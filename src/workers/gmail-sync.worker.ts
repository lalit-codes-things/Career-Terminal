import { JobStatus, JobType } from '@prisma/client';
import { prisma } from '../config/database';
import { logger } from '../lib/logger';
import { gmailIngestionService } from '../services/gmail/ingestion/gmail-ingestion.service';
import { gmailOAuthService } from '../services/gmail/auth/gmail-oauth.service';
import { classifyFailure } from '../services/gmail/gmail-ingestion-coordinator';
import { userOwnershipFilter } from '../utils/user-ownership';
import { durableCheckpointService } from '../services/gmail/durable-checkpoint.service';
import { v4 as uuidv4 } from 'uuid';

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 2000; // 2 seconds

interface JobExecutionContext {
  jobId: string;
  userId: string;
  legacyUserId: string;
  type: JobType;
  attempt: number;
  startedAt: Date;
}

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
   * Before processing a new job, checks if a resumeable sync exists.
   */
  public async processNextJob(): Promise<boolean> {
    // First check if there are resumeable syncs that should take priority
    const activeSyncOp = await prisma.syncOperation.findFirst({
      where: {
        status: 'running',
      },
      orderBy: { createdAt: 'asc' },
    });

    if (activeSyncOp) {
      const corrId = activeSyncOp.correlationId ?? uuidv4();
      logger.info('[Worker] Found active sync operation; resuming', {
        syncOpId: activeSyncOp.id,
        userId: activeSyncOp.userId,
        syncMode: activeSyncOp.syncMode,
        correlationId: corrId,
        attempt: activeSyncOp.attempt,
      });

      try {
        await this.validateUserContext({
          jobId: activeSyncOp.id,
          userId: activeSyncOp.userId,
          legacyUserId: activeSyncOp.legacyUserId,
          type: activeSyncOp.syncMode === 'INITIAL_SYNC' ? JobType.GMAIL_INITIAL_SYNC : JobType.GMAIL_INCREMENTAL_SYNC,
          attempt: activeSyncOp.attempt,
          startedAt: new Date(),
        });
        await this.refreshOAuthToken(activeSyncOp.userId);

        if (activeSyncOp.syncMode === 'INITIAL_SYNC') {
          await gmailIngestionService.syncInitialMailbox(activeSyncOp.legacyUserId, corrId);
        } else {
          await gmailIngestionService.syncNewEmails(activeSyncOp.legacyUserId, corrId);
        }

        logger.info('[Worker] Resumed sync operation completed', {
          syncOpId: activeSyncOp.id,
          userId: activeSyncOp.userId,
        });
        return true;
      } catch (error: any) {
        logger.error('[Worker] Resumed sync operation failed', {
          syncOpId: activeSyncOp.id,
          userId: activeSyncOp.userId,
          error: error instanceof Error ? error.message : String(error),
        });
        await durableCheckpointService.failSyncOp(
          activeSyncOp.id,
          error instanceof Error ? error.message : String(error),
        );
        // Fall through to process next job
      }
    }

    // No active sync — check for pending jobs
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

    const context: JobExecutionContext = {
      jobId: jobToRun.id,
      userId: jobToRun.userId,
      legacyUserId: jobToRun.legacyUserId ?? '',
      type: jobToRun.type,
      attempt: jobToRun.attempts + 1,
      startedAt: new Date(),
    };

    logger.info('[Worker] Executing job', {
      jobId: context.jobId,
      type: context.type,
      userId: context.userId,
      attempt: context.attempt,
    });

    // Extract correlation ID if present
    const correlationId = this.extractCorrelationId(jobToRun.error);

    // Emit start telemetry
    emitTelemetry(context, 'INGESTION_STARTED', { correlationId });

    // 2. Execute the job with user context re-establishment
    try {
      // Re-establish user context and ownership (Epic 4 Prompt 7 requirement)
      await this.validateUserContext(context);

      // Load fresh OAuth token for the user
      await this.refreshOAuthToken(context.userId);

      // Execute ingestion with durable checkpoints
      if (jobToRun.type === JobType.GMAIL_INITIAL_SYNC) {
        await gmailIngestionService.syncInitialMailbox(context.legacyUserId, correlationId);
      } else if (jobToRun.type === JobType.GMAIL_INCREMENTAL_SYNC) {
        await gmailIngestionService.syncNewEmails(context.legacyUserId, correlationId);
      }

      // 3. Mark success
      await prisma.syncJob.update({
        where: { id: jobToRun.id },
        data: {
          status: JobStatus.SUCCESS,
          completedAt: new Date(),
        },
      });

      // Emit completion telemetry
      emitTelemetry(context, 'INGESTION_COMPLETED', {
        correlationId,
        durationMs: Date.now() - context.startedAt.getTime(),
      });

      logger.info('[Worker] Job succeeded', { jobId: jobToRun.id });
    } catch (error: any) {
      await this.handleJobFailure(jobToRun, context, error, correlationId);
    }

    return true;
  }

  /**
   * Validate that the user context is still valid (connection exists and is active).
   */
  private async validateUserContext(context: JobExecutionContext): Promise<void> {
    const scopeFilter = userOwnershipFilter(context.userId);
    const connection = await prisma.userEmailConnection.findFirst({
      where: {
        ...scopeFilter,
        user: { id: context.userId },
      },
      select: { id: true, status: true },
    });

    if (!connection) {
      throw new Error(`User ${context.userId} has no active email connection`);
    }

    if (connection.status !== 'ACTIVE') {
      throw new Error(`Email connection ${connection.id} is not active (status: ${connection.status})`);
    }
  }

  /**
   * Refresh OAuth token for the user before ingestion.
   */
  private async refreshOAuthToken(userId: string): Promise<void> {
    try {
      await gmailOAuthService.getValidAccessToken(userId);
    } catch (error) {
      logger.error('[Worker] Failed to refresh OAuth token', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error('OAuth token refresh failed - connection may be revoked');
    }
  }

  /**
   * Handle job failure with per-item failure classification and retry logic.
   */
  private async handleJobFailure(
    jobToRun: any,
    context: JobExecutionContext,
    error: any,
    correlationId?: string,
  ): Promise<void> {
    const currentAttempts = context.attempt;
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Classify the failure
    const classification = classifyFailure(error);
    const isRetryable = classification.retryable && currentAttempts < MAX_ATTEMPTS;

    if (!isRetryable) {
      // Permanent failure
      await prisma.syncJob.update({
        where: { id: jobToRun.id },
        data: {
          status: JobStatus.FAILED,
          error: errorMessage,
          completedAt: new Date(),
        },
      });

      emitTelemetry(context, 'INGESTION_FAILED', {
        correlationId,
        error: {
          code: classification.category,
          message: errorMessage,
          retryable: false,
        },
        durationMs: Date.now() - context.startedAt.getTime(),
      });

      logger.error('[Worker] Job failed permanently', {
        jobId: jobToRun.id,
        attempts: currentAttempts,
        error: errorMessage,
        category: classification.category,
      });
    } else {
      // Retry with exponential backoff
      const backoffMs = classification.backoffMs ?? BASE_BACKOFF_MS * Math.pow(2, currentAttempts - 1);
      const nextRunAt = new Date(Date.now() + backoffMs);

      await prisma.syncJob.update({
        where: { id: jobToRun.id },
        data: {
          status: JobStatus.PENDING,
          error: errorMessage,
          nextRunAt,
        },
      });

      emitTelemetry(context, 'RETRY_SCHEDULED', {
        correlationId,
        error: {
          code: classification.category,
          message: errorMessage,
          retryable: true,
        },
        retryCount: currentAttempts,
        nextRunAt: nextRunAt.toISOString(),
      });

      logger.warn('[Worker] Job retry scheduled', {
        jobId: jobToRun.id,
        attempt: currentAttempts,
        nextRunAt: nextRunAt.toISOString(),
        category: classification.category,
      });
    }
  }

  /**
   * Extract correlation ID from error field if present.
   */
  private extractCorrelationId(errorField: string | null): string | undefined {
    if (!errorField) return undefined;
    const match = errorField.match(/correlation:(.+)/);
    return match ? match[1] : undefined;
  }
}

/**
 * Emit structured telemetry for ingestion events.
 */
function emitTelemetry(
  context: JobExecutionContext,
  event: 'INGESTION_STARTED' | 'INGESTION_COMPLETED' | 'INGESTION_FAILED' | 'RETRY_SCHEDULED',
  metadata: {
    correlationId?: string;
    error?: { code: string; message: string; retryable: boolean };
    durationMs?: number;
    retryCount?: number;
    nextRunAt?: string;
  } = {},
): void {
  logger.info('[Worker:Telemetry]', {
    event,
    jobId: context.jobId,
    userId: context.userId,
    type: context.type,
    attempt: context.attempt,
    correlationId: metadata.correlationId,
    durationMs: metadata.durationMs,
    retryCount: metadata.retryCount,
    error: metadata.error,
    nextRunAt: metadata.nextRunAt,
  });
}

export const gmailSyncWorker = new GmailSyncWorker();
