/**
 * Gmail Integration Routes
 *
 * POST   /integrations/gmail/sync  - Trigger Gmail ingestion (initial or incremental)
 * GET    /integrations/gmail/status - Get sync status
 */
import { Request, Response, NextFunction, Router } from 'express';
import { z } from 'zod';
import { requireAuth, UnauthorizedError } from '../../middleware/auth';
import { createRateLimiter } from '../../middleware/rate-limiter';
import { prisma } from '../../config/database';
import { userOwnershipFilter } from '../../utils/user-ownership';
import { logger } from '../../lib/logger';
import { v4 as uuidv4 } from 'uuid';
import { enqueueGmailIngestion } from '../../services/gmail/gmail-ingestion-coordinator';

export const gmailRouter = Router();

// Rate limiter: 5 sync requests per minute per user
const syncLimiter = createRateLimiter(60 * 1000, 5);

// Validation schema for sync request
const syncBodySchema = z.object({
  mode: z.enum(['INITIAL_SYNC', 'INCREMENTAL_SYNC']).optional().default('INCREMENTAL_SYNC'),
});

/**
 * POST /integrations/gmail/sync
 * Triggers Gmail ingestion with idempotency guarantees.
 * Requires authentication.
 */
gmailRouter.post(
  '/sync',
  syncLimiter,
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      // Validate request body
      const { mode } = syncBodySchema.parse(req.body);

      // Get user's active Gmail connection
      const scopeFilter = userOwnershipFilter(userId);
      const connection = await prisma.userEmailConnection.findFirst({
        where: {
          ...scopeFilter,
          provider: 'GMAIL',
          status: 'ACTIVE',
        },
        select: { id: true, emailAddress: true },
      });

      if (!connection) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NO_CONNECTION',
            message: 'No active Gmail connection found',
          },
        });
      }

      // Generate idempotency key and correlation ID
      const correlationId = uuidv4();
      const timeWindow = Date.now() - (Date.now() % 3600000); // Hourly window
      const idempotencyKey = `gmail:${userId}:${connection.id}:${mode}:${timeWindow}`;

      // Enqueue ingestion with Epic 4 Prompt 7 guarantees
      await enqueueGmailIngestion({
        userId,
        connectionId: connection.id,
        mode,
        correlationId,
        idempotencyKey,
        priority: 'NORMAL',
        requestedAt: new Date(),
      });

      logger.info('[Gmail:Route] Sync triggered', {
        userId,
        connectionId: connection.id,
        mode,
        correlationId,
      });

      res.json({
        success: true,
        data: {
          correlationId,
          mode,
          status: 'QUEUED',
          message: 'Gmail ingestion has been queued for processing',
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: error.errors,
          },
        });
      }
      return next(error);
    }
  },
);

/**
 * GET /integrations/gmail/status
 * Returns the current sync status for the user's Gmail connection.
 * Requires authentication.
 */
gmailRouter.get('/status', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }

    // Get user's Gmail connection
    const scopeFilter = userOwnershipFilter(userId);
    const connection = await prisma.userEmailConnection.findFirst({
      where: {
        ...scopeFilter,
        provider: 'GMAIL',
      },
      select: {
        id: true,
        emailAddress: true,
        status: true,
        lastSyncAt: true,
      },
    });

    if (!connection) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NO_CONNECTION',
          message: 'No Gmail connection found',
        },
      });
    }

    // Get sync state
    const syncState = await prisma.gmailSyncState.findUnique({
      where: { userId },
      select: { historyId: true, lastSyncedAt: true },
    });

    // Get checkpoint state
    const checkpoint = await prisma.gmailCheckpoint.findUnique({
      where: { userId },
      select: {
        status: true,
        currentHistoryId: true,
        lastSyncAt: true,
        pendingHistoryId: true,
      },
    });

    // Get latest sync job
    const latestJob = await prisma.syncJob.findFirst({
      where: {
        userId,
        type: { in: ['GMAIL_INITIAL_SYNC', 'GMAIL_INCREMENTAL_SYNC'] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        type: true,
        status: true,
        createdAt: true,
        completedAt: true,
        error: true,
      },
    });

    res.json({
      success: true,
      data: {
        connection: {
          id: connection.id,
          emailAddress: connection.emailAddress,
          status: connection.status,
          lastSyncAt: connection.lastSyncAt,
        },
        syncState: syncState
          ? {
              historyId: syncState.historyId,
              lastSyncedAt: syncState.lastSyncedAt,
            }
          : null,
        checkpoint: checkpoint
          ? {
              status: checkpoint.status,
              currentHistoryId: checkpoint.currentHistoryId,
              pendingHistoryId: checkpoint.pendingHistoryId,
              lastSyncAt: checkpoint.lastSyncAt,
            }
          : null,
        latestJob: latestJob
          ? {
              type: latestJob.type,
              status: latestJob.status,
              createdAt: latestJob.createdAt,
              completedAt: latestJob.completedAt,
              error: latestJob.error,
            }
          : null,
      },
    });
  } catch (error) {
    return next(error);
  }
});
