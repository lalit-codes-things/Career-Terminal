import { GmailIngestionService } from '../services/gmail/ingestion/gmail-ingestion.service';
import { GmailClient } from '../services/gmail/client/gmail-client';
import { prisma } from '../config/database';
import { gmailOAuthService } from '../services/gmail/auth/gmail-oauth.service';
import { GmailApiError } from '../errors/app-errors';

// Mock dependencies
jest.mock('../services/gmail/client/gmail-client');

jest.mock('uuid', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const actual = require('uuid');
  const mockV4 = () => 'mock-correlation-id';
  return { ...actual, v4: mockV4 };
});

jest.mock('../services/gmail/durable-checkpoint.service', () => ({
  durableCheckpointService: {
    initializeSyncOp: jest.fn(),
    advanceCheckpoint: jest.fn(),
    completeSyncOp: jest.fn(),
    failSyncOp: jest.fn(),
    determineResumeStrategy: jest.fn(),
    loadDurableState: jest.fn(),
    trackEmailJob: jest.fn(),
    lockCheckpoint: jest.fn(),
    compareAndSetVersion: jest.fn(),
    finalizeBatchEmails: jest.fn(),
  },
}));
jest.mock('../config/database', () => ({
  prisma: {
    $transaction: jest.fn((fn) => fn(prisma)),
    userEmailConnection: { findFirst: jest.fn(), update: jest.fn() },
    emailMessage: { findUnique: jest.fn(), upsert: jest.fn() },
    gmailSyncState: { findUnique: jest.fn(), upsert: jest.fn() },
    userIdMapping: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    gmailCheckpoint: { upsert: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    syncBatch: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  },
}));
jest.mock('../services/gmail/auth/gmail-oauth.service', () => ({
  gmailOAuthService: { getValidAccessToken: jest.fn() },
}));

const mockClient = GmailClient.prototype as unknown as {
  getProfile: jest.Mock;
  listMessages: jest.Mock;
  getMessage: jest.Mock;
  getHistory: jest.Mock;
};
const mockPrisma = prisma as unknown as {
  $transaction: jest.Mock;
  userEmailConnection: {
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  emailMessage: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
  gmailSyncState: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
  userIdMapping: {
    findUnique: jest.Mock;
  };
  user: {
    findUnique: jest.Mock;
  };
  gmailCheckpoint: {
    upsert: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  syncBatch: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
};

describe('GmailIngestionService', () => {
  let service: GmailIngestionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GmailIngestionService();

    // Default mock setup
    mockPrisma.userEmailConnection.findFirst.mockResolvedValue({
      id: 'conn-1',
      userId: 'user-1',
      provider: 'GMAIL',
      status: 'ACTIVE',
    } as any);

    (gmailOAuthService.getValidAccessToken as jest.Mock).mockResolvedValue('fake-token');
    mockPrisma.emailMessage.findUnique.mockResolvedValue(null);
    mockPrisma.userIdMapping.findUnique.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', deletionStatus: 'active' });
    mockPrisma.gmailCheckpoint.upsert.mockResolvedValue(null);
    mockPrisma.gmailCheckpoint.findUnique.mockResolvedValue(null);
    mockPrisma.gmailCheckpoint.update.mockResolvedValue(null);
    mockPrisma.syncBatch.findFirst.mockResolvedValue(null);
    mockPrisma.syncBatch.create.mockResolvedValue({ id: 'batch-1', userId: 'user-1' });
    mockPrisma.syncBatch.update.mockResolvedValue({ id: 'batch-1', userId: 'user-1' });
    mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma));

    // Mock DurableCheckpointService
    const mockCheckpoint = jest.requireMock('../services/gmail/durable-checkpoint.service');
    mockCheckpoint.durableCheckpointService.initializeSyncOp.mockResolvedValue({
      syncOpId: 'op-1',
      batchId: 'batch-1',
    });
    mockCheckpoint.durableCheckpointService.advanceCheckpoint.mockResolvedValue(undefined);
    mockCheckpoint.durableCheckpointService.completeSyncOp.mockResolvedValue(undefined);
    mockCheckpoint.durableCheckpointService.failSyncOp.mockResolvedValue(undefined);
    mockCheckpoint.durableCheckpointService.determineResumeStrategy.mockResolvedValue({
      canResume: false,
      action: 'start_fresh',
      state: { checkpoint: null, pendingBatch: null, syncOpId: null },
    });
    mockCheckpoint.durableCheckpointService.trackEmailJob.mockResolvedValue(undefined);
    mockCheckpoint.durableCheckpointService.loadDurableState.mockResolvedValue({
      checkpoint: null,
      pendingBatch: null,
      syncOpId: null,
    });
  });

  describe('syncInitialMailbox', () => {
    it('should fetch profile, paginate through messages, and save state', async () => {
      // Mock Profile
      mockClient.getProfile.mockResolvedValue({
        emailAddress: 'test@test.com',
        messagesTotal: 2,
        threadsTotal: 1,
        historyId: 'start-hist-1',
      });

      // Mock List (2 pages)
      mockClient.listMessages
        .mockResolvedValueOnce({
          messages: [{ id: 'msg-1', threadId: 'thread-1' }],
          nextPageToken: 'page-2',
          resultSizeEstimate: 2,
        })
        .mockResolvedValueOnce({
          messages: [{ id: 'msg-2', threadId: 'thread-1' }],
          resultSizeEstimate: 2,
        });

      // Mock getMessage for fetcher
      mockClient.getMessage.mockResolvedValue({
        id: 'mock-id',
        threadId: 'thread-1',
        labelIds: ['INBOX'],
        sender: 'sender@test.com',
        recipients: { to: [], cc: [], bcc: [] },
        subject: 'Test Subject',
        hasAttachments: false,
        receivedAt: new Date(),
        headers: {},
      } as any);

      await service.syncInitialMailbox('user-1');

      // Verify list loops (pagination)
      expect(mockClient.listMessages).toHaveBeenCalledTimes(2);

      // Verify upserts (duplicate prevention)
      expect(mockPrisma.emailMessage.upsert).toHaveBeenCalledTimes(2);

      // Verify state was saved
      expect(mockPrisma.gmailSyncState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ historyId: 'start-hist-1' }),
        }),
      );
    });
  });

  describe('syncNewEmails (Incremental)', () => {
    it('should use history API if state exists', async () => {
      // Mock existing state
      mockPrisma.gmailSyncState.findUnique.mockResolvedValue({
        historyId: 'old-hist-1',
      } as any);

      // Mock history fetch
      mockClient.getHistory.mockResolvedValue({
        historyId: 'new-hist-2',
        messagesAdded: [{ message: { id: 'msg-new', threadId: 't-1' } }],
      });

      // Mock getMessage
      mockClient.getMessage.mockResolvedValue({
        id: 'msg-new',
        threadId: 't-1',
        labelIds: [],
        sender: 'sender',
        recipients: { to: [], cc: [], bcc: [] },
        subject: 'Subj',
        hasAttachments: false,
        receivedAt: new Date(),
        headers: {},
      } as any);

      await service.syncNewEmails('user-1');

      expect(mockClient.getHistory).toHaveBeenCalledWith({
        startHistoryId: 'old-hist-1',
        pageToken: undefined,
      });
      expect(mockPrisma.emailMessage.upsert).toHaveBeenCalledTimes(1);
      expect(mockPrisma.gmailSyncState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ historyId: 'new-hist-2' }),
        }),
      );
    });

    it('should fall back to initial sync if history API returns 404', async () => {
      // Mock existing state
      mockPrisma.gmailSyncState.findUnique.mockResolvedValue({
        historyId: 'expired-hist',
      } as any);

      // Force 404
      mockClient.getHistory.mockRejectedValue(new GmailApiError('Not found', 404));

      // Spy on initial sync
      const initialSyncSpy = jest.spyOn(service, 'syncInitialMailbox').mockResolvedValue(undefined);

      await service.syncNewEmails('user-1');

      // Verify fallback triggered
      expect(initialSyncSpy).toHaveBeenCalledWith('user-1');
    });
  });
});
