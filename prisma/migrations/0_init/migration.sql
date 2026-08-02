-- ============================================================
-- Career Terminal — Consolidated Database Baseline (SQUASH)
-- ============================================================
--
-- Generated from prisma/schema.prisma via:
--   prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
--
-- This single migration REPLACES the previous 18-migration chain, which had
-- drifted from schema.prisma and could never be applied to a fresh database
-- (e.g. it created "GmailSyncState" but mapped to gmail_sync_states, and
-- never created tables such as gmail_checkpoints / sync_operations).
--
-- Prerequisites (provisioned OUT-OF-BAND by a superuser before migrate deploy,
-- never by the app): the vector / pgcrypto / pg_trgm / btree_gin extensions.
--   - docker dev:     docker/postgres/init/00-extensions.sql
--   - production:     an ops-run step (see scripts/db/bootstrap-roles.sql)
--
-- Roles, grants and the RLS GUC functions are applied by the FOLLOWING
-- migration (20260731000001_add_database_roles). Row-level security policies
-- are applied by 20260731000002_enable_rls. Search/pgvector indexes by
-- 20260731000003_add_pgvector_search.
--
-- The old chain is preserved read-only under prisma/migrations_legacy/.
-- ============================================================

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EmailProvider" AS ENUM ('GMAIL', 'OUTLOOK');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('SAVED', 'APPLIED', 'SCREENING', 'ASSESSMENT', 'INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ApplicationSourceProvider" AS ENUM ('GMAIL', 'MANUAL', 'OUTLOOK', 'CSV', 'API');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('GMAIL_INITIAL_SYNC', 'GMAIL_INCREMENTAL_SYNC');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "ApplicationTimelineEventType" AS ENUM ('APPLICATION_SUBMITTED', 'APPLICATION_CONFIRMED', 'RECRUITER_CONTACT', 'ASSESSMENT', 'ASSESSMENT_COMPLETED', 'PHONE_SCREEN', 'INTERVIEW', 'FINAL_INTERVIEW', 'OFFER', 'REJECTION', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "CellStatus" AS ENUM ('ACTIVE', 'DRAINING', 'READ_ONLY', 'MIGRATING', 'DISABLED');

-- CreateEnum
CREATE TYPE "CellLifecycleState" AS ENUM ('PROVISIONING', 'ACTIVE', 'DRAINING', 'MIGRATING', 'DISABLED');

-- CreateEnum
CREATE TYPE "CellRoutingState" AS ENUM ('ROUTABLE', 'WRITE_BLOCKED', 'READ_ONLY', 'UNROUTABLE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "cell_id" TEXT,
    "region" TEXT NOT NULL DEFAULT 'us-east-1',
    "data_residency_region" TEXT NOT NULL DEFAULT 'us-east-1',
    "shard_key" INTEGER NOT NULL DEFAULT 0,
    "tenant_id" UUID,
    "consent_version" TEXT NOT NULL DEFAULT 'v1',
    "consent_granted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,
    "deletion_status" TEXT NOT NULL DEFAULT 'active',
    "deletion_requested_at" TIMESTAMPTZ,
    "deletion_completed_at" TIMESTAMPTZ,
    "legal_hold_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cells" (
    "id" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "residency_policy_id" TEXT,
    "status" "CellStatus" NOT NULL DEFAULT 'ACTIVE',
    "lifecycle_state" "CellLifecycleState" NOT NULL DEFAULT 'ACTIVE',
    "routing_state" "CellRoutingState" NOT NULL DEFAULT 'ROUTABLE',
    "capacity_state" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cells_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "full_name" TEXT,
    "phone" TEXT,
    "location" TEXT,
    "timezone" TEXT,
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "career_goals" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "candidate_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_id_mapping" (
    "id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_id_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_email_connections" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "legacy_user_id" TEXT NOT NULL,
    "provider" "EmailProvider" NOT NULL,
    "email_address" TEXT NOT NULL,
    "access_token_encrypted" TEXT NOT NULL,
    "refresh_token_encrypted" TEXT NOT NULL,
    "token_expiry" TIMESTAMPTZ NOT NULL,
    "scopes" TEXT[],
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_sync_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_email_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gmail_sync_states" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "legacy_user_id" TEXT NOT NULL,
    "connection_id" UUID NOT NULL,
    "history_id" TEXT NOT NULL,
    "last_synced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gmail_sync_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gmail_checkpoints" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "current_history_id" TEXT,
    "pending_history_id" TEXT,
    "page_token" TEXT,
    "sync_mode" TEXT NOT NULL DEFAULT 'INCREMENTAL_SYNC',
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "last_sync_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMPTZ,
    "worker_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "gmail_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_operations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "legacy_user_id" TEXT NOT NULL,
    "connection_id" UUID NOT NULL,
    "sync_mode" TEXT NOT NULL,
    "correlation_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sync_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "legacy_user_id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "next_run_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_batches" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "history_id" TEXT NOT NULL,
    "page_token" TEXT,
    "correlation_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "total_emails" INTEGER,
    "processed_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sync_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_email_jobs" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "email_id" UUID NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "processed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "batch_email_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dead_letter_emails" (
    "id" UUID NOT NULL,
    "email_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "error" TEXT NOT NULL,
    "failed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "dead_letter_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gmail_sync_queue" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "legacy_user_id" TEXT NOT NULL,
    "connection_id" UUID NOT NULL,
    "sync_mode" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "next_run_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "gmail_sync_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "malware_scan_results" (
    "id" UUID NOT NULL,
    "user_resume_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scanner" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "threats" JSONB,
    "scan_duration_ms" INTEGER,
    "scanned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "malware_scan_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "careers_url" TEXT,
    "website" TEXT,
    "logo_url" TEXT,
    "industry" TEXT,
    "headquarters" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_aliases" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "normalized_value" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "company_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiters" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "recruiters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "external_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "salary_range" TEXT,
    "employment_type" TEXT,
    "work_setting" TEXT,
    "url" TEXT,
    "requirements" JSONB NOT NULL DEFAULT '[]',
    "source_metadata" JSONB,
    "posted_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "first_seen_at" TIMESTAMPTZ,
    "last_seen_at" TIMESTAMPTZ,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "careers_page_url" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_observations" (
    "id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "user_id" UUID,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "extraction_run_id" UUID,
    "observed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT,
    "description" TEXT,
    "location" TEXT,
    "compensation" JSONB,
    "requirements" JSONB DEFAULT '[]',
    "department" TEXT,
    "employment_type" TEXT,
    "remote_policy" TEXT,
    "seniority" TEXT,
    "hiring_info" JSONB DEFAULT '{}',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "url" TEXT,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "superseded_by_id" UUID,
    "superseded_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "opportunity_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_applications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "legacy_user_id" TEXT,
    "company_id" UUID,
    "opportunity_id" UUID,
    "recruiter_id" UUID,
    "snapshot_id" UUID,
    "company_name" TEXT,
    "company_domain" TEXT,
    "role_title" TEXT,
    "role_department" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'SAVED',
    "source_provider" "ApplicationSourceProvider" NOT NULL DEFAULT 'MANUAL',
    "applied_at" TIMESTAMPTZ,
    "applied_date" TIMESTAMPTZ,
    "last_activity_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recruiter_name" TEXT,
    "recruiter_email" TEXT,
    "source_email_id" TEXT,
    "location" TEXT,
    "employment_type" TEXT,
    "current_stage" TEXT,
    "interview_rounds" INTEGER NOT NULL DEFAULT 0,
    "deadlines" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "thread_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ats_application_id" TEXT,
    "candidate_email" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_timeline_events" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "event_type" "ApplicationTimelineEventType" NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "source_email_id" TEXT,
    "description" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_timeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_sources" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "source_email_id" TEXT,
    "source_data" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_status_history" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "previous_status" TEXT,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_email_id" TEXT,
    "changed_by_user_id" TEXT,
    "timestamp" TIMESTAMPTZ NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" UUID NOT NULL,
    "application_id" UUID,
    "recruiter_id" UUID,
    "user_id" UUID,
    "legacy_user_id" TEXT,
    "connection_id" UUID,
    "provider_message_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "subject" TEXT,
    "snippet" TEXT,
    "body" TEXT,
    "body_text" TEXT,
    "body_html" TEXT,
    "from" TEXT,
    "to" TEXT[],
    "labels" JSONB NOT NULL DEFAULT '[]',
    "received_at" TIMESTAMPTZ NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_attachments" (
    "id" UUID NOT NULL,
    "email_message_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "s3_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "operation_type" TEXT NOT NULL,
    "result_id" TEXT NOT NULL,
    "result_data" JSONB,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_resumes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "legacy_user_id" TEXT,
    "resume_hash_id" UUID,
    "filename" TEXT NOT NULL,
    "original_name" TEXT,
    "s3_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "superseded_at" TIMESTAMPTZ,
    "scanning_status" TEXT,
    "status" TEXT DEFAULT 'pending',
    "parsed_content" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_resumes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resume_hashes" (
    "id" UUID NOT NULL,
    "hash" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "storage_url" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resume_hashes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_resumes" (
    "application_id" UUID NOT NULL,
    "resume_version_id" UUID NOT NULL,
    "snapshot_key" TEXT NOT NULL,
    "snapshot_metadata" JSONB NOT NULL DEFAULT '{}',
    "applied_at" TIMESTAMPTZ,
    "usage_context" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_resumes_pkey" PRIMARY KEY ("application_id","resume_version_id")
);

-- CreateTable
CREATE TABLE "resumes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "legacy_user_id" TEXT,
    "application_id" UUID,
    "resume_version_id" UUID,
    "filename" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "parsed_content" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "resumes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fact_observations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "fact_type" TEXT NOT NULL,
    "fact_data" JSONB NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "source_version" TEXT,
    "extraction_method" TEXT NOT NULL,
    "model_version" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "evidence_reference" TEXT,
    "valid_from" TIMESTAMPTZ,
    "valid_to" TIMESTAMPTZ,
    "observed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot_id" UUID,
    "extracted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "superseded_by_id" UUID,
    "superseded_at" TIMESTAMPTZ,
    "corrected_by" UUID,
    "corrected_at" TIMESTAMPTZ,
    "correction_reason" TEXT,
    "is_user_corrected" BOOLEAN NOT NULL DEFAULT false,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "reviewed_at" TIMESTAMPTZ,
    "reviewed_by" UUID,
    "review_status" TEXT,
    "review_notes" TEXT,
    "deduplication_key" TEXT,
    "deleted_at" TIMESTAMPTZ,
    "extraction_run_id" UUID,
    "provenance_id" UUID,

    CONSTRAINT "fact_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snapshots" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "snapshot_type" TEXT NOT NULL,
    "reference_id" UUID,
    "captured_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "last_fact_id" UUID,
    "schema_version" TEXT NOT NULL DEFAULT 'v1',
    "candidate_state_json" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_runs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "cell_id" TEXT,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "source_version" TEXT,
    "source_identity" TEXT,
    "model_id" TEXT NOT NULL,
    "model_version" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "error" TEXT,
    "failure_reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "parser_version" TEXT,
    "model_provider" TEXT,
    "prompt_version" TEXT,
    "schema_version" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "extraction_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fact_provenance" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "cell_id" TEXT,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_version" TEXT,
    "source_identity" TEXT,
    "extraction_run_id" UUID NOT NULL,
    "parser_version" TEXT,
    "model_provider" TEXT,
    "model_version" TEXT,
    "prompt_version" TEXT,
    "schema_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fact_provenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_candidate_intelligence" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "cell_id" TEXT NOT NULL,
    "fact_type" TEXT NOT NULL,
    "deduplication_key" TEXT NOT NULL,
    "source_fact_id" UUID NOT NULL,
    "provenance_id" UUID NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "last_observed_at" TIMESTAMPTZ NOT NULL,
    "source_version" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "canonical_candidate_intelligence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outcome_events" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "outcome_type" TEXT NOT NULL,
    "outcome_category" TEXT NOT NULL,
    "outcome_status" TEXT NOT NULL,
    "explicit" BOOLEAN NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT,
    "source_data" JSONB,
    "evidence" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resulting_status" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "superseded_by_id" UUID,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "outcome_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "application_id" UUID,
    "opportunity_id" UUID,
    "action_type" TEXT NOT NULL,
    "action_subtype" TEXT,
    "strategy_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "context" JSONB,
    "source_type" TEXT NOT NULL DEFAULT 'USER_ACTION',
    "source_id" TEXT,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "action_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "models" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "capabilities" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "predictions" (
    "id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "application_id" UUID,
    "opportunity_id" UUID,
    "extraction_run_id" UUID,
    "prediction_type" TEXT NOT NULL,
    "prediction_value" JSONB NOT NULL,
    "confidence_score" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_correct" BOOLEAN,
    "evaluation_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prediction_feedback" (
    "id" TEXT NOT NULL,
    "prediction_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "rating" INTEGER,
    "helpful" BOOLEAN,
    "correct" BOOLEAN,
    "comment" TEXT,
    "feedback_type" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "prediction_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "cell_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "correlation_id" TEXT NOT NULL,
    "error" TEXT,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_occupations" (
    "id" UUID NOT NULL,
    "canonical_name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_version" TEXT,

    CONSTRAINT "canonical_occupations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_occupation_aliases" (
    "id" UUID NOT NULL,
    "occupation_id" UUID NOT NULL,
    "alias" TEXT NOT NULL,

    CONSTRAINT "canonical_occupation_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_skills" (
    "id" UUID NOT NULL,
    "canonical_name" TEXT NOT NULL,
    "skill_type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_version" TEXT,

    CONSTRAINT "canonical_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_skill_aliases" (
    "id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,
    "alias" TEXT NOT NULL,

    CONSTRAINT "canonical_skill_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_tasks" (
    "id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_version" TEXT,

    CONSTRAINT "canonical_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_work_activities" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_version" TEXT,

    CONSTRAINT "canonical_work_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_industries" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_version" TEXT,

    CONSTRAINT "canonical_industries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_countries" (
    "id" UUID NOT NULL,
    "iso_alpha_2" TEXT NOT NULL,
    "iso_alpha_3" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "canonical_countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_languages" (
    "id" UUID NOT NULL,
    "iso_639_1" TEXT NOT NULL,
    "iso_639_2" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "native_name" TEXT,

    CONSTRAINT "canonical_languages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_time_zones" (
    "id" UUID NOT NULL,
    "zone_name" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,

    CONSTRAINT "canonical_time_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ontology_sources" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "source_url" TEXT,
    "license" TEXT,
    "checksum" TEXT,
    "import_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ontology_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "occupation_skill" (
    "occupation_id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,
    "importance" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "source_id" TEXT,

    CONSTRAINT "occupation_skill_pkey" PRIMARY KEY ("occupation_id","skill_id")
);

-- CreateTable
CREATE TABLE "skill_relationship" (
    "skill_a" UUID NOT NULL,
    "skill_b" UUID NOT NULL,
    "relationship_type" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "source_id" TEXT,

    CONSTRAINT "skill_relationship_pkey" PRIMARY KEY ("skill_a","skill_b","relationship_type")
);

-- CreateTable
CREATE TABLE "occupation_hierarchy" (
    "parent" UUID NOT NULL,
    "child" UUID NOT NULL,

    CONSTRAINT "occupation_hierarchy_pkey" PRIMARY KEY ("parent","child")
);

-- CreateTable
CREATE TABLE "occupation_classification_mapping" (
    "occupation_id" UUID NOT NULL,
    "classification_system" TEXT NOT NULL,
    "external_code" TEXT NOT NULL,

    CONSTRAINT "occupation_classification_mapping_pkey" PRIMARY KEY ("occupation_id","classification_system","external_code")
);

-- CreateTable
CREATE TABLE "canonical_currencies" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "minor_units" INTEGER,
    "source" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_version" TEXT,

    CONSTRAINT "canonical_currencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_signals" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "signal_type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "description" TEXT,
    "source_url" TEXT,
    "source_name" TEXT,
    "publication_time" TIMESTAMPTZ,
    "discovery_time" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "affected_areas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "estimated_impact" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "company_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendations" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "recommendation_type" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID,
    "overall_score" DOUBLE PRECISION,
    "score_breakdown" JSONB DEFAULT '{}',
    "explanation" TEXT,
    "confidence" DOUBLE PRECISION,
    "model_version" TEXT,
    "ranking_position" INTEGER,
    "feedback" JSONB DEFAULT '{}',
    "eventual_outcome" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_roles" (
    "id" UUID NOT NULL,
    "canonical_name" TEXT NOT NULL,
    "category" TEXT,
    "seniority" TEXT,
    "synonyms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required_skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferred_skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "salary_info" JSONB DEFAULT '{}',
    "demand_trend" TEXT DEFAULT 'stable',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "canonical_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embedding_models" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "embedding_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_profile_embeddings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "cell_id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "embedding" vector(1536),
    "source_type" TEXT NOT NULL DEFAULT 'PROFILE',
    "source_id" UUID NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "candidate_profile_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_embeddings" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "cell_id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "embedding" vector(1536),
    "source_type" TEXT NOT NULL DEFAULT 'OPPORTUNITY',
    "source_id" UUID NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "opportunity_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_embeddings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "cell_id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "embedding" vector(1536),
    "source_type" TEXT NOT NULL DEFAULT 'APPLICATION',
    "source_id" UUID NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "application_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_region_idx" ON "users"("region");

-- CreateIndex
CREATE INDEX "users_deletion_status_idx" ON "users"("deletion_status");

-- CreateIndex
CREATE INDEX "users_shard_key_idx" ON "users"("shard_key");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE INDEX "users_data_residency_region_idx" ON "users"("data_residency_region");

-- CreateIndex
CREATE INDEX "users_cell_id_idx" ON "users"("cell_id");

-- CreateIndex
CREATE INDEX "cells_region_idx" ON "cells"("region");

-- CreateIndex
CREATE INDEX "cells_status_idx" ON "cells"("status");

-- CreateIndex
CREATE INDEX "cells_routing_state_idx" ON "cells"("routing_state");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_profiles_user_id_key" ON "candidate_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_id_mapping_external_id_key" ON "user_id_mapping"("external_id");

-- CreateIndex
CREATE INDEX "user_id_mapping_user_id_idx" ON "user_id_mapping"("user_id");

-- CreateIndex
CREATE INDEX "user_email_connections_user_id_idx" ON "user_email_connections"("user_id");

-- CreateIndex
CREATE INDEX "user_email_connections_provider_idx" ON "user_email_connections"("provider");

-- CreateIndex
CREATE INDEX "user_email_connections_status_idx" ON "user_email_connections"("status");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_connections_legacy_user_id_provider_email_addres_key" ON "user_email_connections"("legacy_user_id", "provider", "email_address");

-- CreateIndex
CREATE UNIQUE INDEX "gmail_sync_states_user_id_key" ON "gmail_sync_states"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "gmail_sync_states_legacy_user_id_key" ON "gmail_sync_states"("legacy_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "gmail_checkpoints_user_id_key" ON "gmail_checkpoints"("user_id");

-- CreateIndex
CREATE INDEX "sync_operations_user_id_status_idx" ON "sync_operations"("user_id", "status");

-- CreateIndex
CREATE INDEX "sync_operations_connection_id_status_idx" ON "sync_operations"("connection_id", "status");

-- CreateIndex
CREATE INDEX "sync_operations_correlation_id_idx" ON "sync_operations"("correlation_id");

-- CreateIndex
CREATE INDEX "sync_jobs_status_next_run_at_idx" ON "sync_jobs"("status", "next_run_at");

-- CreateIndex
CREATE INDEX "sync_jobs_user_id_idx" ON "sync_jobs"("user_id");

-- CreateIndex
CREATE INDEX "sync_batches_user_id_idx" ON "sync_batches"("user_id");

-- CreateIndex
CREATE INDEX "sync_batches_status_idx" ON "sync_batches"("status");

-- CreateIndex
CREATE INDEX "batch_email_jobs_batch_id_idx" ON "batch_email_jobs"("batch_id");

-- CreateIndex
CREATE INDEX "batch_email_jobs_status_idx" ON "batch_email_jobs"("status");

-- CreateIndex
CREATE INDEX "dead_letter_emails_user_id_idx" ON "dead_letter_emails"("user_id");

-- CreateIndex
CREATE INDEX "dead_letter_emails_email_id_idx" ON "dead_letter_emails"("email_id");

-- CreateIndex
CREATE INDEX "dead_letter_emails_resolved_idx" ON "dead_letter_emails"("resolved");

-- CreateIndex
CREATE INDEX "gmail_sync_queue_next_run_at_priority_idx" ON "gmail_sync_queue"("next_run_at", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "gmail_sync_queue_user_id_sync_mode_key" ON "gmail_sync_queue"("user_id", "sync_mode");

-- CreateIndex
CREATE INDEX "malware_scan_results_user_resume_id_idx" ON "malware_scan_results"("user_resume_id");

-- CreateIndex
CREATE INDEX "malware_scan_results_user_id_idx" ON "malware_scan_results"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "companies_domain_key" ON "companies"("domain");

-- CreateIndex
CREATE INDEX "companies_name_idx" ON "companies"("name");

-- CreateIndex
CREATE UNIQUE INDEX "company_aliases_normalized_value_key" ON "company_aliases"("normalized_value");

-- CreateIndex
CREATE INDEX "company_aliases_company_id_idx" ON "company_aliases"("company_id");

-- CreateIndex
CREATE INDEX "recruiters_company_id_idx" ON "recruiters"("company_id");

-- CreateIndex
CREATE INDEX "recruiters_email_idx" ON "recruiters"("email");

-- CreateIndex
CREATE UNIQUE INDEX "recruiters_company_id_email_key" ON "recruiters"("company_id", "email");

-- CreateIndex
CREATE INDEX "opportunities_company_id_idx" ON "opportunities"("company_id");

-- CreateIndex
CREATE INDEX "opportunities_title_idx" ON "opportunities"("title");

-- CreateIndex
CREATE INDEX "opportunities_location_idx" ON "opportunities"("location");

-- CreateIndex
CREATE INDEX "opportunity_observations_opportunity_id_idx" ON "opportunity_observations"("opportunity_id");

-- CreateIndex
CREATE INDEX "opportunity_observations_user_id_idx" ON "opportunity_observations"("user_id");

-- CreateIndex
CREATE INDEX "opportunity_observations_observed_at_idx" ON "opportunity_observations"("observed_at");

-- CreateIndex
CREATE INDEX "opportunity_observations_opportunity_id_observed_at_idx" ON "opportunity_observations"("opportunity_id", "observed_at");

-- CreateIndex
CREATE INDEX "job_applications_user_id_idx" ON "job_applications"("user_id");

-- CreateIndex
CREATE INDEX "job_applications_company_id_idx" ON "job_applications"("company_id");

-- CreateIndex
CREATE INDEX "job_applications_opportunity_id_idx" ON "job_applications"("opportunity_id");

-- CreateIndex
CREATE INDEX "job_applications_status_idx" ON "job_applications"("status");

-- CreateIndex
CREATE INDEX "job_applications_snapshot_id_idx" ON "job_applications"("snapshot_id");

-- CreateIndex
CREATE INDEX "application_timeline_events_application_id_idx" ON "application_timeline_events"("application_id");

-- CreateIndex
CREATE INDEX "application_timeline_events_occurred_at_idx" ON "application_timeline_events"("occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "application_sources_application_id_key" ON "application_sources"("application_id");

-- CreateIndex
CREATE INDEX "application_status_history_application_id_idx" ON "application_status_history"("application_id");

-- CreateIndex
CREATE INDEX "application_status_history_timestamp_idx" ON "application_status_history"("timestamp");

-- CreateIndex
CREATE INDEX "email_messages_application_id_idx" ON "email_messages"("application_id");

-- CreateIndex
CREATE INDEX "email_messages_recruiter_id_idx" ON "email_messages"("recruiter_id");

-- CreateIndex
CREATE INDEX "email_messages_thread_id_idx" ON "email_messages"("thread_id");

-- CreateIndex
CREATE INDEX "email_messages_received_at_idx" ON "email_messages"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_legacy_user_id_provider_message_id_key" ON "email_messages"("legacy_user_id", "provider_message_id");

-- CreateIndex
CREATE INDEX "email_attachments_email_message_id_idx" ON "email_attachments"("email_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_key_key" ON "idempotency_records"("key");

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

-- CreateIndex
CREATE INDEX "user_resumes_user_id_idx" ON "user_resumes"("user_id");

-- CreateIndex
CREATE INDEX "user_resumes_is_active_idx" ON "user_resumes"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "resume_hashes_hash_key" ON "resume_hashes"("hash");

-- CreateIndex
CREATE INDEX "resumes_user_id_idx" ON "resumes"("user_id");

-- CreateIndex
CREATE INDEX "resumes_application_id_idx" ON "resumes"("application_id");

-- CreateIndex
CREATE INDEX "fact_observations_user_id_fact_type_is_current_idx" ON "fact_observations"("user_id", "fact_type", "is_current");

-- CreateIndex
CREATE INDEX "fact_observations_user_id_is_current_idx" ON "fact_observations"("user_id", "is_current");

-- CreateIndex
CREATE INDEX "fact_observations_source_id_source_type_idx" ON "fact_observations"("source_id", "source_type");

-- CreateIndex
CREATE INDEX "fact_observations_user_id_observed_at_idx" ON "fact_observations"("user_id", "observed_at");

-- CreateIndex
CREATE INDEX "fact_observations_snapshot_id_idx" ON "fact_observations"("snapshot_id");

-- CreateIndex
CREATE INDEX "fact_observations_needs_review_review_status_idx" ON "fact_observations"("needs_review", "review_status");

-- CreateIndex
CREATE INDEX "snapshots_user_id_snapshot_type_idx" ON "snapshots"("user_id", "snapshot_type");

-- CreateIndex
CREATE INDEX "snapshots_reference_id_idx" ON "snapshots"("reference_id");

-- CreateIndex
CREATE INDEX "snapshots_captured_at_idx" ON "snapshots"("captured_at");

-- CreateIndex
CREATE INDEX "snapshots_user_id_captured_at_idx" ON "snapshots"("user_id", "captured_at");

-- CreateIndex
CREATE INDEX "extraction_runs_user_id_idx" ON "extraction_runs"("user_id");

-- CreateIndex
CREATE INDEX "extraction_runs_source_type_source_id_idx" ON "extraction_runs"("source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "fact_provenance_extraction_run_id_key" ON "fact_provenance"("extraction_run_id");

-- CreateIndex
CREATE INDEX "fact_provenance_user_id_idx" ON "fact_provenance"("user_id");

-- CreateIndex
CREATE INDEX "canonical_candidate_intelligence_user_id_fact_type_is_activ_idx" ON "canonical_candidate_intelligence"("user_id", "fact_type", "is_active");

-- CreateIndex
CREATE INDEX "canonical_candidate_intelligence_user_id_is_active_idx" ON "canonical_candidate_intelligence"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "canonical_candidate_intelligence_source_fact_id_idx" ON "canonical_candidate_intelligence"("source_fact_id");

-- CreateIndex
CREATE INDEX "canonical_candidate_intelligence_provenance_id_idx" ON "canonical_candidate_intelligence"("provenance_id");

-- CreateIndex
CREATE INDEX "canonical_candidate_intelligence_cell_id_idx" ON "canonical_candidate_intelligence"("cell_id");

-- CreateIndex
CREATE UNIQUE INDEX "canonical_candidate_intelligence_user_id_fact_type_deduplic_key" ON "canonical_candidate_intelligence"("user_id", "fact_type", "deduplication_key");

-- CreateIndex
CREATE INDEX "outcome_events_application_id_idx" ON "outcome_events"("application_id");

-- CreateIndex
CREATE INDEX "outcome_events_user_id_idx" ON "outcome_events"("user_id");

-- CreateIndex
CREATE INDEX "outcome_events_occurred_at_idx" ON "outcome_events"("occurred_at");

-- CreateIndex
CREATE INDEX "outcome_events_outcome_type_idx" ON "outcome_events"("outcome_type");

-- CreateIndex
CREATE INDEX "outcome_events_user_id_outcome_type_occurred_at_idx" ON "outcome_events"("user_id", "outcome_type", "occurred_at");

-- CreateIndex
CREATE INDEX "action_events_user_id_idx" ON "action_events"("user_id");

-- CreateIndex
CREATE INDEX "action_events_application_id_idx" ON "action_events"("application_id");

-- CreateIndex
CREATE INDEX "action_events_opportunity_id_idx" ON "action_events"("opportunity_id");

-- CreateIndex
CREATE INDEX "action_events_action_type_idx" ON "action_events"("action_type");

-- CreateIndex
CREATE INDEX "action_events_occurred_at_idx" ON "action_events"("occurred_at");

-- CreateIndex
CREATE INDEX "predictions_model_id_idx" ON "predictions"("model_id");

-- CreateIndex
CREATE INDEX "predictions_user_id_idx" ON "predictions"("user_id");

-- CreateIndex
CREATE INDEX "predictions_application_id_idx" ON "predictions"("application_id");

-- CreateIndex
CREATE INDEX "predictions_prediction_type_idx" ON "predictions"("prediction_type");

-- CreateIndex
CREATE INDEX "predictions_timestamp_idx" ON "predictions"("timestamp");

-- CreateIndex
CREATE INDEX "predictions_is_correct_idx" ON "predictions"("is_correct");

-- CreateIndex
CREATE INDEX "prediction_feedback_prediction_id_idx" ON "prediction_feedback"("prediction_id");

-- CreateIndex
CREATE INDEX "prediction_feedback_user_id_idx" ON "prediction_feedback"("user_id");

-- CreateIndex
CREATE INDEX "events_user_id_idx" ON "events"("user_id");

-- CreateIndex
CREATE INDEX "events_aggregate_id_aggregate_type_idx" ON "events"("aggregate_id", "aggregate_type");

-- CreateIndex
CREATE INDEX "events_status_idx" ON "events"("status");

-- CreateIndex
CREATE INDEX "events_correlation_id_idx" ON "events"("correlation_id");

-- CreateIndex
CREATE INDEX "canonical_occupations_canonical_name_idx" ON "canonical_occupations"("canonical_name");

-- CreateIndex
CREATE UNIQUE INDEX "canonical_occupations_source_source_id_key" ON "canonical_occupations"("source", "source_id");

-- CreateIndex
CREATE INDEX "canonical_occupation_aliases_alias_idx" ON "canonical_occupation_aliases"("alias");

-- CreateIndex
CREATE INDEX "canonical_skills_canonical_name_idx" ON "canonical_skills"("canonical_name");

-- CreateIndex
CREATE INDEX "canonical_skills_skill_type_idx" ON "canonical_skills"("skill_type");

-- CreateIndex
CREATE UNIQUE INDEX "canonical_skills_source_source_id_key" ON "canonical_skills"("source", "source_id");

-- CreateIndex
CREATE INDEX "canonical_skill_aliases_alias_idx" ON "canonical_skill_aliases"("alias");

-- CreateIndex
CREATE UNIQUE INDEX "canonical_tasks_source_source_id_key" ON "canonical_tasks"("source", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "canonical_work_activities_source_source_id_key" ON "canonical_work_activities"("source", "source_id");

-- CreateIndex
CREATE INDEX "canonical_industries_code_idx" ON "canonical_industries"("code");

-- CreateIndex
CREATE UNIQUE INDEX "canonical_industries_source_source_id_key" ON "canonical_industries"("source", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "canonical_countries_iso_alpha_2_key" ON "canonical_countries"("iso_alpha_2");

-- CreateIndex
CREATE UNIQUE INDEX "canonical_countries_iso_alpha_3_key" ON "canonical_countries"("iso_alpha_3");

-- CreateIndex
CREATE UNIQUE INDEX "canonical_languages_iso_639_1_key" ON "canonical_languages"("iso_639_1");

-- CreateIndex
CREATE UNIQUE INDEX "canonical_languages_iso_639_2_key" ON "canonical_languages"("iso_639_2");

-- CreateIndex
CREATE UNIQUE INDEX "canonical_time_zones_zone_name_key" ON "canonical_time_zones"("zone_name");

-- CreateIndex
CREATE UNIQUE INDEX "ontology_sources_name_version_key" ON "ontology_sources"("name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "canonical_currencies_code_key" ON "canonical_currencies"("code");

-- CreateIndex
CREATE INDEX "company_signals_company_id_idx" ON "company_signals"("company_id");

-- CreateIndex
CREATE INDEX "company_signals_signal_type_idx" ON "company_signals"("signal_type");

-- CreateIndex
CREATE INDEX "company_signals_discovery_time_idx" ON "company_signals"("discovery_time");

-- CreateIndex
CREATE INDEX "recommendations_user_id_idx" ON "recommendations"("user_id");

-- CreateIndex
CREATE INDEX "recommendations_recommendation_type_idx" ON "recommendations"("recommendation_type");

-- CreateIndex
CREATE INDEX "recommendations_user_id_created_at_idx" ON "recommendations"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "canonical_roles_category_idx" ON "canonical_roles"("category");

-- CreateIndex
CREATE INDEX "canonical_roles_seniority_idx" ON "canonical_roles"("seniority");

-- CreateIndex
CREATE UNIQUE INDEX "canonical_roles_canonical_name_key" ON "canonical_roles"("canonical_name");

-- CreateIndex
CREATE INDEX "candidate_profile_embeddings_user_id_cell_id_idx" ON "candidate_profile_embeddings"("user_id", "cell_id");

-- CreateIndex
CREATE INDEX "candidate_profile_embeddings_source_type_source_id_idx" ON "candidate_profile_embeddings"("source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_candidate_embeddings_user_model_source" ON "candidate_profile_embeddings"("user_id", "model_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "opportunity_embeddings_user_id_cell_id_idx" ON "opportunity_embeddings"("user_id", "cell_id");

-- CreateIndex
CREATE INDEX "opportunity_embeddings_source_type_source_id_idx" ON "opportunity_embeddings"("source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_opportunity_embeddings_user_model_source" ON "opportunity_embeddings"("user_id", "model_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "application_embeddings_user_id_cell_id_idx" ON "application_embeddings"("user_id", "cell_id");

-- CreateIndex
CREATE INDEX "application_embeddings_source_type_source_id_idx" ON "application_embeddings"("source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_application_embeddings_user_model_source" ON "application_embeddings"("user_id", "model_id", "source_type", "source_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_cell_id_fkey" FOREIGN KEY ("cell_id") REFERENCES "cells"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_id_mapping" ADD CONSTRAINT "user_id_mapping_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_email_connections" ADD CONSTRAINT "user_email_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gmail_sync_states" ADD CONSTRAINT "gmail_sync_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gmail_sync_states" ADD CONSTRAINT "gmail_sync_states_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "user_email_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gmail_checkpoints" ADD CONSTRAINT "gmail_checkpoints_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_batches" ADD CONSTRAINT "sync_batches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_email_jobs" ADD CONSTRAINT "batch_email_jobs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "sync_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_aliases" ADD CONSTRAINT "company_aliases_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruiters" ADD CONSTRAINT "recruiters_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_observations" ADD CONSTRAINT "opportunity_observations_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_observations" ADD CONSTRAINT "opportunity_observations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_observations" ADD CONSTRAINT "opportunity_observations_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "opportunity_observations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_recruiter_id_fkey" FOREIGN KEY ("recruiter_id") REFERENCES "recruiters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_timeline_events" ADD CONSTRAINT "application_timeline_events_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_sources" ADD CONSTRAINT "application_sources_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_recruiter_id_fkey" FOREIGN KEY ("recruiter_id") REFERENCES "recruiters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_email_message_id_fkey" FOREIGN KEY ("email_message_id") REFERENCES "email_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_resumes" ADD CONSTRAINT "user_resumes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_resumes" ADD CONSTRAINT "user_resumes_resume_hash_id_fkey" FOREIGN KEY ("resume_hash_id") REFERENCES "resume_hashes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_resumes" ADD CONSTRAINT "application_resumes_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_resumes" ADD CONSTRAINT "application_resumes_resume_version_id_fkey" FOREIGN KEY ("resume_version_id") REFERENCES "user_resumes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_observations" ADD CONSTRAINT "fact_observations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_observations" ADD CONSTRAINT "fact_observations_corrected_by_fkey" FOREIGN KEY ("corrected_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_observations" ADD CONSTRAINT "fact_observations_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_observations" ADD CONSTRAINT "fact_email_fk" FOREIGN KEY ("source_id") REFERENCES "email_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_observations" ADD CONSTRAINT "fact_resume_fk" FOREIGN KEY ("source_id") REFERENCES "resumes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_observations" ADD CONSTRAINT "fact_opportunity_fk" FOREIGN KEY ("source_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_observations" ADD CONSTRAINT "fact_application_fk" FOREIGN KEY ("source_id") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_observations" ADD CONSTRAINT "fact_observations_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_observations" ADD CONSTRAINT "fact_observations_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "fact_observations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_observations" ADD CONSTRAINT "fact_observations_extraction_run_id_fkey" FOREIGN KEY ("extraction_run_id") REFERENCES "extraction_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_observations" ADD CONSTRAINT "fact_observations_provenance_id_fkey" FOREIGN KEY ("provenance_id") REFERENCES "fact_provenance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_email_fk" FOREIGN KEY ("source_id") REFERENCES "email_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_resume_fk" FOREIGN KEY ("source_id") REFERENCES "resumes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_opportunity_fk" FOREIGN KEY ("source_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_application_fk" FOREIGN KEY ("source_id") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_provenance" ADD CONSTRAINT "fact_provenance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_provenance" ADD CONSTRAINT "fact_provenance_extraction_run_id_fkey" FOREIGN KEY ("extraction_run_id") REFERENCES "extraction_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canonical_candidate_intelligence" ADD CONSTRAINT "canonical_candidate_intelligence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canonical_candidate_intelligence" ADD CONSTRAINT "canonical_candidate_intelligence_source_fact_id_fkey" FOREIGN KEY ("source_fact_id") REFERENCES "fact_observations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canonical_candidate_intelligence" ADD CONSTRAINT "canonical_candidate_intelligence_provenance_id_fkey" FOREIGN KEY ("provenance_id") REFERENCES "fact_provenance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_events" ADD CONSTRAINT "outcome_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_events" ADD CONSTRAINT "outcome_events_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_events" ADD CONSTRAINT "action_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_events" ADD CONSTRAINT "action_events_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_events" ADD CONSTRAINT "action_events_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "job_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_extraction_run_id_fkey" FOREIGN KEY ("extraction_run_id") REFERENCES "extraction_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_feedback" ADD CONSTRAINT "prediction_feedback_prediction_id_fkey" FOREIGN KEY ("prediction_id") REFERENCES "predictions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_feedback" ADD CONSTRAINT "prediction_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canonical_occupation_aliases" ADD CONSTRAINT "canonical_occupation_aliases_occupation_id_fkey" FOREIGN KEY ("occupation_id") REFERENCES "canonical_occupations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canonical_skill_aliases" ADD CONSTRAINT "canonical_skill_aliases_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "canonical_skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canonical_time_zones" ADD CONSTRAINT "canonical_time_zones_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "canonical_countries"("iso_alpha_2") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occupation_skill" ADD CONSTRAINT "occupation_skill_occupation_id_fkey" FOREIGN KEY ("occupation_id") REFERENCES "canonical_occupations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occupation_skill" ADD CONSTRAINT "occupation_skill_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "canonical_skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_relationship" ADD CONSTRAINT "skill_relationship_skill_a_fkey" FOREIGN KEY ("skill_a") REFERENCES "canonical_skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_relationship" ADD CONSTRAINT "skill_relationship_skill_b_fkey" FOREIGN KEY ("skill_b") REFERENCES "canonical_skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occupation_hierarchy" ADD CONSTRAINT "occupation_hierarchy_parent_fkey" FOREIGN KEY ("parent") REFERENCES "canonical_occupations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occupation_hierarchy" ADD CONSTRAINT "occupation_hierarchy_child_fkey" FOREIGN KEY ("child") REFERENCES "canonical_occupations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occupation_classification_mapping" ADD CONSTRAINT "occupation_classification_mapping_occupation_id_fkey" FOREIGN KEY ("occupation_id") REFERENCES "canonical_occupations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_signals" ADD CONSTRAINT "company_signals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_profile_embeddings" ADD CONSTRAINT "candidate_profile_embeddings_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "embedding_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_embeddings" ADD CONSTRAINT "opportunity_embeddings_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "embedding_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_embeddings" ADD CONSTRAINT "application_embeddings_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "embedding_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

