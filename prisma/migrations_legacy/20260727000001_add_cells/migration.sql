BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cell_status') THEN
    CREATE TYPE "cell_status" AS ENUM ('ACTIVE', 'DRAINING', 'READ_ONLY', 'MIGRATING', 'DISABLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cell_lifecycle_state') THEN
    CREATE TYPE "cell_lifecycle_state" AS ENUM ('PROVISIONING', 'ACTIVE', 'DRAINING', 'MIGRATING', 'DISABLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cell_routing_state') THEN
    CREATE TYPE "cell_routing_state" AS ENUM ('ROUTABLE', 'WRITE_BLOCKED', 'READ_ONLY', 'UNROUTABLE');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "cells" (
  "id"                TEXT NOT NULL,
  "region"            TEXT NOT NULL,
  "residency_policy_id" TEXT,
  "status"            "cell_status" NOT NULL DEFAULT 'ACTIVE',
  "lifecycle_state"   "cell_lifecycle_state" NOT NULL DEFAULT 'ACTIVE',
  "routing_state"     "cell_routing_state" NOT NULL DEFAULT 'ROUTABLE',
  "capacity_state"    TEXT,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "cells_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cells_region_idx" ON "cells" ("region");
CREATE INDEX IF NOT EXISTS "cells_status_idx" ON "cells" ("status");
CREATE INDEX IF NOT EXISTS "cells_routing_state_idx" ON "cells" ("routing_state");

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "cell_id" TEXT;

WITH user_cells AS (
  SELECT DISTINCT
    "id",
    "region",
    "shard_key",
    CONCAT("region", '-shard-', LPAD(COALESCE("shard_key", 0)::text, 3, '0')) AS cell_id
  FROM "users"
)
INSERT INTO "cells" ("id", "region")
SELECT DISTINCT uc.cell_id, uc.region
FROM user_cells uc
ON CONFLICT ("id") DO NOTHING;

UPDATE "users" u
SET "cell_id" = CONCAT(u."region", '-shard-', LPAD(COALESCE(u."shard_key", 0)::text, 3, '0'))
WHERE u."cell_id" IS NULL;

CREATE INDEX IF NOT EXISTS "users_cell_id_idx" ON "users" ("cell_id");

ALTER TABLE "users"
  ADD CONSTRAINT "users_cell_id_fkey"
  FOREIGN KEY ("cell_id") REFERENCES "cells"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
