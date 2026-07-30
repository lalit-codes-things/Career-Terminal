import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, UnauthorizedError } from '../middleware/auth';
import { validateQuery, validateParams } from '../middleware/validate';
import { recruiterService } from '../services/recruiter';
import { generalApiLimiter, expensiveLimiter } from '../middleware/rate-limiter';

export const recruitersRouter = Router();

const listQuerySchema = z.object({
  company: z.string().max(100).optional(),
  name: z.string().max(100).optional(),
  page: z.coerce.number().int().positive().max(10000).optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const paramIdSchema = z.object({
  id: z.string().uuid(),
});

recruitersRouter.get(
  '/',
  generalApiLimiter,
  requireAuth,
  validateQuery(listQuerySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const recruiters = await recruiterService.listRecruiters(
        userId,
        {
          company: typeof req.query.company === 'string' ? req.query.company : undefined,
          name: typeof req.query.name === 'string' ? req.query.name : undefined,
        },
        {
          page: typeof req.query.page === 'number' ? req.query.page : undefined,
          pageSize: typeof req.query.pageSize === 'number' ? req.query.pageSize : undefined,
        },
      );
      res.json({ success: true, data: recruiters });
    } catch (error) {
      next(error);
    }
  },
);

recruitersRouter.get(
  '/:id',
  generalApiLimiter,
  requireAuth,
  validateParams(paramIdSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const recruiterId = typeof req.params.id === 'string' ? req.params.id : '';
      const recruiter = await recruiterService.getRecruiter(userId, recruiterId);

      res.json({ success: true, data: recruiter });
    } catch (error) {
      next(error);
    }
  },
);

recruitersRouter.get(
  '/:id/insights',
  expensiveLimiter,
  requireAuth,
  validateParams(paramIdSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const recruiterId = typeof req.params.id === 'string' ? req.params.id : '';
      const insights = await recruiterService.getRecruiterInsights(userId, recruiterId);

      res.json({ success: true, data: insights });
    } catch (error) {
      next(error);
    }
  },
);
