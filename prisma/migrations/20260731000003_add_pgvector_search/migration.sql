-- ============================================================
-- Career Terminal — pgvector Semantic Search & Performance Indexes
-- ============================================================
--
-- Adds the derived-data indexes that are NOT expressible in schema.prisma:
--   - HNSW vector indexes (candidate/opportunity/application embeddings)
--   - trigram / GIN full-text + JSONB indexes
--   - hot-path composite and partial indexes
--
-- The embedding TABLES themselves are created by the 0_init baseline. The
-- vector / pg_trgm / btree_gin extensions are provisioned OUT-OF-BAND before
-- migrations (docker/postgres/init/00-extensions.sql or bootstrap-roles.sql),
-- so no CREATE EXTENSION is issued here (the migration role is not superuser).
-- ============================================================

-- ── 1. Embedding version tracking seed ───────────────────────
-- Derived embeddings are tied to a model version so re-embedding is possible.
INSERT INTO "embedding_models" ("id", "name", "version", "dimensions", "is_active", "created_at", "updated_at")
VALUES ('text-embedding-3-large', 'OpenAI Text Embedding 3 Large', 'v1', 1536, true, NOW(), NOW())
ON CONFLICT ("id") DO UPDATE SET "updated_at" = NOW();

-- ── 2. HNSW vector indexes (cosine similarity) ───────────────

CREATE INDEX IF NOT EXISTS "idx_candidate_profile_embeddings_hnsw"
  ON "candidate_profile_embeddings"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS "idx_opportunity_embeddings_hnsw"
  ON "opportunity_embeddings"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS "idx_application_embeddings_hnsw"
  ON "application_embeddings"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── 3. Full-text search indexes ──────────────────────────────

CREATE INDEX IF NOT EXISTS "idx_companies_name_trgm"
  ON "companies" USING gin ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_companies_industry_trgm"
  ON "companies" USING gin ("industry" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_opportunities_title_trgm"
  ON "opportunities" USING gin ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_opportunities_description_fts"
  ON "opportunities" USING gin (to_tsvector('english', COALESCE("description", '')));

CREATE INDEX IF NOT EXISTS "idx_opportunities_location_title"
  ON "opportunities" ("location", "title");

-- ── 4. JSONB GIN indexes ─────────────────────────────────────

CREATE INDEX IF NOT EXISTS "idx_candidate_profiles_preferences_gin"
  ON "candidate_profiles" USING gin ("preferences");

CREATE INDEX IF NOT EXISTS "idx_candidate_profiles_career_goals_gin"
  ON "candidate_profiles" USING gin ("career_goals");

CREATE INDEX IF NOT EXISTS "idx_opportunities_requirements_gin"
  ON "opportunities" USING gin ("requirements");

CREATE INDEX IF NOT EXISTS "idx_opportunities_source_metadata_gin"
  ON "opportunities" USING gin ("source_metadata");

CREATE INDEX IF NOT EXISTS "idx_job_applications_metadata_gin"
  ON "job_applications" USING gin ("metadata");

CREATE INDEX IF NOT EXISTS "idx_fact_observations_fact_data_gin"
  ON "fact_observations" USING gin ("fact_data");

CREATE INDEX IF NOT EXISTS "idx_snapshots_candidate_state_gin"
  ON "snapshots" USING gin ("candidate_state_json");

CREATE INDEX IF NOT EXISTS "idx_app_timeline_metadata_gin"
  ON "application_timeline_events" USING gin ("metadata");

CREATE INDEX IF NOT EXISTS "idx_recommendations_score_gin"
  ON "recommendations" USING gin ("score_breakdown");

CREATE INDEX IF NOT EXISTS "idx_predictions_value_gin"
  ON "predictions" USING gin ("prediction_value");

-- ── 5. Hot-path composite indexes ────────────────────────────

CREATE INDEX IF NOT EXISTS "idx_job_applications_user_status_activity"
  ON "job_applications" ("user_id", "status", "last_activity_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_fact_observations_user_current_observed"
  ON "fact_observations" ("user_id", "is_current", "observed_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_predictions_user_type_time"
  ON "predictions" ("user_id", "prediction_type", "timestamp" DESC);

CREATE INDEX IF NOT EXISTS "idx_recommendations_user_type_created"
  ON "recommendations" ("user_id", "recommendation_type", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_email_messages_thread_received"
  ON "email_messages" ("thread_id", "received_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_user_resumes_user_active_created"
  ON "user_resumes" ("user_id", "is_active", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_canonical_intelligence_user_active_type"
  ON "canonical_candidate_intelligence" ("user_id", "is_active", "fact_type");

CREATE INDEX IF NOT EXISTS "idx_outcome_events_user_type_occurred"
  ON "outcome_events" ("user_id", "outcome_type", "occurred_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_action_events_user_type_occurred"
  ON "action_events" ("user_id", "action_type", "occurred_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_events_user_status_correlation"
  ON "events" ("user_id", "status", "correlation_id");

CREATE INDEX IF NOT EXISTS "idx_events_aggregate_type_created"
  ON "events" ("aggregate_id", "aggregate_type", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_events_user_created"
  ON "events" ("user_id", "created_at" DESC);

-- ── 6. Partial indexes for filtered access ───────────────────

CREATE INDEX IF NOT EXISTS "idx_fact_observations_user_current_only"
  ON "fact_observations" ("user_id", "fact_type", "observed_at" DESC)
  WHERE "is_current" = true AND "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_job_applications_user_active_only"
  ON "job_applications" ("user_id", "status", "last_activity_at" DESC)
  WHERE "status" NOT IN ('WITHDRAWN');

CREATE INDEX IF NOT EXISTS "idx_users_active_only"
  ON "users" ("id", "region", "cell_id")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_opportunities_current_only"
  ON "opportunities" ("company_id", "posted_at" DESC)
  WHERE "is_current" = true;

CREATE INDEX IF NOT EXISTS "idx_gmail_connections_user_active"
  ON "user_email_connections" ("user_id", "status")
  WHERE "status" = 'ACTIVE';

CREATE INDEX IF NOT EXISTS "idx_user_resumes_clean_only"
  ON "user_resumes" ("user_id", "version" DESC)
  WHERE "scanning_status" IS NULL OR "scanning_status" != 'INFECTED';
