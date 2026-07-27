-- Migration: add_resume_versioning
-- Epic 1-3 Prompt 3 — Resume <-> Application Version Linkage
--
-- Purpose:
--   (a) Add version + superseded_at to user_resumes so each upload is a new
--       row with a monotonic version per user.
--   (b) Create application_resumes link table that immutably records which
--       resume version was used for which job application, with a storage
--       snapshot key for audit.
--
-- Roll back:
--   DROP TABLE IF EXISTS application_resumes CASCADE;
--   ALTER TABLE user_resumes DROP CONSTRAINT IF EXISTS unique_user_resume_version;
--   DROP INDEX IF EXISTS idx_user_resumes_user_version;
--   ALTER TABLE user_resumes DROP COLUMN IF EXISTS version;
--   ALTER TABLE user_resumes DROP COLUMN IF EXISTS superseded_at;

-- ============================================================
-- (A) VERSIONING COLUMNS ON user_resumes
-- ============================================================

ALTER TABLE user_resumes
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN user_resumes.version IS
    'Monotonic version per user (starts at 1).  New upload = max(version) + 1.';

ALTER TABLE user_resumes
    ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

COMMENT ON COLUMN user_resumes.superseded_at IS
    'Timestamp when this version was replaced by a newer upload.';

-- Back-annotation: for users who already have multiple rows in user_resumes
-- (e.g. uploaded multiple times before this migration), number their rows
-- in created_at order so the UNIQUE constraint doesn't fail when they have
-- the default `1` already.  Rows without a mapped user_id stay at 1.
DO $$
DECLARE
    u RECORD;
BEGIN
    FOR u IN
        SELECT user_id
          FROM user_resumes
         WHERE user_id IS NOT NULL
         GROUP BY user_id
        HAVING COUNT(*) > 1
    LOOP
        UPDATE user_resumes r
           SET version = n.rn
          FROM (
            SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
              FROM user_resumes
             WHERE user_id = u.user_id
          ) n
         WHERE r.id = n.id;
    END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_resumes_user_version
    ON user_resumes (user_id, version)
    WHERE user_id IS NOT NULL;

ALTER TABLE user_resumes
    DROP CONSTRAINT IF EXISTS unique_user_resume_version;

-- ============================================================
-- (B) application_resumes link table
-- ============================================================

CREATE TABLE IF NOT EXISTS application_resumes (
    id                 UUID           NOT NULL DEFAULT gen_random_uuid(),
    application_id     UUID           NOT NULL,
    resume_version_id  UUID           NOT NULL,
    snapshot_key       TEXT           NOT NULL,
    snapshot_metadata  JSONB,
    applied_at         TIMESTAMPTZ    NOT NULL,
    usage_context      JSONB,
    created_at         TIMESTAMPTZ    NOT NULL DEFAULT now(),

    CONSTRAINT application_resumes_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE application_resumes IS
    'Immutable snapshot of exactly which resume version was used to submit a job application.';

COMMENT ON COLUMN application_resumes.snapshot_key IS
    'Copy of resume_hashes.storage_key at link-time so we can always retrieve the exact blob.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_application_resumes_application
    ON application_resumes (application_id);

CREATE INDEX IF NOT EXISTS idx_application_resumes_resume_version
    ON application_resumes (resume_version_id);

CREATE INDEX IF NOT EXISTS idx_application_resumes_applied_at
    ON application_resumes (applied_at);

ALTER TABLE application_resumes
    ADD CONSTRAINT application_resumes_application_id_fkey
        FOREIGN KEY (application_id)
        REFERENCES job_applications (id)
        ON DELETE CASCADE;

ALTER TABLE application_resumes
    ADD CONSTRAINT application_resumes_resume_version_id_fkey
        FOREIGN KEY (resume_version_id)
        REFERENCES user_resumes (id)
        ON DELETE RESTRICT;
