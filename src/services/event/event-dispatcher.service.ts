import crypto from 'crypto';
import { prisma } from '../../config/database';
import { queueService } from '../queue/queue.service';
import { logger } from '../../lib/logger';
import { CreateEventInput, EVENT_TYPES } from './event.types';
import type { MalwareScanJobPayload, ResumeParsingJobPayload } from '../queue/queue.types';

export class EventDispatcherService {
  /**
   * Publishes a durable event and dispatches the corresponding queue job.
   */
  async publish(input: CreateEventInput): Promise<string> {
    const correlationId = input.correlationId || crypto.randomUUID();

    // Persist event durably. 
    // Idempotency constraint: duplicate events shouldn't duplicate intelligence.
    // By keeping the event history durable, we allow replay and audit.
    // If we wanted to avoid storing duplicates completely, we could query for existing 
    // events with the same aggregateId + eventType in a recent timeframe.
    // However, BullMQ job IDs provide our primary idempotency boundary.
    
    const event = await prisma.event.create({
      data: {
        eventType: input.eventType,
        aggregateId: input.aggregateId,
        aggregateType: input.aggregateType,
        userId: input.userId,
        cellId: input.cellId,
        payload: input.payload,
        correlationId,
        status: 'pending',
      },
    });

    try {
      // Route event to appropriate queue based on type
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
        case EVENT_TYPES.RESUME_PARSED: {
          // Future: Extract & Materialize
          break;
        }
        default: {
          logger.warn(`[EventDispatcher] No queue mapping for event type ${input.eventType}`);
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
