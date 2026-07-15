/**
 * Integration Routes for OAuth flows.
 */
import { Request, Response, NextFunction, Router } from 'express';
import { z } from 'zod';
import { validateQuery } from '../middleware/validate';
// import { requireAuth } from '../middleware/auth'; // Disabled for simplified testing
import { createRateLimiter } from '../middleware/rate-limiter';
import { gmailOAuthService } from '../services/gmail';

// (Removed AuthenticatedRequest interface as auth is not required)

export const integrationsRouter = Router();

// Validation schemas
// No query parameters required for connect route
const connectQuerySchema = z.object({
  userId: z.string().min(1, 'userId is required'),
});

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
  validateQuery(connectQuerySchema),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.query as { userId: string };
      const authorizationUrl = gmailOAuthService.getAuthorizationUrl(userId);
      res.json({
        success: true,
        data: { authorizationUrl },
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
  async (req: Request, res: Response, next: NextFunction) => {
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
