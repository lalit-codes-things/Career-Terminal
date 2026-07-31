process.env.GOOGLE_CLIENT_ID ??= 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET ??= 'test-client-secret';
process.env.GOOGLE_REDIRECT_URI ??= 'http://localhost/callback';
// ENCRYPTION_KEY must be 64 hex chars (32 bytes) — set by jest.env.setup.js
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/testdb';

import { GmailOAuthService } from '../services/gmail/auth/gmail-oauth.service';
import { oauthStateService } from '../services/gmail/auth/oauth-state.service';
import { prisma } from '../config/database';
import { google } from 'googleapis';
import * as encryption from '../utils/encryption';
import { OAuthError, NotFoundError } from '../errors/app-errors';

// Mock dependencies
jest.mock('googleapis');
jest.mock('../config/database', () => ({
  prisma: {
    userEmailConnection: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    userIdMapping: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    candidateProfile: {
      create: jest.fn(),
      upsert: jest.fn(),
    },
    cell: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}));
jest.mock('../utils/encryption');
// Mock oauthStateService so validateAndConsume returns a Promise
jest.mock('../services/gmail/auth/oauth-state.service', () => ({
  oauthStateService: {
    generateState: jest.fn(async (userId: string) => `mock-state-${userId}`),
    validateAndConsume: jest.fn(),
    destroy: jest.fn(),
  },
}));

describe('GmailOAuthService', () => {
  let service: InstanceType<typeof GmailOAuthService>;

  // Mock OAuth2 client instance
  const mockGenerateAuthUrl = jest.fn();
  const mockGetToken = jest.fn();
  const mockSetCredentials = jest.fn();
  const mockRefreshAccessToken = jest.fn();
  const mockUserinfoGet = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup googleapis mocks
    (google.auth.OAuth2 as jest.Mock).mockImplementation(() => ({
      generateAuthUrl: mockGenerateAuthUrl,
      getToken: mockGetToken,
      setCredentials: mockSetCredentials,
      refreshAccessToken: mockRefreshAccessToken,
    }));

    (google.oauth2 as jest.Mock).mockReturnValue({
      userinfo: { get: mockUserinfoGet },
    });

    (prisma.userIdMapping.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.userIdMapping.upsert as jest.Mock).mockResolvedValue({
      externalId: 'user_1',
      userId: 'user_1',
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.user.create as jest.Mock).mockResolvedValue({ id: 'user_1' });
    (prisma.candidateProfile.create as jest.Mock).mockResolvedValue({ id: 'cp-1' });
    (prisma.candidateProfile.upsert as jest.Mock).mockResolvedValue({ id: 'cp-1' });
    (prisma.cell.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.cell.create as jest.Mock).mockResolvedValue({ id: 'cell-1', userId: 'user_1' });

    service = new GmailOAuthService();
  });

  describe('getAuthorizationUrl', () => {
    it('should generate URL with state', async () => {
      mockGenerateAuthUrl.mockReturnValue(
        'https://accounts.google.com/o/oauth2/v2/auth?state=mocked-state',
      );

      const url = await service.getAuthorizationUrl('user_123');

      expect(url).toBe('https://accounts.google.com/o/oauth2/v2/auth?state=mocked-state');
      expect(mockGenerateAuthUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          access_type: 'offline',
          prompt: 'consent',
          state: 'mock-state-user_123',
        }),
      );
    });
  });

  describe('handleCallback', () => {
    it('should complete full oauth flow successfully', async () => {
      // Mock state validation — validateAndConsume is now async
      const state = await oauthStateService.generateState('user_1');
      (oauthStateService.validateAndConsume as jest.Mock).mockResolvedValue('user_1');

      // Mock token exchange
      mockGetToken.mockResolvedValue({
        tokens: {
          access_token: 'access_mock',
          refresh_token: 'refresh_mock',
          expiry_date: Date.now() + 3600000,
          scope: 'gmail.readonly userinfo.email',
        },
      });

      // Mock profile fetch
      mockUserinfoGet.mockResolvedValue({
        data: { email: 'test@gmail.com' },
      });

      // Mock DB upsert
      (prisma.userEmailConnection.upsert as jest.Mock).mockResolvedValue({ id: 'conn_1' });
      (encryption.encryptToken as jest.Mock).mockReturnValue('encrypted_mock');

      const result = await service.handleCallback('valid_code', state);

      expect(result).toEqual({
        connectionId: 'conn_1',
        emailAddress: 'test@gmail.com',
        provider: 'GMAIL',
      });

      expect(prisma.userEmailConnection.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            legacyUserId: 'user_1',
            emailAddress: 'test@gmail.com',
          }),
        }),
      );
    });

    it('should throw OAuthError if token exchange fails', async () => {
      const state = await oauthStateService.generateState('user_1');
      (oauthStateService.validateAndConsume as jest.Mock).mockResolvedValue('user_1');
      mockGetToken.mockRejectedValue(new Error('Google API Error'));

      await expect(service.handleCallback('invalid_code', state)).rejects.toThrow(OAuthError);
    });
  });

  describe('getValidAccessToken', () => {
    it('should return token if not expired', async () => {
      (prisma.userEmailConnection.findUnique as jest.Mock).mockResolvedValue({
        id: 'conn_1',
        tokenExpiry: new Date(Date.now() + 3600000), // 1 hour in future
        status: 'ACTIVE',
        accessTokenEncrypted: 'encrypted_access',
      });
      (encryption.decryptToken as jest.Mock).mockReturnValue('decrypted_access');

      const token = await service.getValidAccessToken('conn_1');

      expect(token).toBe('decrypted_access');
      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });

    it('should trigger refresh if token is expired', async () => {
      (prisma.userEmailConnection.findUnique as jest.Mock).mockResolvedValue({
        id: 'conn_1',
        tokenExpiry: new Date(Date.now() - 1000), // 1 second in past
        status: 'ACTIVE',
        refreshTokenEncrypted: 'encrypted_refresh',
      });
      (encryption.decryptToken as jest.Mock).mockReturnValue('decrypted_refresh');

      mockRefreshAccessToken.mockResolvedValue({
        credentials: {
          access_token: 'new_access',
          expiry_date: Date.now() + 3600000,
        },
      });

      const token = await service.getValidAccessToken('conn_1');

      expect(token).toBe('new_access');
      expect(mockRefreshAccessToken).toHaveBeenCalled();
      expect(prisma.userEmailConnection.update).toHaveBeenCalled();
    });

    it('should throw NotFoundError if connection does not exist', async () => {
      (prisma.userEmailConnection.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.getValidAccessToken('missing_conn')).rejects.toThrow(NotFoundError);
    });
  });
});
