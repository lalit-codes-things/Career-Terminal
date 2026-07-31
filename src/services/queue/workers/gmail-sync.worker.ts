import { Worker, type Job } from 'bullmq';
import { bullMQConnection } from '../../../config/redis';
import { logger } from '../../../lib/logger';
import { QUEUE_NAMES, GmailSyncJobPayloadSchema, type GmailSyncJobPayload } from '../queue.types';
import { gmailIngestionService } from '../../../services/gmail/ingestion/gmail-ingestion.service';
import { gmailOAuthService } from '../../../services/gmail/auth/gmail-oauth.service';
import { durableCheckpointService } from '../../../services/gmail/durable-checkpoint.service';
import { userOwnershipFilter } from '../../../utils/user-ownership';
import { prisma } from '../../../config/database';
import { withEventLifecycle } from '../../../services/event/event-worker';
import { EVENT_TYPES } from '../../../services/event/event.types';
import { eventDispatcher } from '../../../services/event/event-dispatcher.service';
import { classifyFailure } from '../../../services/gmail/gmail-ingestion-coordinator';

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 2_000;
const LEASE_REFRESH_INTERVAL_MS = 60_000;

export async function processGmailSyncJob(job: Job<GmailSyncJobPayload>): Promise<void> {
  return withEventLifecycle(job, async (job) => {
    const payload = GmailSyncJobPayloadSchema.parse(job.data);
    const workerId = `gmail-worker-${process.pid}-${job.id ?? 'unknown'}`;
    const correlationId = payload.correlationId ?? job.id ?? `gmail-sync-${Date.now()}`;

    logger.info('[GmailSyncWorker] Processing job', {
      jobId: job.id,
      userId: payload.userId,
      type: payload.type,
      legacyUserId: payload.legacyUserId,
      connectionId: payload.connectionId,
      attempt: job.attemptsMade,
      correlationId,
    });

    if (!payload.connectionId) {
      throw new Error(`Gmail sync job missing connectionId for user ${payload.userId}`);
    }

    const userScopeFilter = userOwnershipFilter(payload.userId);
    const connection = await prisma.userEmailConnection.findFirst({
      where: { ...userScopeFilter, id: payload.connectionId },
      select: { id: true, status: true },
    });

    if (!connection || connection.status !== 'ACTIVE') {
      throw new Error(`User ${payload.userId} has no active email connection`);
    }

    await gmailOAuthService.getValidAccessToken(payload.userId);

    const claim = await durableCheckpointService.claimCheckpoint(prisma, payload.userId, workerId);

    if (!claim.claimed) {
      throw new Error(`Checkpoint already locked: ${claim.reason}`);
    }

    const leaseRefreshTimer = setInterval(() => {
      void durableCheckpointService.refreshLease(payload.userId, workerId).catch(() => {
        // Lease refresh failed — will be detected on next check
      });
    }, LEASE_REFRESH_INTERVAL_MS);

    try {
      const syncOpResult = await durableCheckpointService.initializeSyncOp(
        payload.userId,
        payload.connectionId,
        payload.type === 'GMAIL_INITIAL_SYNC' ? 'INITIAL_SYNC' : 'INCREMENTAL_SYNC',
        correlationId,
        payload.historyId ?? '0',
        workerId,
        payload.pageToken,
      );

      if (payload.type === 'GMAIL_INITIAL_SYNC') {
        await gmailIngestionService.syncInitialMailbox(payload.legacyUserId, correlationId);
      } else {
        await gmailIngestionService.syncNewEmails(payload.legacyUserId, correlationId);
      }

      await durableCheckpointService.completeSyncOp(syncOpResult.syncOpId);
      await durableCheckpointService.releaseLease(payload.userId, workerId);

      await eventDispatcher.publish({
        eventType: EVENT_TYPES.GMAIL_SYNC_COMPLETED,
        aggregateId: payload.userId,
        aggregateType: 'USER',
        userId: payload.userId,
        cellId: payload.cellId || 'default',
        correlationId,
        payload: {
          userId: payload.userId,
          syncMode: payload.type,
          connectionId: payload.connectionId,
          syncOpId: syncOpResult.syncOpId,
        },
      });

      logger.info('[GmailSyncWorker] Job completed', { jobId: job.id, userId: payload.userId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const classification = classifyFailure(error);
      const currentAttempts = job.attemptsMade + 1;
      const isRetryable = classification.retryable && currentAttempts < MAX_ATTEMPTS;

      if (!isRetryable) {
        await durableCheckpointService.releaseLease(payload.userId, workerId);
        await durableCheckpointService.failSyncOp(
          claim.checkpoint?.id ??
            (
              await prisma.syncOperation.findFirst({
                where: { userId: payload.userId, status: 'running' },
                orderBy: { createdAt: 'desc' },
              })
            )?.id ??
            'unknown',
          errorMessage,
        );

        await eventDispatcher.publish({
          eventType: EVENT_TYPES.GMAIL_SYNC_FAILED,
          aggregateId: payload.userId,
          aggregateType: 'USER',
          userId: payload.userId,
          cellId: payload.cellId || 'default',
          correlationId,
          payload: {
            userId: payload.userId,
            syncMode: payload.type,
            error: errorMessage,
            category: classification.category,
            retryable: false,
          },
        });

        logger.error('[GmailSyncWorker] Job failed permanently', {
          jobId: job.id,
          userId: payload.userId,
          error: errorMessage,
          category: classification.category,
        });
      } else {
        const backoffMs =
          classification.backoffMs ?? BASE_BACKOFF_MS * Math.pow(2, currentAttempts - 1);
        await durableCheckpointService.releaseLease(payload.userId, workerId);

        logger.warn('[GmailSyncWorker] Job retry scheduled', {
          jobId: job.id,
          userId: payload.userId,
          attempt: currentAttempts,
          nextRetryMs: backoffMs,
          category: classification.category,
        });
      }

      throw error;
    } finally {
      clearInterval(leaseRefreshTimer);
    }
  });
}

export function startGmailSyncWorker(): Worker<GmailSyncJobPayload> {
  const worker = new Worker<GmailSyncJobPayload>(QUEUE_NAMES.GMAIL_SYNC, processGmailSyncJob, {
    connection: bullMQConnection,
    concurrency: Number.parseInt(process.env.WORKER_CONCURRENCY ?? '5', 10),
    limiter: {
      max: 10,
      duration: 1000,
    },
  });

  worker.on('completed', (job) =>
    logger.info('[GmailSyncWorker] Job completed', {
      jobId: job.id,
      userId: job.data.userId,
    }),
  );

  worker.on('failed', (job, err) =>
    logger.error('[GmailSyncWorker] Job failed', {
      jobId: job?.id,
      userId: job?.data.userId,
      attempt: job?.attemptsMade,
      error: err.message,
    }),
  );

  worker.on('error', (err) =>
    logger.error('[GmailSyncWorker] Worker error', { message: err.message }),
  );

  logger.info('[GmailSyncWorker] Started', { concurrency: worker.opts.concurrency });
  return worker;
}
