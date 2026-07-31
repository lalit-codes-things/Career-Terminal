-- ─────────────────────────────────────────────────────────────────────────────
-- Epic 1–3: Idempotency & deduplication foundation
--
-- 1. Creates `idempotency_records` table — generic at-least-once delivery
--    guard for any write operation (Gmail webhooks, BullMQ retries, …).
-- 2. Adds a partial UNIQUE constraint on `job_applications(user_id, opportunity_id)`
--    to enforce the "one application per (user, opportunity)" business rule.
--    Rows with `opportunity_id IS NULL` are not covered (opportunity_id may
--    be filled later by the opportunity resolver).
-- 3. Adds a partial UNIQUE constraint on `application_sources(provider, provider_message_id)`
--    to guarantee a given email message cannot link back to multiple source
--    rows.  Rows without `provider_message_id` are excluded (manual sources).
--
-- If any existing rows violate these constraints the migration will fail
-- loudly — the operator should run the application-dedup backfill script
-- first (scripts/backfill/backfill-dedup-applications.ts) before applying.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. idempotency_records ──────────────────────────────────────────────────

CREATE TABLE "idempotency_records" (
    "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
    "key"             TEXT         NOT NULL,
    "operation_type"  TEXT         NOT NULL,
    "result_id"       UUID         NOT NULL,
    "result_data"     JSONB,
    "created_at"      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "expires_at"      TIMESTAMPTZ  NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "idempotency_records_key_unique" UNIQUE ("key")
);

CREATE INDEX "idempotency_records_operation_type_idx"
    ON "idempotency_records" ("operation_type");

CREATE INDEX "idempotency_records_expires_at_idx"
    ON "idempotency_records" ("expires_at");

CREATE INDEX "idempotency_records_key_expires_at_idx"
    ON "idempotency_records" ("key", "expires_at");

COMMENT ON TABLE "idempotency_records" IS
    'Atomic guard against duplicate write operations. See IdempotencyService.';

-- ── 2. Application ↔ opportunity uniqueness (partial) ────────────────────────
--
-- Prisma's runtime `@@unique([userId, opportunityId])` declaration creates
-- this as a partial unique index in Postgres thanks to Prisma's handling of
-- nullable columns in unique composites — we write it explicitly here so
-- the on-disk object matches the Prisma schema declaration exactly.

CREATE UNIQUE INDEX IF NOT EXISTS "unique_user_opportunity_application"
    ON "job_applications" ("user_id", "opportunity_id")
    WHERE "opportunity_id" IS NOT NULL AND "user_id" IS NOT NULL;

-- ── 3. Application source uniqueness (partial) ───────────────────────────────
--
-- A single email message can only be recorded as a source for one
-- application row.  Manual sources (no provider_message_id) are excluded.

CREATE UNIQUE INDEX IF NOT EXISTS "unique_provider_message_source"
    ON "application_sources" ("provider", "provider_message_id")
    WHERE "provider_message_id" IS NOT NULL;

COMMIT;
