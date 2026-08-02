import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { requireAuth, UnauthorizedError } from '../middleware/auth';
import { expensiveLimiter } from '../middleware/rate-limiter';
import { analyticsService } from '../services/analytics.service';

export const analyticsRouter = Router();

async function handle<T>(
  req: Request,
  res: Response,
  next: NextFunction,
  producer: (userId: string) => Promise<T>,
): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }
    const data = await producer(userId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

analyticsRouter.get('/jobs', expensiveLimiter, requireAuth, (req, res, next) =>
  handle(req, res, next, (userId) => analyticsService.getOverallFunnel(userId)),
);

analyticsRouter.get('/resume-performance', expensiveLimiter, requireAuth, (req, res, next) =>
  handle(req, res, next, (userId) => analyticsService.getResumePerformance(userId)),
);

analyticsRouter.get('/action-performance', expensiveLimiter, requireAuth, (req, res, next) =>
  handle(req, res, next, (userId) => analyticsService.getActionPerformance(userId)),
);

analyticsRouter.get('/strategy-performance', expensiveLimiter, requireAuth, (req, res, next) =>
  handle(req, res, next, (userId) => analyticsService.getStrategyPerformance(userId)),
);

analyticsRouter.get('/timing-performance', expensiveLimiter, requireAuth, (req, res, next) =>
  handle(req, res, next, (userId) => analyticsService.getTimingPerformance(userId)),
);

analyticsRouter.get('/funnel', expensiveLimiter, requireAuth, (req, res, next) =>
  handle(req, res, next, (userId) => analyticsService.getOverallFunnel(userId)),
);

analyticsRouter.get('/benchmarks', expensiveLimiter, requireAuth, (req, res, next) =>
  handle(req, res, next, (userId) => analyticsService.getBenchmarks(userId)),
);
