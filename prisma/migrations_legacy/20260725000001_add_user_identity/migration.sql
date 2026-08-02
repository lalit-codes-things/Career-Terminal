-- ─────────────────────────────────────────────────────────────────────────────
-- Epic 1–3: Global user identity & candidate profiles
--
-- 1. Creates users, candidate_profiles, user_id_mapping tables
-- 2. Adds legacy_user_id + UUID FK user_id to all user-scoped tables
-- 3. Backfills users from existing legacy identifiers (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Core identity tables ──────────────────────────────────────────────────────

CREATE TABLE "users" (
    "id"                  UUID         NOT NULL,
    "email"               TEXT,
    "region"              TEXT         NOT NULL DEFAULT 'us-east-1',
    "consent_version"     TEXT         NOT NULL DEFAULT 'v1',
    "consent_granted_at"  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "deleted_at"          TIMESTAMPTZ,
    "deletion_status"     TEXT         NOT NULL DEFAULT 'active',
    "created_at"          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updated_at"          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "users_region_idx" ON "users" ("region");
CREATE INDEX "users_deletion_status_idx" ON "users" ("deletion_status");

-- Partial unique index: email unique among non-deleted users
CREATE UNIQUE INDEX "users_email_unique_active"
    ON "users" ("email")
    WHERE "email" IS NOT NULL AND "deletion_status" <> 'deleted';

CREATE TABLE "candidate_profiles" (
    "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"       UUID         NOT NULL,
    "full_name"     TEXT,
    "phone"         TEXT,
    "location"      TEXT,
    "timezone"      TEXT,
    "preferences"   JSONB        NOT NULL DEFAULT '{}',
    "career_goals"  JSONB,
    "created_at"    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updated_at"    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "candidate_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "candidate_profiles_user_id_key" ON "candidate_profiles" ("user_id");

CREATE TABLE "user_id_mapping" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "external_id"  TEXT         NOT NULL,
    "user_id"      UUID         NOT NULL,
    "created_at"   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "user_id_mapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_id_mapping_external_id_key" ON "user_id_mapping" ("external_id");
CREATE INDEX "user_id_mapping_user_id_idx" ON "user_id_mapping" ("user_id");

-- ── user_email_connections ────────────────────────────────────────────────────

ALTER TABLE "user_email_connections" ADD COLUMN "legacy_user_id" TEXT;
UPDATE "user_email_connections" SET "legacy_user_id" = "user_id" WHERE "legacy_user_id" IS NULL;
ALTER TABLE "user_email_connections" ALTER COLUMN "legacy_user_id" SET NOT NULL;

ALTER TABLE "user_email_connections" ADD COLUMN "user_id_new" UUID;
UPDATE "user_email_connections"
SET "user_id_new" = "user_id"::uuid
WHERE "user_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

ALTER TABLE "user_email_connections" DROP COLUMN "user_id";
ALTER TABLE "user_email_connections" RENAME COLUMN "user_id_new" TO "user_id";

DROP INDEX IF EXISTS "unique_user_provider_email";
CREATE UNIQUE INDEX "unique_user_provider_email"
    ON "user_email_connections" ("legacy_user_id", "provider", "email_address");
CREATE INDEX "user_email_connections_user_id_idx" ON "user_email_connections" ("user_id");

-- ── email_messages ────────────────────────────────────────────────────────────

ALTER TABLE "email_messages" ADD COLUMN "legacy_user_id" TEXT;
UPDATE "email_messages" SET "legacy_user_id" = "user_id" WHERE "legacy_user_id" IS NULL;
ALTER TABLE "email_messages" ALTER COLUMN "legacy_user_id" SET NOT NULL;

ALTER TABLE "email_messages" ADD COLUMN "user_id_new" UUID;
UPDATE "email_messages"
SET "user_id_new" = "user_id"::uuid
WHERE "user_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

ALTER TABLE "email_messages" DROP COLUMN "user_id";
ALTER TABLE "email_messages" RENAME COLUMN "user_id_new" TO "user_id";

DROP INDEX IF EXISTS "unique_user_message";
CREATE UNIQUE INDEX "unique_user_message"
    ON "email_messages" ("legacy_user_id", "provider_message_id");
CREATE INDEX "email_messages_user_id_idx" ON "email_messages" ("user_id");

-- ── gmail_sync_state ──────────────────────────────────────────────────────────

ALTER TABLE "GmailSyncState" ADD COLUMN "legacy_user_id" TEXT;
UPDATE "GmailSyncState" SET "legacy_user_id" = "user_id" WHERE "legacy_user_id" IS NULL;
ALTER TABLE "GmailSyncState" ALTER COLUMN "legacy_user_id" SET NOT NULL;

ALTER TABLE "GmailSyncState" ADD COLUMN "user_id_new" UUID;
UPDATE "GmailSyncState"
SET "user_id_new" = "user_id"::uuid
WHERE "user_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

ALTER TABLE "GmailSyncState" DROP CONSTRAINT IF EXISTS "gmail_sync_state_user_id_key";
ALTER TABLE "GmailSyncState" DROP COLUMN "user_id";
ALTER TABLE "GmailSyncState" RENAME COLUMN "user_id_new" TO "user_id";
CREATE UNIQUE INDEX "gmail_sync_state_user_id_key" ON "GmailSyncState" ("user_id");
CREATE UNIQUE INDEX "gmail_sync_state_legacy_user_id_key" ON "GmailSyncState" ("legacy_user_id");

-- ── sync_jobs ─────────────────────────────────────────────────────────────────

ALTER TABLE "sync_jobs" ADD COLUMN "legacy_user_id" TEXT;
UPDATE "sync_jobs" SET "legacy_user_id" = "user_id" WHERE "legacy_user_id" IS NULL;
ALTER TABLE "sync_jobs" ALTER COLUMN "legacy_user_id" SET NOT NULL;

ALTER TABLE "sync_jobs" ADD COLUMN "user_id_new" UUID;
UPDATE "sync_jobs"
SET "user_id_new" = "user_id"::uuid
WHERE "user_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

ALTER TABLE "sync_jobs" DROP COLUMN "user_id";
ALTER TABLE "sync_jobs" RENAME COLUMN "user_id_new" TO "user_id";
CREATE INDEX "sync_jobs_user_id_idx" ON "sync_jobs" ("user_id");

-- ── job_applications ──────────────────────────────────────────────────────────

ALTER TABLE "job_applications" ADD COLUMN "legacy_user_id" TEXT;
UPDATE "job_applications" SET "legacy_user_id" = "user_id" WHERE "legacy_user_id" IS NULL;
ALTER TABLE "job_applications" ALTER COLUMN "legacy_user_id" SET NOT NULL;

ALTER TABLE "job_applications" ADD COLUMN "user_id_new" UUID;
UPDATE "job_applications"
SET "user_id_new" = "user_id"::uuid
WHERE "user_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

ALTER TABLE "job_applications" DROP COLUMN "user_id";
ALTER TABLE "job_applications" RENAME COLUMN "user_id_new" TO "user_id";
CREATE INDEX "job_applications_user_id_idx" ON "job_applications" ("user_id");
CREATE INDEX "job_applications_legacy_user_id_idx" ON "job_applications" ("legacy_user_id");

-- ── user_resumes ──────────────────────────────────────────────────────────────

ALTER TABLE "user_resumes" ADD COLUMN "legacy_user_id" TEXT;
UPDATE "user_resumes" SET "legacy_user_id" = "user_id" WHERE "legacy_user_id" IS NULL;
ALTER TABLE "user_resumes" ALTER COLUMN "legacy_user_id" SET NOT NULL;

ALTER TABLE "user_resumes" ADD COLUMN "user_id_new" UUID;
UPDATE "user_resumes"
SET "user_id_new" = "user_id"::uuid
WHERE "user_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

ALTER TABLE "user_resumes" DROP COLUMN "user_id";
ALTER TABLE "user_resumes" RENAME COLUMN "user_id_new" TO "user_id";
CREATE INDEX "user_resumes_user_id_idx" ON "user_resumes" ("user_id");
CREATE INDEX "user_resumes_legacy_user_id_idx" ON "user_resumes" ("legacy_user_id");

-- ── Backfill users from all legacy identifiers (idempotent) ─────────────────────

INSERT INTO "users" ("id", "region", "consent_version", "consent_granted_at", "deletion_status", "created_at", "updated_at")
SELECT DISTINCT legacy_id::uuid, 'us-east-1', 'v1', NOW(), 'active', NOW(), NOW()
FROM (
    SELECT "legacy_user_id" AS legacy_id FROM "user_email_connections"
    UNION SELECT "legacy_user_id" FROM "email_messages"
    UNION SELECT "legacy_user_id" FROM "GmailSyncState"
    UNION SELECT "legacy_user_id" FROM "sync_jobs"
    UNION SELECT "legacy_user_id" FROM "job_applications"
    UNION SELECT "legacy_user_id" FROM "user_resumes"
) AS all_legacy
WHERE legacy_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
ON CONFLICT ("id") DO NOTHING;

-- ── Foreign keys ──────────────────────────────────────────────────────────────

ALTER TABLE "candidate_profiles"
    ADD CONSTRAINT "candidate_profiles_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_id_mapping"
    ADD CONSTRAINT "user_id_mapping_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_email_connections"
    ADD CONSTRAINT "user_email_connections_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "email_messages"
    ADD CONSTRAINT "email_messages_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GmailSyncState"
    ADD CONSTRAINT "gmail_sync_state_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sync_jobs"
    ADD CONSTRAINT "sync_jobs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "job_applications"
    ADD CONSTRAINT "job_applications_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_resumes"
    ADD CONSTRAINT "user_resumes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
