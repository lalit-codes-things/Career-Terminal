import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { validateQuery, validateBody } from '../middleware/validate';
import { applicationTrackingService } from '../services/application-tracking/application-tracking.service';
import { JobApplicationStatus } from '../services/job-application';
import { recruiterService } from '../services/recruiter';

export const applicationsRouter = Router();

const listQuerySchema = z.object({
  status: z.string().optional(),
  company: z.string().optional(),
  date: z.string().optional(),
  role: z.string().optional(),
});

const statusPatchSchema = z.object({
  status: z.nativeEnum(JobApplicationStatus),
});

applicationsRouter.get(
  '/',
  requireAuth,
  validateQuery(listQuerySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      if (!userId) {
        throw new Error('Authentication required');
      }

      const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined;
      const companyFilter = typeof req.query.company === 'string' ? req.query.company : undefined;
      const dateFilter = typeof req.query.date === 'string' ? req.query.date : undefined;
      const roleFilter = typeof req.query.role === 'string' ? req.query.role : undefined;

      const filters = {
        status: statusFilter,
        company: companyFilter,
        date: dateFilter,
        role: roleFilter,
      };

      const applications = await applicationTrackingService.listApplications(userId, filters);

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
      const applicationId = typeof req.params.id === 'string' ? req.params.id : '';
      const result = await applicationTrackingService.getApplication(applicationId);

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
      const applicationId = typeof req.params.id === 'string' ? req.params.id : '';
      const timeline = await applicationTrackingService.getApplicationTimeline(applicationId);

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
      const applicationId = typeof req.params.id === 'string' ? req.params.id : '';
      const history = await applicationTrackingService.getApplicationStatusHistory(applicationId);

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
        throw new Error('Authentication required');
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
        throw new Error('Authentication required');
      }

      const applicationId = typeof req.params.id === 'string' ? req.params.id : '';
      const parsedStatus = typeof req.body.status === 'string' ? req.body.status : 'Applied';
      const result = await applicationTrackingService.updateApplicationStatus(applicationId, parsedStatus, userId);

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);
