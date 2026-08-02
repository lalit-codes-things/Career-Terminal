import { JobStatus, JobType } from '@prisma/client';
import { prisma } from '../config/database';
import { logger } from '../lib/logger';
import { userOwnershipFilter } from '../utils/user-ownership';
import { userService } from '../services/user';

export interface EnqueueIngestionJobInput {
  /** The user requesting ingestion. */
  userId: string;

  /** The UserEmailConnection reference. */
  connectionId: string;

  /** The type of sync job to enqueue. */
  jobType: JobType;

  /** Correlation ID for tracing. */
  correlationId?: string;

  /** Optional history ID for incremental sync. */
  startHistoryId?: string;
}

export class JobQueueService {
  /**
   * Enqueues an initial historical mailbox sync job.
   */
  async enqueueInitialSync(userId: string): Promise<void> {
    const userScope = await userService.userScopeFor(userId);
    await prisma.syncJob.create({
      data: {
        userId: userScope.userId,
        legacyUserId: userScope.legacyUserId,
        type: JobType.GMAIL_INITIAL_SYNC,
        status: JobStatus.PENDING,
      },
    });
    logger.info('[Queue] Enqueued initial sync job', { userId });
  }

  /**
   * Enqueues an incremental (delta) sync job.
   * Prevents enqueuing if an incremental sync is already pending or running.
   */
  async enqueueIncrementalSync(userId: string): Promise<void> {
    const scopeFilter = userOwnershipFilter(userId);
    // Basic deduplication: don't enqueue if already pending/running
    const existing = await prisma.syncJob.findFirst({
      where: {
        ...scopeFilter,
        type: JobType.GMAIL_INCREMENTAL_SYNC,
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
      },
    });

    if (existing) {
      logger.info('[Queue] Incremental sync already in progress', { userId });
      return;
    }

    const userScope = await userService.userScopeFor(userId);
    await prisma.syncJob.create({
      data: {
        userId: userScope.userId,
        legacyUserId: userScope.legacyUserId,
        type: JobType.GMAIL_INCREMENTAL_SYNC,
        status: JobStatus.PENDING,
      },
    });
    logger.info('[Queue] Enqueued incremental sync job', { userId });
  }

  /**
   * Enqueues a Gmail ingestion job via the coordinator (Epic 4 Prompt 7).
   * This method provides enhanced tracking and idempotency over the legacy methods.
   */
  async enqueueIngestionJob(input: EnqueueIngestionJobInput): Promise<void> {
    const userScope = await userService.userScopeFor(input.userId);

    await prisma.syncJob.create({
      data: {
        userId: userScope.userId,
        legacyUserId: userScope.legacyUserId,
        type: input.jobType,
        status: JobStatus.PENDING,
        // Store correlationId in error field temporarily until we add a dedicated column
        // TODO: Add correlationId column to syncJob table
        error: input.correlationId ? `correlation:${input.correlationId}` : undefined,
      },
    });

    logger.info('[Queue] Enqueued Gmail ingestion job', {
      userId: input.userId,
      connectionId: input.connectionId,
      jobType: input.jobType,
      correlationId: input.correlationId,
      startHistoryId: input.startHistoryId,
    });
  }
}

export const jobQueueService = new JobQueueService();
