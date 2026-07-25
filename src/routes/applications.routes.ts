import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { ApplicationStatus } from '../domain/application-status';
import { requireAuth, UnauthorizedError } from '../middleware/auth';
import { validateBody, validateQuery, validateParams } from '../middleware/validate';
import { applicationTrackingService } from '../services/application-tracking/application-tracking.service';
import { recruiterService } from '../services/recruiter';
import { generalApiLimiter, writeLimiter } from '../middleware/rate-limiter';

export const applicationsRouter = Router();

const listQuerySchema = z.object({
  status: z.string().max(50).optional(),
  company: z.string().max(100).optional(),
  date: z.string().max(30).optional(),
  role: z.string().max(100).optional(),
  page: z.coerce.number().int().positive().max(10000).optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const statusPatchSchema = z.object({
  status: z.nativeEnum(ApplicationStatus),
});

const paramIdSchema = z.object({
  id: z.string().uuid(),
});

applicationsRouter.get(
  '/',
  generalApiLimiter,
  requireAuth,
  validateQuery(listQuerySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const filters = {
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        company: typeof req.query.company === 'string' ? req.query.company : undefined,
        date: typeof req.query.date === 'string' ? req.query.date : undefined,
        role: typeof req.query.role === 'string' ? req.query.role : undefined,
      };
      const pagination = {
        page: typeof req.query.page === 'number' ? req.query.page : undefined,
        pageSize: typeof req.query.pageSize === 'number' ? req.query.pageSize : undefined,
      };

      const applications = await applicationTrackingService.listApplications(
        userId,
        filters,
        pagination,
      );

      res.json({ success: true, data: applications });
    } catch (error) {
      next(error);
    }
  },
);

applicationsRouter.get(
  '/:id',
  generalApiLimiter,
  requireAuth,
  validateParams(paramIdSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const applicationId = typeof req.params.id === 'string' ? req.params.id : '';
      const result = await applicationTrackingService.getApplication(userId, applicationId);

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

applicationsRouter.get(
  '/:id/timeline',
  generalApiLimiter,
  requireAuth,
  validateParams(paramIdSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const applicationId = typeof req.params.id === 'string' ? req.params.id : '';
      const timeline = await applicationTrackingService.getApplicationTimeline(
        userId,
        applicationId,
        {
          page: typeof req.query.page === 'number' ? req.query.page : undefined,
          pageSize: typeof req.query.pageSize === 'number' ? req.query.pageSize : undefined,
        },
      );

      res.json({ success: true, data: timeline });
    } catch (error) {
      next(error);
    }
  },
);

applicationsRouter.get(
  '/:id/status-history',
  generalApiLimiter,
  requireAuth,
  validateParams(paramIdSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const applicationId = typeof req.params.id === 'string' ? req.params.id : '';
      const history = await applicationTrackingService.getApplicationStatusHistory(
        userId,
        applicationId,
        {
          page: typeof req.query.page === 'number' ? req.query.page : undefined,
          pageSize: typeof req.query.pageSize === 'number' ? req.query.pageSize : undefined,
        },
      );

      res.json({ success: true, data: history });
    } catch (error) {
      next(error);
    }
  },
);

applicationsRouter.get(
  '/:id/recruiter',
  generalApiLimiter,
  requireAuth,
  validateParams(paramIdSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const applicationId = typeof req.params.id === 'string' ? req.params.id : '';
      const recruiter = await recruiterService.getRecruiterByApplication(userId, applicationId);

      res.json({ success: true, data: recruiter });
    } catch (error) {
      next(error);
    }
  },
);

applicationsRouter.patch(
  '/:id/status',
  writeLimiter,
  requireAuth,
  validateParams(paramIdSchema),
  validateBody(statusPatchSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const applicationId = typeof req.params.id === 'string' ? req.params.id : '';
      const parsedStatus =
        typeof req.body.status === 'string' ? req.body.status : ApplicationStatus.APPLIED;
      const result = await applicationTrackingService.updateApplicationStatus(
        userId,
        applicationId,
        parsedStatus,
        userId,
      );

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);
