import { durableCheckpointService } from '../services/gmail/durable-checkpoint.service';
import { prisma } from '../config/database';
import { userService } from '../services/user';

// Mock dependencies
jest.mock('@prisma/client', () => ({
  Prisma: {
    TransactionClient: jest.fn(),
  },
}));

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
  },
}));

jest.mock('../services/user', () => ({
  userService: {
    userScopeFor: jest.fn(),
    resolveUserId: jest.fn(),
  },
}));

const mockPrisma = prisma as any;

describe('DurableCheckpointService Resumability', () => {
  const userId = 'user-resumable-uuid';

  beforeEach(() => {
    jest.clearAllMocks();
    (userService.userScopeFor as jest.Mock).mockResolvedValue({
      userId,
      legacyUserId: 'user-resumable',
    });
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockPrisma));
  });

  describe('determineResumeStrategy', () => {
    it('should recommend continue when checkpoint failed but has a valid history cursor', async () => {
      mockPrisma.gmailCheckpoint.findUnique.mockResolvedValue({
        userId,
        status: 'failed',
        currentHistoryId: 'hist-123',
        syncMode: 'INCREMENTAL_SYNC',
      });
      mockPrisma.syncBatch.findFirst.mockResolvedValue(null);

      const strategy = await durableCheckpointService.determineResumeStrategy(userId);

      expect(strategy.canResume).toBe(true);
      expect(strategy.action).toBe('continue');
      expect(strategy.state.checkpoint?.currentHistoryId).toBe('hist-123');
    });

    it('should recommend restart_batch when sync was interrupted with pending jobs', async () => {
      const batchId = 'batch-interrupted';
      mockPrisma.gmailCheckpoint.findUnique.mockResolvedValue({
        userId,
        status: 'syncing',
        pendingHistoryId: 'hist-456',
      });
      mockPrisma.syncBatch.findFirst.mockResolvedValue({
        id: batchId,
        status: 'processing',
        totalEmails: 10,
      });
      mockPrisma.batchEmailJob.count.mockResolvedValue(5); // 5 jobs still pending/processing/retryable

      const strategy = await durableCheckpointService.determineResumeStrategy(userId);

      expect(strategy.canResume).toBe(true);
      expect(strategy.action).toBe('restart_batch');
      expect(strategy.state.pendingBatch?.id).toBe(batchId);
      expect(mockPrisma.batchEmailJob.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            batchId,
            status: { in: ['pending', 'processing', 'retryable'] },
          }),
        }),
      );
    });

    it('should recommend restart_batch when batch was created but no emails were tracked yet', async () => {
      const batchId = 'batch-empty';
      mockPrisma.gmailCheckpoint.findUnique.mockResolvedValue({
        userId,
        status: 'syncing',
      });
      mockPrisma.syncBatch.findFirst.mockResolvedValue({
        id: batchId,
        status: 'pending',
        totalEmails: null, // No emails tracked yet
      });

      const strategy = await durableCheckpointService.determineResumeStrategy(userId);

      expect(strategy.canResume).toBe(true);
      expect(strategy.action).toBe('restart_batch');
    });

    it('should recommend fallback_to_initial when incremental sync failed without a cursor', async () => {
      mockPrisma.gmailCheckpoint.findUnique.mockResolvedValue({
        userId,
        status: 'failed',
        currentHistoryId: null,
        syncMode: 'INCREMENTAL_SYNC',
      });
      mockPrisma.syncBatch.findFirst.mockResolvedValue(null);

      const strategy = await durableCheckpointService.determineResumeStrategy(userId);

      expect(strategy.canResume).toBe(false);
      expect(strategy.action).toBe('fallback_to_initial');
    });

    it('should recommend start_fresh when initial sync failed without a cursor', async () => {
      mockPrisma.gmailCheckpoint.findUnique.mockResolvedValue({
        userId,
        status: 'failed',
        currentHistoryId: null,
        syncMode: 'INITIAL_SYNC',
      });
      mockPrisma.syncBatch.findFirst.mockResolvedValue(null);

      const strategy = await durableCheckpointService.determineResumeStrategy(userId);

      expect(strategy.canResume).toBe(false);
      expect(strategy.action).toBe('start_fresh');
    });

    it('should recommend start_fresh when no checkpoint exists', async () => {
      mockPrisma.gmailCheckpoint.findUnique.mockResolvedValue(null);

      const strategy = await durableCheckpointService.determineResumeStrategy(userId);

      expect(strategy.canResume).toBe(false);
      expect(strategy.action).toBe('start_fresh');
    });

    it('should recommend start_fresh when previous sync was idle (completed)', async () => {
      mockPrisma.gmailCheckpoint.findUnique.mockResolvedValue({
        userId,
        status: 'idle',
      });

      const strategy = await durableCheckpointService.determineResumeStrategy(userId);

      expect(strategy.canResume).toBe(false);
      expect(strategy.action).toBe('start_fresh');
    });
  });

  describe('advanceCheckpoint edge cases', () => {
    it('should throw error if batch is not found', async () => {
      mockPrisma.syncBatch.findUnique.mockResolvedValue(null);

      await expect(
        durableCheckpointService.advanceCheckpoint(userId, 'non-existent-batch', 'hist-new'),
      ).rejects.toThrow('Batch non-existent-batch not found');
    });

    it('should throw error if checkpoint is not found', async () => {
      mockPrisma.syncBatch.findUnique.mockResolvedValue({ userId, id: 'batch-1' });
      mockPrisma.gmailCheckpoint.findUnique.mockResolvedValue(null);

      await expect(
        durableCheckpointService.advanceCheckpoint(userId, 'batch-1', 'hist-new'),
      ).rejects.toThrow(`Checkpoint for user ${userId} not found`);
    });
  });
});
