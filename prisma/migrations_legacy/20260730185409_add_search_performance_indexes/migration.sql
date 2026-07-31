-- ============================================================
-- Career Terminal — Search & Performance Indexes
-- ============================================================
--
-- Adds GIN, GIST, trigram and composite indexes for real query
-- patterns. Indexes are created concurrently where appropriate
-- and validated against actual usage.

-- ------------------------------------------------------------
-- 1. Enable required extensions
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- ------------------------------------------------------------
-- 2. Full-text search indexes (companies, opportunities)
-- ------------------------------------------------------------

-- Company name + industry for search
CREATE INDEX IF NOT EXISTS "idx_companies_name_trgm"
  ON "companies" USING gin ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_companies_industry_trgm"
  ON "companies" USING gin ("industry" gin_trgm_ops);

-- Opportunity title + description for search
CREATE INDEX IF NOT EXISTS "idx_opportunities_title_trgm"
  ON "opportunities" USING gin ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_opportunities_description_fts"
  ON "opportunities" USING gin (to_tsvector('english', COALESCE("description", '')));

-- Composite for opportunity search: location + title
CREATE INDEX IF NOT EXISTS "idx_opportunities_location_title"
  ON "opportunities" ("location", "title");

-- ------------------------------------------------------------
-- 3. JSONB GIN indexes for variable fields
-- ------------------------------------------------------------

-- Candidate preferences (JSONB queries)
CREATE INDEX IF NOT EXISTS "idx_candidate_profiles_preferences_gin"
  ON "candidate_profiles" USING gin ("preferences");

-- Candidate career goals (JSONB queries)
CREATE INDEX IF NOT EXISTS "idx_candidate_profiles_career_goals_gin"
  ON "candidate_profiles" USING gin ("career_goals");

-- Opportunity requirements (JSONB queries)
CREATE INDEX IF NOT EXISTS "idx_opportunities_requirements_gin"
  ON "opportunities" USING gin ("requirements");

-- Opportunity source metadata (JSONB queries)
CREATE INDEX IF NOT EXISTS "idx_opportunities_source_metadata_gin"
  ON "opportunities" USING gin ("source_metadata");

-- Job application metadata (JSONB queries)
CREATE INDEX IF NOT EXISTS "idx_job_applications_metadata_gin"
  ON "job_applications" USING gin ("metadata");

-- Fact observation fact_data (JSONB queries)
CREATE INDEX IF NOT EXISTS "idx_fact_observations_fact_data_gin"
  ON "fact_observations" USING gin ("fact_data");

-- Snapshot candidate_state_json (JSONB queries)
CREATE INDEX IF NOT EXISTS "idx_snapshots_candidate_state_gin"
  ON "snapshots" USING gin ("candidate_state_json");

-- Application timeline metadata (JSONB queries)
CREATE INDEX IF NOT EXISTS "idx_app_timeline_metadata_gin"
  ON "application_timeline_events" USING gin ("metadata");

-- Recommendation score_breakdown (JSONB queries)
CREATE INDEX IF NOT EXISTS "idx_recommendations_score_gin"
  ON "recommendations" USING gin ("score_breakdown");

-- Prediction prediction_value (JSONB queries)
CREATE INDEX IF NOT EXISTS "idx_predictions_value_gin"
  ON "predictions" USING gin ("prediction_value");

-- ------------------------------------------------------------
-- 4. Composite indexes for hot-path queries
-- ------------------------------------------------------------

-- User applications by status + last activity
CREATE INDEX IF NOT EXISTS "idx_job_applications_user_status_activity"
  ON "job_applications" ("userId", "status", "last_activity_at" DESC);

-- User fact observations by current flag + observed time
CREATE INDEX IF NOT EXISTS "idx_fact_observations_user_current_observed"
  ON "fact_observations" ("userId", "isCurrent", "observed_at" DESC);

-- User predictions by timestamp + type
CREATE INDEX IF NOT EXISTS "idx_predictions_user_type_time"
  ON "predictions" ("userId", "prediction_type", "timestamp" DESC);

-- User recommendations by type + created time
CREATE INDEX IF NOT EXISTS "idx_recommendations_user_type_created"
  ON "recommendations" ("userId", "recommendation_type", "created_at" DESC);

-- Email messages by thread + received time
CREATE INDEX IF NOT EXISTS "idx_email_messages_thread_received"
  ON "email_messages" ("threadId", "received_at" DESC);

-- User resumes by active flag + created time
CREATE INDEX IF NOT EXISTS "idx_user_resumes_user_active_created"
  ON "user_resumes" ("userId", "isActive", "created_at" DESC);

-- Canonical candidate intelligence by active + fact type
CREATE INDEX IF NOT EXISTS "idx_canonical_intelligence_user_active_type"
  ON "canonical_candidate_intelligence" ("userId", "isActive", "fact_type");

-- Outcome events by user + type + occurred time
CREATE INDEX IF NOT EXISTS "idx_outcome_events_user_type_occurred"
  ON "outcome_events" ("userId", "outcome_type", "occurred_at" DESC);

-- Action events by user + action type + occurred time
CREATE INDEX IF NOT EXISTS "idx_action_events_user_type_occurred"
  ON "action_events" ("userId", "action_type", "occurred_at" DESC);

-- Events by user + status + correlation ID
CREATE INDEX IF NOT EXISTS "idx_events_user_status_correlation"
  ON "events" ("userId", "status", "correlation_id");

-- Events by aggregate + type for event-sourcing lookups
CREATE INDEX IF NOT EXISTS "idx_events_aggregate_type_created"
  ON "events" ("aggregateId", "aggregateType", "created_at" DESC);

-- User events by user + created date (for user-scoped timeline)
CREATE INDEX IF NOT EXISTS "idx_events_user_created"
  ON "events" ("userId", "created_at" DESC);

-- ------------------------------------------------------------
-- 5. Partial indexes for filtered access
-- ------------------------------------------------------------

-- Only current fact observations for a user (excludes superseded)
CREATE INDEX IF NOT EXISTS "idx_fact_observations_user_current_only"
  ON "fact_observations" ("userId", "fact_type", "observed_at" DESC)
  WHERE "isCurrent" = true AND "deletedAt" IS NULL;

-- Only active applications (excludes fully withdrawn)
CREATE INDEX IF NOT EXISTS "idx_job_applications_user_active_only"
  ON "job_applications" ("userId", "status", "last_activity_at" DESC)
  WHERE "status" NOT IN ('WITHDRAWN');

-- Only non-deleted users
CREATE INDEX IF NOT EXISTS "idx_users_active_only"
  ON "users" ("id", "region", "cellId")
  WHERE "deletedAt" IS NULL;

-- Only current opportunities
CREATE INDEX IF NOT EXISTS "idx_opportunities_current_only"
  ON "opportunities" ("companyId", "posted_at" DESC)
  WHERE "isCurrent" = true;

-- Only active Gmail connections
CREATE INDEX IF NOT EXISTS "idx_gmail_connections_user_active"
  ON "user_email_connections" ("userId", "status")
  WHERE "status" = 'ACTIVE';

-- Only clean resume versions
CREATE INDEX IF NOT EXISTS "idx_user_resumes_clean_only"
  ON "user_resumes" ("userId", "version" DESC)
  WHERE "scanningStatus" IS NULL OR "scanningStatus" != 'INFECTED';
