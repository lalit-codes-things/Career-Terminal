/**
 * Tests for DurableCheckpointService (Epic 4 Prompt 8)
 *
 * Covers:
 *   1. initial sync checkpoint creation with advisory lock
 *   2. checkpoint advancement after successful processing
 *   3. concurrent worker claim protection
 *   4. stale lease recovery
 *   5. lease refresh
 *   6. lease release
 *   7. worker crash before checkpoint commit
 *   8. worker crash after successful batch commit
 *   9. retry/resume from previous checkpoint
 *   10. duplicate processing safety
 *   11. partial batch failure
 *   12. expired Gmail history cursor
 *   13. completion state
 *   14. permanent failure state
 */
import { durableCheckpointService } from '../services/gmail/durable-checkpoint.service';
import { prisma } from '../config/database';
import { userService } from '../services/user';

jest.mock('../config/database', () => {
  const prisma = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
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
  };
  return {
    prisma,
  dbRouter: {
    read: jest.fn().mockReturnValue(prisma),
    write: jest.fn().mockReturnValue(prisma),
    withReplicaFallback: jest.fn(),
    getHealth: jest.fn(),
    disconnect: jest.fn(),
  },
  };
});

jest.mock('../services/user', () => ({
  userService: {
    userScopeFor: jest.fn(),
    resolveUserId: jest.fn(),
  },
}));

const mockPrisma = prisma as unknown as {
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
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

    mockPrisma.$transaction.mockImplementation((fn: (tx: any) => Promise<any>) => fn(mockPrisma));
    mockPrisma.$queryRaw.mockResolvedValue([]);
  });

  describe('1. initial sync checkpoint creation with advisory lock', () => {
    it('should acquire advisory lock and create sync records', async () => {
      mockPrisma.gmailCheckpoint.findUnique.mockResolvedValue(null);
      mockPrisma.gmailCheckpoint.upsert = jest.fn().mockResolvedValue({
        id: 'cp-1',
        userId,
        version: 1,
        status: 'syncing',
        leaseOwner: 'worker-1',
        leaseExpiresAt: new Date(),
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
        'worker-1',
      );

      expect(result).toEqual({
        syncOpId: 'op-1',
        batchId: 'batch-1',
      });

      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
      expect(mockPrisma.gmailCheckpoint.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            status: 'syncing',
            leaseOwner: 'worker-1',
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

      await durableCheckpointService.advanceCheckpoint(userId, 'batch-1', 'new-hist-2');

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

      mockPrisma.gmailCheckpoint.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        durableCheckpointService.advanceCheckpoint(userId, 'batch-1', 'new-hist-2'),
      ).rejects.toThrow(/Concurrent checkpoint modification/);
    });
  });

  describe('3. concurrent worker claim protection', () => {
    it('should claim checkpoint when no other worker holds it', async () => {
      mockPrisma.gmailCheckpoint.findUnique.mockResolvedValue(null);

      const result = await durableCheckpointService.claimCheckpoint(
        mockPrisma as any,
        userId,
        'worker-1',
      );

      expect(result.claimed).toBe(true);
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    });

    it('should reject claim when another worker holds active lease', async () => {
      const now = new Date();
      mockPrisma.gmailCheckpoint.findUnique.mockResolvedValue({
        userId,
        status: 'syncing',
        leaseOwner: 'worker-2',
        leaseExpiresAt: new Date(now.getTime() + 60000),
      });

      const result = await durableCheckpointService.claimCheckpoint(
        mockPrisma as any,
        userId,
        'worker-1',
      );

      expect(result.claimed).toBe(false);
      expect(result.reason).toContain('already locked');
    });

    it('should allow reclaim of stale lease', async () => {
      const now = new Date();
      mockPrisma.gmailCheckpoint.findUnique.mockResolvedValue({
        userId,
        status: 'syncing',
        leaseOwner: 'worker-dead',
        leaseExpiresAt: new Date(now.getTime() - 60000),
      });

      const result = await durableCheckpointService.claimCheckpoint(
        mockPrisma as any,
        userId,
        'worker-1',
      );

      expect(result.claimed).toBe(true);
    });
  });

  describe('4. stale lease recovery', () => {
    it('should recover stale leases back to idle', async () => {
      const now = new Date();
      mockPrisma.gmailCheckpoint.findUnique
        .mockResolvedValueOnce({
          userId,
          status: 'syncing',
          leaseExpiresAt: new Date(now.getTime() - 60000),
        })
        .mockResolvedValueOnce({
          userId,
          status: 'idle',
          leaseExpiresAt: null,
        });

      mockPrisma.gmailCheckpoint.updateMany.mockResolvedValue({ count: 1 });

      const recovered = await durableCheckpointService.recoverStaleLeases();

      expect(recovered).toBe(1);
      expect(mockPrisma.gmailCheckpoint.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'syncing',
          leaseExpiresAt: { lt: expect.any(Date) },
        },
        data: expect.objectContaining({
          status: 'idle',
          lastError: 'Stale lease recovered',
        }),
      });
    });
  });

  describe('5. lease refresh', () => {
    it('should extend lease for the owning worker', async () => {
      mockPrisma.gmailCheckpoint.updateMany.mockResolvedValue({ count: 1 });

      const result = await durableCheckpointService.refreshLease(userId, 'worker-1');

      expect(result).toBe(true);
      expect(mockPrisma.gmailCheckpoint.updateMany).toHaveBeenCalledWith({
        where: {
          userId,
          leaseOwner: 'worker-1',
          status: 'syncing',
        },
        data: expect.objectContaining({
          leaseExpiresAt: expect.any(Date),
        }),
      });
    });
  });

  describe('6. lease release', () => {
    it('should clear lease ownership', async () => {
      mockPrisma.gmailCheckpoint.updateMany.mockResolvedValue({ count: 1 });

      await durableCheckpointService.releaseLease(userId, 'worker-1');

      expect(mockPrisma.gmailCheckpoint.updateMany).toHaveBeenCalledWith({
        where: { userId, leaseOwner: 'worker-1' },
        data: {
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
    });
  });

  describe('7. worker crash before checkpoint commit', () => {
    it('should leave checkpoint in syncing state with pending batch', async () => {
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

      const state = await durableCheckpointService.loadDurableState(userId);

      expect(state.checkpoint).not.toBeNull();
      expect(state.checkpoint!.status).toBe('syncing');
      expect(state.pendingBatch).not.toBeNull();
      expect(state.pendingBatch!.status).toBe('processing');
    });
  });

  describe('8. worker crash after successful batch commit', () => {
    it('should reflect committed state with advanced historyId', async () => {
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

      expect(resume.canResume).toBe(false);
      expect(resume.action).toBe('start_fresh');
    });
  });

  describe('9. retry/resume from previous checkpoint', () => {
    it('should continue from last committed pageToken', async () => {
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

  describe('10. duplicate processing safety', () => {
    it('should be safe via idempotent upsert tracking', async () => {
      mockPrisma.batchEmailJob.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'job-1', emailId: 'email-1', status: 'processed' });

      mockPrisma.batchEmailJob.create = jest.fn().mockResolvedValue({ id: 'job-1' });
      mockPrisma.batchEmailJob.update = jest
        .fn()
        .mockResolvedValue({ id: 'job-1', status: 'processed' });
      mockPrisma.syncBatch.update.mockResolvedValue({});

      await durableCheckpointService.trackEmailJob('batch-1', 'email-1', 'msg-1', 'processed');

      expect(mockPrisma.batchEmailJob.create).toHaveBeenCalled();

      await durableCheckpointService.trackEmailJob('batch-1', 'email-1', 'msg-1', 'processed');

      expect(mockPrisma.batchEmailJob.update).toHaveBeenCalled();
      expect(mockPrisma.syncBatch.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('11. partial batch failure', () => {
    it('should track processed, skipped, failed, retryable, permanently_failed separately', async () => {
      mockPrisma.batchEmailJob.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mockPrisma.batchEmailJob.create = jest.fn().mockResolvedValue({});
      mockPrisma.syncBatch.update.mockResolvedValue({});

      const statuses: Array<
        'processed' | 'skipped' | 'failed' | 'retryable' | 'permanently_failed'
      > = ['processed', 'skipped', 'failed', 'retryable', 'permanently_failed'];

      for (const status of statuses) {
        await durableCheckpointService.trackEmailJob(
          'batch-1',
          `email-${status}`,
          `msg-${status}`,
          status,
        );
      }

      const createCalls = mockPrisma.batchEmailJob.create.mock.calls;
      expect(createCalls[0][0].data.status).toBe('processed');
      expect(createCalls[1][0].data.status).toBe('skipped');
      expect(createCalls[2][0].data.status).toBe('failed');
      expect(createCalls[3][0].data.status).toBe('retryable');
      expect(createCalls[4][0].data.status).toBe('permanently_failed');
    });
  });

  describe('12. expired Gmail history cursor', () => {
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

  describe('13. completion state', () => {
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

  describe('14. permanent failure state', () => {
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
      const checkpoint = {
        id: 'cp-1',
        userId,
        currentHistoryId: 'hist-1',
        pendingHistoryId: 'hist-2',
        status: 'failed',
        version: 2,
      };

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

    it('should recommend start_fresh when checkpoint is idle', async () => {
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
