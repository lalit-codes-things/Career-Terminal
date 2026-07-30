import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { ApplicationTimelineEventType } from '@prisma/client';
import { requireAuth, UnauthorizedError } from '../middleware/auth';
import { validateBody, validateParams } from '../middleware/validate';
import { applicationTrackingService } from '../services/application-tracking/application-tracking.service';
import { writeLimiter } from '../middleware/rate-limiter';

export const timelineRouter = Router();

const patchTimelineSchema = z.object({
  eventType: z.nativeEnum(ApplicationTimelineEventType).optional(),
  timestamp: z.coerce.date().optional(),
  sourceEmailId: z.string().nullable().optional(),
  metadata: z.any().optional(),
  description: z.string().nullable().optional(),
});

const paramIdSchema = z.object({
  id: z.string().uuid(),
});

timelineRouter.patch(
  '/:id',
  writeLimiter,
  requireAuth,
  validateParams(paramIdSchema),
  validateBody(patchTimelineSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const eventId = typeof req.params.id === 'string' ? req.params.id : '';
      const result = await applicationTrackingService.updateTimelineEvent(userId, eventId, {
        eventType: req.body.eventType,
        timestamp: req.body.timestamp,
        sourceEmailId: req.body.sourceEmailId,
        metadata: req.body.metadata,
        description: req.body.description,
      });

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);
