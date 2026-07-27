import { gmailCheckpointService } from '../services/gmail/checkpoint.service';
import { prisma } from '../config/database';

jest.mock('../config/database', () => ({
  prisma: {
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
    $transaction: jest.fn((callback) => callback(prisma)),
  },
}));

describe('GmailCheckpointService', () => {
  const userId = 'user-123';
  const historyId = 'hist-456';
  const batchId = 'batch-789';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should start a batch correctly', async () => {
    (prisma.syncBatch.create as jest.Mock).mockResolvedValue({ id: batchId });
    (prisma.gmailCheckpoint.upsert as jest.Mock).mockResolvedValue({ id: 'cp-1' });

    const result = await gmailCheckpointService.startBatch(userId, historyId);

    expect(result.batchId).toBe(batchId);
    expect(prisma.syncBatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId, historyId }),
    });
    expect(prisma.gmailCheckpoint.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId },
        update: expect.objectContaining({ pendingHistoryId: historyId, status: 'syncing' }),
      })
    );
  });

  it('should mark email as processed', async () => {
    await gmailCheckpointService.markEmailProcessed(batchId, 'email-1', 'msg-1', 'completed');

    expect(prisma.batchEmailJob.upsert).toHaveBeenCalled();
    expect(prisma.syncBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: batchId },
        data: expect.objectContaining({ processedCount: { increment: 1 } }),
      })
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
    (prisma.syncBatch.findUnique as jest.Mock).mockResolvedValue(mockBatch);

    await gmailCheckpointService.completeBatch(batchId);

    expect(prisma.gmailCheckpoint.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId },
        data: expect.objectContaining({
          currentHistoryId: 'new-hist',
          pendingHistoryId: null,
          status: 'idle',
        }),
      })
    );
    expect(prisma.syncBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: batchId },
        data: expect.objectContaining({ status: 'completed' }),
      })
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
    (prisma.syncBatch.findUnique as jest.Mock).mockResolvedValue(mockBatch);

    await gmailCheckpointService.completeBatch(batchId);

    expect(prisma.gmailCheckpoint.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId },
        data: expect.objectContaining({
          status: 'failed',
        }),
      })
    );
    // Ensure currentHistoryId was NOT updated
    const updateCall = (prisma.gmailCheckpoint.update as jest.Mock).mock.calls[0][0];
    expect(updateCall.data.currentHistoryId).toBeUndefined();
  });
});
