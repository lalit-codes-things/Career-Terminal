/**
 * Integration Routes for OAuth flows.
 */
import { Router } from 'express';
import { z } from 'zod';
import { validateQuery } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { createRateLimiter } from '../middleware/rate-limiter';
import { gmailOAuthService } from '../services/gmail';

export const integrationsRouter = Router();

// Validation schemas
// userId is removed from query schema to prevent IDOR; extracted securely via auth middleware instead.
const connectQuerySchema = z.object({});

const callbackQuerySchema = z.object({
  code: z.string().min(1, 'code is required'),
  state: z.string().min(1, 'state is required'),
});

// Configure rate limiters:
// Connect route: 10 requests per 15 minutes
const connectLimiter = createRateLimiter(15 * 60 * 1000, 10);
// Callback route: 20 requests per 15 minutes
const callbackLimiter = createRateLimiter(15 * 60 * 1000, 20);

/**
 * GET /integrations/gmail/connect
 * Generates and returns the Google OAuth2 authorization URL.
 */
integrationsRouter.get(
  '/gmail/connect',
  connectLimiter,
  requireAuth,
  validateQuery(connectQuerySchema),
  (req, res, next) => {
    try {
      // Safely extract userId from the authenticated session, NOT the untrusted query
      const userId = (req as any).user.id;
      const authorizationUrl = gmailOAuthService.getAuthorizationUrl(userId);

      res.json({
        success: true,
        data: {
          authorizationUrl,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /integrations/gmail/callback
 * Handles the OAuth callback from Google.
 */
integrationsRouter.get(
  '/gmail/callback',
  callbackLimiter,
  validateQuery(callbackQuerySchema),
  async (req, res, next) => {
    try {
      const { code, state } = req.query as { code: string; state: string };
      
      const result = await gmailOAuthService.handleCallback(code, state);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },
);
