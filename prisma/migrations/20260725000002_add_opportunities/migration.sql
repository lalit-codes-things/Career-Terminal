-- ─────────────────────────────────────────────────────────────────────────────
-- Epic 1–3: Canonical Opportunity table (Prompt 2 of 19)
--
-- 1. Creates `opportunities` table — global, company-scoped canonical job
--    openings with temporal fields (first_seen_at / last_seen_at) for
--    intelligence signals.
-- 2. Adds nullable `opportunity_id` FK to `job_applications` so that each
--    application can point at its canonical opportunity.
-- 3. Old denormalized columns (`company_name`, `role_title`, `location`, …)
--    on `job_applications` are preserved for backward compatibility.
--
-- This is a compatibility-first migration: no existing columns are dropped
-- and the new FK is nullable. The backfill script that runs next populates
-- `opportunity_id` for rows that can be matched.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── opportunities table ──────────────────────────────────────────────────────

CREATE TABLE "opportunities" (
    "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
    "company_id"       UUID         NOT NULL,
    "title"            TEXT         NOT NULL,
    "description"      TEXT,
    "location"         TEXT,
    "salary_range"     JSONB,
    "requirements"     JSONB,
    "url"              TEXT,
    "source_metadata"  JSONB,
    "first_seen_at"    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "last_seen_at"     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "is_current"       BOOLEAN      NOT NULL DEFAULT TRUE,
    "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updated_at"       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- FK: opportunity → company (CASCADE on delete — no orphan opportunities)
ALTER TABLE "opportunities"
    ADD CONSTRAINT "opportunities_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Deduplication & analytical indexes
CREATE INDEX "opportunities_company_id_title_idx"
    ON "opportunities" ("company_id", "title");

CREATE INDEX "opportunities_company_id_idx"
    ON "opportunities" ("company_id");

CREATE INDEX "opportunities_is_current_idx"
    ON "opportunities" ("is_current");

CREATE INDEX "opportunities_first_seen_at_idx"
    ON "opportunities" ("first_seen_at");

CREATE INDEX "opportunities_last_seen_at_idx"
    ON "opportunities" ("last_seen_at");

-- URL-based exact-match lookup (when external job URLs are available)
CREATE INDEX "opportunities_url_idx"
    ON "opportunities" ("url");

-- ── job_applications.opportunity_id ──────────────────────────────────────────

ALTER TABLE "job_applications"
    ADD COLUMN "opportunity_id" UUID;

ALTER TABLE "job_applications"
    ADD CONSTRAINT "job_applications_opportunity_id_fkey"
    FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "job_applications_opportunity_id_idx"
    ON "job_applications" ("opportunity_id");

COMMIT;
