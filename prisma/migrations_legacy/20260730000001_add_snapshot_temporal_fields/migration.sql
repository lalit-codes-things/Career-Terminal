-- Migration: Add temporal snapshot fields (Epic 4 Prompt 10)
-- Adds last_fact_id, schema_version, and candidate_state_json to snapshots.
-- These fields allow point-in-time reconstruction without duplicating FactObservation rows.

ALTER TABLE "snapshots"
  ADD COLUMN IF NOT EXISTS "last_fact_id"          UUID,
  ADD COLUMN IF NOT EXISTS "schema_version"        TEXT NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS "candidate_state_json"  JSONB;

-- Chronological reconstruction index: find the best snapshot ≤ a given timestamp
CREATE INDEX IF NOT EXISTS "snapshots_user_captured_at_idx"
  ON "snapshots" ("user_id", "captured_at" DESC);
