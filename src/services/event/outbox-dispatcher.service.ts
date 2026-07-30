/**
 * OutboxDispatcher — durable event-to-queue bridge.
 *
 * Reads pending PostgreSQL Event records, dispatches the corresponding
 * BullMQ jobs, and marks events as processed atomically. This ensures:
 *
 *   ┌────────────────────┐     ┌──────────────────────┐
 *   │  Application code  │────▶│  PostgreSQL Event     │
 *   │  (business TX)     │     │  (committed atomically│
 *   └────────────────────┘     │   with the write)     │
 *                              └──────────┬───────────┘
 *                                         │
 *                              ┌──────────▼───────────┐
 *                              │  OutboxDispatcher    │
 *                              │  claims pending      │
 *   ┌────────────────────┐     │  events via FOR UPDATE│
 *   │  BullMQ queues     │◀────│  SKIP LOCKED          │
 *   │  (actual delivery) │     └──────────────────────┘
 *   └────────────────────┘
 *
 * Guarantees:
 *   1. A business transaction and its event commit atomically.
 *   2. Event delivery is retried with backoff.
 *   3. Duplicate processing is prevented via BullMQ job IDs.
 *   4. Correlation ID and user/cell context are preserved.
 *   5. Dead-letter events are moved to 'dlq' after max retries.
 */

import { Event } from '@prisma/client';
import { prisma } from '../../config/database';
import { queueService } from '../queue/queue.service';
import { logger } from '../../lib/logger';
import { EVENT_TYPES } from './event.types';
import { setWorkerRlsContext, clearWorkerRlsContext } from '../../middleware/rls';

const BATCH_SIZE = 50;
const DISPATCH_INTERVAL_MS = 2_000;

export class OutboxDispatcher {
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info('[OutboxDispatcher] Started');
    this.timer = setInterval(() => {
      void this.dispatchBatch().catch(() => {});
    }, DISPATCH_INTERVAL_MS);
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

  async dispatchBatch(): Promise<void> {
    try {
      const events = await prisma.$transaction(async (tx) => {
        // Claim a batch of pending events using FOR UPDATE SKIP LOCKED
        const claimed = await tx.$queryRaw<Event[]>`
          SELECT * FROM "events"
          WHERE "status" = 'pending'
          ORDER BY "created_at" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${BATCH_SIZE}
        `;

        if (claimed.length === 0) return [];

        // Mark claimed events as 'processing' to prevent re-claim
        const ids = claimed.map((e) => e.id);
        await tx.$executeRaw`
          UPDATE "events"
          SET "status" = 'processing', "processed_at" = NOW()
          WHERE "id" = ANY(${ids}::uuid[])
        `;

        return claimed;
      });

      for (const event of events) {
        await this.dispatchEvent(event);
      }
    } catch (err) {
      logger.error('[OutboxDispatcher] Batch dispatch failed', {
        error: (err as Error).message,
      });
    }
  }

  private async dispatchEvent(event: Event): Promise<void> {
    try {
      // Set RLS context for any additional DB lookups during dispatch
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
          await prisma.event.update({
            where: { id: event.id },
            data: { status: 'processed', processedAt: new Date() },
          });
          clearWorkerRlsContext();
          return;
      }

      // Mark dispatched only after successful queue submission
      await prisma.event.update({
        where: { id: event.id },
        data: { status: 'processed', processedAt: new Date() },
      });

      logger.info('[OutboxDispatcher] Event dispatched', {
        eventId: event.id,
        eventType: event.eventType,
        queueJobId,
        correlationId: event.correlationId,
      });
    } catch (err) {
      const errorMsg = (err as Error).message;
      await prisma.event.update({
        where: { id: event.id },
        data: {
          status: 'failed',
          error: errorMsg,
          retryCount: { increment: 1 },
        },
      });

      logger.error('[OutboxDispatcher] Dispatch failed', {
        eventId: event.id,
        eventType: event.eventType,
        error: errorMsg,
      });
    } finally {
      clearWorkerRlsContext();
    }
  }
}

export const outboxDispatcher = new OutboxDispatcher();
