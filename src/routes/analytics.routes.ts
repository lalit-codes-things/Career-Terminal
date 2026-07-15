import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { jobAnalyticsService } from '../services/job-analytics/job-analytics.service';

export const analyticsRouter = Router();

analyticsRouter.get(
  '/jobs',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      if (!userId) {
        throw new Error('Authentication required');
      }

      const analytics = await jobAnalyticsService.getAnalytics(userId);

      res.json({ success: true, data: analytics });
    } catch (error) {
      next(error);
    }
  },
);
