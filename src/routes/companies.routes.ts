import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, UnauthorizedError } from '../middleware/auth';
import { validateQuery } from '../middleware/validate';
import { companyService } from '../services/company';

export const companiesRouter = Router();

const listQuerySchema = z.object({
  name: z.string().optional(),
  domain: z.string().optional(),
  industry: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

companiesRouter.get(
  '/',
  requireAuth,
  validateQuery(listQuerySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const companies = await companyService.listCompanies(
        userId,
        {
          name: typeof req.query.name === 'string' ? req.query.name : undefined,
          domain: typeof req.query.domain === 'string' ? req.query.domain : undefined,
          industry: typeof req.query.industry === 'string' ? req.query.industry : undefined,
        },
        {
          page: typeof req.query.page === 'number' ? req.query.page : undefined,
          pageSize: typeof req.query.pageSize === 'number' ? req.query.pageSize : undefined,
        },
      );

      res.json({ success: true, data: companies });
    } catch (error) {
      next(error);
    }
  },
);

companiesRouter.get(
  '/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const companyId = typeof req.params.id === 'string' ? req.params.id : '';
      const company = await companyService.getCompany(userId, companyId);

      res.json({ success: true, data: company });
    } catch (error) {
      next(error);
    }
  },
);

companiesRouter.get(
  '/:id/applications',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const companyId = typeof req.params.id === 'string' ? req.params.id : '';
      const applications = await companyService.getCompanyApplications(userId, companyId, {
        page: typeof req.query.page === 'number' ? req.query.page : undefined,
        pageSize: typeof req.query.pageSize === 'number' ? req.query.pageSize : undefined,
      });

      res.json({ success: true, data: applications });
    } catch (error) {
      next(error);
    }
  },
);
