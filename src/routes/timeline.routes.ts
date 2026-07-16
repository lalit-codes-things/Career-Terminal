import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { applicationTrackingService } from '../services/application-tracking/application-tracking.service';
import { ApplicationTimelineEventType } from '../services/application-timeline';

export const timelineRouter = Router();

const patchTimelineSchema = z.object({
  eventType: z.nativeEnum(ApplicationTimelineEventType).optional(),
  timestamp: z.coerce.date().optional(),
  sourceEmailId: z.string().nullable().optional(),
  metadata: z.any().optional(),
  description: z.string().nullable().optional(),
});

timelineRouter.patch(
  '/:id',
  requireAuth,
  validateBody(patchTimelineSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const eventId = typeof req.params.id === 'string' ? req.params.id : '';
      const result = await applicationTrackingService.updateTimelineEvent(eventId, {
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
