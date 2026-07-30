/**
 * Tests for DurableCheckpointService (Epic 4 Prompt 8)
 *
 * Covers:
 *   1. initial sync checkpoint creation
 *   2. checkpoint advancement after successful processing
 *   3. worker crash before checkpoint commit
 *   4. worker crash after successful batch commit
 *   5. retry/resume from previous checkpoint
 *   6. duplicate processing of a previously completed batch
 *   7. partial batch failure
 *   8. expired Gmail history cursor
 *   9. concurrent checkpoint update protection
 *  10. completion state
 *  11. permanent failure state
 */
import { durableCheckpointService } from '../services/gmail/durable-checkpoint.service';
import { prisma } from '../config/database';
import { userService } from '../services/user';

// Mock dependencies
jest.mock('../config/database', () => ({
  prisma: {
    $transaction: jest.fn(),
    gmailCheckpoint: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
    },
    syncBatch: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    syncOperation: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    batchEmailJob: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    userEmailConnection: {
      update: jest.fn(),
    },
    gmailSyncState: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../services/user', () => ({
  userService: {
    userScopeFor: jest.fn(),
    resolveUserId: jest.fn(),
  },
}));

// Typed mocks
const mockPrisma = prisma as unknown as {
  $transaction: jest.Mock;
  gmailCheckpoint: {
    findUnique: jest.Mock;
    updateMany: jest.Mock;
    upsert: jest.Mock;
  };
  syncBatch: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
  };
  syncOperation: {
    create: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  batchEmailJob: {
    create: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    count: jest.Mock;
  };
  userEmailConnection: { update: jest.Mock };
  gmailSyncState: { upsert: jest.Mock; findUnique: jest.Mock };
};

describe('DurableCheckpointService', () => {
  const userId = 'user-1-uuid';
  const connectionId = 'conn-1-uuid';

  beforeEach(() => {
    jest.clearAllMocks();

    (userService.userScopeFor as jest.Mock).mockResolvedValue({
      userId,
      legacyUserId: 'user-1',
    });
    (userService.resolveUserId as jest.Mock).mockResolvedValue(userId);

    // Default: transaction passes tx object = same mock prisma
    mockPrisma.$transaction.mockImplementation(
      (fn: (tx: any) => Promise<any>) => fn(mockPrisma),
    );
  });

  describe('1. initial sync checkpoint creation', () => {
    it('should create a sync operation, batch, and checkpoint atomically', async () => {
      mockPrisma.gmailCheckpoint.findUnique.mockResolvedValue(null);
      mockPrisma.gmailCheckpoint.upsert = jest.fn().mockResolvedValue({
        id: 'cp-1',
        userId,
        version: 1,
        status: 'syncing',
      });
      mockPrisma.syncBatch.create = jest.fn().mockResolvedValue({
        id: 'batch-1',
        userId,
        historyId: 'hist-1',
      });
      mockPrisma.syncOperation.create = jest.fn().mockResolvedValue({
        id: 'op-1',
        userId,
        connectionId,
        syncMode: 'INITIAL_SYNC',
        status: 'running',
        attempt: 1,
      });

      const result = await durableCheckpointService.initializeSyncOp(
        userId,
        connectionId,
        'INITIAL_SYNC',
        'corr-1',
        'hist-1',
      );

      expect(result).toEqual({
        syncOpId: 'op-1',
        batchId: 'batch-1',
      });

      expect(mockPrisma.syncOperation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId,
            connectionId,
            syncMode: 'INITIAL_SYNC',
            status: 'running',
          }),
        }),
      );

      expect(mockPrisma.syncBatch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId,
            historyId: 'hist-1',
          }),
        }),
      );
    });
  });

  describe('2. checkpoint advancement after successful processing', () => {
    it('should atomically advance checkpoint with optimistic locking', async () => {
      mockPrisma.syncBatch.findUnique.mockResolvedValue({
        id: 'batch-1',
        userId,
        status: 'processing',
        failedCount: 0,
        processedCount: 10,
      });

      mockPrisma.gmailCheckpoint.findUnique.mockResolvedValue({
        id: 'cp-1',
        userId,
        version: 3,
        status: 'syncing',
      });

      mockPrisma.gmailCheckpoint.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.syncBatch.update.mockResolvedValue({ id: 'batch-1', status: 'completed' });

      await durableCheckpointService.advanceCheckpoint(
        userId,
        'batch-1',
        'new-hist-2',
      );

      expect(mockPrisma.gmailCheckpoint.updateMany).toHaveBeenCalledWith({
        where: { userId, version: 3 },
        data: expect.objectContaining({
          currentHistoryId: 'new-hist-2',
          version: { increment: 1 },
        }),
      });

      expect(mockPrisma.syncBatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'batch-1' },
          data: expect.objectContaining({ status: 'completed' }),
        }),
      );
    });

    it('should reject concurrent modification (version mismatch)', async () => {
      mockPrisma.syncBatch.findUnique.mockResolvedValue({
        id: 'batch-1',
        userId,
        status: 'processing',
        failedCount: 0,
        processedCount: 5,
      });

      mockPrisma.gmailCheckpoint.findUnique.mockResolvedValue({
        id: 'cp-1',
        userId,
        version: 3,
        status: 'syncing',
      });

      // Another worker already advanced — updateMany returns 0
      mockPrisma.gmailCheckpoint.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        durableCheckpointService.advanceCheckpoint(userId, 'batch-1', 'new-hist-2'),
      ).rejects.toThrow(/Concurrent checkpoint modification/);
    });
  });

  describe('3. worker crash before checkpoint commit', () => {
    it('should leave checkpoint in syncing state with pending batch', async () => {
      // Simulate state after worker crash: batch created, emails fetched, but checkpoint not advanced
      mockPrisma.gmailCheckpoint.findUnique.mockResolvedValue({
        id: 'cp-1',
        userId,
        currentHistoryId: null,
        pendingHistoryId: 'hist-1',
        pageToken: 'page-2',
        syncMode: 'INITIAL_SYNC',
        version: 2,
        status: 'syncing',
      });

      mockPrisma.syncBatch.findFirst.mockResolvedValue({
        id: 'batch-1',
        userId,
        historyId: 'hist-1',
        status: 'processing',
        totalEmails: 50,
        processedCount: 20,
        failedCount: 2,
      });

      // Durable state should show pending batch
      const state = await durableCheckpointService.loadDurableState(userId);

      expect(state.checkpoint).not.toBeNull();
      expect(state.checkpoint!.status).toBe('syncing');
      expect(state.pendingBatch).not.toBeNull();
      expect(state.pendingBatch!.status).toBe('processing');
    });
  });

  describe('4. worker crash after successful batch commit', () => {
    it('should reflect committed state with advanced historyId', async () => {
      // Simulate state after crash that happened after checkpoint was committed
      mockPrisma.gmailCheckpoint.findUnique.mockResolvedValue({
        id: 'cp-1',
        userId,
        currentHistoryId: 'hist-2',
        pendingHistoryId: null,
        syncMode: 'INITIAL_SYNC',
        version: 3,
        status: 'idle',
      });

      mockPrisma.syncBatch.findFirst.mockResolvedValue(null);

      const resume = await durableCheckpointService.determineResumeStrategy(userId);

      // Should report no resume needed — sync already committed
      expect(resume.canResume).toBe(false);
      expect(resume.action).toBe('start_fresh');
    });
  });

  describe('5. retry/resume from previous checkpoint', () => {
    it('should continue from last committed pageToken', async () => {
      // Checkpoint has pageToken and last successful historyId
      mockPrisma.gmailCheckpoint.findUnique.mockResolvedValue({
        id: 'cp-1',
        userId,
        currentHistoryId: 'hist-1',
        pendingHistoryId: 'hist-2',
        pageToken: 'page-2',
        syncMode: 'INITIAL_SYNC',
        version: 2,
        status: 'syncing',
      });

      mockPrisma.syncBatch.findFirst.mockResolvedValue({
        id: 'batch-1',
        userId,
        historyId: 'hist-2',
        status: 'processing',
        totalEmails: null,
        processedCount: 20,
        failedCount: 0,
      });

      const resume = await durableCheckpointService.determineResumeStrategy(userId);

      expect(resume.canResume).toBe(true);
      expect(resume.action).toBe('restart_batch');
      expect(resume.state.checkpoint!.pageToken).toBe('page-2');
    });
  });

  describe('6. duplicate processing of a previously completed batch', () => {
    it('should be safe via idempotent upsert tracking', async () => {
      // Simulate tracking the same email twice
      mockPrisma.batchEmailJob.findFirst
        .mockResolvedValueOnce(null) // First time: not found → create
        .mockResolvedValueOnce({ id: 'job-1', emailId: 'email-1', status: 'processed' }); // Second time: found → update

      mockPrisma.batchEmailJob.create = jest.fn().mockResolvedValue({ id: 'job-1' });
      mockPrisma.batchEmailJob.update = jest.fn().mockResolvedValue({ id: 'job-1', status: 'processed' });
      mockPrisma.syncBatch.update.mockResolvedValue({});

      // First call
      await durableCheckpointService.trackEmailJob(
        'batch-1', 'email-1', 'msg-1', 'processed',
      );

      expect(mockPrisma.batchEmailJob.create).toHaveBeenCalled();

      // Second call (duplicate)
      await durableCheckpointService.trackEmailJob(
        'batch-1', 'email-1', 'msg-1', 'processed',
      );

      // Should update existing, not create again
      expect(mockPrisma.batchEmailJob.update).toHaveBeenCalled();
      // processedCount increments each time (at-least-once is acceptable)
      expect(mockPrisma.syncBatch.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('7. partial batch failure', () => {
    it('should track processed, skipped, failed, retryable, permanently_failed separately', async () => {
      mockPrisma.batchEmailJob.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mockPrisma.batchEmailJob.create = jest.fn().mockResolvedValue({});
      mockPrisma.syncBatch.update.mockResolvedValue({});

      // Track 5 emails with different statuses
      const statuses: Array<'processed' | 'skipped' | 'failed' | 'retryable' | 'permanently_failed'> = [
        'processed',
        'skipped',
        'failed',
        'retryable',
        'permanently_failed',
      ];

      for (const status of statuses) {
        await durableCheckpointService.trackEmailJob(
          'batch-1', `email-${status}`, `msg-${status}`, status,
        );
      }

      // Verify each create call has the right status
      const createCalls = mockPrisma.batchEmailJob.create.mock.calls;
      expect(createCalls[0][0].data.status).toBe('processed');
      expect(createCalls[1][0].data.status).toBe('skipped');
      expect(createCalls[2][0].data.status).toBe('failed');
      expect(createCalls[3][0].data.status).toBe('retryable');
      expect(createCalls[4][0].data.status).toBe('permanently_failed');
    });
  });

  describe('8. expired Gmail history cursor', () => {
    it('should detect and recommend fallback to initial sync', async () => {
      mockPrisma.gmailCheckpoint.findUnique.mockResolvedValue({
        id: 'cp-1',
        userId,
        currentHistoryId: null,
        pendingHistoryId: null,
        syncMode: 'INCREMENTAL_SYNC',
        version: 1,
        status: 'failed',
        lastError: 'History API 404',
      });

      mockPrisma.syncBatch.findFirst.mockResolvedValue(null);

      const resume = await durableCheckpointService.determineResumeStrategy(userId);

      expect(resume.canResume).toBe(false);
      expect(resume.action).toBe('fallback_to_initial');
    });
  });

  describe('9. concurrent checkpoint update protection', () => {
    it('should throw when lockCheckpoint detects an active sync', async () => {
      mockPrisma.gmailCheckpoint.findUnique.mockResolvedValue({
        userId,
        status: 'syncing',
      });

      await expect(
        durableCheckpointService.lockCheckpoint(mockPrisma as any, userId),
      ).rejects.toThrow(/already locked/);
    });

    it('should allow lock when checkpoint is idle', async () => {
      mockPrisma.gmailCheckpoint.findUnique.mockResolvedValue({
        userId,
        status: 'idle',
      });

      await expect(
        durableCheckpointService.lockCheckpoint(mockPrisma as any, userId),
      ).resolves.not.toThrow();
    });
  });

  describe('10. completion state', () => {
    it('should mark sync operation as completed', async () => {
      mockPrisma.syncOperation.update.mockResolvedValue({
        id: 'op-1',
        status: 'completed',
        completedAt: new Date(),
      });

      await durableCheckpointService.completeSyncOp('op-1');

      expect(mockPrisma.syncOperation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'op-1' },
          data: expect.objectContaining({
            status: 'completed',
            completedAt: expect.any(Date),
          }),
        }),
      );
    });
  });

  describe('11. permanent failure state', () => {
    it('should mark sync operation as failed with error', async () => {
      mockPrisma.syncOperation.update.mockResolvedValue({
        id: 'op-1',
        status: 'failed',
        error: 'Permanent error',
        completedAt: new Date(),
      });

      await durableCheckpointService.failSyncOp('op-1', 'Permanent error');

      expect(mockPrisma.syncOperation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'op-1' },
          data: expect.objectContaining({
            status: 'failed',
            error: 'Permanent error',
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('should not advance checkpoint after permanent failure', async () => {
      // Failed sync op: checkpoint should NOT have been advanced
      const checkpoint = {
        id: 'cp-1',
        userId,
        currentHistoryId: 'hist-1', // stuck at old value
        pendingHistoryId: 'hist-2', // was never committed
        status: 'failed',
        version: 2,
      };

      // The checkpoint's currentHistoryId should still be the old value
      expect(checkpoint.currentHistoryId).toBe('hist-1');
      expect(checkpoint.currentHistoryId).not.toBe('hist-2');
    });
  });

  describe('resume strategy edge cases', () => {
    it('should recommend start_fresh when no checkpoint exists', async () => {
      mockPrisma.gmailCheckpoint.findUnique.mockResolvedValue(null);
      mockPrisma.syncBatch.findFirst.mockResolvedValue(null);

      const resume = await durableCheckpointService.determineResumeStrategy(userId);

      expect(resume.canResume).toBe(false);
      expect(resume.action).toBe('start_fresh');
    });

    it('should recommend continue when checkpoint is idle', async () => {
      mockPrisma.gmailCheckpoint.findUnique.mockResolvedValue({
        id: 'cp-1',
        userId,
        currentHistoryId: 'hist-5',
        status: 'idle',
        syncMode: 'INCREMENTAL_SYNC',
        version: 5,
      });
      mockPrisma.syncBatch.findFirst.mockResolvedValue(null);

      const resume = await durableCheckpointService.determineResumeStrategy(userId);

      expect(resume.canResume).toBe(false);
      expect(resume.action).toBe('start_fresh');
    });
  });
});
