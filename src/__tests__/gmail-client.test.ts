import { GmailClient } from '../services/gmail/client/gmail-client';
import { google } from 'googleapis';

jest.mock('googleapis');

describe('GmailClient', () => {
  let client: GmailClient;

  const mockMessagesList = jest.fn();
  const mockMessagesGet = jest.fn();
  const mockThreadsGet = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    (google.auth.OAuth2 as jest.Mock).mockImplementation(() => ({
      setCredentials: jest.fn(),
    }));

    (google.gmail as jest.Mock).mockReturnValue({
      users: {
        messages: {
          list: mockMessagesList,
          get: mockMessagesGet,
          attachments: {
            get: jest.fn(),
          },
        },
        threads: {
          get: mockThreadsGet,
        },
        labels: {
          list: jest.fn(),
        },
      },
    });

    client = new GmailClient({ accessToken: 'test_token' });
  });

  describe('listMessages', () => {
    it('should return paginated message references', async () => {
      mockMessagesList.mockResolvedValue({
        data: {
          messages: [{ id: 'msg1', threadId: 'thread1' }],
          nextPageToken: 'token123',
          resultSizeEstimate: 1,
        },
      });

      const result = await client.listMessages({ query: 'is:unread', maxResults: 10 });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]?.id).toBe('msg1');
      expect(result.nextPageToken).toBe('token123');
      expect(mockMessagesList).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'is:unread',
          maxResults: 10,
        }),
      );
    });
  });

  describe('getMessage', () => {
    it('should fetch and parse a message correctly', async () => {
      mockMessagesGet.mockResolvedValue({
        data: {
          id: 'msg_123',
          threadId: 'thread_123',
          payload: {
            headers: [
              { name: 'From', value: 'sender@example.com' },
              { name: 'Subject', value: 'Test Subject' },
              { name: 'Date', value: 'Wed, 14 Jul 2026 12:00:00 +0000' },
            ],
            mimeType: 'text/plain',
            body: {
              data: Buffer.from('Hello world').toString('base64'),
            },
          },
        },
      });

      const message = await client.getMessage('msg_123');

      expect(message.id).toBe('msg_123');
      expect(message.sender).toBe('sender@example.com');
      expect(message.subject).toBe('Test Subject');
      expect(message.bodyText).toBe('Hello world');
      expect(message.hasAttachments).toBe(false);
    });
  });
});
