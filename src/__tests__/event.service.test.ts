import { eventDispatcher } from '../services/event/event-dispatcher.service';
import { withEventLifecycle } from '../services/event/event-worker';
import { EVENT_TYPES } from '../services/event/event.types';
import { queueService } from '../services/queue/queue.service';
import { prisma } from '../config/database';

jest.mock('../config/database', () => ({
  prisma: {
    event: {
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('../services/queue/queue.service', () => ({
  queueService: {
    addMalwareScanJob: jest.fn(),
    addResumeParsingJob: jest.fn(),
  },
}));

describe('Event System', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('EventDispatcher', () => {
    it('should persist event and dispatch job for RESUME_UPLOADED', async () => {
      const mockEvent = { id: 'evt-1', eventType: EVENT_TYPES.RESUME_UPLOADED };
      (prisma.event.create as jest.Mock).mockResolvedValue(mockEvent);

      await eventDispatcher.publish({
        eventType: EVENT_TYPES.RESUME_UPLOADED,
        aggregateId: 'res-1',
        aggregateType: 'UserResume',
        userId: 'u1',
        cellId: 'c1',
        payload: { fileHash: 'abc' },
        correlationId: 'corr-1',
      });

      expect(prisma.event.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: EVENT_TYPES.RESUME_UPLOADED,
          aggregateId: 'res-1',
          userId: 'u1',
          correlationId: 'corr-1',
        }),
      });

      expect(queueService.addMalwareScanJob).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'evt-1',
          correlationId: 'corr-1',
          fileHash: 'abc',
        })
      );
    });
  });

  describe('withEventLifecycle (EventWorker)', () => {
    it('should mark event as processed on success', async () => {
      const job: any = {
        id: 'job-1',
        attemptsMade: 0,
        data: { eventId: 'evt-1', correlationId: 'corr-1' },
      };
      const processor = jest.fn().mockResolvedValue(undefined);

      await withEventLifecycle(job, processor);

      expect(processor).toHaveBeenCalledWith(job);
      expect(prisma.event.update).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
        data: expect.objectContaining({
          status: 'processed',
        }),
      });
    });

    it('should mark event as failed on temporary error and increment retry', async () => {
      const job: any = {
        id: 'job-1',
        attemptsMade: 1, // First retry
        opts: { attempts: 3 },
        data: { eventId: 'evt-1', correlationId: 'corr-1' },
      };
      const processor = jest.fn().mockRejectedValue(new Error('Temp error'));

      await expect(withEventLifecycle(job, processor)).rejects.toThrow('Temp error');

      // Check retry count increment
      expect(prisma.event.update).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
        data: { retryCount: { increment: 1 } },
      });

      // Check failure status update
      expect(prisma.event.update).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
        data: expect.objectContaining({
          status: 'failed',
          error: 'Temp error',
        }),
      });
    });

    it('should move event to dlq on permanent error', async () => {
      const job: any = {
        id: 'job-1',
        attemptsMade: 2, // 3 attempts made total (0, 1, 2). max is 3. So >= 3 - 1
        opts: { attempts: 3 },
        data: { eventId: 'evt-1', correlationId: 'corr-1' },
      };
      const processor = jest.fn().mockRejectedValue(new Error('Fatal error'));

      await expect(withEventLifecycle(job, processor)).rejects.toThrow('Fatal error');

      expect(prisma.event.update).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
        data: expect.objectContaining({
          status: 'dlq',
          error: 'Fatal error',
        }),
      });
    });

    it('should pass through legacy jobs without eventId', async () => {
      const job: any = {
        id: 'job-1',
        attemptsMade: 0,
        data: {}, // No eventId
      };
      const processor = jest.fn().mockResolvedValue(undefined);

      await withEventLifecycle(job, processor);

      expect(processor).toHaveBeenCalledWith(job);
      expect(prisma.event.update).not.toHaveBeenCalled();
    });
  });
});
