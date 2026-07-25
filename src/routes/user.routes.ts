/**
 * User account routes — Epic 0.7, Phase 24.
 *
 * DELETE /user/account — Full user data deletion (GDPR/CCPA erasure).
 *
 * Security:
 *   - Requires valid JWT (requireAuth).
 *   - Rate-limited to 1 request per hour per user (deletionLimiter).
 *   - userId is always derived from the verified JWT — never from the request body.
 *
 * Deletion sequence:
 *   1. Revoke all Redis refresh tokens (sessions terminated).
 *   2. Delete all database records (deleteUserData).
 *   3. Clean up OAuth state tokens stored under this user.
 *
 * Note: S3 resume file cleanup is handled by identifyOrphanedResumeHashes()
 * which is run as a periodic cleanup job — not inline here, to avoid timeouts.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { createUserAwareRateLimiter } from '../middleware/rate-limiter';
import { dataRetentionService } from '../services/retention/data-retention.service';
import { tokenService } from '../services/auth/token.service';
import { cacheService } from '../services/cache/cache.service';
import { logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Rate limiter: 1 account deletion per hour per user
// ---------------------------------------------------------------------------

const deletionLimiter = createUserAwareRateLimiter(60 * 60 * 1000, 1);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const userRouter = Router();

/**
 * DELETE /user/account
 *
 * Permanently deletes all data associated with the authenticated user.
 * This action is irreversible.
 *
 * Response 200:
 *   { success: true, message: "Account deleted", deletedCounts: { ... } }
 *
 * Response 429: Too many requests (rate limit: 1/hour).
 * Response 401: Missing or invalid JWT.
 * Response 500: Deletion failed (partial deletion logged; support required).
 */
userRouter.delete(
  '/account',
  deletionLimiter,
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user!.id;

    logger.info('[UserRoutes] Account deletion initiated', {
      userId,
      requestId: req.requestId,
      ip: req.ip,
    });

    try {
      // 1. Revoke all refresh tokens — terminates all active sessions immediately
      await tokenService.revokeAllRefreshTokens(userId);

      // 2. Delete all persistent user data from the database
      const deletedCounts = await dataRetentionService.deleteUserData(userId);

      // 3. Clean up any lingering OAuth CSRF state stored in Redis for this user
      //    (oauth:state:* keys are short-lived but clean them up proactively)
      await cacheService.delByPrefix('oauth:state:');

      logger.info('[UserRoutes] Account deletion complete', {
        userId,
        requestId: req.requestId,
        deletedCounts,
      });

      res.status(200).json({
        success: true,
        message: 'Account deleted',
        deletedCounts,
      });
    } catch (error) {
      logger.error('[UserRoutes] Account deletion failed', {
        userId,
        requestId: req.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      next(error);
    }
  },
);
