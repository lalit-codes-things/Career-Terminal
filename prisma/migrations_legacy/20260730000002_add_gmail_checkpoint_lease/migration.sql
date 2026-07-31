-- Add lease fields to gmail_checkpoints for real concurrency control
-- Uses PostgreSQL advisory locks + lease ownership for worker claims

ALTER TABLE "gmail_checkpoints" ADD COLUMN IF NOT EXISTS "lease_owner" TEXT;
ALTER TABLE "gmail_checkpoints" ADD COLUMN IF NOT EXISTS "lease_expires_at" TIMESTAMPTZ;
ALTER TABLE "gmail_checkpoints" ADD COLUMN IF NOT EXISTS "worker_id" TEXT;

CREATE INDEX IF NOT EXISTS "idx_gmail_checkpoints_lease" ON "gmail_checkpoints" ("lease_expires_at") WHERE "status" = 'syncing';

-- Add gmail_sync_queue for BullMQ-backed sync scheduling
CREATE TABLE IF NOT EXISTS "gmail_sync_queue" (
  "id" TEXT NOT NULL,
  "userId" UUID NOT NULL,
  "legacyUserId" TEXT NOT NULL,
  "connectionId" UUID NOT NULL,
  "syncMode" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "nextRunAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "lastError" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "gmail_sync_queue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_gmail_sync_queue_user_mode" ON "gmail_sync_queue" ("userId", "syncMode") WHERE "nextRunAt" IS NOT NULL AND "attempts" < "maxAttempts";
CREATE INDEX IF NOT EXISTS "idx_gmail_sync_queue_next_run" ON "gmail_sync_queue" ("nextRunAt", "priority");

-- Add malware_scan_results for real scanner audit trail
CREATE TABLE IF NOT EXISTS "malware_scan_results" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userResumeId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "scanner" TEXT NOT NULL,
  "result" TEXT NOT NULL,
  "threats" JSONB,
  "scanDurationMs" INTEGER,
  "scannedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "metadata" JSONB DEFAULT '{}',
  CONSTRAINT "malware_scan_results_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_malware_scan_results_resume" ON "malware_scan_results" ("userResumeId");
CREATE INDEX IF NOT EXISTS "idx_malware_scan_results_user" ON "malware_scan_results" ("userId");
