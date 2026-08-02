-- ============================================================
-- Career Terminal — Fix RLS Policies for Outbox Dispatcher & Embeddings
-- ============================================================
--
-- Fixes:
--   1. events table: allow app_worker role (outbox dispatcher needs to
--      claim and update events for all users).
--   2. candidate_profile_embeddings: user-private embeddings RLS.
--   3. opportunity_embeddings: global + user-scoped embeddings with
--      read-safe user_id IS NULL policy.
--   4. application_embeddings: user-private embeddings RLS.
--   5. opportunity_observations: user-owned observations RLS.

-- ── 1. Fix events table — allow worker role ────────────────────────────────

DROP POLICY IF EXISTS events_owner_policy ON "events";

CREATE POLICY events_owner_policy ON "events"
  FOR ALL
  USING (
    "user_id" = current_app_user_id()
    OR ("user_id" IS NULL AND pg_has_role(current_user, 'app_admin', 'member'))
    OR pg_has_role(current_user, 'app_worker', 'member')
    OR pg_has_role(current_user, 'app_admin', 'member')
  );

-- ── 2. candidate_profile_embeddings (user-private) ─────────────────────────

ALTER TABLE "candidate_profile_embeddings" ENABLE ROW LEVEL SECURITY;

CREATE POLICY candidate_profile_embeddings_owner_policy ON "candidate_profile_embeddings"
  FOR ALL
  USING (
    "user_id" = current_app_user_id()
    OR pg_has_role(current_user, 'app_admin', 'member')
    OR pg_has_role(current_user, 'app_worker', 'member')
  );

-- ── 3. opportunity_embeddings (global + user-scoped) ───────────────────────
--
--    user_id IS NULL  →  globally shared embedding (readable by all)
--    user_id NOT NULL →  user-private (isolated)
--
--    Updates/deletes require either ownership or admin/worker privilege.

ALTER TABLE "opportunity_embeddings" ENABLE ROW LEVEL SECURITY;

CREATE POLICY opportunity_embeddings_select_policy ON "opportunity_embeddings"
  FOR SELECT
  USING (
    "user_id" = current_app_user_id()
    OR "user_id" IS NULL
    OR pg_has_role(current_user, 'app_admin', 'member')
    OR pg_has_role(current_user, 'app_worker', 'member')
  );

CREATE POLICY opportunity_embeddings_write_policy ON "opportunity_embeddings"
  FOR INSERT
  WITH CHECK (
    "user_id" = current_app_user_id()
    OR pg_has_role(current_user, 'app_admin', 'member')
    OR pg_has_role(current_user, 'app_worker', 'member')
  );

CREATE POLICY opportunity_embeddings_update_policy ON "opportunity_embeddings"
  FOR UPDATE
  USING (
    "user_id" = current_app_user_id()
    OR pg_has_role(current_user, 'app_admin', 'member')
    OR pg_has_role(current_user, 'app_worker', 'member')
  );

CREATE POLICY opportunity_embeddings_delete_policy ON "opportunity_embeddings"
  FOR DELETE
  USING (
    "user_id" = current_app_user_id()
    OR pg_has_role(current_user, 'app_admin', 'member')
    OR pg_has_role(current_user, 'app_worker', 'member')
  );

-- ── 4. application_embeddings (user-private) ───────────────────────────────

ALTER TABLE "application_embeddings" ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_embeddings_owner_policy ON "application_embeddings"
  FOR ALL
  USING (
    "user_id" = current_app_user_id()
    OR pg_has_role(current_user, 'app_admin', 'member')
    OR pg_has_role(current_user, 'app_worker', 'member')
  );

-- ── 5. opportunity_observations (user-owned) ──────────────────────────────

ALTER TABLE "opportunity_observations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY opportunity_observations_owner_policy ON "opportunity_observations"
  FOR ALL
  USING (
    "user_id" = current_app_user_id()
    OR ("user_id" IS NULL AND pg_has_role(current_user, 'app_admin', 'member'))
    OR pg_has_role(current_user, 'app_worker', 'member')
  );
