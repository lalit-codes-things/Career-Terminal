import { gmailCheckpointService } from '../services/gmail/checkpoint.service';
import { prisma } from '../config/database';
import { userService } from '../services/user';

jest.mock('../config/database', () => {
  const prisma = {
    $transaction: jest.fn(),
    syncBatch: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    gmailCheckpoint: {
      upsert: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    batchEmailJob: {
      upsert: jest.fn(),
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
  },
}));

const mockPrisma = prisma as unknown as {
  $transaction: jest.Mock;
  syncBatch: {
    create: jest.Mock;
    update: jest.Mock;
    findUnique: jest.Mock;
    findFirst: jest.Mock;
  };
  gmailCheckpoint: {
    upsert: jest.Mock;
    update: jest.Mock;
    findUnique: jest.Mock;
  };
  batchEmailJob: {
    upsert: jest.Mock;
  };
};

describe('GmailCheckpointService', () => {
  const userId = 'user-123';
  const historyId = 'hist-456';
  const batchId = 'batch-789';

  beforeEach(() => {
    jest.clearAllMocks();

    (userService.userScopeFor as jest.Mock).mockResolvedValue({
      userId,
      legacyUserId: 'user-123',
    });

    mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => Promise<any>) =>
      fn(mockPrisma),
    );
  });

  it('should start a batch correctly', async () => {
    mockPrisma.syncBatch.create = jest.fn().mockResolvedValue({ id: batchId });
    mockPrisma.gmailCheckpoint.upsert = jest.fn().mockResolvedValue({ id: 'cp-1' });

    const result = await gmailCheckpointService.startBatch(userId, historyId);

    expect(result.batchId).toBe(batchId);
    expect(mockPrisma.syncBatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId, historyId }),
    });
    expect(mockPrisma.gmailCheckpoint.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId },
        update: expect.objectContaining({ pendingHistoryId: historyId, status: 'syncing' }),
      }),
    );
  });

  it('should mark email as processed', async () => {
    await gmailCheckpointService.markEmailProcessed(batchId, 'email-1', 'msg-1', 'completed');

    expect(mockPrisma.batchEmailJob.upsert).toHaveBeenCalled();
    expect(mockPrisma.syncBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: batchId },
        data: expect.objectContaining({ processedCount: { increment: 1 } }),
      }),
    );
  });

  it('should complete a batch and advance checkpoint if no failures', async () => {
    const mockBatch = {
      id: batchId,
      userId,
      totalEmails: 10,
      processedCount: 10,
      failedCount: 0,
      user: {
        checkpoint: {
          pendingHistoryId: 'new-hist',
        },
      },
    };
    mockPrisma.syncBatch.findUnique = jest.fn().mockResolvedValue(mockBatch);

    await gmailCheckpointService.completeBatch(batchId);

    expect(mockPrisma.gmailCheckpoint.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId },
        data: expect.objectContaining({
          currentHistoryId: 'new-hist',
          pendingHistoryId: null,
          status: 'idle',
        }),
      }),
    );
    expect(mockPrisma.syncBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: batchId },
        data: expect.objectContaining({ status: 'completed' }),
      }),
    );
  });

  it('should not advance checkpoint if there are failures', async () => {
    const mockBatch = {
      id: batchId,
      userId,
      totalEmails: 10,
      processedCount: 8,
      failedCount: 2,
      user: {
        checkpoint: {
          pendingHistoryId: 'new-hist',
        },
      },
    };
    mockPrisma.syncBatch.findUnique = jest.fn().mockResolvedValue(mockBatch);

    await gmailCheckpointService.completeBatch(batchId);

    expect(mockPrisma.gmailCheckpoint.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId },
        data: expect.objectContaining({
          status: 'failed',
        }),
      }),
    );
    const updateCall = mockPrisma.gmailCheckpoint.update.mock.calls[0][0];
    expect(updateCall.data.currentHistoryId).toBeUndefined();
  });
});
