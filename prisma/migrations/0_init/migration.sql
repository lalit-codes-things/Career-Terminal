-- ─────────────────────────────────────────────────────────────────────────────
-- Baseline migration — ApplyWise
--
-- Creates all application tables from scratch on a fresh PostgreSQL database.
-- Run automatically by: npx prisma migrate deploy
--
-- This migration must run BEFORE 20260716000001_add_resume_dedup.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Enums ─────────────────────────────────────────────────────────────────────

CREATE TYPE "EmailProvider" AS ENUM ('GMAIL', 'OUTLOOK');

CREATE TYPE "ApplicationStatus" AS ENUM (
  'SAVED', 'APPLIED', 'SCREENING', 'ASSESSMENT',
  'INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN'
);

CREATE TYPE "ApplicationSourceProvider" AS ENUM (
  'GMAIL', 'MANUAL', 'OUTLOOK', 'CSV', 'API'
);

CREATE TYPE "ConnectionStatus" AS ENUM (
  'ACTIVE', 'REVOKED', 'EXPIRED', 'ERROR'
);

CREATE TYPE "JobType" AS ENUM (
  'GMAIL_INITIAL_SYNC', 'GMAIL_INCREMENTAL_SYNC'
);

CREATE TYPE "JobStatus" AS ENUM (
  'PENDING', 'RUNNING', 'SUCCESS', 'FAILED'
);

CREATE TYPE "ApplicationTimelineEventType" AS ENUM (
  'APPLICATION_SUBMITTED', 'APPLICATION_CONFIRMED', 'RECRUITER_CONTACT',
  'ASSESSMENT', 'ASSESSMENT_COMPLETED', 'PHONE_SCREEN', 'INTERVIEW',
  'FINAL_INTERVIEW', 'OFFER', 'REJECTION', 'WITHDRAWN'
);

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE "user_email_connections" (
    "id"                      UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"                 TEXT         NOT NULL,
    "provider"                "EmailProvider" NOT NULL,
    "email_address"           TEXT         NOT NULL,
    "access_token_encrypted"  TEXT         NOT NULL,
    "refresh_token_encrypted" TEXT         NOT NULL,
    "token_expiry"            TIMESTAMPTZ  NOT NULL,
    "scopes"                  TEXT[]       NOT NULL,
    "status"                  "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_sync_at"            TIMESTAMPTZ,
    "created_at"              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updated_at"              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "user_email_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "unique_user_provider_email"
    ON "user_email_connections" ("user_id", "provider", "email_address");
CREATE INDEX "user_email_connections_user_id_idx"
    ON "user_email_connections" ("user_id");
CREATE INDEX "user_email_connections_provider_idx"
    ON "user_email_connections" ("provider");
CREATE INDEX "user_email_connections_status_idx"
    ON "user_email_connections" ("status");

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "companies" (
    "id"           UUID        NOT NULL DEFAULT gen_random_uuid(),
    "name"         TEXT        NOT NULL,
    "domain"       TEXT        NOT NULL,
    "careers_url"  TEXT,
    "website"      TEXT,
    "logo_url"     TEXT,
    "industry"     TEXT,
    "headquarters" TEXT,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "companies_domain_key" ON "companies" ("domain");
CREATE INDEX "companies_name_idx"           ON "companies" ("name");

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "company_aliases" (
    "id"               UUID        NOT NULL DEFAULT gen_random_uuid(),
    "company_id"       UUID        NOT NULL,
    "value"            TEXT        NOT NULL,
    "normalized_value" TEXT        NOT NULL,
    "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "company_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_aliases_normalized_value_key"
    ON "company_aliases" ("normalized_value");
CREATE INDEX "company_aliases_company_id_idx"
    ON "company_aliases" ("company_id");

ALTER TABLE "company_aliases"
    ADD CONSTRAINT "company_aliases_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "recruiters" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID        NOT NULL,
    "name"       TEXT        NOT NULL,
    "email"      TEXT        NOT NULL,
    "title"      TEXT        NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "recruiters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "unique_company_recruiter_email"
    ON "recruiters" ("company_id", "email");
CREATE INDEX "recruiters_company_id_idx" ON "recruiters" ("company_id");
CREATE INDEX "recruiters_email_idx"      ON "recruiters" ("email");

ALTER TABLE "recruiters"
    ADD CONSTRAINT "recruiters_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "job_applications" (
    "id"                UUID              NOT NULL DEFAULT gen_random_uuid(),
    "user_id"           TEXT              NOT NULL,
    "company_id"        UUID,
    "recruiter_id"      UUID,
    "company_name"      TEXT              NOT NULL,
    "company_domain"    TEXT              NOT NULL,
    "role_title"        TEXT              NOT NULL,
    "role_department"   TEXT              NOT NULL,
    "status"            "ApplicationStatus" NOT NULL,
    "applied_date"      TIMESTAMPTZ       NOT NULL,
    "recruiter_name"    TEXT              NOT NULL,
    "recruiter_email"   TEXT              NOT NULL,
    "source_email_id"   TEXT              NOT NULL,
    "location"          TEXT              NOT NULL,
    "employment_type"   TEXT              NOT NULL,
    "current_stage"     TEXT              NOT NULL,
    "interview_rounds"  INTEGER           NOT NULL DEFAULT 0,
    "deadlines"         TEXT[]            NOT NULL,
    "candidate_email"   TEXT,
    "ats_application_id" TEXT,
    "thread_ids"        TEXT[]            NOT NULL,
    "created_at"        TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
    "updated_at"        TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

    CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_applications_user_id_idx"    ON "job_applications" ("user_id");
CREATE INDEX "job_applications_company_id_idx" ON "job_applications" ("company_id");
CREATE INDEX "job_applications_recruiter_id_idx" ON "job_applications" ("recruiter_id");
CREATE INDEX "job_applications_status_idx"     ON "job_applications" ("status");

ALTER TABLE "job_applications"
    ADD CONSTRAINT "job_applications_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE SET NULL;
ALTER TABLE "job_applications"
    ADD CONSTRAINT "job_applications_recruiter_id_fkey"
    FOREIGN KEY ("recruiter_id") REFERENCES "recruiters" ("id") ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "email_messages" (
    "id"                  UUID        NOT NULL DEFAULT gen_random_uuid(),
    "user_id"             TEXT        NOT NULL,
    "connection_id"       UUID        NOT NULL,
    "application_id"      UUID,
    "recruiter_id"        UUID,
    "provider_message_id" TEXT        NOT NULL,
    "thread_id"           TEXT,
    "sender"              TEXT        NOT NULL,
    "recipients"          JSONB       NOT NULL,
    "subject"             TEXT        NOT NULL DEFAULT '',
    "body_text"           TEXT,
    "body_html"           TEXT,
    "labels"              TEXT[]      NOT NULL,
    "has_attachments"     BOOLEAN     NOT NULL DEFAULT FALSE,
    "received_at"         TIMESTAMPTZ NOT NULL,
    "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "unique_user_message"
    ON "email_messages" ("user_id", "provider_message_id");
CREATE INDEX "email_messages_user_id_idx"       ON "email_messages" ("user_id");
CREATE INDEX "email_messages_connection_id_idx" ON "email_messages" ("connection_id");
CREATE INDEX "email_messages_application_id_idx" ON "email_messages" ("application_id");
CREATE INDEX "email_messages_recruiter_id_idx"  ON "email_messages" ("recruiter_id");
CREATE INDEX "email_messages_thread_id_idx"     ON "email_messages" ("thread_id");
CREATE INDEX "email_messages_received_at_idx"   ON "email_messages" ("received_at");

ALTER TABLE "email_messages"
    ADD CONSTRAINT "email_messages_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "user_email_connections" ("id") ON DELETE CASCADE;
ALTER TABLE "email_messages"
    ADD CONSTRAINT "email_messages_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "job_applications" ("id") ON DELETE SET NULL;
ALTER TABLE "email_messages"
    ADD CONSTRAINT "email_messages_recruiter_id_fkey"
    FOREIGN KEY ("recruiter_id") REFERENCES "recruiters" ("id") ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "GmailSyncState" (
    "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
    "user_id"       TEXT        NOT NULL,
    "connection_id" UUID        NOT NULL,
    "history_id"    TEXT        NOT NULL,
    "last_synced_at" TIMESTAMPTZ NOT NULL,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "GmailSyncState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GmailSyncState_user_id_key"       ON "GmailSyncState" ("user_id");
CREATE UNIQUE INDEX "GmailSyncState_connection_id_key" ON "GmailSyncState" ("connection_id");

ALTER TABLE "GmailSyncState"
    ADD CONSTRAINT "GmailSyncState_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "user_email_connections" ("id") ON DELETE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "sync_jobs" (
    "id"           UUID        NOT NULL DEFAULT gen_random_uuid(),
    "user_id"      TEXT        NOT NULL,
    "type"         "JobType"   NOT NULL,
    "status"       "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts"     INTEGER     NOT NULL DEFAULT 0,
    "started_at"   TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "next_run_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "error"        TEXT,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sync_jobs_status_next_run_at_idx" ON "sync_jobs" ("status", "next_run_at");

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "application_status_history" (
    "id"                UUID               NOT NULL DEFAULT gen_random_uuid(),
    "application_id"    UUID               NOT NULL,
    "previous_status"   "ApplicationStatus",
    "status"            "ApplicationStatus" NOT NULL,
    "source"            TEXT               NOT NULL,
    "source_email_id"   TEXT,
    "changed_by_user_id" TEXT,
    "timestamp"         TIMESTAMPTZ        NOT NULL,
    "metadata"          JSONB,
    "created_at"        TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
    "updated_at"        TIMESTAMPTZ        NOT NULL DEFAULT NOW(),

    CONSTRAINT "application_status_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "application_status_history_application_id_idx"
    ON "application_status_history" ("application_id");
CREATE INDEX "application_status_history_application_id_timestamp_idx"
    ON "application_status_history" ("application_id", "timestamp");

ALTER TABLE "application_status_history"
    ADD CONSTRAINT "application_status_history_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "job_applications" ("id") ON DELETE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "application_sources" (
    "id"                       UUID                       NOT NULL DEFAULT gen_random_uuid(),
    "application_id"           UUID                       NOT NULL,
    "provider"                 "ApplicationSourceProvider" NOT NULL,
    "provider_message_id"      TEXT,
    "provider_thread_id"       TEXT,
    "provider_conversation_id" TEXT,
    "provider_metadata"        JSONB,
    "created_at"               TIMESTAMPTZ                NOT NULL DEFAULT NOW(),

    CONSTRAINT "application_sources_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "application_sources_application_id_idx"
    ON "application_sources" ("application_id");
CREATE INDEX "application_sources_provider_idx"
    ON "application_sources" ("provider");
CREATE INDEX "application_sources_provider_message_id_idx"
    ON "application_sources" ("provider_message_id");

ALTER TABLE "application_sources"
    ADD CONSTRAINT "application_sources_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "job_applications" ("id") ON DELETE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "application_timeline" (
    "id"             UUID                           NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID                           NOT NULL,
    "event_type"     "ApplicationTimelineEventType" NOT NULL,
    "timestamp"      TIMESTAMPTZ                    NOT NULL,
    "source_email_id" TEXT,
    "metadata"       JSONB,
    "description"    TEXT,
    "created_at"     TIMESTAMPTZ                    NOT NULL DEFAULT NOW(),
    "updated_at"     TIMESTAMPTZ                    NOT NULL DEFAULT NOW(),

    CONSTRAINT "application_timeline_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "application_timeline_application_id_idx"
    ON "application_timeline" ("application_id");
CREATE INDEX "application_timeline_application_id_timestamp_idx"
    ON "application_timeline" ("application_id", "timestamp");

ALTER TABLE "application_timeline"
    ADD CONSTRAINT "application_timeline_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "job_applications" ("id") ON DELETE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at trigger (shared function)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "user_email_connections_updated_at"
    BEFORE UPDATE ON "user_email_connections"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER "companies_updated_at"
    BEFORE UPDATE ON "companies"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER "company_aliases_updated_at"
    BEFORE UPDATE ON "company_aliases"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER "recruiters_updated_at"
    BEFORE UPDATE ON "recruiters"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER "job_applications_updated_at"
    BEFORE UPDATE ON "job_applications"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER "GmailSyncState_updated_at"
    BEFORE UPDATE ON "GmailSyncState"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER "sync_jobs_updated_at"
    BEFORE UPDATE ON "sync_jobs"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER "application_status_history_updated_at"
    BEFORE UPDATE ON "application_status_history"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER "application_timeline_updated_at"
    BEFORE UPDATE ON "application_timeline"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
