/**
 * Integration Routes for OAuth flows.
 *
 * Security model:
 *   GET /integrations/gmail/connect   — requires a valid JWT; userId is taken
 *                                       from req.user (never from a query param).
 *   GET /integrations/gmail/callback  — public (called by Google's redirect);
 *                                       userId is resolved from the CSRF state
 *                                       token that was generated during /connect.
 */
import { Request, Response, NextFunction, Router } from 'express';
import { z } from 'zod';
import { validateQuery } from '../middleware/validate';
import { requireAuth, UnauthorizedError } from '../middleware/auth';
import { createRateLimiter } from '../middleware/rate-limiter';
import { gmailOAuthService } from '../services/gmail';
import { gmailRouter } from './integrations/gmail.routes';

export const integrationsRouter = Router();

// Use the Gmail router for /integrations/gmail/* routes
integrationsRouter.use('/gmail', gmailRouter);

// Validation schemas
const callbackQuerySchema = z.object({
  code: z.string().min(1, 'code is required'),
  state: z.string().min(1, 'state is required'),
});

// Configure rate limiters:
// Connect route: 10 requests per 15 minutes per IP
const connectLimiter = createRateLimiter(15 * 60 * 1000, 10);
// Callback route: 20 requests per 15 minutes per IP
const callbackLimiter = createRateLimiter(15 * 60 * 1000, 20);

/**
 * GET /integrations/gmail/connect
 * Generates and returns the Google OAuth2 authorization URL.
 *
 * Requires authentication — userId is derived from the verified JWT, not a
 * query parameter. This prevents an attacker from linking another user's
 * account to their own Gmail inbox.
 */
integrationsRouter.get(
  '/connect',
  connectLimiter,
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }
      const authorizationUrl = await gmailOAuthService.getAuthorizationUrl(userId);
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
 *
 * This route is unauthenticated because Google redirects here with a
 * short-lived authorization code.  The userId is recovered from the CSRF
 * state token that was embedded during /connect — not from any caller-supplied
 * parameter.
 */
integrationsRouter.get(
  '/callback',
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
