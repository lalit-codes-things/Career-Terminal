import crypto from 'crypto';
import { prisma } from '../../config/database';
import { queueService } from '../queue/queue.service';
import { logger } from '../../lib/logger';
import type { Prisma } from '@prisma/client';
import { CreateEventInput, EVENT_TYPES, type EventType } from './event.types';
import type {
  MalwareScanJobPayload,
  ResumeParsingJobPayload,
  IntelligenceJobPayload,
} from '../queue/queue.types';

/** A persisted outbox event row (subset used for dispatch). */
export type DispatchedEvent = {
  id: string;
  eventType: string;
  userId: string;
  cellId: string | null;
  correlationId: string;
  payload: Record<string, unknown>;
};

export class EventDispatcherService {
  /**
   * Publishes a durable event and dispatches the corresponding queue job.
   *
   * NOTE: This convenience method writes the event in its own transaction.
   * For TRUE transactional-outbox semantics (business write + event insert
   * commit atomically) use `publishInTransaction(tx, input)` inside your
   * business transaction and `publishFromEvent(event)` after it commits.
   */
  async publish(input: CreateEventInput): Promise<string> {
    const event = await prisma.$transaction(async (tx) => {
      return this.publishInTransaction(tx, input);
    });

    await this.publishFromEvent(event);
    return event.id;
  }

  /**
   * Creates a PENDING event inside the caller's transaction.
   *
   * This is the transactional-outbox primitive: the business write and the
   * event insert commit (or roll back) atomically. No queue delivery is
   * attempted here — after the transaction commits, call `publishFromEvent`
   * for fast-path delivery; if that fails the OutboxDispatcher retries.
   */
  async publishInTransaction(
    tx: Prisma.TransactionClient,
    input: CreateEventInput,
  ): Promise<DispatchedEvent> {
    const correlationId = input.correlationId || crypto.randomUUID();

    const event = await tx.event.create({
      data: {
        eventType: input.eventType,
        aggregateId: input.aggregateId,
        aggregateType: input.aggregateType,
        userId: input.userId,
        cellId: input.cellId,
        payload: input.payload as Prisma.InputJsonValue,
        correlationId,
        status: 'pending',
      },
    });

    return {
      id: event.id,
      eventType: event.eventType,
      userId: event.userId,
      cellId: event.cellId,
      correlationId: event.correlationId,
      payload: event.payload as Record<string, unknown>,
    };
  }

  /**
   * Fast-path delivery after the business transaction has committed.
   * Dispatches the BullMQ job and marks the event 'processed'.
   * If dispatch fails, the event stays 'pending' and the OutboxDispatcher
   * retries it asynchronously — delivery is at-least-once.
   */
  async publishFromEvent(event: DispatchedEvent): Promise<void> {
    try {
      await this.dispatchToQueue(event);

      await prisma.event.update({
        where: { id: event.id },
        data: { status: 'processed', processedAt: new Date() },
      });

      logger.info('[EventDispatcher] Published and dispatched event', {
        eventId: event.id,
        eventType: event.eventType,
        correlationId: event.correlationId,
      });
    } catch (err) {
      // Event is persisted with status='pending' — outbox worker will retry
      logger.error(
        '[EventDispatcher] Failed to dispatch BullMQ job for event (will retry via outbox)',
        {
          eventId: event.id,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }

  private async dispatchToQueue(event: DispatchedEvent): Promise<void> {
    const payload = event.payload;

    switch (event.eventType) {
      case EVENT_TYPES.RESUME_UPLOADED: {
        await queueService.addMalwareScanJob({
          ...(payload as MalwareScanJobPayload),
          eventId: event.id,
          correlationId: event.correlationId,
        });
        break;
      }
      case EVENT_TYPES.RESUME_CLEANED: {
        await queueService.addResumeParsingJob({
          ...(payload as ResumeParsingJobPayload),
          eventId: event.id,
          correlationId: event.correlationId,
        });
        break;
      }
      case EVENT_TYPES.OPPORTUNITY_RESOLVED:
      case EVENT_TYPES.OPPORTUNITY_OBSERVED:
      case EVENT_TYPES.SKILL_OBSERVED:
      case EVENT_TYPES.PREDICTION_GENERATED:
      case EVENT_TYPES.ACTION_RECORDED:
      case EVENT_TYPES.OUTCOME_RECORDED:
      case EVENT_TYPES.APPLICATION_CREATED:
      case EVENT_TYPES.APPLICATION_SUBMITTED: {
        await queueService.addIntelligenceJob({
          ...(payload as IntelligenceJobPayload),
          type: 'GENERATE_EMBEDDING',
          eventId: event.id,
          correlationId: event.correlationId,
        });
        break;
      }
      case EVENT_TYPES.RESUME_PARSED: {
        await queueService.addIntelligenceJob({
          ...(payload as IntelligenceJobPayload),
          type: 'MATCH_RESUME',
          eventId: event.id,
          correlationId: event.correlationId,
        });
        break;
      }
      default: {
        const eventType = event.eventType as EventType;
        logger.warn(`[EventDispatcher] No queue mapping for event type ${eventType}`);
      }
    }
  }
}

export const eventDispatcher = new EventDispatcherService();
