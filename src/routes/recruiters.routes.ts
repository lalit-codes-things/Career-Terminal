import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, UnauthorizedError } from '../middleware/auth';
import { validateQuery, validateParams, validateBody } from '../middleware/validate';
import { recruiterService } from '../services/recruiter';
import { generalApiLimiter, expensiveLimiter } from '../middleware/rate-limiter';
import { planner, type PlannerIntent } from '../services/planner';

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

const intelligenceBodySchema = z.object({
  content: z.string().min(1).max(50_000).optional(),
  intent: z.enum(['understand', 'extract', 'infer', 'predict', 'recommend', 'verify', 'full']).optional(),
  context: z.record(z.string()).optional(),
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
      if (!userId) throw new UnauthorizedError('Authentication required');

      const recruiterId = typeof req.params.id === 'string' ? req.params.id : '';

      // Run the planner with 'infer' intent — produces RecruiterFact + Prediction rows
      // in addition to the existing CRM-style insight response.
      const [insight, planResult] = await Promise.allSettled([
        recruiterService.getRecruiterInsights(userId, recruiterId),
        planner.run({
          userId,
          entityId: recruiterId,
          entityType: 'recruiter',
          content: `recruiter_id:${recruiterId}`,
          intent: 'infer',
        }),
      ]);

      const insightData = insight.status === 'fulfilled' ? insight.value : null;
      const planData = planResult.status === 'fulfilled' ? planResult.value : null;

      res.json({
        success: true,
        data: {
          ...insightData,
          intelligence: planData
            ? {
                planId: planData.planId,
                intent: planData.intent,
                capabilitiesRun: planData.capabilitiesRun,
                fields: planData.results.flatMap((r) => r.fields),
                confidence: planData.results.length
                  ? planData.results.reduce((s, r) => s + r.confidence, 0) / planData.results.length
                  : null,
                latencyMs: planData.totalLatencyMs,
              }
            : null,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /:id/intelligence
 *
 * AI capability endpoint — callers specify intent and content.
 * The planner dispatches to the right capability chain and returns
 * structured fields with confidence scores.
 */
recruitersRouter.post(
  '/:id/intelligence',
  expensiveLimiter,
  requireAuth,
  validateParams(paramIdSchema),
  validateBody(intelligenceBodySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) throw new UnauthorizedError('Authentication required');

      const recruiterId = typeof req.params.id === 'string' ? req.params.id : '';
      const { content, intent, context } = req.body as z.infer<typeof intelligenceBodySchema>;

      const result = await planner.run({
        userId,
        entityId: recruiterId,
        entityType: 'recruiter',
        content: content ?? `recruiter_id:${recruiterId}`,
        intent: intent as PlannerIntent | undefined,
        context,
      });

      res.json({
        success: true,
        data: {
          planId: result.planId,
          intent: result.intent,
          capabilitiesRun: result.capabilitiesRun,
          results: result.results.map((r) => ({
            capability: r.capability,
            fields: r.fields,
            confidence: r.confidence,
            confidenceBand: r.confidenceBand,
            recruiterFactIds: r.recruiterFactIds,
            latencyMs: r.latencyMs,
          })),
          totalLatencyMs: result.totalLatencyMs,
          totalCostUsd: result.totalCostUsd,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
