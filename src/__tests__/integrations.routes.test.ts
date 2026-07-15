import request from 'supertest';
import express from 'express';
import { integrationsRouter } from '../routes/integrations.routes';
import { errorHandler } from '../middleware/error-handler';
import { gmailOAuthService } from '../services/gmail';
import { OAuthError } from '../errors/app-errors';

jest.mock('../services/gmail', () => ({
  gmailOAuthService: {
    getAuthorizationUrl: jest.fn(),
    handleCallback: jest.fn(),
  },
}));

const app = express();
app.use(express.json());
app.use('/integrations', integrationsRouter);
app.use(errorHandler);

describe('Integration Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /integrations/gmail/connect', () => {
    it('should return authorization URL for valid userId', async () => {
      (gmailOAuthService.getAuthorizationUrl as jest.Mock).mockReturnValue('https://auth.url');

      const response = await request(app).get('/integrations/gmail/connect?userId=user_123');
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.authorizationUrl).toBe('https://auth.url');
    });

    it('should return 400 for missing userId', async () => {
      const response = await request(app).get('/integrations/gmail/connect');
      
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /integrations/gmail/callback', () => {
    it('should handle successful callback', async () => {
      (gmailOAuthService.handleCallback as jest.Mock).mockResolvedValue({
        connectionId: 'conn_1',
        emailAddress: 'test@example.com',
        provider: 'GMAIL',
      });

      const response = await request(app).get('/integrations/gmail/callback?code=abc&state=xyz');
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.emailAddress).toBe('test@example.com');
    });

    it('should handle OAuthError from service', async () => {
      (gmailOAuthService.handleCallback as jest.Mock).mockRejectedValue(
        new OAuthError('Invalid state', 'INVALID_STATE')
      );

      const response = await request(app).get('/integrations/gmail/callback?code=abc&state=xyz');
      
      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_STATE');
    });
    
    it('should return 400 for missing code or state', async () => {
      const response = await request(app).get('/integrations/gmail/callback?code=abc'); // missing state
      
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
