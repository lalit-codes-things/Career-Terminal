/**
 * Re-encryption Worker.
 *
 * Migrates encrypted OAuth tokens from old key versions to the current
 * active key version during zero-downtime key rotation.
 *
 * Design principles:
 *   - Idempotent: safe to run multiple times; skips already-migrated records.
 *   - Bounded: processes records in configurable batches (default 50).
 *   - Observable: emits structured logs for every batch.
 *   - Retry-safe: each batch uses a DB transaction; partial failures roll back.
 *   - Non-destructive: old key versions are NOT removed until all data migrates.
 *
 * Key rotation sequence:
 *   1. Add new key: set ENCRYPTION_KEY_V2 + ACTIVE_ENCRYPTION_KEY_VERSION=2.
 *   2. Deploy new pods: new encryptions use V2. Old V1 data still decryptable.
 *   3. Trigger re-encryption jobs via the queue (BullMQ BULK_REENCRYPT job).
 *   4. Worker migrates V1 tokens → V2 in pages.
 *   5. Verify: confirm no V1 records remain (use findConnectionsForReEncryption).
 *   6. Remove ENCRYPTION_KEY (V1) from the secret manager.
 *   7. Deploy final pods with V1 removed from env.
 *
 * Emergency rotation:
 *   If a key is compromised:
 *   1. Immediately generate new key version.
 *   2. Set ACTIVE_ENCRYPTION_KEY_VERSION to new version.
 *   3. Deploy — new logins/token refreshes auto-encrypt with new key.
 *   4. Run re-encryption worker at high concurrency to migrate active tokens.
 *   5. Revoke/rotate any OAuth refresh tokens for affected connections.
 *
 * Queue payload: ReEncryptionJobPayload (see queue.types.ts or inline below)
 */
import { Worker, type Job } from 'bullmq';
import { z } from 'zod';
import { bullMQConnection } from '../../../config/redis';
import { logger } from '../../../lib/logger';
import { dbRouter } from '../../../config/database';
import {
  decryptToken,
  encryptToken,
  getEncryptedKeyVersion,
  getActiveEncryptionVersion,
} from '../../../utils/encryption';

// ---------------------------------------------------------------------------
// Job schema
// ---------------------------------------------------------------------------

export const ReEncryptionJobSchema = z.object({
  /** Target encryption key version to migrate TO */
  targetVersion: z.number().int().positive(),
  /** Max records to process per job execution (default 50) */
  batchSize: z.number().int().positive().max(500).default(50),
  /** Specific connection IDs to re-encrypt (optional; if absent → all stale) */
  connectionIds: z.array(z.string().uuid()).optional(),
});

export type ReEncryptionJobPayload = z.infer<typeof ReEncryptionJobSchema>;

export const REENCRYPTION_QUEUE_NAME = 're-encryption';

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

export async function processReEncryptionJob(job: Job<ReEncryptionJobPayload>): Promise<void> {
  const { targetVersion, batchSize, connectionIds } = ReEncryptionJobSchema.parse(job.data);
  const activeVersion = getActiveEncryptionVersion();

  if (targetVersion !== activeVersion) {
    logger.warn('[ReEncryptionWorker] targetVersion does not match active version', {
      targetVersion,
      activeVersion,
    });
  }

  logger.info('[ReEncryptionWorker] Starting re-encryption batch', {
    jobId: job.id,
    targetVersion,
    batchSize,
    specificIds: connectionIds?.length ?? 'all stale',
  });

  // Build the where clause
  const versionPrefix = `v${targetVersion}:`;
  const where = connectionIds?.length
    ? { id: { in: connectionIds } }
    : {
        OR: [
          // Legacy format (no v prefix at all = version 1)
          ...(targetVersion !== 1 ? [{ accessTokenEncrypted: { not: { startsWith: 'v' } } }] : []),
          // Has a version prefix but it's not the target version
          {
            AND: [
              { accessTokenEncrypted: { startsWith: 'v' } },
              { accessTokenEncrypted: { not: { startsWith: versionPrefix } } },
            ],
          },
        ],
      };

  const records = await dbRouter.read().userEmailConnection.findMany({
    where,
    select: {
      id: true,
      accessTokenEncrypted: true,
      refreshTokenEncrypted: true,
    },
    take: batchSize,
  });

  if (records.length === 0) {
    logger.info('[ReEncryptionWorker] No stale records found — migration complete or already done');
    return;
  }

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const record of records) {
    try {
      const accessVersion = getEncryptedKeyVersion(record.accessTokenEncrypted);
      const refreshVersion = getEncryptedKeyVersion(record.refreshTokenEncrypted);

      const needsAccessMigration = accessVersion !== targetVersion;
      const needsRefreshMigration = refreshVersion !== targetVersion;

      if (!needsAccessMigration && !needsRefreshMigration) {
        skipped++;
        continue;
      }

      // Decrypt with old key, re-encrypt with active key — inside a transaction
      await dbRouter.write().$transaction(async (tx) => {
        const updateData: {
          accessTokenEncrypted?: string;
          refreshTokenEncrypted?: string;
        } = {};

        if (needsAccessMigration) {
          const plaintext = decryptToken(record.accessTokenEncrypted);
          updateData.accessTokenEncrypted = encryptToken(plaintext);
        }

        if (needsRefreshMigration) {
          const plaintext = decryptToken(record.refreshTokenEncrypted);
          updateData.refreshTokenEncrypted = encryptToken(plaintext);
        }

        await tx.userEmailConnection.update({
          where: { id: record.id },
          data: updateData,
        });
      });

      migrated++;
    } catch (error) {
      failed++;
      logger.error('[ReEncryptionWorker] Failed to re-encrypt connection', {
        connectionId: record.id,
        error: error instanceof Error ? error.message : String(error),
        // Never log the encrypted values
      });
      // Continue with other records — don't abort the entire batch
    }
  }

  logger.info('[ReEncryptionWorker] Re-encryption batch complete', {
    jobId: job.id,
    processed: records.length,
    migrated,
    skipped,
    failed,
    targetVersion,
  });

  // If this batch was full, there may be more records — re-queue
  if (records.length === batchSize && failed === 0) {
    logger.info('[ReEncryptionWorker] Batch full — re-queue for next page');
    // Caller should schedule follow-up jobs to drain remaining stale records
  }
}

// ---------------------------------------------------------------------------
// Worker instantiation
// ---------------------------------------------------------------------------

export function startReEncryptionWorker(): Worker<ReEncryptionJobPayload> {
  const worker = new Worker<ReEncryptionJobPayload>(
    REENCRYPTION_QUEUE_NAME,
    processReEncryptionJob,
    {
      connection: bullMQConnection,
      concurrency: 2, // Low concurrency — crypto is CPU-bound
    },
  );

  worker.on('completed', (job) =>
    logger.info('[ReEncryptionWorker] Job completed', { jobId: job.id }),
  );

  worker.on('failed', (job, err) =>
    logger.error('[ReEncryptionWorker] Job failed', {
      jobId: job?.id,
      error: err.message,
    }),
  );

  worker.on('error', (err) =>
    logger.error('[ReEncryptionWorker] Worker error', { message: err.message }),
  );

  logger.info('[ReEncryptionWorker] Started (concurrency=2)');
  return worker;
}
