-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION: 20260803000002_add_ai_extraction_intelligence
-- Epic 6 Batch 3 — AI Extraction Pipeline, Recruiter Intelligence Engine
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Enum additions ───────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "AiExtractionStatus" AS ENUM (
    'PENDING',
    'RUNNING',
    'COMPLETED',
    'FAILED',
    'REQUIRES_REVIEW'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ─── ai_prompt_templates ──────────────────────────────────────────────────────
-- Versioned prompt templates. Extraction runs reference a specific template+version
-- so every AI output is fully reproducible.

CREATE TABLE IF NOT EXISTS "ai_prompt_templates" (
  "id"               UUID        NOT NULL DEFAULT gen_random_uuid(),
  "template_id"      TEXT        NOT NULL,
  "name"             TEXT        NOT NULL,
  "version"          TEXT        NOT NULL,
  "tier"             TEXT        NOT NULL,
  "system_prompt"    TEXT        NOT NULL,
  "user_prompt_tpl"  TEXT        NOT NULL,
  "output_schema"    JSONB       NOT NULL DEFAULT '{}',
  "max_tokens"       INTEGER     NOT NULL,
  "temperature"      DOUBLE PRECISION NOT NULL DEFAULT 0.1,
  "deprecated"       BOOLEAN     NOT NULL DEFAULT false,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "ai_prompt_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_prompt_templates_template_id_key"
  ON "ai_prompt_templates" ("template_id");

CREATE INDEX IF NOT EXISTS "ai_prompt_templates_deprecated_idx"
  ON "ai_prompt_templates" ("deprecated");

-- ─── ai_extraction_runs ───────────────────────────────────────────────────────
-- One row per AI extraction invocation. Records provider, model, token usage,
-- cost, latency, confidence, and human-review status.

CREATE TABLE IF NOT EXISTS "ai_extraction_runs" (
  "id"                  UUID                   NOT NULL DEFAULT gen_random_uuid(),
  "extraction_id"       TEXT                   NOT NULL,
  "tenant_id"           UUID                   NOT NULL,
  "template_id"         TEXT                   NOT NULL,
  "template_version"    TEXT                   NOT NULL,
  "source_type"         TEXT                   NOT NULL,
  "source_id"           TEXT                   NOT NULL,
  "provider"            TEXT                   NOT NULL,
  "model"               TEXT                   NOT NULL,
  "status"              "AiExtractionStatus"   NOT NULL DEFAULT 'PENDING',
  "input_tokens"        INTEGER                NOT NULL DEFAULT 0,
  "output_tokens"       INTEGER                NOT NULL DEFAULT 0,
  "estimated_cost_usd"  DOUBLE PRECISION       NOT NULL DEFAULT 0,
  "latency_ms"          INTEGER                NOT NULL DEFAULT 0,
  "overall_confidence"  DOUBLE PRECISION       NOT NULL DEFAULT 0,
  "requires_review"     BOOLEAN                NOT NULL DEFAULT false,
  "review_reason"       TEXT,
  "error"               TEXT,
  "provenance_json"     JSONB                  NOT NULL DEFAULT '{}',
  "requested_at"        TIMESTAMPTZ            NOT NULL,
  "completed_at"        TIMESTAMPTZ,
  "created_at"          TIMESTAMPTZ            NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMPTZ            NOT NULL DEFAULT now(),

  CONSTRAINT "ai_extraction_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_extraction_runs_extraction_id_key"
  ON "ai_extraction_runs" ("extraction_id");

CREATE INDEX IF NOT EXISTS "ai_extraction_runs_tenant_id_idx"
  ON "ai_extraction_runs" ("tenant_id");

CREATE INDEX IF NOT EXISTS "ai_extraction_runs_template_id_idx"
  ON "ai_extraction_runs" ("template_id");

CREATE INDEX IF NOT EXISTS "ai_extraction_runs_status_idx"
  ON "ai_extraction_runs" ("status");

CREATE INDEX IF NOT EXISTS "ai_extraction_runs_source_idx"
  ON "ai_extraction_runs" ("source_type", "source_id");

CREATE INDEX IF NOT EXISTS "ai_extraction_runs_requested_at_idx"
  ON "ai_extraction_runs" ("requested_at");

ALTER TABLE "ai_extraction_runs"
  ADD CONSTRAINT "ai_extraction_runs_template_id_fkey"
  FOREIGN KEY ("template_id")
  REFERENCES "ai_prompt_templates" ("template_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE
  NOT VALID;

-- ─── ai_extraction_results ────────────────────────────────────────────────────
-- Individual field extraction results within a run.
-- Each row is one extracted field with its value, confidence, evidence, provenance.

CREATE TABLE IF NOT EXISTS "ai_extraction_results" (
  "id"                UUID             NOT NULL DEFAULT gen_random_uuid(),
  "extraction_run_id" UUID             NOT NULL,
  "field_name"        TEXT             NOT NULL,
  "raw_value"         TEXT             NOT NULL,
  "normalized_value"  TEXT,
  "structured_value"  JSONB            NOT NULL DEFAULT '{}',
  "confidence"        DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "confidence_band"   TEXT             NOT NULL DEFAULT 'medium',
  "evidence_json"     JSONB            NOT NULL DEFAULT '[]',
  "provenance_json"   JSONB            NOT NULL DEFAULT '{}',
  "requires_review"   BOOLEAN          NOT NULL DEFAULT false,
  "created_at"        TIMESTAMPTZ      NOT NULL DEFAULT now(),

  CONSTRAINT "ai_extraction_results_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_extraction_results_run_id_idx"
  ON "ai_extraction_results" ("extraction_run_id");

CREATE INDEX IF NOT EXISTS "ai_extraction_results_field_name_idx"
  ON "ai_extraction_results" ("field_name");

CREATE INDEX IF NOT EXISTS "ai_extraction_results_confidence_idx"
  ON "ai_extraction_results" ("confidence");

ALTER TABLE "ai_extraction_results"
  ADD CONSTRAINT "ai_extraction_results_run_fkey"
  FOREIGN KEY ("extraction_run_id")
  REFERENCES "ai_extraction_runs" ("id")
  ON DELETE CASCADE;

-- ─── ai_model_usage ───────────────────────────────────────────────────────────
-- Token accounting and cost tracking per model call.
-- Supports cost attribution by tenant, template, provider, and model.

CREATE TABLE IF NOT EXISTS "ai_model_usage" (
  "id"                  UUID             NOT NULL DEFAULT gen_random_uuid(),
  "usage_id"            TEXT             NOT NULL,
  "extraction_run_id"   UUID,
  "tenant_id"           UUID             NOT NULL,
  "provider"            TEXT             NOT NULL,
  "model"               TEXT             NOT NULL,
  "template_id"         TEXT             NOT NULL,
  "input_tokens"        INTEGER          NOT NULL,
  "output_tokens"       INTEGER          NOT NULL,
  "total_tokens"        INTEGER          NOT NULL,
  "estimated_cost_usd"  DOUBLE PRECISION NOT NULL,
  "latency_ms"          INTEGER          NOT NULL,
  "success"             BOOLEAN          NOT NULL DEFAULT true,
  "error"               TEXT,
  "recorded_at"         TIMESTAMPTZ      NOT NULL,
  "created_at"          TIMESTAMPTZ      NOT NULL DEFAULT now(),

  CONSTRAINT "ai_model_usage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_model_usage_usage_id_key"
  ON "ai_model_usage" ("usage_id");

CREATE INDEX IF NOT EXISTS "ai_model_usage_tenant_id_idx"
  ON "ai_model_usage" ("tenant_id");

CREATE INDEX IF NOT EXISTS "ai_model_usage_provider_model_idx"
  ON "ai_model_usage" ("provider", "model");

CREATE INDEX IF NOT EXISTS "ai_model_usage_template_id_idx"
  ON "ai_model_usage" ("template_id");

CREATE INDEX IF NOT EXISTS "ai_model_usage_recorded_at_idx"
  ON "ai_model_usage" ("recorded_at");

CREATE INDEX IF NOT EXISTS "ai_model_usage_success_idx"
  ON "ai_model_usage" ("success");

ALTER TABLE "ai_model_usage"
  ADD CONSTRAINT "ai_model_usage_run_fkey"
  FOREIGN KEY ("extraction_run_id")
  REFERENCES "ai_extraction_runs" ("id")
  ON DELETE SET NULL;

-- ─── ai_human_review_queue ────────────────────────────────────────────────────
-- Low-confidence extractions queued for human review.
-- Populated automatically by the extraction pipeline's human-review hook.

CREATE TABLE IF NOT EXISTS "ai_human_review_queue" (
  "id"              UUID             NOT NULL DEFAULT gen_random_uuid(),
  "review_id"       TEXT             NOT NULL,
  "extraction_id"   TEXT             NOT NULL,
  "tenant_id"       UUID             NOT NULL,
  "reason"          TEXT             NOT NULL,
  "flagged_fields"  JSONB            NOT NULL DEFAULT '[]',
  "extracted_data"  JSONB            NOT NULL DEFAULT '{}',
  "confidence"      DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "status"          TEXT             NOT NULL DEFAULT 'pending',
  "reviewed_at"     TIMESTAMPTZ,
  "reviewed_by"     UUID,
  "review_notes"    TEXT,
  "queued_at"       TIMESTAMPTZ      NOT NULL,
  "created_at"      TIMESTAMPTZ      NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ      NOT NULL DEFAULT now(),

  CONSTRAINT "ai_human_review_queue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_human_review_queue_review_id_key"
  ON "ai_human_review_queue" ("review_id");

CREATE INDEX IF NOT EXISTS "ai_human_review_queue_extraction_id_idx"
  ON "ai_human_review_queue" ("extraction_id");

CREATE INDEX IF NOT EXISTS "ai_human_review_queue_tenant_id_idx"
  ON "ai_human_review_queue" ("tenant_id");

CREATE INDEX IF NOT EXISTS "ai_human_review_queue_status_idx"
  ON "ai_human_review_queue" ("status");

CREATE INDEX IF NOT EXISTS "ai_human_review_queue_queued_at_idx"
  ON "ai_human_review_queue" ("queued_at");

-- ─── recruiter_intelligence_profiles ─────────────────────────────────────────
-- Materialized recruiter intelligence profiles generated by the intelligence engine.
-- One row per recruiter per generation run; versioned for historical comparison.

CREATE TABLE IF NOT EXISTS "recruiter_intelligence_profiles" (
  "id"                    UUID             NOT NULL DEFAULT gen_random_uuid(),
  "profile_id"            TEXT             NOT NULL,
  "recruiter_id"          UUID             NOT NULL,
  "summary_text"          TEXT             NOT NULL,
  "summary_confidence"    DOUBLE PRECISION NOT NULL,
  "hiring_focus_json"     JSONB            NOT NULL DEFAULT '{}',
  "technical_focus_json"  JSONB            NOT NULL DEFAULT '{}',
  "industry_focus_json"   JSONB            NOT NULL DEFAULT '{}',
  "organization_ctx_json" JSONB            NOT NULL DEFAULT '{}',
  "communication_style"   TEXT             NOT NULL,
  "recruiting_style"      TEXT             NOT NULL,
  "velocity_signals_json" JSONB            NOT NULL DEFAULT '{}',
  "relationship_json"     JSONB            NOT NULL DEFAULT '{}',
  "candidate_fit_json"    JSONB            NOT NULL DEFAULT '[]',
  "evidence_refs_json"    JSONB            NOT NULL DEFAULT '[]',
  "overall_confidence"    DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "fact_count"            INTEGER          NOT NULL DEFAULT 0,
  "inference_count"       INTEGER          NOT NULL DEFAULT 0,
  "version"               INTEGER          NOT NULL DEFAULT 1,
  "generated_at"          TIMESTAMPTZ      NOT NULL,
  "created_at"            TIMESTAMPTZ      NOT NULL DEFAULT now(),
  "updated_at"            TIMESTAMPTZ      NOT NULL DEFAULT now(),

  CONSTRAINT "recruiter_intelligence_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "recruiter_intelligence_profiles_profile_id_key"
  ON "recruiter_intelligence_profiles" ("profile_id");

CREATE INDEX IF NOT EXISTS "recruiter_intelligence_profiles_recruiter_id_idx"
  ON "recruiter_intelligence_profiles" ("recruiter_id");

CREATE INDEX IF NOT EXISTS "recruiter_intelligence_profiles_generated_at_idx"
  ON "recruiter_intelligence_profiles" ("generated_at");

CREATE INDEX IF NOT EXISTS "recruiter_intelligence_profiles_confidence_idx"
  ON "recruiter_intelligence_profiles" ("overall_confidence");

-- ─── Update triggers ──────────────────────────────────────────────────────────
-- Keeps updated_at current on mutable tables.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER "ai_prompt_templates_updated_at"
    BEFORE UPDATE ON "ai_prompt_templates"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TRIGGER "ai_extraction_runs_updated_at"
    BEFORE UPDATE ON "ai_extraction_runs"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TRIGGER "ai_human_review_queue_updated_at"
    BEFORE UPDATE ON "ai_human_review_queue"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TRIGGER "recruiter_intelligence_profiles_updated_at"
    BEFORE UPDATE ON "recruiter_intelligence_profiles"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN null; END $$;
