/**
 * DurableCheckpointService — Durable, resumable Gmail sync checkpoints
 *
 * Provides atomic checkpoint operations with:
 *   - PostgreSQL advisory locks for real concurrency control
 *   - Lease-based checkpoint ownership with worker identity
 *   - Stale lease recovery
 *   - Optimistic concurrency control (version field)
 *   - Per-item batch tracking (processed/failed/retryable)
 *   - Page token persistence for pagination resumability
 *   - Full recovery: load checkpoint → determine last commit → continue
 *   - Atomic advancement: processed → committed → advanced
 *   - Structured telemetry for all lifecycle events
 */
import { dbRouter } from '../../config/database';
import { logger } from '../../lib/logger';
import { Prisma, SyncBatch, GmailCheckpoint } from '@prisma/client';
import { userService } from '../user';

export const CHECKPOINT_LEASE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
export const CHECKPOINT_STALE_LEASE_MS = 2 * 60 * 1000; // 2 minutes

export interface DurableCheckpointState {
  checkpoint: GmailCheckpoint | null;
  pendingBatch: SyncBatch | null;
  syncOpId: string | null;
}

export interface SyncOpResult {
  syncOpId: string;
  batchId: string;
}

export interface ResumeResult {
  canResume: boolean;
  state: DurableCheckpointState;
  action: 'continue' | 'restart_batch' | 'start_fresh' | 'fallback_to_initial';
}

export interface ClaimCheckpointResult {
  claimed: boolean;
  checkpoint: GmailCheckpoint | null;
  reason?: string;
}

export class DurableCheckpointService {
  // ── Lifecycle Events ──────────────────────────────────────────────────────

  /**
   * Initialize a new sync operation with durable checkpoint and batch.
   * Creates all three records atomically with a real advisory lock.
   */
  async initializeSyncOp(
    userId: string,
    connectionId: string,
    syncMode: 'INITIAL_SYNC' | 'INCREMENTAL_SYNC',
    correlationId: string,
    historyId: string,
    workerId: string,
    pageToken?: string,
  ): Promise<SyncOpResult> {
    const userScope = await userService.userScopeFor(userId);

    return dbRouter.write().$transaction(async (tx) => {
      const claim = await this.claimCheckpoint(tx, userScope.userId, workerId);
      if (!claim.claimed) {
        throw new Error(`Cannot initialize sync: ${claim.reason}`);
      }

      const syncOp = await tx.syncOperation.create({
        data: {
          userId: userScope.userId,
          legacyUserId: userScope.legacyUserId,
          connectionId,
          syncMode,
          correlationId,
          status: 'running',
          attempt: 1,
        },
      });

      const batch = await tx.syncBatch.create({
        data: {
          userId: userScope.userId,
          historyId,
          pageToken,
          correlationId,
          status: 'pending',
        },
      });

      const checkpoint = await tx.gmailCheckpoint.upsert({
        where: { userId: userScope.userId },
        create: {
          userId: userScope.userId,
          pendingHistoryId: historyId,
          pageToken: pageToken ?? null,
          syncMode,
          version: 1,
          status: 'syncing',
          lastSyncAt: new Date(),
          leaseOwner: workerId,
          leaseExpiresAt: new Date(Date.now() + CHECKPOINT_LEASE_DURATION_MS),
          workerId,
        },
        update: {
          pendingHistoryId: historyId,
          pageToken: pageToken ?? null,
          syncMode,
          version: { increment: 1 },
          status: 'syncing',
          lastSyncAt: new Date(),
          leaseOwner: workerId,
          leaseExpiresAt: new Date(Date.now() + CHECKPOINT_LEASE_DURATION_MS),
          workerId,
        },
      });

      this.emitTelemetry('SYNC_INITIALIZED', {
        syncOpId: syncOp.id,
        batchId: batch.id,
        userId,
        connectionId,
        syncMode,
        correlationId,
        checkpointVersion: checkpoint.version,
        workerId,
      });

      return { syncOpId: syncOp.id, batchId: batch.id };
    });
  }

  /**
   * Atomically advance the checkpoint after a batch has been durably processed.
   * Rule: processed successfully → durable state committed → checkpoint advanced
   */
  async advanceCheckpoint(
    userId: string,
    batchId: string,
    newHistoryId: string,
    nextPageToken?: string,
  ): Promise<void> {
    await dbRouter.write().$transaction(async (tx) => {
      const batch = await tx.syncBatch.findUnique({
        where: { id: batchId },
        select: { id: true, status: true, userId: true, failedCount: true, processedCount: true },
      });
      if (!batch) throw new Error(`Batch ${batchId} not found`);

      const checkpoint = await tx.gmailCheckpoint.findUnique({
        where: { userId: batch.userId },
      });
      if (!checkpoint) throw new Error(`Checkpoint for user ${batch.userId} not found`);

      const oldVersion = checkpoint.version;

      const result = await tx.gmailCheckpoint.updateMany({
        where: { userId: batch.userId, version: oldVersion },
        data: {
          currentHistoryId: newHistoryId,
          pendingHistoryId: nextPageToken ? newHistoryId : null,
          pageToken: nextPageToken ?? null,
          status: nextPageToken ? 'syncing' : 'idle',
          version: { increment: 1 },
          lastSyncAt: new Date(),
          lastError: null,
          leaseExpiresAt: nextPageToken
            ? new Date(Date.now() + CHECKPOINT_LEASE_DURATION_MS)
            : null,
          leaseOwner: nextPageToken ? checkpoint.leaseOwner : null,
        },
      });

      if (result.count === 0) {
        throw new Error(
          `Concurrent checkpoint modification detected for user ${batch.userId}. ` +
            `Expected version ${oldVersion}. Retry safe.`,
        );
      }

      await tx.syncBatch.update({
        where: { id: batchId },
        data: {
          status: batch.failedCount > 0 ? 'completed_with_failures' : 'completed',
          completedAt: new Date(),
        },
      });

      this.emitTelemetry('CHECKPOINT_ADVANCED', {
        userId,
        batchId,
        newHistoryId,
        nextPageToken,
        oldVersion,
        newVersion: oldVersion + 1,
        failedCount: batch.failedCount,
      });
    });
  }

  /**
   * Load full durable state for a user to determine resume/recovery strategy.
   * Does NOT lock — this is a read-only snapshot.
   */
  async loadDurableState(userId: string): Promise<DurableCheckpointState> {
    const userScope = await userService.userScopeFor(userId);
    const [checkpoint, pendingBatch] = await Promise.all([
      dbRouter.read().gmailCheckpoint.findUnique({ where: { userId: userScope.userId } }),
      dbRouter.read().syncBatch.findFirst({
        where: {
          userId: userScope.userId,
          status: { in: ['pending', 'processing'] },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const syncOp = pendingBatch
      ? await dbRouter.read().syncOperation.findFirst({
          where: {
            userId: userScope.userId,
            status: 'running',
          },
          orderBy: { createdAt: 'desc' },
        })
      : null;

    return {
      checkpoint,
      pendingBatch,
      syncOpId: syncOp?.id ?? null,
    };
  }

  /**
   * Determine if a sync can be resumed, and what action to take.
   * Called on worker start / queue retry.
   */
  async determineResumeStrategy(userId: string): Promise<ResumeResult> {
    const state = await this.loadDurableState(userId);

    if (!state.checkpoint) {
      return { canResume: false, state, action: 'start_fresh' };
    }

    if (state.checkpoint.status === 'idle') {
      return { canResume: false, state, action: 'start_fresh' };
    }

    if (state.checkpoint.status === 'failed' && state.checkpoint.currentHistoryId) {
      return { canResume: true, state, action: 'continue' };
    }

    if (state.checkpoint.status === 'syncing' && state.pendingBatch) {
      const batch = state.pendingBatch;

      if (batch.totalEmails && batch.totalEmails > 0) {
        const unprocessedJobs = await dbRouter.read().batchEmailJob.count({
          where: {
            batchId: batch.id,
            status: { in: ['pending', 'processing', 'retryable'] },
          },
        });

        if (unprocessedJobs > 0) {
          return { canResume: true, state, action: 'restart_batch' };
        }
      }

      return { canResume: true, state, action: 'restart_batch' };
    }

    if (state.checkpoint.status === 'failed' && !state.checkpoint.currentHistoryId) {
      if (state.checkpoint.syncMode === 'INCREMENTAL_SYNC') {
        return { canResume: false, state, action: 'fallback_to_initial' };
      }
      return { canResume: false, state, action: 'start_fresh' };
    }

    return { canResume: false, state, action: 'start_fresh' };
  }

  /**
   * Claim a checkpoint lease using PostgreSQL advisory lock.
   * This is the real concurrency control primitive.
   * Returns whether the claim succeeded and the reason if not.
   */
  async claimCheckpoint(
    tx: Prisma.TransactionClient,
    userId: string,
    workerId: string,
  ): Promise<ClaimCheckpointResult> {
    const userScope = await userService.userScopeFor(userId);
    const advisoryKey = this.getAdvisoryKey(userScope.userId);

    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${advisoryKey})`;

    const checkpoint = await tx.gmailCheckpoint.findUnique({
      where: { userId: userScope.userId },
    });

    if (!checkpoint) {
      return { claimed: true, checkpoint: null };
    }

    const now = new Date();
    const isStaleLease = checkpoint.leaseExpiresAt ? checkpoint.leaseExpiresAt < now : false;

    if (checkpoint.status === 'syncing' && !isStaleLease) {
      if (checkpoint.leaseOwner === workerId) {
        return { claimed: true, checkpoint };
      }
      return {
        claimed: false,
        checkpoint,
        reason: `Checkpoint already locked by worker ${checkpoint.leaseOwner}`,
      };
    }

    if (checkpoint.status === 'syncing' && isStaleLease) {
      this.emitTelemetry('STALE_LEASE_RECOVERED', {
        userId: userScope.userId,
        previousOwner: checkpoint.leaseOwner,
        newWorkerId: workerId,
      });
    }

    return { claimed: true, checkpoint };
  }

  /**
   * Refresh the lease on a checkpoint to keep ownership alive.
   * Call this periodically during long sync operations.
   */
  async refreshLease(userId: string, workerId: string): Promise<boolean> {
    const result = await dbRouter.write().gmailCheckpoint.updateMany({
      where: {
        userId,
        leaseOwner: workerId,
        status: 'syncing',
      },
      data: {
        leaseExpiresAt: new Date(Date.now() + CHECKPOINT_LEASE_DURATION_MS),
      },
    });
    return result.count > 0;
  }

  /**
   * Release a checkpoint lease when sync completes or fails.
   */
  async releaseLease(userId: string, workerId: string): Promise<void> {
    await dbRouter.write().gmailCheckpoint.updateMany({
      where: {
        userId,
        leaseOwner: workerId,
      },
      data: {
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });

    this.emitTelemetry('LEASE_RELEASED', { userId, workerId });
  }

  /**
   * Recover stale leases from crashed workers.
   * Sets checkpoint back to idle if the lease has expired.
   */
  async recoverStaleLeases(): Promise<number> {
    const now = new Date();
    const result = await dbRouter.write().gmailCheckpoint.updateMany({
      where: {
        status: 'syncing',
        leaseExpiresAt: { lt: now },
      },
      data: {
        status: 'idle',
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: 'Stale lease recovered',
      },
    });

    if (result.count > 0) {
      logger.warn('[DurableCheckpoint] Recovered stale leases', { count: result.count });
    }

    return result.count;
  }

  /**
   * Mark a sync operation as completed successfully.
   */
  async completeSyncOp(syncOpId: string): Promise<void> {
    await dbRouter.write().syncOperation.update({
      where: { id: syncOpId },
      data: {
        status: 'completed',
        completedAt: new Date(),
      },
    });

    this.emitTelemetry('SYNC_COMPLETED', { syncOpId });
  }

  /**
   * Mark a sync operation as permanently failed.
   */
  async failSyncOp(syncOpId: string, error: string): Promise<void> {
    await dbRouter.write().syncOperation.update({
      where: { id: syncOpId },
      data: {
        status: 'failed',
        completedAt: new Date(),
        error,
      },
    });

    this.emitTelemetry('SYNC_FAILED', { syncOpId, error });
  }

  // ── Per-Item Tracking ─────────────────────────────────────────────────────

  async trackEmailJob(
    batchId: string,
    emailId: string,
    providerMessageId: string,
    status: 'processed' | 'skipped' | 'failed' | 'retryable' | 'permanently_failed',
    error?: string,
  ): Promise<void> {
    await dbRouter.write().$transaction(async (tx) => {
      const existing = await tx.batchEmailJob.findFirst({
        where: { batchId, emailId },
      });

      if (existing) {
        await tx.batchEmailJob.update({
          where: { id: existing.id },
          data: {
            status,
            lastError: error,
            processedAt: status === 'processed' ? new Date() : existing.processedAt,
            attempts: { increment: 1 },
          },
        });
      } else {
        await tx.batchEmailJob.create({
          data: {
            batchId,
            emailId,
            providerMessageId,
            status,
            lastError: error,
            processedAt: status === 'processed' ? new Date() : null,
            attempts: 1,
          },
        });
      }

      const incrementProcessed = status === 'processed' || status === 'skipped' ? 1 : 0;
      const incrementFailed = status === 'failed' || status === 'permanently_failed' ? 1 : 0;

      if (incrementProcessed > 0 || incrementFailed > 0) {
        await tx.syncBatch.update({
          where: { id: batchId },
          data: {
            processedCount: incrementProcessed > 0 ? { increment: incrementProcessed } : undefined,
            failedCount: incrementFailed > 0 ? { increment: incrementFailed } : undefined,
            status: 'processing',
          },
        });
      }
    });
  }

  async finalizeBatchEmails(batchId: string): Promise<void> {
    await dbRouter.write().batchEmailJob.updateMany({
      where: {
        batchId,
        status: { in: ['pending', 'processing'] },
      },
      data: {
        status: 'skipped',
        lastError: 'Batch finalized before processing',
      },
    });
  }

  // ── Concurrency Protection ────────────────────────────────────────────────

  /**
   * Optimistic update: advance checkpoint only if version matches.
   */
  async compareAndSetVersion(
    userId: string,
    expectedVersion: number,
    data: Partial<Prisma.GmailCheckpointUpdateInput>,
  ): Promise<boolean> {
    const result = await dbRouter.write().gmailCheckpoint.updateMany({
      where: { userId, version: expectedVersion },
      data: {
        ...data,
        version: { increment: 1 },
      },
    });
    return result.count > 0;
  }

  // ── Observability ─────────────────────────────────────────────────────────

  private emitTelemetry(event: string, data: Record<string, unknown>): void {
    logger.info('[DurableCheckpoint]', { event, ...data, timestamp: new Date().toISOString() });
  }

  private getAdvisoryKey(userId: string): number {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      const char = userId.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash) % 2147483647;
  }
}

export const durableCheckpointService = new DurableCheckpointService();
