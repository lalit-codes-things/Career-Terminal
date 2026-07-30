import request from 'supertest';
import express from 'express';
import { integrationsRouter } from '../routes/integrations.routes';
import { errorHandler } from '../middleware/error-handler';
import { gmailOAuthService } from '../services/gmail';
import { OAuthError } from '../errors/app-errors';

jest.mock('../services/gmail', () => ({
  gmailOAuthService: {
    getAuthorizationUrl: jest.fn(async () => 'https://auth.url'),
    handleCallback: jest.fn(),
  },
}));

const app = express();
app.use(express.json());
app.use('/integrations', integrationsRouter);
app.use(errorHandler);

// Helper — sets the x-user-id test escape-hatch (active when NODE_ENV=test)
const authedGet = (path: string, userId = 'user-123') =>
  request(app).get(path).set('x-user-id', userId);

describe('Integration Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /integrations/connect', () => {
    it('should return authorization URL for authenticated user', async () => {
      (gmailOAuthService.getAuthorizationUrl as jest.Mock).mockReturnValue('https://auth.url');

      const response = await authedGet('/integrations/connect');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.authorizationUrl).toBe('https://auth.url');
      expect(gmailOAuthService.getAuthorizationUrl).toHaveBeenCalledWith('user-123');
    });

    it('should return 401 when no authentication is provided', async () => {
      const response = await request(app).get('/integrations/connect');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject userId supplied as query param (no longer accepted)', async () => {
      const response = await request(app).get(
        '/integrations/connect?userId=attacker-supplied-id',
      );

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /integrations/callback', () => {
    it('should handle successful callback', async () => {
      (gmailOAuthService.handleCallback as jest.Mock).mockResolvedValue({
        connectionId: 'conn_1',
        emailAddress: 'test@example.com',
        provider: 'GMAIL',
      });

      const response = await request(app).get('/integrations/callback?code=abc&state=xyz');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.emailAddress).toBe('test@example.com');
    });

    it('should handle OAuthError from service', async () => {
      (gmailOAuthService.handleCallback as jest.Mock).mockRejectedValue(
        new OAuthError('Invalid state', 'INVALID_STATE'),
      );

      const response = await request(app).get('/integrations/callback?code=abc&state=xyz');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_STATE');
    });

    it('should return 400 for missing code or state', async () => {
      const response = await request(app).get(
        '/integrations/callback?code=abc',
      );

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
