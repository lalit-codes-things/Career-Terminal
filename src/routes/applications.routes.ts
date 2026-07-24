import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { ApplicationStatus } from '../domain/application-status';
import { requireAuth, UnauthorizedError } from '../middleware/auth';
import { validateBody, validateQuery } from '../middleware/validate';
import { applicationTrackingService } from '../services/application-tracking/application-tracking.service';
import { recruiterService } from '../services/recruiter';

export const applicationsRouter = Router();

const listQuerySchema = z.object({
  status: z.string().optional(),
  company: z.string().optional(),
  date: z.string().optional(),
  role: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const statusPatchSchema = z.object({
  status: z.nativeEnum(ApplicationStatus),
});

applicationsRouter.get(
  '/',
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
  requireAuth,
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
  requireAuth,
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
  requireAuth,
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
  requireAuth,
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
  requireAuth,
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
