BEGIN;

CREATE TABLE IF NOT EXISTS "extraction_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "cell_id" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "source_version" TEXT,
  "source_identity" TEXT,
  "parser_version" TEXT NOT NULL,
  "model_provider" TEXT,
  "model_version" TEXT,
  "prompt_version" TEXT,
  "schema_version" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "failure_reason" TEXT,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "completed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "extraction_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "fact_provenance" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "cell_id" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "source_version" TEXT,
  "source_identity" TEXT,
  "extraction_run_id" UUID NOT NULL,
  "parser_version" TEXT NOT NULL,
  "model_provider" TEXT,
  "model_version" TEXT,
  "prompt_version" TEXT,
  "schema_version" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "fact_provenance_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "extraction_runs"
  ADD CONSTRAINT "extraction_runs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fact_provenance"
  ADD CONSTRAINT "fact_provenance_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fact_provenance"
  ADD CONSTRAINT "fact_provenance_extraction_run_id_fkey"
  FOREIGN KEY ("extraction_run_id") REFERENCES "extraction_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fact_observations"
  ADD COLUMN IF NOT EXISTS "extraction_run_id" UUID,
  ADD COLUMN IF NOT EXISTS "provenance_id" UUID;

WITH legacy_runs AS (
  INSERT INTO "extraction_runs" (
    "user_id", "cell_id", "source_type", "source_id", "source_version",
    "source_identity", "parser_version", "model_provider", "model_version",
    "prompt_version", "schema_version", "status", "completed_at"
  )
  SELECT DISTINCT
    fo."user_id",
    COALESCE(u."cell_id", 'us-east-1-shard-000'),
    fo."source_type",
    fo."source_id",
    fo."source_version",
    fo."source_id",
    COALESCE(fo."extraction_method", 'legacy'),
    fo."model_version",
    fo."model_version",
    'legacy',
    'epic-4-prompt-3',
    'completed',
    NOW()
  FROM "fact_observations" fo
  JOIN "users" u ON u."id" = fo."user_id"
  ON CONFLICT DO NOTHING
  RETURNING "id", "user_id", "source_type", "source_id", "source_version"
)
INSERT INTO "fact_provenance" (
  "user_id", "cell_id", "source_type", "source_id", "source_version",
  "source_identity", "extraction_run_id", "parser_version",
  "model_provider", "model_version", "prompt_version", "schema_version"
)
SELECT
  fo."user_id",
  COALESCE(u."cell_id", 'us-east-1-shard-000'),
  fo."source_type",
  fo."source_id",
  fo."source_version",
  fo."source_id",
  er."id",
  COALESCE(fo."extraction_method", 'legacy'),
  fo."model_version",
  fo."model_version",
  'legacy',
  'epic-4-prompt-3'
FROM "fact_observations" fo
JOIN "users" u ON u."id" = fo."user_id"
JOIN "extraction_runs" er
  ON er."user_id" = fo."user_id"
 AND er."source_type" = fo."source_type"
 AND er."source_id" = fo."source_id"
 AND COALESCE(er."source_version", '') = COALESCE(fo."source_version", '')
WHERE fo."provenance_id" IS NULL;

UPDATE "fact_observations" fo
SET "extraction_run_id" = er."id"
FROM "extraction_runs" er
WHERE fo."extraction_run_id" IS NULL
  AND er."user_id" = fo."user_id"
  AND er."source_type" = fo."source_type"
  AND er."source_id" = fo."source_id"
  AND COALESCE(er."source_version", '') = COALESCE(fo."source_version", '');

UPDATE "fact_observations" fo
SET "provenance_id" = fp."id"
FROM "fact_provenance" fp
WHERE fo."provenance_id" IS NULL
  AND fp."user_id" = fo."user_id"
  AND fp."source_type" = fo."source_type"
  AND fp."source_id" = fo."source_id"
  AND COALESCE(fp."source_version", '') = COALESCE(fo."source_version", '');

ALTER TABLE "fact_observations"
  ALTER COLUMN "extraction_run_id" SET NOT NULL,
  ALTER COLUMN "provenance_id" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "fact_observations_provenance_id_key" ON "fact_observations" ("provenance_id");
CREATE INDEX IF NOT EXISTS "fact_observations_extraction_run_id_idx" ON "fact_observations" ("extraction_run_id");
CREATE UNIQUE INDEX IF NOT EXISTS "fact_provenance_extraction_run_id_key" ON "fact_provenance" ("extraction_run_id");
CREATE INDEX IF NOT EXISTS "fact_provenance_user_id_idx" ON "fact_provenance" ("user_id");
CREATE INDEX IF NOT EXISTS "extraction_runs_user_id_idx" ON "extraction_runs" ("user_id");

ALTER TABLE "fact_observations"
  ADD CONSTRAINT "fact_observations_extraction_run_id_fkey"
  FOREIGN KEY ("extraction_run_id") REFERENCES "extraction_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fact_observations"
  ADD CONSTRAINT "fact_observations_provenance_id_fkey"
  FOREIGN KEY ("provenance_id") REFERENCES "fact_provenance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
