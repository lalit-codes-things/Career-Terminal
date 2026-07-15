import { prisma } from '../config/database';

export class JobQueueService {
  /**
   * Enqueues an initial historical mailbox sync job.
   */
  async enqueueInitialSync(userId: string): Promise<void> {
    await prisma.syncJob.create({
      data: {
        userId,
        type: 'GMAIL_INITIAL_SYNC',
        status: 'PENDING',
      },
    });
    console.info(`[Queue] Enqueued initial sync job for user ${userId}`);
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
        type: 'GMAIL_INCREMENTAL_SYNC',
        status: { in: ['PENDING', 'RUNNING'] },
      },
    });

    if (existing) {
      console.info(`[Queue] Incremental sync already in progress for user ${userId}`);
      return;
    }

    await prisma.syncJob.create({
      data: {
        userId,
        type: 'GMAIL_INCREMENTAL_SYNC',
        status: 'PENDING',
      },
    });
    console.info(`[Queue] Enqueued incremental sync job for user ${userId}`);
  }
}

export const jobQueueService = new JobQueueService();
