import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { validateQuery } from '../middleware/validate';
import { recruiterService } from '../services/recruiter';

export const recruitersRouter = Router();

const listQuerySchema = z.object({
  company: z.string().optional(),
  name: z.string().optional(),
});

recruitersRouter.get(
  '/',
  requireAuth,
  validateQuery(listQuerySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      if (!userId) {
        throw new Error('Authentication required');
      }

      const company = typeof req.query.company === 'string' ? req.query.company : undefined;
      const name = typeof req.query.name === 'string' ? req.query.name : undefined;

      const recruiters = await recruiterService.listRecruiters(userId, { company, name });
      res.json({ success: true, data: recruiters });
    } catch (error) {
      next(error);
    }
  },
);

recruitersRouter.get(
  '/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      if (!userId) {
        throw new Error('Authentication required');
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
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      if (!userId) {
        throw new Error('Authentication required');
      }

      const recruiterId = typeof req.params.id === 'string' ? req.params.id : '';
      const insights = await recruiterService.getRecruiterInsights(userId, recruiterId);

      res.json({ success: true, data: insights });
    } catch (error) {
      next(error);
    }
  },
);
