-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION: 20260805000001_gap_fill_model_prediction
-- Wave 1 Step 4 — Gap-fill Model, Prediction, PredictionFeedback tables
-- Adds: latency, cost, confidence/calibration, output_validation tracking
-- Does NOT create new tables — extends existing ones only.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── models ──────────────────────────────────────────────────────────────────
-- Add provider-level metadata needed to track capability framework routing.

ALTER TABLE "models"
  ADD COLUMN IF NOT EXISTS "context_window"     INTEGER          DEFAULT 32768,
  ADD COLUMN IF NOT EXISTS "max_output_tokens"  INTEGER          DEFAULT 4096,
  ADD COLUMN IF NOT EXISTS "cost_per_1k_input"  DOUBLE PRECISION DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cost_per_1k_output" DOUBLE PRECISION DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "supports_json_mode" BOOLEAN          NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "supports_streaming" BOOLEAN          NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "default_temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
  ADD COLUMN IF NOT EXISTS "metadata"           JSONB            NOT NULL DEFAULT '{}';

-- ─── predictions ─────────────────────────────────────────────────────────────
-- Add latency, cost, output validation, and capability tracking.

ALTER TABLE "predictions"
  ADD COLUMN IF NOT EXISTS "capability"          TEXT,
  ADD COLUMN IF NOT EXISTS "recruiter_id"        UUID,
  ADD COLUMN IF NOT EXISTS "latency_ms"          INTEGER,
  ADD COLUMN IF NOT EXISTS "input_tokens"        INTEGER,
  ADD COLUMN IF NOT EXISTS "output_tokens"       INTEGER,
  ADD COLUMN IF NOT EXISTS "estimated_cost_usd"  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "raw_output"          JSONB,
  ADD COLUMN IF NOT EXISTS "output_valid"        BOOLEAN,
  ADD COLUMN IF NOT EXISTS "output_errors"       JSONB            DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "confidence_band"     TEXT,
  ADD COLUMN IF NOT EXISTS "requires_review"     BOOLEAN          NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "review_reason"       TEXT,
  ADD COLUMN IF NOT EXISTS "provider"            TEXT,
  ADD COLUMN IF NOT EXISTS "planner_context"     JSONB            DEFAULT '{}';

CREATE INDEX IF NOT EXISTS "predictions_capability_idx"
  ON "predictions" ("capability")
  WHERE "capability" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "predictions_recruiter_id_idx"
  ON "predictions" ("recruiter_id")
  WHERE "recruiter_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "predictions_output_valid_idx"
  ON "predictions" ("output_valid")
  WHERE "output_valid" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "predictions_requires_review_idx"
  ON "predictions" ("requires_review")
  WHERE "requires_review" = true;

CREATE INDEX IF NOT EXISTS "predictions_provider_idx"
  ON "predictions" ("provider")
  WHERE "provider" IS NOT NULL;

-- ─── prediction_feedback ─────────────────────────────────────────────────────
-- Add calibration fields for confidence tracking.

ALTER TABLE "prediction_feedback"
  ADD COLUMN IF NOT EXISTS "expected_value"      JSONB,
  ADD COLUMN IF NOT EXISTS "actual_value"        JSONB,
  ADD COLUMN IF NOT EXISTS "confidence_at_pred"  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "outcome_occurred_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "calibration_bucket"  TEXT,
  ADD COLUMN IF NOT EXISTS "metadata"            JSONB  DEFAULT '{}';

CREATE INDEX IF NOT EXISTS "prediction_feedback_calibration_bucket_idx"
  ON "prediction_feedback" ("calibration_bucket")
  WHERE "calibration_bucket" IS NOT NULL;

-- ─── Seed default models ──────────────────────────────────────────────────────
-- Insert the two DeepSeek model rows so ExtractionRun FK constraints succeed.
-- Uses ON CONFLICT DO UPDATE so re-running the migration is idempotent.

INSERT INTO "models" (
  "id", "name", "version", "provider", "capabilities",
  "cost_per_1k_input", "cost_per_1k_output",
  "context_window", "max_output_tokens", "is_active"
) VALUES
  ('deepseek-chat',     'DeepSeek Chat',     'v3',    'deepseek',    ARRAY['extract','infer','reason','chat'],
   0.00014, 0.00028, 65536, 4096, true),
  ('deepseek-reasoner', 'DeepSeek Reasoner', 'r1',    'deepseek',    ARRAY['reason','predict','verify'],
   0.00055, 0.00219, 65536, 8192, true),
  ('deepseek/deepseek-chat', 'DeepSeek Chat (OR)', 'v3', 'openrouter', ARRAY['extract','infer','reason','chat'],
   0.00014, 0.00028, 65536, 4096, true),
  ('deepseek/deepseek-r1',   'DeepSeek R1 (OR)',   'r1', 'openrouter', ARRAY['reason','predict','verify'],
   0.00055, 0.00219, 65536, 8192, true),
  ('stub-balanced', 'Stub Balanced', 'test', 'stub', ARRAY['extract','infer','reason'],
   0, 0, 4096, 2048, true)
ON CONFLICT ("id") DO UPDATE SET
  "name"               = EXCLUDED."name",
  "provider"           = EXCLUDED."provider",
  "capabilities"       = EXCLUDED."capabilities",
  "cost_per_1k_input"  = EXCLUDED."cost_per_1k_input",
  "cost_per_1k_output" = EXCLUDED."cost_per_1k_output",
  "is_active"          = EXCLUDED."is_active",
  "updated_at"         = now();
