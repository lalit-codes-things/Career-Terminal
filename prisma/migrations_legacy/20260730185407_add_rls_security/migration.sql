-- ============================================================
-- Career Terminal — PostgreSQL Row-Level Security Hardening
-- ============================================================
--
-- 1. Database role separation (least privilege)
-- 2. Request-scoped identity (app.current_user_id)
-- 3. RLS on all user-owned tables
-- 4. Service/admin role for background workers
--
-- ============================================================

-- ── 1. Database Roles ────────────────────────────────────────

-- Runtime application role — normal query + DML, NO DDL
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime;
  END IF;
END
$$;

-- Migration/admin role — schema changes, migrations
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_migration') THEN
    CREATE ROLE app_migration;
  END IF;
END
$$;

-- Read-only/reporting role
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_readonly') THEN
    CREATE ROLE app_readonly;
  END IF;
END
$$;

-- Worker/service role — same as runtime but for worker processes
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_worker') THEN
    CREATE ROLE app_worker;
  END IF;
END
$$;

-- Admin/service role for elevated operations (e.g. migration runner, admin tooling)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_admin') THEN
    CREATE ROLE app_admin;
  END IF;
END
$$;

-- ── 2. Application-level session identity ─────────────────────
--
-- We store the authenticated user ID in a custom GUC variable.
-- This variable is set at the start of each transaction/request
-- and is consumed by RLS policies.
--
-- IMPORTANT: The caller must ALWAYS set this explicitly.
-- We do NOT trust client-supplied values inside the database.

CREATE OR REPLACE FUNCTION set_app_user_id(p_user_id TEXT)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.current_user_id', p_user_id, false);
END;
$$ LANGUAGE plpgsql;

-- Helper: returns the current user id cast to uuid, or NULL
CREATE OR REPLACE FUNCTION current_app_user_id()
RETURNS UUID AS $$
BEGIN
  RETURN NULLIF(current_setting('app.current_user_id', true), '')::UUID;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- ── 3. RLS Helper Policy ──────────────────────────────────────
--
-- The policy checks whether the row's user_id matches the session user
-- OR whether the caller has the app_admin / app_worker role (which
-- may bypass user-scoping for system-level operations where the row
-- has a NULL user_id or needs explicit access).

-- ── 4. Enable RLS on user-owned tables ────────────────────────

-- Users (self-access only)
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;

-- User-owned domain tables
ALTER TABLE "candidate_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_id_mapping" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_email_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gmail_sync_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gmail_checkpoints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_operations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "batch_email_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dead_letter_emails" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gmail_sync_queue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "malware_scan_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_resumes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resumes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fact_observations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "extraction_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fact_provenance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "canonical_candidate_intelligence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outcome_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "action_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "predictions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prediction_feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recommendations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "application_timeline_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "application_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "application_status_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_records" ENABLE ROW LEVEL SECURITY;

-- ── 5. RLS Policies ──────────────────────────────────────────
--
-- Generous SELECT + full DML for the owner.
-- Admins/workers get access for rows they explicitly need (NULL user_id
-- or via explicit service role). However, the default for user-owned
-- rows is strict user scoping.
--
-- Application must still enforce authorization. RLS is defense in depth.

-- users
CREATE POLICY users_owner_policy ON "users"
  FOR ALL
  USING ("id" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- candidate_profiles
CREATE POLICY candidate_profiles_owner_policy ON "candidate_profiles"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- user_id_mapping
CREATE POLICY user_id_mapping_owner_policy ON "user_id_mapping"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- user_email_connections
CREATE POLICY user_email_connections_owner_policy ON "user_email_connections"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- gmail_sync_states
CREATE POLICY gmail_sync_states_owner_policy ON "gmail_sync_states"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- gmail_checkpoints
CREATE POLICY gmail_checkpoints_owner_policy ON "gmail_checkpoints"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- sync_operations
CREATE POLICY sync_operations_owner_policy ON "sync_operations"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- sync_jobs
CREATE POLICY sync_jobs_owner_policy ON "sync_jobs"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- sync_batches
CREATE POLICY sync_batches_owner_policy ON "sync_batches"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- batch_email_jobs (accessible via batch -> user_id)
CREATE POLICY batch_email_jobs_owner_policy ON "batch_email_jobs"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "sync_batches" sb
      WHERE sb."id" = "batch_email_jobs"."batchId"
        AND sb."userId" = current_app_user_id()
    )
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

-- dead_letter_emails
CREATE POLICY dead_letter_emails_owner_policy ON "dead_letter_emails"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- gmail_sync_queue
CREATE POLICY gmail_sync_queue_owner_policy ON "gmail_sync_queue"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- malware_scan_results
CREATE POLICY malware_scan_results_owner_policy ON "malware_scan_results"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- user_resumes
CREATE POLICY user_resumes_owner_policy ON "user_resumes"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- resumes
CREATE POLICY resumes_owner_policy ON "resumes"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- fact_observations
CREATE POLICY fact_observations_owner_policy ON "fact_observations"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- snapshots
CREATE POLICY snapshots_owner_policy ON "snapshots"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- extraction_runs
CREATE POLICY extraction_runs_owner_policy ON "extraction_runs"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- fact_provenance
CREATE POLICY fact_provenance_owner_policy ON "fact_provenance"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- canonical_candidate_intelligence
CREATE POLICY canonical_candidate_intelligence_owner_policy ON "canonical_candidate_intelligence"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- outcome_events
CREATE POLICY outcome_events_owner_policy ON "outcome_events"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- action_events
CREATE POLICY action_events_owner_policy ON "action_events"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- predictions
CREATE POLICY predictions_owner_policy ON "predictions"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- prediction_feedback
CREATE POLICY prediction_feedback_owner_policy ON "prediction_feedback"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- recommendations
CREATE POLICY recommendations_owner_policy ON "recommendations"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- events
CREATE POLICY events_owner_policy ON "events"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- job_applications
CREATE POLICY job_applications_owner_policy ON "job_applications"
  FOR ALL
  USING ("userId" = current_app_user_id() OR pg_has_role(current_user, 'app_admin', 'member'));

-- application_timeline_events
CREATE POLICY application_timeline_events_owner_policy ON "application_timeline_events"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "job_applications" ja
      WHERE ja."id" = "application_timeline_events"."applicationId"
        AND ja."userId" = current_app_user_id()
    )
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

-- application_sources
CREATE POLICY application_sources_owner_policy ON "application_sources"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "job_applications" ja
      WHERE ja."id" = "application_sources"."applicationId"
        AND ja."userId" = current_app_user_id()
    )
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

-- application_status_history
CREATE POLICY application_status_history_owner_policy ON "application_status_history"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "job_applications" ja
      WHERE ja."id" = "application_status_history"."applicationId"
        AND ja."userId" = current_app_user_id()
    )
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

-- email_messages
CREATE POLICY email_messages_owner_policy ON "email_messages"
  FOR ALL
  USING ("userId" = current_app_user_id() OR "userId" IS NULL AND pg_has_role(current_user, 'app_admin', 'member') OR "userId" = current_app_user_id());

-- email_attachments (via email_message -> user_id)
CREATE POLICY email_attachments_owner_policy ON "email_attachments"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "email_messages" em
      WHERE em."id" = "email_attachments"."emailMessageId"
        AND (em."userId" = current_app_user_id() OR em."userId" IS NULL)
    )
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

-- idempotency_records (global, but restrict to service role for mutations)
CREATE POLICY idempotency_records_service_policy ON "idempotency_records"
  FOR ALL
  USING (pg_has_role(current_user, 'app_admin', 'member') OR pg_has_role(current_user, 'app_worker', 'member') OR pg_has_role(current_user, 'app_runtime', 'member'));
