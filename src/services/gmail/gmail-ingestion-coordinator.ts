/**
 * Gmail Ingestion Coordinator — Orchestrates async Gmail ingestion (Epic 4 Prompt 7)
 *
 * Provides the explicit async ingestion boundary:
 *   1. Validates user ownership of the connection
 *   2. Derives idempotency key for deduplication
 *   3. Enqueues via JobQueueService with idempotency guard
 *   4. Tracks processing state
 *   5. Emits structured telemetry
 */

import { dbRouter } from '../../config/database';
import { logger } from '../../lib/logger';
import { queueService } from '../../services/queue/queue.service';
import { idempotencyService } from '../idempotency/idempotency.service';
import { userOwnershipFilter } from '../../utils/user-ownership';
import {
  GmailIngestionCommand,
  GmailIngestionTelemetry,
  FailureClassification,
} from './models/gmail-ingestion.types';
import { NotFoundError, ValidationError } from '../../errors/app-errors';
import { config } from '../../config';

/**
 * Enqueue a Gmail ingestion request with idempotency guarantees.
 *
 * @param command - The ingestion command
 * @returns The sync job ID that was created or reused
 */
export async function enqueueGmailIngestion(command: GmailIngestionCommand): Promise<string> {
  const startTime = Date.now();

  // Step 1: Validate user owns the connection
  await validateUserOwnsConnection(command.userId, command.connectionId);

  // Step 2: Check if this ingestion is already in progress or completed (idempotency)
  const existingResult = await idempotencyService.claim(
    command.idempotencyKey,
    'gmail:ingestion',
    { ttlDays: 1 }, // Short TTL — ingestion commands are idempotent within a day
  );

  if (!existingResult.claimed) {
    // Idempotency: return existing job if already processed
    logger.info('[GmailIngestion] Idempotent reuse', {
      userId: command.userId,
      connectionId: command.connectionId,
      idempotencyKey: command.idempotencyKey,
      existingResultId: existingResult.existing.resultId,
    });

    emitTelemetry({
      event: 'INGESTION_ENQUEUED',
      command,
      timestamp: new Date(),
      metrics: { retryCount: 0, durationMs: Date.now() - startTime },
    });

    return existingResult.existing.resultId ?? 'unknown';
  }

  try {
    // Step 3: Check for backpressure before enqueueing
    const backpressureActive = await isBackpressured();
    if (backpressureActive && command.priority !== 'HIGH') {
      logger.warn('[GmailIngestion] Backpressure active, rejecting non-priority request', {
        userId: command.userId,
        connectionId: command.connectionId,
      });

      await idempotencyService.abort(existingResult.recordId);

      emitTelemetry({
        event: 'INGESTION_FAILED',
        command,
        timestamp: new Date(),
        metrics: { retryCount: 0, durationMs: Date.now() - startTime, backpressureActive: true },
        error: {
          code: 'BACKPRESSURE',
          message: 'Ingestion queue depth limit reached',
          retryable: true,
        },
      });

      throw new ValidationError(
        'Ingestion temporarily unavailable due to high load. Please retry.',
      );
    }

    // Step 4: Enqueue the job via QueueService (BullMQ)
    const jobType =
      command.mode === 'INITIAL_SYNC' ? 'GMAIL_INITIAL_SYNC' : 'GMAIL_INCREMENTAL_SYNC';

    await queueService.addGmailSyncJob({
      type: jobType,
      userId: command.userId,
      cellId: command.cellId,
      legacyUserId: command.legacyUserId ?? command.userId,
      connectionId: command.connectionId,
      historyId: command.startHistoryId,
      pageToken: command.pageToken,
      priority: command.priority === 'HIGH' ? 10 : 0,
    });

    // Step 5: Commit the idempotency record with the job reference
    // We use a placeholder resultId since the actual syncJob ID is created by the enqueue
    const resultId = `gmail:${command.userId}:${command.connectionId}:${command.mode}`;
    await idempotencyService.commit(existingResult.recordId, resultId, {
      enqueuedAt: new Date().toISOString(),
      mode: command.mode,
    });

    // Step 6: Emit telemetry
    emitTelemetry({
      event: 'INGESTION_ENQUEUED',
      command,
      timestamp: new Date(),
      metrics: {
        retryCount: 0,
        durationMs: Date.now() - startTime,
        backpressureActive,
      },
    });

    logger.info('[GmailIngestion] Enqueued successfully', {
      userId: command.userId,
      connectionId: command.connectionId,
      mode: command.mode,
      correlationId: command.correlationId,
    });

    return resultId;
  } catch (error) {
    // Abort on failure
    await idempotencyService.abort(existingResult.recordId);
    throw error;
  }
}

/**
 * Validate that the user owns the specified connection.
 * Throws NotFoundError if the connection doesn't exist or doesn't belong to the user.
 */
async function validateUserOwnsConnection(userId: string, connectionId: string): Promise<void> {
  const scopeFilter = userOwnershipFilter(userId);

  const connection = await dbRouter.read().userEmailConnection.findFirst({
    where: {
      ...scopeFilter,
      id: connectionId,
    },
    select: { id: true, status: true, provider: true },
  });

  if (!connection) {
    throw new NotFoundError('UserEmailConnection', connectionId);
  }

  if (connection.status !== 'ACTIVE') {
    throw new ValidationError(
      `Connection ${connectionId} is not active (status: ${connection.status})`,
    );
  }
}

/**
 * Check if the ingestion queue is backpressured.
 */
async function isBackpressured(): Promise<boolean> {
  const limit = config.limits.maxQueryParams;

  const pendingCount = await dbRouter.read().syncJob.count({
    where: {
      status: { in: ['PENDING', 'RUNNING'] },
    },
  });

  return pendingCount >= limit;
}

/**
 * Emit structured telemetry for ingestion events.
 */
function emitTelemetry(event: GmailIngestionTelemetry): void {
  logger.info('[GmailIngestion:Telemetry]', {
    event: event.event,
    userId: event.command.userId,
    connectionId: event.command.connectionId,
    mode: event.command.mode,
    correlationId: event.command.correlationId,
    ...event.metrics,
    error: event.error,
    timestamp: event.timestamp,
  });
}

/**
 * Classify a failure to determine retry behaviour.
 */
export function classifyFailure(error: unknown): FailureClassification {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorCode = (error as { code?: string; gmailErrorCode?: number }).gmailErrorCode;

  // Auth/connection errors — not retryable
  if (errorMessage.includes('revoked') || errorMessage.includes('not active')) {
    return {
      retryable: false,
      category: 'AUTH_REVOKED',
    };
  }

  if (errorMessage.includes('not found') || errorMessage.includes('Invalid connection')) {
    return {
      retryable: false,
      category: 'INVALID_CONNECTION',
    };
  }

  // Rate limiting — retryable with backoff
  if (errorCode === 429 || errorMessage.includes('rate limit') || errorMessage.includes('quota')) {
    return {
      retryable: true,
      backoffMs: 60_000, // 1 minute for rate limits
      category: 'RATE_LIMIT',
    };
  }

  // Gmail API transient errors
  if (errorCode === 403 || errorCode === 500 || errorCode === 503) {
    return {
      retryable: true,
      backoffMs: 5_000,
      category: 'TRANSIENT_API_ERROR',
    };
  }

  // Network errors
  if (
    errorMessage.includes('network') ||
    errorMessage.includes('timeout') ||
    errorMessage.includes('ETIMEDOUT')
  ) {
    return {
      retryable: true,
      backoffMs: 10_000,
      category: 'NETWORK_ERROR',
    };
  }

  // Unknown — default to retryable with conservative backoff
  return {
    retryable: true,
    backoffMs: 30_000,
    category: 'UNKNOWN',
  };
}
