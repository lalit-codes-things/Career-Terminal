import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { requireAuth, UnauthorizedError } from '../middleware/auth';
import { jobAnalyticsService } from '../services/job-analytics/job-analytics.service';
import { expensiveLimiter } from '../middleware/rate-limiter';

export const analyticsRouter = Router();

analyticsRouter.get(
  '/jobs',
  expensiveLimiter,
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const analytics = await jobAnalyticsService.getAnalytics(userId);

      res.json({ success: true, data: analytics });
    } catch (error) {
      next(error);
    }
  },
);
