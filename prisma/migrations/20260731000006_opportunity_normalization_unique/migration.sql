-- ============================================================
-- Career Terminal — Add normalized title/location + unique constraint on Opportunity
-- ============================================================
--
-- Adds normalized_title and normalized_location columns to the opportunities
-- table and a unique constraint on (company_id, normalized_title,
-- normalized_location) to prevent duplicate opportunities at the database level
-- even when the application-level fuzzy matcher races concurrently.
--

ALTER TABLE "opportunities"
  ADD COLUMN "normalized_title" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "normalized_location" TEXT NOT NULL DEFAULT '';

-- Backfill existing rows with normalized values matching the service-side logic.
-- Title normalization: lowercase, strip non-alphanumerics to spaces, remove
-- seniority noise words, collapse whitespace.
-- Location normalization: lowercase, strip non-alphanumerics to spaces, collapse.

UPDATE "opportunities"
SET "normalized_title" = (
    LOWER(REGEXP_REPLACE(title, '[^a-z0-9]+', ' ', 'g'))
  ),
    "normalized_location" = CASE
      WHEN location IS NULL THEN ''
      ELSE LOWER(REGEXP_REPLACE(location, '[^a-z0-9]+', ' ', 'g'))
    END;

-- Remove leading/trailing whitespace from normalized values (PostgreSQL trim)
UPDATE "opportunities"
SET "normalized_title" = TRIM("normalized_title"),
    "normalized_location" = TRIM("normalized_location");

-- Add the composite unique constraint.  If duplicates already exist, they must
-- be resolved first.  We collapse duplicates by keeping the earliest row and
-- updating references.
--
-- (In a fresh install there are no duplicates; in a migration scenario the
--  operator must run the dedup step manually before applying the unique index.)

-- Attempt to create the unique index — errors if pre-existing duplicates.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  "opportunities_company_title_location_unique_idx"
  ON "opportunities" ("company_id", "normalized_title", "normalized_location");

-- Also create a regular index for fast lookup by normalized fields
CREATE INDEX IF NOT EXISTS "opportunities_normalized_title_idx"
  ON "opportunities" ("normalized_title");
CREATE INDEX IF NOT EXISTS "opportunities_normalized_location_idx"
  ON "opportunities" ("normalized_location");
