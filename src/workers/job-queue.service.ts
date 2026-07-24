import { JobStatus, JobType } from '@prisma/client';
import { prisma } from '../config/database';
import { logger } from '../lib/logger';

export class JobQueueService {
  /**
   * Enqueues an initial historical mailbox sync job.
   */
  async enqueueInitialSync(userId: string): Promise<void> {
    await prisma.syncJob.create({
      data: {
        userId,
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
    // Basic deduplication: don't enqueue if already pending/running
    const existing = await prisma.syncJob.findFirst({
      where: {
        userId,
        type: JobType.GMAIL_INCREMENTAL_SYNC,
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
      },
    });

    if (existing) {
      logger.info('[Queue] Incremental sync already in progress', { userId });
      return;
    }

    await prisma.syncJob.create({
      data: {
        userId,
        type: JobType.GMAIL_INCREMENTAL_SYNC,
        status: JobStatus.PENDING,
      },
    });
    logger.info('[Queue] Enqueued incremental sync job', { userId });
  }
}

export const jobQueueService = new JobQueueService();
