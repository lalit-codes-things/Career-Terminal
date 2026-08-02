-- ============================================================
-- Career Terminal — Outbox Lease Fields for Dispatcher
-- ============================================================
--
-- Adds lease/claim fields to the events table so the OutboxDispatcher
-- can use a proper FOR UPDATE SKIP LOCKED claim model with expiration.
--
-- State machine:
--   pending → processing → processed
--                         → failed (with retry)
--                         → dlq (after max retries)
--
-- Lease fields:
--   lease_owner      — which dispatcher instance holds the claim
--   lease_expires_at — claim expiration; other dispatchers can re-claim
--   next_attempt_at  — scheduled retry time for bounded exponential backoff

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "lease_owner" TEXT;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "lease_expires_at" TIMESTAMPTZ;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "next_attempt_at" TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS "idx_events_lease"
  ON "events" ("lease_owner", "lease_expires_at")
  WHERE "status" IN ('pending', 'failed');
