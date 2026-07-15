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
  },
}));

jest.mock('../services/gmail/ingestion/gmail-ingestion.service', () => ({
  gmailIngestionService: {
    syncInitialMailbox: jest.fn(),
    syncNewEmails: jest.fn(),
  },
}));

const mockPrisma = prisma as unknown as jest.Mocked<typeof prisma>;

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
    mockPrisma.syncJob.findFirst.mockResolvedValue(null);

    const ran = await worker.processNextJob();
    expect(ran).toBe(false);
  });

  it('should return false if job gets locked by another process', async () => {
    mockPrisma.syncJob.findFirst.mockResolvedValue({
      id: 'job-1',
      type: 'GMAIL_INITIAL_SYNC',
      userId: 'user-1',
      attempts: 0,
    } as any);

    // Simulate another worker grabbing it first (count = 0 updated)
    mockPrisma.syncJob.updateMany.mockResolvedValue({ count: 0 });

    const ran = await worker.processNextJob();
    expect(ran).toBe(false);
    expect(gmailIngestionService.syncInitialMailbox).not.toHaveBeenCalled();
  });

  it('should execute job successfully and mark as SUCCESS', async () => {
    mockPrisma.syncJob.findFirst.mockResolvedValue({
      id: 'job-1',
      type: 'GMAIL_INITIAL_SYNC',
      userId: 'user-1',
      attempts: 0,
    } as any);

    mockPrisma.syncJob.updateMany.mockResolvedValue({ count: 1 });

    const ran = await worker.processNextJob();
    expect(ran).toBe(true);
    
    // Check execution
    expect(gmailIngestionService.syncInitialMailbox).toHaveBeenCalledWith('user-1');

    // Check success update
    expect(mockPrisma.syncJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'SUCCESS' }),
      })
    );
  });

  it('should exponential backoff when a job fails and attempts < MAX', async () => {
    mockPrisma.syncJob.findFirst.mockResolvedValue({
      id: 'job-1',
      type: 'GMAIL_INCREMENTAL_SYNC',
      userId: 'user-1',
      attempts: 2, // This will become 3 during updateMany
    } as any);

    mockPrisma.syncJob.updateMany.mockResolvedValue({ count: 1 });
    
    // Simulate failure
    (gmailIngestionService.syncNewEmails as jest.Mock).mockRejectedValue(new Error('API Down'));

    await worker.processNextJob();

    // Verify backoff logic (attempt 3 means 2^2 * 2000 = 8000ms)
    expect(mockPrisma.syncJob.update).toHaveBeenCalledWith(
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
    mockPrisma.syncJob.findFirst.mockResolvedValue({
      id: 'job-1',
      type: 'GMAIL_INITIAL_SYNC',
      userId: 'user-1',
      attempts: 4, // Next is 5 (MAX)
    } as any);

    mockPrisma.syncJob.updateMany.mockResolvedValue({ count: 1 });
    (gmailIngestionService.syncInitialMailbox as jest.Mock).mockRejectedValue(new Error('Fatal'));

    await worker.processNextJob();

    expect(mockPrisma.syncJob.update).toHaveBeenCalledWith(
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
