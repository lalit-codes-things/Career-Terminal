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

      logger.info('[EventDispatcher] Published event and dispatched job', {
        eventId: event.id,
        eventType: event.eventType,
        correlationId,
      });
    } catch (err) {
      logger.error('[EventDispatcher] Failed to dispatch BullMQ job for event', {
        eventId: event.id,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    return event.id;
  }
}

export const eventDispatcher = new EventDispatcherService();
