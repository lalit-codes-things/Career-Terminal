import { JobStatus, JobType } from '@prisma/client';
import { prisma } from '../config/database';
import { logger } from '../lib/logger';
import { gmailIngestionService } from '../services/gmail/ingestion/gmail-ingestion.service';

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 2000; // 2 seconds

export class GmailSyncWorker {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;

  /**
   * Starts the worker polling loop.
   */
  public start(pollIntervalMs = 5000) {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('[Worker] Started Gmail Sync Worker', { pollIntervalMs });
    this.poll(pollIntervalMs);
  }

  /**
   * Stops the worker gracefully.
   */
  public stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    logger.info('[Worker] Stopped Gmail Sync Worker');
  }

  private async poll(intervalMs: number) {
    if (!this.isRunning) return;

    try {
      await this.processNextJob();
    } catch (error) {
      logger.error('[Worker] Fatal error during polling', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (this.isRunning) {
      this.timer = setTimeout(() => {
        void this.poll(intervalMs);
      }, intervalMs);
    }
  }

  /**
   * Fetches the next pending job, locks it, and executes it.
   */
  public async processNextJob(): Promise<boolean> {
    // 1. Fetch and Lock a job using a transaction
    // This assumes Prisma handles the SELECT ... FOR UPDATE or we simulate a lock via a unique update.
    // For a simple Node app, an atomic update is safest:

    // Find highest priority pending job ready to run
    const jobToRun = await prisma.syncJob.findFirst({
      where: {
        status: JobStatus.PENDING,
        nextRunAt: { lte: new Date() },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!jobToRun) return false;

    // Lock it by setting status to RUNNING (atomic check)
    const lockedJob = await prisma.syncJob.updateMany({
      where: {
        id: jobToRun.id,
        status: JobStatus.PENDING,
      },
      data: {
        status: JobStatus.RUNNING,
        startedAt: new Date(),
        attempts: { increment: 1 },
      },
    });

    if (lockedJob.count === 0) {
      // Another worker grabbed it first
      return false;
    }

    logger.info('[Worker] Executing job', {
      jobId: jobToRun.id,
      type: jobToRun.type,
      userId: jobToRun.userId,
      attempt: jobToRun.attempts + 1,
    });

    // 2. Execute the job
    try {
      if (jobToRun.type === JobType.GMAIL_INITIAL_SYNC) {
        await gmailIngestionService.syncInitialMailbox(jobToRun.userId);
      } else if (jobToRun.type === JobType.GMAIL_INCREMENTAL_SYNC) {
        await gmailIngestionService.syncNewEmails(jobToRun.userId);
      }

      // 3. Mark success
      await prisma.syncJob.update({
        where: { id: jobToRun.id },
        data: {
          status: JobStatus.SUCCESS,
          completedAt: new Date(),
        },
      });
      logger.info('[Worker] Job succeeded', { jobId: jobToRun.id });
    } catch (error: any) {
      const currentAttempts = jobToRun.attempts + 1;
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (currentAttempts >= MAX_ATTEMPTS) {
        // Fail permanently
        await prisma.syncJob.update({
          where: { id: jobToRun.id },
          data: {
            status: JobStatus.FAILED,
            error: errorMessage,
            completedAt: new Date(),
          },
        });
        logger.error('[Worker] Job failed permanently', {
          jobId: jobToRun.id,
          attempts: currentAttempts,
          error: errorMessage,
        });
      } else {
        // Exponential backoff: 2s, 4s, 8s, 16s...
        const backoffMs = BASE_BACKOFF_MS * Math.pow(2, currentAttempts - 1);
        const nextRunAt = new Date(Date.now() + backoffMs);

        await prisma.syncJob.update({
          where: { id: jobToRun.id },
          data: {
            status: JobStatus.PENDING,
            error: errorMessage,
            nextRunAt,
          },
        });
        logger.warn('[Worker] Job retry scheduled', {
          jobId: jobToRun.id,
          attempt: currentAttempts,
          nextRunAt: nextRunAt.toISOString(),
        });
      }
    }

    return true;
  }
}

export const gmailSyncWorker = new GmailSyncWorker();
