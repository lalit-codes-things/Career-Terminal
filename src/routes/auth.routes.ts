/**
 * Auth routes — token issuance, rotation, and revocation.
 *
 * POST /auth/token          Issue a token pair (called after OAuth callback)
 * POST /auth/refresh        Rotate refresh token → new pair
 * POST /auth/logout         Revoke the current refresh token (single device)
 * POST /auth/logout-all     Revoke all refresh tokens for the user (all devices)
 *
 * These endpoints sit outside the standard `requireAuth` middleware because
 * they either precede authentication (token issuance) or handle an expired
 * access token (refresh). The refresh token itself is the credential here.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { tokenService } from '../services/auth/token.service';
import { userService } from '../services/user';
import { validateBody } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { requireInternalApiKey } from '../middleware/internal-api';
import { logger } from '../lib/logger';
import { createRateLimiter, authFloodLimiter } from '../middleware/rate-limiter';

// Rate limiters for auth endpoints
const tokenIssuanceLimiter = createRateLimiter(15 * 60 * 1000, 5);
const refreshLimiter = createRateLimiter(15 * 60 * 1000, 20);

export const authRouter = Router();

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const issueTokenSchema = z.object({
  /** The userId obtained after a successful OAuth callback. */
  userId: z.string().uuid(),
});

const refreshSchema = z.object({
  userId: z.string().uuid(),
  refreshToken: z.string().min(1),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

// ---------------------------------------------------------------------------
// POST /auth/token
// Issue a new access + refresh token pair.
// INTERNAL ONLY — requires x-internal-api-key header.
// Called server-side after a successful OAuth callback; never by end users.
// ---------------------------------------------------------------------------

authRouter.post(
  '/token',
  tokenIssuanceLimiter,
  requireInternalApiKey,
  validateBody(issueTokenSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.body as { userId: string };
      await userService.getOrCreateUser(userId);
      const tokenPair = await tokenService.issueTokenPair(userId);

      res.status(201).json({
        success: true,
        data: {
          accessToken: tokenPair.accessToken,
          refreshToken: tokenPair.refreshToken,
          accessTokenExpiresAt: tokenPair.accessTokenExpiresAt,
          tokenType: 'Bearer',
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /auth/refresh
// Exchange a valid refresh token for a new access + refresh token pair.
// The old refresh token is revoked immediately (rotation).
// ---------------------------------------------------------------------------

authRouter.post(
  '/refresh',
  refreshLimiter,
  validateBody(refreshSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, refreshToken } = req.body as {
        userId: string;
        refreshToken: string;
      };

      const tokenPair = await tokenService.rotateTokenPair(userId, refreshToken);

      res.json({
        success: true,
        data: {
          accessToken: tokenPair.accessToken,
          refreshToken: tokenPair.refreshToken,
          accessTokenExpiresAt: tokenPair.accessTokenExpiresAt,
          tokenType: 'Bearer',
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /auth/logout  (requires valid access token)
// Revokes the supplied refresh token — logs out this device only.
// ---------------------------------------------------------------------------

authRouter.post(
  '/logout',
  authFloodLimiter,
  requireAuth,
  validateBody(logoutSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { refreshToken } = req.body as { refreshToken: string };

      await tokenService.revokeRefreshToken(userId, refreshToken);
      logger.info('[auth] User logged out (single device)', { userId });

      res.json({ success: true, message: 'Logged out successfully' });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /auth/logout-all  (requires valid access token)
// Revokes ALL refresh tokens for this user — logs out every device.
// ---------------------------------------------------------------------------

authRouter.post(
  '/logout-all',
  authFloodLimiter,
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      await tokenService.revokeAllRefreshTokens(userId);
      logger.info('[auth] User logged out (all devices)', { userId });

      res.json({ success: true, message: 'Logged out from all devices' });
    } catch (err) {
      next(err);
    }
  },
);
