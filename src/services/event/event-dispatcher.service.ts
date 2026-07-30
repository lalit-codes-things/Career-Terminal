import crypto from 'crypto';
import { prisma } from '../../config/database';
import { queueService } from '../queue/queue.service';
import { logger } from '../../lib/logger';
import type { Prisma } from '@prisma/client';
import { CreateEventInput, EVENT_TYPES, type EventType } from './event.types';
import type { MalwareScanJobPayload, ResumeParsingJobPayload, IntelligenceJobPayload } from '../queue/queue.types';

export class EventDispatcherService {
  /**
   * Publishes a durable event and dispatches the corresponding queue job.
   *
   * The event record and the business transaction must commit atomically
   * in PostgreSQL before delivery is attempted. If BullMQ delivery fails,
   * the event remains in the database with status 'pending' or 'failed',
   * and the OutboxDispatcher worker will retry delivery asynchronously.
   */
  async publish(input: CreateEventInput): Promise<string> {
    const correlationId = input.correlationId || crypto.randomUUID();

    const event = await prisma.event.create({
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

    try {
      await this.dispatchToQueue(event, input, correlationId);

      // Fast-path success: mark dispatched so outbox worker skips it
      await prisma.event.update({
        where: { id: event.id },
        data: { status: 'processed', processedAt: new Date() },
      });

      logger.info('[EventDispatcher] Published and dispatched event', {
        eventId: event.id,
        eventType: event.eventType,
        correlationId,
      });
    } catch (err) {
      // Event is persisted with status='pending' — outbox worker will retry
      logger.error('[EventDispatcher] Failed to dispatch BullMQ job for event (will retry via outbox)', {
        eventId: event.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return event.id;
  }

  private async dispatchToQueue(
    event: { id: string; eventType: string },
    input: CreateEventInput,
    correlationId: string,
  ): Promise<void> {
    switch (input.eventType) {
      case EVENT_TYPES.RESUME_UPLOADED: {
        const payload = input.payload as unknown as MalwareScanJobPayload;
        await queueService.addMalwareScanJob({
          ...payload,
          eventId: event.id,
          correlationId,
        });
        break;
      }
      case EVENT_TYPES.RESUME_CLEANED: {
        const payload = input.payload as unknown as ResumeParsingJobPayload;
        await queueService.addResumeParsingJob({
          ...payload,
          eventId: event.id,
          correlationId,
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
        const payload = input.payload as unknown as IntelligenceJobPayload;
        await queueService.addIntelligenceJob({
          ...payload,
          type: 'GENERATE_EMBEDDING',
          eventId: event.id,
          correlationId,
        });
        break;
      }
      case EVENT_TYPES.RESUME_PARSED: {
        const payload = input.payload as unknown as IntelligenceJobPayload;
        await queueService.addIntelligenceJob({
          ...payload,
          type: 'MATCH_RESUME',
          eventId: event.id,
          correlationId,
        });
        break;
      }
      default: {
        const eventType = input.eventType as EventType;
        logger.warn(`[EventDispatcher] No queue mapping for event type ${eventType}`);
      }
    }
  }
}

export const eventDispatcher = new EventDispatcherService();
