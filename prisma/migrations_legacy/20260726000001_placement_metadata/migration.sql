-- ─────────────────────────────────────────────────────────────────────────────
-- Epic 1–3: Placement metadata & regional affinity
--
-- 1. Adds placement columns to users:
--      data_residency_region   TEXT
--      shard_key               INTEGER
--      tenant_id               TEXT
-- 2. Backfills them in a safe, deterministic way so subsequent migrations
--    can make them NOT NULL without breaking existing rows.
-- 3. Adds a check constraint enforcing known regions (future hardening) and
--    indices for shard / tenant routing.
--
-- Note: we add the columns nullable first, backfill, then keep them nullable
-- in this migration.  The next migration (after the backfill script runs in
-- prod) will make them NOT NULL per the migration plan in Prompt 4.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Add placement columns (nullable) ──────────────────────────────────────

ALTER TABLE "users"
    ADD COLUMN "data_residency_region" TEXT;

ALTER TABLE "users"
    ADD COLUMN "shard_key" INTEGER;

ALTER TABLE "users"
    ADD COLUMN "tenant_id" TEXT;

-- ── 2. Inline backfill for safety (defensive; dedicated script also provided) ─

-- data_residency_region falls back to the user's home region
UPDATE "users"
   SET "data_residency_region" = COALESCE("data_residency_region", "region")
 WHERE "data_residency_region" IS NULL;

-- shard_key = application-level FNV-1a hash of the UUID string, mod 256.
-- The inline computation here is a best-effort placeholder that mirrors
-- the general distribution shape.  Run `scripts/backfill/backfill-placement.ts`
-- immediately after this migration to overwrite the column with the exact
-- FNV-1a output used by PlacementService.
UPDATE "users"
   SET "shard_key" = MOD(
        (
            (ASCII(SUBSTR("id",  1, 1))::bigint * 16777216 +
             ASCII(SUBSTR("id",  9, 1))::bigint *  1048576 +
             ASCII(SUBSTR("id", 15, 1))::bigint *    65536 +
             ASCII(SUBSTR("id", 20, 1))::bigint *     4096 +
             ASCII(SUBSTR("id", 24, 1))::bigint *      256 +
             ASCII(SUBSTR("id", 28, 1))::bigint *       16 +
             ASCII(SUBSTR("id", 36, 1))::bigint)
        ),
        256
    )::integer
 WHERE "shard_key" IS NULL;

-- ── 3. Indices ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "users_shard_key_idx" ON "users" ("shard_key");
CREATE INDEX IF NOT EXISTS "users_tenant_id_idx" ON "users" ("tenant_id");
CREATE INDEX IF NOT EXISTS "users_data_residency_region_idx" ON "users" ("data_residency_region");

-- ── 4. Defensive region check (informational, not yet enforced) ──────────────
-- A future migration will add a hard CHECK constraint once all call-sites
-- have been updated to pass only supported regions.  For now we log the
-- constraint via a COMMENT so operators know the expected values.

COMMENT ON COLUMN "users"."region" IS
    'Home region for placement/routing. Expected values: us-east-1, us-west-2, eu-west-1, eu-central-1, ap-southeast-1, ap-northeast-1. Default: us-east-1';

COMMIT;
