-- Epic 4 Prompt 4 — Canonical Candidate Intelligence
--
-- Adds the canonical_candidate_intelligence table which is the single
-- queryable surface for current candidate intelligence per user.
--
-- Design:
--   - One row per (user_id, fact_type, deduplication_key).
--   - Points to the winning fact_observation via source_fact_id.
--     Raw data is NOT duplicated here.
--   - provenance_id is denormalised for fast provenance look-up.
--   - Materialisation is idempotent: upsert on the unique constraint.
--   - Historical fact_observations are never touched by this table.
--
-- Safety:
--   - source_fact_id references fact_observations with ON DELETE RESTRICT
--     so a canonical row can never point to a deleted fact silently.
--   - provenance_id references fact_provenance with ON DELETE RESTRICT.
--   - No backfill needed: the table starts empty and is populated by the
--     materialisation service going forward.

BEGIN;

CREATE TABLE IF NOT EXISTS "canonical_candidate_intelligence" (
  "id"                UUID        NOT NULL DEFAULT gen_random_uuid(),
  "user_id"           UUID        NOT NULL,
  "cell_id"           TEXT        NOT NULL,
  "fact_type"         TEXT        NOT NULL,
  "deduplication_key" TEXT        NOT NULL,
  "source_fact_id"    UUID        NOT NULL,
  "provenance_id"     UUID        NOT NULL,
  "confidence"        DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "last_observed_at"  TIMESTAMPTZ NOT NULL,
  "source_version"    TEXT,
  "is_active"         BOOLEAN     NOT NULL DEFAULT TRUE,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "canonical_candidate_intelligence_pkey" PRIMARY KEY ("id")
);

-- Ownership FK
ALTER TABLE "canonical_candidate_intelligence"
  ADD CONSTRAINT "canonical_intelligence_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Source fact FK — RESTRICT prevents silent orphans
ALTER TABLE "canonical_candidate_intelligence"
  ADD CONSTRAINT "canonical_intelligence_source_fact_id_fkey"
  FOREIGN KEY ("source_fact_id") REFERENCES "fact_observations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Provenance FK — RESTRICT preserves traceability
ALTER TABLE "canonical_candidate_intelligence"
  ADD CONSTRAINT "canonical_intelligence_provenance_id_fkey"
  FOREIGN KEY ("provenance_id") REFERENCES "fact_provenance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One active canonical record per user × factType × deduplicationKey.
-- This is the idempotency constraint — upserts target this key.
CREATE UNIQUE INDEX IF NOT EXISTS "unique_canonical_per_user_type_key"
  ON "canonical_candidate_intelligence" ("user_id", "fact_type", "deduplication_key");

-- Read-model queries: current intelligence for a user
CREATE INDEX IF NOT EXISTS "canonical_intelligence_user_type_active_idx"
  ON "canonical_candidate_intelligence" ("user_id", "fact_type", "is_active");

CREATE INDEX IF NOT EXISTS "canonical_intelligence_user_active_idx"
  ON "canonical_candidate_intelligence" ("user_id", "is_active");

-- Provenance and source-fact look-ups
CREATE INDEX IF NOT EXISTS "canonical_intelligence_source_fact_idx"
  ON "canonical_candidate_intelligence" ("source_fact_id");

CREATE INDEX IF NOT EXISTS "canonical_intelligence_provenance_idx"
  ON "canonical_candidate_intelligence" ("provenance_id");

CREATE INDEX IF NOT EXISTS "canonical_intelligence_cell_idx"
  ON "canonical_candidate_intelligence" ("cell_id");

COMMIT;

-- Backfill: none required.
-- The table starts empty. The materialisation service will populate it
-- incrementally as future extraction runs complete.
-- Existing fact_observations from prior runs remain available for
-- manual replay via ExtractionRunService if desired.
