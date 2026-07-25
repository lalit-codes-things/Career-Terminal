import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { requireAuth, UnauthorizedError } from '../middleware/auth';
import { validateQuery } from '../middleware/validate';
import { dashboardService } from '../services/dashboard';
import { z } from 'zod';
import { generalApiLimiter } from '../middleware/rate-limiter';

const pagingSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

export const dashboardRouter = Router();

dashboardRouter.get('/', generalApiLimiter, requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }

    const data = await dashboardService.getDashboard(userId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get(
  '/activity',
  generalApiLimiter,
  requireAuth,
  validateQuery(pagingSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const activity = await dashboardService.getActivity(userId, {
        page: typeof req.query.page === 'number' ? req.query.page : undefined,
        pageSize: typeof req.query.pageSize === 'number' ? req.query.pageSize : undefined,
      });
      res.json({ success: true, data: activity });
    } catch (error) {
      next(error);
    }
  },
);

dashboardRouter.get(
  '/upcoming',
  generalApiLimiter,
  requireAuth,
  validateQuery(pagingSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const interviews = await dashboardService.getUpcomingInterviews(userId, {
        page: typeof req.query.page === 'number' ? req.query.page : undefined,
        pageSize: typeof req.query.pageSize === 'number' ? req.query.pageSize : undefined,
      });
      res.json({ success: true, data: interviews });
    } catch (error) {
      next(error);
    }
  },
);
