import { JobStatus, JobType } from '@prisma/client';
import { prisma } from '../config/database';
import { logger } from '../lib/logger';
import { userOwnershipFilter } from '../utils/user-ownership';
import { userService } from '../services/user';

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
}

export const jobQueueService = new JobQueueService();
