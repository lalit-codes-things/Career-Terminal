-- Migration: add_resume_dedup
-- Adds two tables that power the SHA-256 file-deduplication system.
--
-- resume_hashes  — one row per unique file blob (keyed by SHA-256 hash).
--                  Multiple users uploading identical files all point here.
-- user_resumes   — one row per user×upload event, FK → resume_hashes.
--
-- Apply with:  npx prisma migrate deploy
-- Roll back:   DROP TABLE user_resumes; DROP TABLE resume_hashes;

-- ---------------------------------------------------------------------
-- Table: resume_hashes
-- ---------------------------------------------------------------------

CREATE TABLE "resume_hashes" (
    "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "hash"        TEXT         NOT NULL,
    "storage_key" TEXT         NOT NULL,
    "storage_url" TEXT         NOT NULL,
    "mime_type"   TEXT         NOT NULL,
    "size_bytes"  INTEGER      NOT NULL,
    "created_at"  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "resume_hashes_pkey" PRIMARY KEY ("id")
);

-- The hash column is the dedup key — must be unique and fast to look up.
CREATE UNIQUE INDEX "resume_hashes_hash_key"
    ON "resume_hashes" ("hash");

-- Explicit index even though there's a unique constraint,
-- keeps the query planner happy on large tables.
CREATE INDEX "resume_hashes_hash_idx"
    ON "resume_hashes" ("hash");

-- ---------------------------------------------------------------------
-- Table: user_resumes
-- ---------------------------------------------------------------------

CREATE TABLE "user_resumes" (
    "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"         TEXT         NOT NULL,
    "original_name"   TEXT         NOT NULL,
    "resume_hash_id"  UUID         NOT NULL,
    "is_active"       BOOLEAN      NOT NULL DEFAULT TRUE,
    "created_at"      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updated_at"      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "user_resumes_pkey" PRIMARY KEY ("id")
);

-- Partition key index — every query must scope to userId.
CREATE INDEX "user_resumes_user_id_idx"
    ON "user_resumes" ("user_id");

-- Composite index for "give me this user's active resume" queries.
CREATE INDEX "user_resumes_user_id_is_active_idx"
    ON "user_resumes" ("user_id", "is_active");

CREATE INDEX "user_resumes_resume_hash_id_idx"
    ON "user_resumes" ("resume_hash_id");

-- Foreign key: prevent orphaned user_resume rows.
ALTER TABLE "user_resumes"
    ADD CONSTRAINT "user_resumes_resume_hash_id_fkey"
    FOREIGN KEY ("resume_hash_id")
    REFERENCES "resume_hashes" ("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

-- Auto-update updated_at on every row modification.
-- Requires the pgcrypto/moddatetime extension or a custom trigger.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "user_resumes_updated_at"
    BEFORE UPDATE ON "user_resumes"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
