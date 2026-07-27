-- ─────────────────────────────────────────────────────────────────────────────
-- Epic 1–3 Prompt 10: Temporal Snapshots & Fact Versioning
--
-- 1. Creates `fact_observations` table — structured intelligence with full
--    provenance, versioning, temporal validity (validFrom/validTo), and
--    snapshot linkage.
-- 2. Creates `snapshots` table — frozen view of facts at a point in time
--    (e.g., at application submission).
-- 3. Adds `snapshot_id` FK to `job_applications` to link each application
--    to the snapshot of facts taken at creation time.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. fact_observations table ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "fact_observations" (
    "id"                    UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"               UUID         NOT NULL,
    "fact_type"             TEXT         NOT NULL,
    "fact_data"             JSONB        NOT NULL,
    "source_type"           TEXT         NOT NULL,
    "source_id"             TEXT         NOT NULL,
    "source_version"        TEXT,
    "extraction_method"     TEXT         NOT NULL,
    "model_version"         TEXT,
    "confidence"            DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "evidence_reference"    TEXT,

    -- Temporal validity (Prompt 10)
    "valid_from"            TIMESTAMPTZ,
    "valid_to"              TIMESTAMPTZ,

    -- Observation context (Prompt 10)
    "observed_at"           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "snapshot_id"           UUID,

    "extracted_at"          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "created_at"            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updated_at"            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- Versioning fields (Prompt 9)
    "version"               INTEGER      NOT NULL DEFAULT 1,
    "is_current"            BOOLEAN      NOT NULL DEFAULT TRUE,
    "superseded_by_id"      UUID,
    "superseded_at"         TIMESTAMPTZ,

    -- Correction fields (Prompt 11)
    "corrected_by"          UUID,
    "corrected_at"          TIMESTAMPTZ,
    "correction_reason"     TEXT,
    "is_user_corrected"     BOOLEAN      NOT NULL DEFAULT FALSE,

    -- Review fields (Prompt 11)
    "needs_review"          BOOLEAN      NOT NULL DEFAULT FALSE,
    "reviewed_at"           TIMESTAMPTZ,
    "reviewed_by"           UUID,
    "review_status"         TEXT,
    "review_notes"          TEXT,

    -- Soft deletion
    "deleted_at"            TIMESTAMPTZ,

    CONSTRAINT "fact_observations_pkey" PRIMARY KEY ("id")
);

COMMENT ON TABLE "fact_observations" IS
    'Individual structured intelligence facts with provenance, versioning, and temporal validity.';
COMMENT ON COLUMN "fact_observations"."valid_from" IS
    'When this fact became true (e.g., employment start date, skill acquisition date).';
COMMENT ON COLUMN "fact_observations"."valid_to" IS
    'When this fact ceased to be true (e.g., employment end date, skill obsolescence). NULL means still true.';
COMMENT ON COLUMN "fact_observations"."observed_at" IS
    'When the fact was observed from the source document/email.';
COMMENT ON COLUMN "fact_observations"."snapshot_id" IS
    'FK to snapshots — links this fact copy to a frozen point-in-time view.';

-- Analytical & lookup indexes
CREATE INDEX IF NOT EXISTS "fact_observations_user_fact_current_idx"
    ON "fact_observations" ("user_id", "fact_type", "is_current");
CREATE INDEX IF NOT EXISTS "fact_observations_user_current_idx"
    ON "fact_observations" ("user_id", "is_current");
CREATE INDEX IF NOT EXISTS "fact_observations_source_idx"
    ON "fact_observations" ("source_id", "source_type");
CREATE INDEX IF NOT EXISTS "fact_observations_user_observed_at_idx"
    ON "fact_observations" ("user_id", "observed_at");
CREATE INDEX IF NOT EXISTS "fact_observations_snapshot_id_idx"
    ON "fact_observations" ("snapshot_id");
CREATE INDEX IF NOT EXISTS "fact_observations_review_idx"
    ON "fact_observations" ("needs_review", "review_status");
CREATE INDEX IF NOT EXISTS "fact_observations_valid_from_idx"
    ON "fact_observations" ("valid_from") WHERE "valid_from" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "fact_observations_valid_to_idx"
    ON "fact_observations" ("valid_to") WHERE "valid_to" IS NOT NULL;

ALTER TABLE "fact_observations"
    ADD CONSTRAINT "fact_observations_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 2. snapshots table ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "snapshots" (
    "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"       UUID         NOT NULL,
    "snapshot_type" TEXT         NOT NULL,
    "reference_id"  UUID,
    "captured_at"   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "description"   TEXT,
    "created_at"    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updated_at"    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "snapshots_pkey" PRIMARY KEY ("id")
);

COMMENT ON TABLE "snapshots" IS
    'Frozen point-in-time views of a user''s facts. Used to preserve historical context for job applications.';
COMMENT ON COLUMN "snapshots"."snapshot_type" IS
    'APPLICATION, MONTHLY, RESUME_VERSION — what kind of event triggered the snapshot.';
COMMENT ON COLUMN "snapshots"."reference_id" IS
    'FK to the triggering entity (applicationId, resumeId, etc.).';

CREATE INDEX IF NOT EXISTS "snapshots_user_type_idx"
    ON "snapshots" ("user_id", "snapshot_type");
CREATE INDEX IF NOT EXISTS "snapshots_reference_id_idx"
    ON "snapshots" ("reference_id");
CREATE INDEX IF NOT EXISTS "snapshots_captured_at_idx"
    ON "snapshots" ("captured_at");

ALTER TABLE "snapshots"
    ADD CONSTRAINT "snapshots_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Link fact observations to snapshots
ALTER TABLE "fact_observations"
    ADD CONSTRAINT "fact_observations_snapshot_id_fkey"
    FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Self-reference for fact versioning
ALTER TABLE "fact_observations"
    ADD CONSTRAINT "fact_observations_superseded_by_id_fkey"
    FOREIGN KEY ("superseded_by_id") REFERENCES "fact_observations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 3. job_applications.snapshot_id ──────────────────────────────────────────

ALTER TABLE "job_applications"
    ADD COLUMN IF NOT EXISTS "snapshot_id" UUID;

COMMENT ON COLUMN "job_applications"."snapshot_id" IS
    'FK to snapshots — the frozen fact view captured at the time this application was created/submitted.';

CREATE INDEX IF NOT EXISTS "job_applications_snapshot_id_idx"
    ON "job_applications" ("snapshot_id");

ALTER TABLE "job_applications"
    ADD CONSTRAINT "job_applications_snapshot_id_fkey"
    FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 4. Missing users columns (align to schema.prisma) ────────────────────────
-- Safe, idempotent additions: name, tenant_id already added by prior migrations.

ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "name" TEXT;

-- ── 5. outcome_events table (Prompt 12) ──────────────────────────────────────
-- Explicit, typed, timestamped, sourced, evidence-backed outcome observations
-- for job applications — foundation of the Personal Outcome Moat.

CREATE TABLE IF NOT EXISTS "outcome_events" (
    "id"                    UUID         NOT NULL DEFAULT gen_random_uuid(),
    "application_id"        UUID         NOT NULL,
    "user_id"               UUID         NOT NULL,
    "outcome_type"          TEXT         NOT NULL,
    "outcome_category"      TEXT         NOT NULL,
    "outcome_status"        TEXT         NOT NULL,
    "explicit"              BOOLEAN      NOT NULL,

    -- Metadata
    "source_type"           TEXT         NOT NULL,
    "source_id"             TEXT,
    "source_data"           JSONB,

    -- Evidence (for trust)
    "evidence"              TEXT,
    "confidence"            DOUBLE PRECISION NOT NULL,

    -- Temporal
    "occurred_at"           TIMESTAMPTZ  NOT NULL,
    "recorded_at"           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- Derived status (for backward compatibility)
    "resulting_status"      TEXT,

    -- Versioning
    "version"               INTEGER      NOT NULL DEFAULT 1,
    "superseded_by_id"      UUID,
    "is_current"            BOOLEAN      NOT NULL DEFAULT TRUE,
    "deleted_at"            TIMESTAMPTZ,

    "created_at"            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updated_at"            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "outcome_events_pkey" PRIMARY KEY ("id")
);

COMMENT ON TABLE "outcome_events" IS
    'Explicit outcome events observed for job applications (Prompt 12).';
COMMENT ON COLUMN "outcome_events"."explicit" IS
    'True if directly observed (email/manual); false if inferred (rules/import).';
COMMENT ON COLUMN "outcome_events"."occurred_at" IS
    'When the outcome actually happened (from source timestamp).';
COMMENT ON COLUMN "outcome_events"."recorded_at" IS
    'When ApplyWise recorded the outcome (wall-clock at insertion).';

CREATE INDEX IF NOT EXISTS "outcome_events_application_id_idx"
    ON "outcome_events" ("application_id");
CREATE INDEX IF NOT EXISTS "outcome_events_user_id_idx"
    ON "outcome_events" ("user_id");
CREATE INDEX IF NOT EXISTS "outcome_events_occurred_at_idx"
    ON "outcome_events" ("occurred_at");
CREATE INDEX IF NOT EXISTS "outcome_events_outcome_type_idx"
    ON "outcome_events" ("outcome_type");
CREATE INDEX IF NOT EXISTS "outcome_events_user_outcome_occurred_idx"
    ON "outcome_events" ("user_id", "outcome_type", "occurred_at");

ALTER TABLE "outcome_events"
    ADD CONSTRAINT "outcome_events_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "job_applications"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outcome_events"
    ADD CONSTRAINT "outcome_events_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 6. action_events table (Prompt 13) ──────────────────────────────────────
-- User Action / Strategy Log: records every meaningful user action with
-- strategy-tags so we can later correlate "what did user do" with "what
-- happened" (outcomes). This is the second half of the strategy-outcome moat.

CREATE TABLE IF NOT EXISTS "action_events" (
    "id"                    UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"               UUID         NOT NULL,
    "application_id"        UUID,
    "opportunity_id"        UUID,

    -- Action details
    "action_type"           TEXT         NOT NULL,
    "action_subtype"        TEXT,

    -- Strategy metadata
    "strategy_tags"         TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    "context"               JSONB,

    -- Source
    "source_type"           TEXT         NOT NULL DEFAULT 'USER_ACTION',
    "source_id"             TEXT,

    -- Temporal
    "occurred_at"           TIMESTAMPTZ  NOT NULL,
    "recorded_at"           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- Metadata
    "notes"                 TEXT,
    "confidence"            DOUBLE PRECISION,

    "created_at"            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updated_at"            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "action_events_pkey" PRIMARY KEY ("id")
);

COMMENT ON TABLE "action_events" IS
    'User actions and strategy metadata (Prompt 13) — half of the action→outcome correlation moat.';
COMMENT ON COLUMN "action_events"."strategy_tags" IS
    'Free-form but conventionally-named tags: e.g. "resume_v3", "early_application", "with_referral", "tailored_resume".';
COMMENT ON COLUMN "action_events"."context" IS
    'Structured, queryable context: e.g. { "resumeVersionId": UUID, "applicationChannel": "company_website" }.';
COMMENT ON COLUMN "action_events"."source_type" IS
    'USER_ACTION (user clicked button / filled form) | SYSTEM_TRACKED (we observed internally) | IMPORTED (bulk import).';
COMMENT ON COLUMN "action_events"."confidence" IS
    'NULL for USER_ACTION (ground truth); 0.0–1.0 for inferred/system-tracked actions.';

CREATE INDEX IF NOT EXISTS "action_events_user_id_idx"
    ON "action_events" ("user_id");
CREATE INDEX IF NOT EXISTS "action_events_application_id_idx"
    ON "action_events" ("application_id");
CREATE INDEX IF NOT EXISTS "action_events_opportunity_id_idx"
    ON "action_events" ("opportunity_id");
CREATE INDEX IF NOT EXISTS "action_events_action_type_idx"
    ON "action_events" ("action_type");
CREATE INDEX IF NOT EXISTS "action_events_occurred_at_idx"
    ON "action_events" ("occurred_at");

ALTER TABLE "action_events"
    ADD CONSTRAINT "action_events_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "action_events"
    ADD CONSTRAINT "action_events_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "job_applications"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "action_events"
    ADD CONSTRAINT "action_events_opportunity_id_fkey"
    FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
