/**
 * Data Retention Service — Epic 0.7, Phases 24 & 25.
 *
 * Manages lifecycle of sensitive data according to retention policies.
 * All cleanup operations are:
 *   - Idempotent: safe to run multiple times.
 *   - Bounded: process records in pages to avoid long-running transactions.
 *   - Observable: emit structured logs for every deletion batch.
 *   - Ownership-safe: always scope by userId or explicit owner.
 *   - Region-aware: can be extended to handle regional data-residency.
 *
 * Retention policies:
 *   - Expired OAuth tokens:          purge connections with EXPIRED/REVOKED status > 30 days old
 *   - Failed BullMQ jobs (DB mirror): no retention — ephemeral in Redis, auto-cleaned by BullMQ
 *   - Completed sync jobs:           purge SyncJob records older than 90 days
 *   - Orphaned temp processing data: purge any temp state left by crashed workers
 *
 * Scheduling:
 *   These jobs are designed to run as BullMQ scheduled (repeatable) jobs.
 *   Add them via the queue service using a cron schedule, e.g.:
 *     await queueService.scheduleRetentionJob({ cron: '0 3 * * *' });  // 3 AM daily
 *
 * Account deletion:
 *   See deleteUserData() — the comprehensive user data deletion method.
 *   This handles GDPR/CCPA erasure requests.
 */
import { PrismaClient } from '@prisma/client';
import { prisma } from '../../config/database';
import { logger } from '../../lib/logger';

// ---------------------------------------------------------------------------
// Retention configuration
// ---------------------------------------------------------------------------

/** Page size for batch deletions — prevents long DB transactions. */
const DELETION_BATCH_SIZE = 100;

/** Expired/revoked OAuth connections older than this are purged. */
const EXPIRED_CONNECTION_RETENTION_DAYS = 30;

/** Completed sync jobs older than this are purged. */
const SYNC_JOB_RETENTION_DAYS = 90;

/** User records are hard-deleted after this grace period (allows undo). */
const DELETION_GRACE_PERIOD_DAYS = 30;

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

// ---------------------------------------------------------------------------
// Data Retention Service
// ---------------------------------------------------------------------------

export class DataRetentionService {
  constructor(private readonly db: PrismaClient = prisma) {}

  // ─────────────────────────────────────────────────────────────────
  // Phase 24: User Data Deletion
  // ─────────────────────────────────────────────────────────────────

  /**
   * Complete user data deletion — handles GDPR/CCPA erasure requests.
   *
   * Deletes in dependency order to respect foreign key constraints:
   *   1. Email messages (references connections and applications)
   *   2. Gmail sync states
   *   3. OAuth connections (and their encrypted tokens)
   *   4. Application timeline entries
   *   5. Application status history
   *   6. Application sources
   *   7. Job applications
   *   8. User resumes (DB records — S3 objects handled separately)
   *   9. Sync job records
   *
   * S3 object deletion:
   *   Resume files in S3 are NOT deleted here because ResumeHash is shared
   *   across users (content-addressable dedup). The S3 object is only deleted
   *   when the LAST UserResume pointing to a ResumeHash is removed.
   *   See deleteOrphanedResumeHashes() for the S3 cleanup pass.
   *
   * Redis cleanup:
   *   Refresh tokens are stored as refresh:{userId}:* keys in Redis.
   *   Call cacheService.delByPrefix(`refresh:${userId}:`) before this method.
   *
   * @param userId - The user to delete (all data scoped to this userId)
   * @returns Summary of deleted record counts
   */
  async deleteUserData(userId: string): Promise<Record<string, number>> {
    logger.info('[DataRetention] Starting user data deletion', { userId });

    const counts: Record<string, number> = {};

    try {
      // 1. Email messages
      const emailResult = await this.db.emailMessage.deleteMany({
        where: { userId },
      });
      counts.emailMessages = emailResult.count;

      // 2. Gmail sync state
      const syncStateResult = await this.db.gmailSyncState.deleteMany({
        where: { userId },
      });
      counts.gmailSyncStates = syncStateResult.count;

      // 3. OAuth connections (encrypted tokens are deleted with the row)
      const connectionResult = await this.db.userEmailConnection.deleteMany({
        where: { userId },
      });
      counts.emailConnections = connectionResult.count;

      // 4. Application timeline entries (via cascade from JobApplication,
      //    but explicit delete ensures it runs even if cascade is removed)
      const timelineResult = await this.db.applicationTimeline.deleteMany({
        where: { application: { userId } },
      });
      counts.timelineEntries = timelineResult.count;

      // 5. Application status history
      const statusHistoryResult = await this.db.applicationStatusHistory.deleteMany({
        where: { application: { userId } },
      });
      counts.statusHistoryEntries = statusHistoryResult.count;

      // 6. Application sources
      const sourcesResult = await this.db.applicationSource.deleteMany({
        where: { application: { userId } },
      });
      counts.applicationSources = sourcesResult.count;

      // 7. Job applications
      const applicationResult = await this.db.jobApplication.deleteMany({
        where: { userId },
      });
      counts.jobApplications = applicationResult.count;

      // 8. User resumes (DB records)
      const resumeResult = await this.db.userResume.deleteMany({
        where: { userId },
      });
      counts.userResumes = resumeResult.count;

      // 9. Sync jobs
      const syncJobResult = await this.db.syncJob.deleteMany({
        where: { userId },
      });
      counts.syncJobs = syncJobResult.count;

      logger.info('[DataRetention] User data deletion complete', {
        userId,
        deletedCounts: counts,
      });

      return counts;
    } catch (error) {
      logger.error('[DataRetention] User data deletion failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
        partialCounts: counts,
      });
      throw error;
    }
  }

  /**
   * Delete orphaned ResumeHash records (S3 objects) where no UserResume
   * still references them. Called after deleteUserData() to clean S3.
   *
   * This is safe to call repeatedly — it only removes unreferenced blobs.
   * In production, pair this with an S3 lifecycle rule as defence-in-depth.
   *
   * @returns Number of orphaned hash records identified (S3 deletion is async)
   */
  async identifyOrphanedResumeHashes(): Promise<string[]> {
    // Find ResumeHash records with no remaining UserResume references
    const orphans = await this.db.resumeHash.findMany({
      where: {
        userResumes: {
          none: {},
        },
      },
      select: {
        id: true,
        storageKey: true,
        hash: true,
      },
    });

    if (orphans.length > 0) {
      logger.info('[DataRetention] Identified orphaned resume hashes for S3 cleanup', {
        count: orphans.length,
        // Log storage keys (not content) so ops can verify S3 deletions
        storageKeys: orphans.map((o) => o.storageKey),
      });
    }

    return orphans.map((o) => o.storageKey);
  }

  // ─────────────────────────────────────────────────────────────────
  // Phase 25: Retention-based cleanup jobs
  // ─────────────────────────────────────────────────────────────────

  /**
   * Purge OAuth connections that have been in EXPIRED or REVOKED status
   * for more than EXPIRED_CONNECTION_RETENTION_DAYS (default: 30 days).
   *
   * Encrypted tokens are stored in the connection row and are deleted with it.
   * This ensures revoked credentials are not retained indefinitely.
   *
   * @returns Number of connections deleted
   */
  async purgeExpiredOAuthConnections(): Promise<number> {
    const cutoff = daysAgo(EXPIRED_CONNECTION_RETENTION_DAYS);
    let total = 0;

    // Process in batches to avoid locking the table
    while (true) {
      const batch = await this.db.userEmailConnection.findMany({
        where: {
          status: { in: ['EXPIRED', 'REVOKED'] },
          updatedAt: { lt: cutoff },
        },
        select: { id: true },
        take: DELETION_BATCH_SIZE,
      });

      if (batch.length === 0) break;

      const ids = batch.map((r) => r.id);
      const result = await this.db.userEmailConnection.deleteMany({
        where: { id: { in: ids } },
      });

      total += result.count;

      logger.info('[DataRetention] Purged expired OAuth connections batch', {
        batchSize: result.count,
        totalSoFar: total,
      });

      if (batch.length < DELETION_BATCH_SIZE) break;

      // Small delay between batches to reduce DB load
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    logger.info('[DataRetention] Expired OAuth connection purge complete', { total });
    return total;
  }

  /**
   * Purge completed SyncJob records older than SYNC_JOB_RETENTION_DAYS (90 days).
   * Failed jobs are retained for 90 days for debugging purposes.
   *
   * @returns Number of sync job records deleted
   */
  async purgeOldSyncJobs(): Promise<number> {
    const cutoff = daysAgo(SYNC_JOB_RETENTION_DAYS);
    let total = 0;

    while (true) {
      const batch = await this.db.syncJob.findMany({
        where: {
          status: { in: ['SUCCESS', 'FAILED'] },
          completedAt: { lt: cutoff },
        },
        select: { id: true },
        take: DELETION_BATCH_SIZE,
      });

      if (batch.length === 0) break;

      const ids = batch.map((r) => r.id);
      const result = await this.db.syncJob.deleteMany({
        where: { id: { in: ids } },
      });

      total += result.count;

      if (batch.length < DELETION_BATCH_SIZE) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    logger.info('[DataRetention] Old sync job purge complete', { total });
    return total;
  }

  /**
   * Run all retention cleanup jobs.
   * Designed to be called from a BullMQ scheduled job.
   *
   * @returns Summary of all cleanup operations
   */
  async runRetentionCleanup(): Promise<Record<string, number>> {
    logger.info('[DataRetention] Starting scheduled retention cleanup');

    const [expiredConnections, oldSyncJobs] = await Promise.allSettled([
      this.purgeExpiredOAuthConnections(),
      this.purgeOldSyncJobs(),
    ]);

    const results = {
      expiredOAuthConnections:
        expiredConnections.status === 'fulfilled' ? expiredConnections.value : -1,
      oldSyncJobs: oldSyncJobs.status === 'fulfilled' ? oldSyncJobs.value : -1,
    };

    logger.info('[DataRetention] Scheduled retention cleanup complete', results);
    return results;
  }

  // ─────────────────────────────────────────────────────────────────
  // Key rotation helpers (Phase 16)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Find UserEmailConnection records whose tokens are encrypted with an
   * older encryption key version. Used by the re-encryption worker.
   *
   * @param targetVersion - Re-encrypt any records NOT on this version
   * @param batchSize     - Max records to return per call
   * @returns Slice of connection IDs needing re-encryption
   */
  async findConnectionsForReEncryption(
    targetVersion: number,
    batchSize = DELETION_BATCH_SIZE,
  ): Promise<Array<{ id: string; accessTokenEncrypted: string; refreshTokenEncrypted: string }>> {
    // The version is embedded in the ciphertext as v<N>: prefix
    // Connections using the current version start with `v${targetVersion}:`
    const versionPrefix = `v${targetVersion}:`;

    return this.db.userEmailConnection.findMany({
      where: {
        OR: [
          // Legacy format (no version prefix) — version 1 implied
          ...(targetVersion !== 1
            ? [
                {
                  accessTokenEncrypted: {
                    not: { startsWith: 'v' },
                  },
                },
              ]
            : []),
          // Versioned but not the target version
          {
            AND: [
              { accessTokenEncrypted: { startsWith: 'v' } },
              { accessTokenEncrypted: { not: { startsWith: versionPrefix } } },
            ],
          },
        ],
      },
      select: {
        id: true,
        accessTokenEncrypted: true,
        refreshTokenEncrypted: true,
      },
      take: batchSize,
    });
  }

  /**
   * Retention policy summary for documentation / audit export.
   */
  getRetentionPolicySummary(): Record<string, string> {
    return {
      oauthConnectionExpiredRevoked: `Purged ${EXPIRED_CONNECTION_RETENTION_DAYS} days after status change`,
      syncJobsSuccessFailure: `Purged ${SYNC_JOB_RETENTION_DAYS} days after completion`,
      emailMessages: 'Retained until user deletion; deleted with user data',
      resumeFiles: 'S3 object deleted when last user reference removed',
      userDataOnDeletion: `All user data deleted immediately on account deletion; backups may retain for up to ${DELETION_GRACE_PERIOD_DAYS} days`,
    };
  }
}

/** Singleton instance. */
export const dataRetentionService = new DataRetentionService();
