/**
 * User account routes &  Identity.
 *
 * Endpoints:
 *   GET    /user/profile   — Fetch candidate profile.
 *   PUT    /user/profile   — Update candidate profile fields.
 *   PUT    /user/consent   — Update consent version (e.g., after TOS change).
 *   DELETE /user/account   — Full user data deletion (GDPR/CCPA erasure).
 *
 * Security:
 *   - All endpoints require valid JWT (requireAuth).
 *   - userId is always derived from the verified JWT — never from the request body.
 *   - DELETE is rate-limited to 1/hour per user.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { createUserAwareRateLimiter } from '../middleware/rate-limiter';
import { dataRetentionService } from '../services/retention/data-retention.service';
import { deletionService } from '../services/deletion.service';
import { tokenService } from '../services/auth/token.service';
import { cacheService } from '../services/cache/cache.service';
import { userService } from '../services/user';
import { dbRouter } from '../config/database';
import { logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Rate limiters
// ---------------------------------------------------------------------------

const profileLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 429, error: 'Too many requests, please try again later.' },
});
// NOTE: profileLimiter uses in-memory express-rate-limit and must run as a
// single-process deployment. deletionLimiter is backed by Redis via
// createUserAwareRateLimiter for per-user enforcement across processes.

const deletionLimiter = createUserAwareRateLimiter(60 * 60 * 1000, 1);

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const updateProfileSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  phone: z.string().max(50).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  timezone: z.string().max(100).optional().nullable(),
  preferences: z.record(z.unknown()).optional(),
  careerGoals: z.record(z.unknown()).optional().nullable(),
});

const updateConsentSchema = z.object({
  version: z.string().min(1).max(50),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * User account routes — profile, consent, and account deletion.
 *
 * All endpoints require authentication. DELETE /account is user-aware
 * rate-limited to 1 request per hour.
 */
export const userRouter = Router();

/**
 * GET /user/profile
 *
 * Returns the authenticated user's identity + candidate profile.
 *
 * Response 200:
 *   {
 *     success: true,
 *     data: {
 *       user: { id, email, region, consentVersion, consentGrantedAt, deletionStatus, createdAt },
 *       profile: { id, fullName, phone, location, timezone, preferences, careerGoals }
 *     }
 *   }
 */
userRouter.get(
  '/profile',
  profileLimiter,
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user!.id;
    try {
      await userService.getOrCreateUser(userId);
      const [user, profile] = await Promise.all([
        dbRouter.read().user.findUnique({
          where: { id: await userService.resolveUserId(userId) },
          select: {
            id: true,
            email: true,
            region: true,
            consentVersion: true,
            consentGrantedAt: true,
            deletionStatus: true,
            createdAt: true,
          },
        }),
        userService.getProfile(userId),
      ]);

      res.json({
        success: true,
        data: {
          user,
          profile: {
            id: profile.id,
            fullName: profile.fullName,
            phone: profile.phone,
            location: profile.location,
            timezone: profile.timezone,
            preferences: profile.preferences,
            careerGoals: profile.careerGoals,
          },
        },
      });
    } catch (error) {
      logger.error('[UserRoutes] GET profile failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      next(error);
    }
  },
);

userRouter.get(
  '/export',
  profileLimiter,
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user!.id;
    try {
      const data = await deletionService.exportUserData(userId);
      res.json({ success: true, data });
    } catch (error) {
      logger.error('[UserRoutes] GET export failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      next(error);
    }
  },
);

/**
 * PUT /user/profile
 *
 * Updates editable fields on the candidate profile.
 * Accepts a partial payload — only provided fields are written.
 *
 * Response 200: { success: true, data: { profile } }
 * Response 400: Validation error on body fields.
 */
userRouter.put(
  '/profile',
  profileLimiter,
  requireAuth,
  validateBody(updateProfileSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user!.id;
    try {
      const update = req.body as z.infer<typeof updateProfileSchema>;
      const profile = await userService.updateProfile(userId, update);

      logger.info('[UserRoutes] Profile updated', { userId });

      res.json({
        success: true,
        data: {
          profile: {
            id: profile.id,
            fullName: profile.fullName,
            phone: profile.phone,
            location: profile.location,
            timezone: profile.timezone,
            preferences: profile.preferences,
            careerGoals: profile.careerGoals,
          },
        },
      });
    } catch (error) {
      logger.error('[UserRoutes] PUT profile failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      next(error);
    }
  },
);

userRouter.put(
  '/legal-hold',
  profileLimiter,
  requireAuth,
  validateBody(z.object({ reason: z.string().min(1).max(500) })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user!.id;
    try {
      await deletionService.setLegalHold(userId, (req.body as { reason: string }).reason);
      res.json({ success: true, message: 'Legal hold applied' });
    } catch (error) {
      logger.error('[UserRoutes] PUT legal hold failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      next(error);
    }
  },
);

/**
 * PUT /user/consent
 *
 * Records that the user accepted a newer consent version.
 * Updates `consent_version` and `consent_granted_at`.
 *
 * Body: { version: "v2" }
 * Response 200: { success: true, message: "Consent updated" }
 */
userRouter.put(
  '/consent',
  profileLimiter,
  requireAuth,
  validateBody(updateConsentSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user!.id;
    try {
      const { version } = req.body as z.infer<typeof updateConsentSchema>;
      await userService.updateConsent(userId, version);

      logger.info('[UserRoutes] Consent updated', { userId, version });

      res.json({
        success: true,
        message: 'Consent updated',
      });
    } catch (error) {
      logger.error('[UserRoutes] PUT consent failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      next(error);
    }
  },
);

/**
 * DELETE /user/account
 *
 * Permanently deletes all data associated with the authenticated user.
 * This action is irreversible.
 *
 * Rate-limited to 1 request per hour per authenticated user.
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
  requireAuth,
  deletionLimiter,
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
