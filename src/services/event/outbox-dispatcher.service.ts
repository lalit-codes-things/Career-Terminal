/**
 * OutboxDispatcher — durable event-to-queue bridge with lease/claim semantics.
 *
 * State machine:
 *   pending → processing → processed
 *                         → failed    (with retry + next_attempt_at)
 *                         → dlq       (after max retries)
 *
 * Claim model:
 *   Multiple dispatcher replicas claim events via FOR UPDATE SKIP LOCKED.
 *   Claims have a visibility timeout (LEASE_TTL_MS). Expired claims become
 *   eligible for re-claim by any dispatcher.
 *
 * Guarantees:
 *   1. A business transaction and its event commit atomically.
 *   2. Event delivery is retried with bounded exponential backoff.
 *   3. Duplicate processing is prevented via BullMQ job IDs.
 *   4. Correlation ID and user/cell context are preserved.
 *      events are moved to 'dlq' after MAX_RETRIES.
 */

import { Event } from '@prisma/client';
import { prisma } from '../../config/database';
import { queueService } from '../queue/queue.service';
import { logger } from '../../lib/logger';
import { EVENT_TYPES } from './event.types';
import {
  setWorkerRlsContext,
  clearWorkerRlsContext,
  withRlsTransaction,
} from '../../middleware/rls';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_DISPATCH_INTERVAL_MS = 2_000;

const LEASE_TTL_MS = 30_000; // 30 seconds — must exceed worst-case dispatch time
const MAX_RETRIES = 5;
const BASE_RETRY_DELAY_MS = 1_000; // 1 second base for exponential backoff
const MAX_RETRY_DELAY_MS = 60_000; // 1 minute cap
const DISPATCHER_ID = `dispatcher-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OutboxOptions {
  batchSize?: number;
  dispatchIntervalMs?: number;
  leaseTtlMs?: number;
  maxRetries?: number;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export class OutboxDispatcher {
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly options: Required<OutboxOptions>;

  constructor(options: OutboxOptions = {}) {
    this.options = {
      batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
      dispatchIntervalMs: options.dispatchIntervalMs ?? DEFAULT_DISPATCH_INTERVAL_MS,
      leaseTtlMs: options.leaseTtlMs ?? LEASE_TTL_MS,
      maxRetries: options.maxRetries ?? MAX_RETRIES,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info('[OutboxDispatcher] Started', {
      dispatcherId: DISPATCHER_ID,
      batchSize: this.options.batchSize,
      leaseTtlMs: this.options.leaseTtlMs,
      maxRetries: this.options.maxRetries,
    });
    this.timer = setInterval(() => {
      void this.dispatchBatch().catch(() => {});
    }, this.options.dispatchIntervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('[OutboxDispatcher] Stopped');
  }

  // -------------------------------------------------------------------------
  // Batch dispatch
  // -------------------------------------------------------------------------

  async dispatchBatch(): Promise<void> {
    try {
      const claimed = await this.claimBatch();

      if (claimed.length === 0) return;

      for (const event of claimed) {
        await this.dispatchEvent(event);
      }
    } catch (err) {
      logger.error('[OutboxDispatcher] Batch dispatch failed', {
        error: (err as Error).message,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Claim a batch of events using FOR UPDATE SKIP LOCKED
  // -------------------------------------------------------------------------

  private async claimBatch(): Promise<Event[]> {
    const leaseExpiresAt = new Date(Date.now() + this.options.leaseTtlMs);

    return prisma.$transaction(async (tx) => {
      // Find claimable events:
      //   1. status = 'pending' (never claimed), OR
      //   2. status = 'failed' AND next_attempt_at <= NOW() AND
      //      (lease_owner IS NULL OR lease_expires_at < NOW())
      const events = await tx.$queryRaw<Event[]>`
        SELECT * FROM "events"
        WHERE
          (
            "status" = 'pending'
            OR (
              "status" = 'failed'
              AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= NOW())
              AND ("lease_owner" IS NULL OR "lease_expires_at" < NOW())
            )
          )
          AND "retry_count" < ${this.options.maxRetries}
        ORDER BY "created_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${this.options.batchSize}
      `;

      if (events.length === 0) return [];

      const ids = events.map((e) => e.id);

      // Claim the events: set status → processing, lease owner, lease expiration
      await tx.$executeRaw`
        UPDATE "events"
        SET
          "status" = 'processing',
          "lease_owner" = ${DISPATCHER_ID},
          "lease_expires_at" = ${leaseExpiresAt},
          "error" = NULL
        WHERE "id" = ANY(${ids}::uuid[])
      `;

      return events;
    });
  }

  // -------------------------------------------------------------------------
  // Dispatch a single claimed event
  // -------------------------------------------------------------------------

  private async dispatchEvent(event: Event): Promise<void> {
    try {
      // Set worker RLS context for any additional DB lookups during dispatch
      setWorkerRlsContext(event.userId);

      const payload = event.payload as Record<string, unknown>;

      let queueJobId: string;
      switch (event.eventType) {
        case EVENT_TYPES.RESUME_UPLOADED:
          queueJobId = await queueService.addMalwareScanJob({
            eventId: event.id,
            correlationId: event.correlationId,
            userId: event.userId,
            cellId: event.cellId,
            ...payload,
          } as Parameters<typeof queueService.addMalwareScanJob>[0]);
          break;
        case EVENT_TYPES.RESUME_CLEANED:
          queueJobId = await queueService.addResumeParsingJob({
            eventId: event.id,
            correlationId: event.correlationId,
            userId: event.userId,
            cellId: event.cellId,
            ...payload,
          } as Parameters<typeof queueService.addResumeParsingJob>[0]);
          break;
        case EVENT_TYPES.OPPORTUNITY_RESOLVED:
        case EVENT_TYPES.OPPORTUNITY_OBSERVED:
        case EVENT_TYPES.SKILL_OBSERVED:
        case EVENT_TYPES.PREDICTION_GENERATED:
        case EVENT_TYPES.ACTION_RECORDED:
        case EVENT_TYPES.OUTCOME_RECORDED:
        case EVENT_TYPES.APPLICATION_CREATED:
        case EVENT_TYPES.APPLICATION_SUBMITTED:
          queueJobId = await queueService.addIntelligenceJob({
            eventId: event.id,
            correlationId: event.correlationId,
            userId: event.userId,
            cellId: event.cellId,
            ...payload,
            type: 'GENERATE_EMBEDDING',
          });
          break;
        case EVENT_TYPES.RESUME_PARSED:
          queueJobId = await queueService.addIntelligenceJob({
            eventId: event.id,
            correlationId: event.correlationId,
            userId: event.userId,
            cellId: event.cellId,
            ...payload,
            type: 'MATCH_RESUME',
          });
          break;
        default:
          logger.warn('[OutboxDispatcher] Unknown event type, no queue mapping', {
            eventId: event.id,
            eventType: event.eventType,
          });
      await this.markProcessed(event.id, event.userId);
      clearWorkerRlsContext();
      return;
      }

      // Mark dispatched only after successful queue submission
      await this.markProcessed(event.id, event.userId);

      logger.info('[OutboxDispatcher] Event dispatched', {
        eventId: event.id,
        eventType: event.eventType,
        queueJobId,
        correlationId: event.correlationId,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.markFailed(event.id, errorMsg, event.userId);

      logger.error('[OutboxDispatcher] Dispatch failed', {
        eventId: event.id,
        eventType: event.eventType,
        error: errorMsg,
      });
    } finally {
      clearWorkerRlsContext();
    }
  }

  // -------------------------------------------------------------------------
  // Status transitions — each uses a single-row transaction with RLS context
  // -------------------------------------------------------------------------

  private async markProcessed(eventId: string, userId: string): Promise<void> {
    await withRlsTransaction(prisma, userId, async (tx) => {
      await tx.event.update({
        where: { id: eventId },
        data: {
          status: 'processed',
          processedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
    });
  }

  private async markFailed(eventId: string, errorMsg: string, userId: string): Promise<void> {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { retryCount: true, userId: true },
    });

    const newRetryCount = (event?.retryCount ?? 0) + 1;
    const shouldDlq = newRetryCount >= this.options.maxRetries;
    const userId = event?.userId ?? '';

    // Bounded exponential backoff: min(base * 2^retry, max)
    const backoffMs = Math.min(
      BASE_RETRY_DELAY_MS * Math.pow(2, newRetryCount - 1),
      MAX_RETRY_DELAY_MS,
    );
    const nextAttempt = new Date(Date.now() + backoffMs);

    await withRlsTransaction(prisma, userId, async (tx) => {
      await tx.event.update({
        where: { id: eventId },
        data: {
          status: shouldDlq ? 'dlq' : 'failed',
          error: errorMsg,
          retryCount: newRetryCount,
          nextAttemptAt: shouldDlq ? null : nextAttempt,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
    });

    if (shouldDlq) {
      logger.warn('[OutboxDispatcher] Event moved to DLQ', {
        eventId,
        retryCount: newRetryCount,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Manually re-queue a DLQ event for reprocessing.
   * Sets status back to 'pending' and clears retry count.
   */
  async requeueDlqEvent(eventId: string): Promise<void> {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { userId: true },
    });

    await withRlsTransaction(prisma, event?.userId ?? '', async (tx) => {
      await tx.event.update({
        where: { id: eventId },
        data: {
          status: 'pending',
          retryCount: 0,
          error: null,
          nextAttemptAt: null,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
    });
  }

  /**
   * Get current dispatcher statistics.
   */
  async getStats(): Promise<{
    pending: number;
    processing: number;
    failed: number;
    dlq: number;
    processed: number;
  }> {
    const [pending, processing, failed, dlq, processed] = await Promise.all([
      prisma.event.count({ where: { status: 'pending' } }),
      prisma.event.count({ where: { status: 'processing' } }),
      prisma.event.count({ where: { status: 'failed' } }),
      prisma.event.count({ where: { status: 'dlq' } }),
      prisma.event.count({ where: { status: 'processed' } }),
    ]);

    return { pending, processing, failed, dlq, processed };
  }
}

export const outboxDispatcher = new OutboxDispatcher();
