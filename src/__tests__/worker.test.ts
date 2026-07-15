import { GmailSyncWorker } from '../workers/gmail-sync.worker';
import { prisma } from '../config/database';
import { gmailIngestionService } from '../services/gmail/ingestion/gmail-ingestion.service';

jest.mock('../config/database', () => ({
  prisma: {
    syncJob: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    // Include $transaction if used in the worker (your worker might not use it)
    $transaction: jest.fn((callback) => callback(prisma)),
  },
}));

jest.mock('../services/gmail/ingestion/gmail-ingestion.service', () => ({
  gmailIngestionService: {
    syncInitialMailbox: jest.fn(),
    syncNewEmails: jest.fn(),
  },
}));

// Type-safe access
const mockSyncJob = {
  findFirst: prisma.syncJob.findFirst as jest.Mock,
  updateMany: prisma.syncJob.updateMany as jest.Mock,
  update: prisma.syncJob.update as jest.Mock,
};

describe('GmailSyncWorker', () => {
  let worker: GmailSyncWorker;

  beforeEach(() => {
    jest.clearAllMocks();
    worker = new GmailSyncWorker();
  });

  afterEach(() => {
    worker.stop();
  });

  it('should return false if no pending jobs are available', async () => {
    mockSyncJob.findFirst.mockResolvedValue(null);

    const ran = await worker.processNextJob();
    expect(ran).toBe(false);
  });

  it('should return false if job gets locked by another process', async () => {
    mockSyncJob.findFirst.mockResolvedValue({
      id: 'job-1',
      type: 'GMAIL_INITIAL_SYNC',
      userId: 'user-1',
      attempts: 0,
    });

    mockSyncJob.updateMany.mockResolvedValue({ count: 0 });

    const ran = await worker.processNextJob();
    expect(ran).toBe(false);
    expect(gmailIngestionService.syncInitialMailbox).not.toHaveBeenCalled();
  });

  it('should execute job successfully and mark as SUCCESS', async () => {
    mockSyncJob.findFirst.mockResolvedValue({
      id: 'job-1',
      type: 'GMAIL_INITIAL_SYNC',
      userId: 'user-1',
      attempts: 0,
    });

    mockSyncJob.updateMany.mockResolvedValue({ count: 1 });

    const ran = await worker.processNextJob();
    expect(ran).toBe(true);

    expect(gmailIngestionService.syncInitialMailbox).toHaveBeenCalledWith('user-1');

    expect(mockSyncJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'SUCCESS' }),
      })
    );
  });

  it('should exponential backoff when a job fails and attempts < MAX', async () => {
    mockSyncJob.findFirst.mockResolvedValue({
      id: 'job-1',
      type: 'GMAIL_INCREMENTAL_SYNC',
      userId: 'user-1',
      attempts: 2,
    });

    mockSyncJob.updateMany.mockResolvedValue({ count: 1 });

    (gmailIngestionService.syncNewEmails as jest.Mock).mockRejectedValue(new Error('API Down'));

    await worker.processNextJob();

    expect(mockSyncJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: 'PENDING',
          error: 'API Down',
          nextRunAt: expect.any(Date),
        }),
      })
    );
  });

  it('should mark job FAILED when max attempts are reached', async () => {
    mockSyncJob.findFirst.mockResolvedValue({
      id: 'job-1',
      type: 'GMAIL_INITIAL_SYNC',
      userId: 'user-1',
      attempts: 4,
    });

    mockSyncJob.updateMany.mockResolvedValue({ count: 1 });
    (gmailIngestionService.syncInitialMailbox as jest.Mock).mockRejectedValue(new Error('Fatal'));

    await worker.processNextJob();

    expect(mockSyncJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: 'FAILED',
          error: 'Fatal',
        }),
      })
    );
  });
});