import { Router, Request, Response, NextFunction } from 'express';
import { CompanyIntelligenceApiService } from '../services/company-intelligence/api.service';
import { planner } from '../services/planner';
import { requireAuth, UnauthorizedError } from '../middleware/auth';
import { generalApiLimiter, writeLimiter } from '../middleware/rate-limiter';

export const companyIntelligenceRouter = Router();
const apiService = new CompanyIntelligenceApiService();

const withUserId = (req: Request): string => {
  const userId = req.user?.id;
  if (!userId) {
    throw new UnauthorizedError('Authentication required');
  }
  return userId;
};

const paramId = (req: Request): string => (typeof req.params.id === 'string' ? req.params.id : '');

// Lookup & Search
companyIntelligenceRouter.get('/lookup/:id', generalApiLimiter, requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    withUserId(req);
    const result = await apiService.lookup(paramId(req));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

companyIntelligenceRouter.get('/search', generalApiLimiter, requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    withUserId(req);
    const query = req.query.q as string;
    const result = await apiService.search(query, {
      page: Number(req.query.page ?? 1),
      limit: Number(req.query.limit ?? 20),
      sort: req.query.sort as string | undefined,
      filter: {
        countryCode: req.query.countryCode as string | undefined,
        jurisdictionCode: req.query.jurisdictionCode as string | undefined,
        status: req.query.status as string | undefined,
      },
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

companyIntelligenceRouter.post('/bulk-lookup', writeLimiter, requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    withUserId(req);
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : [];
    const result = await apiService.bulkLookup(ids);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

companyIntelligenceRouter.get('/metadata', generalApiLimiter, requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await apiService.getMetadata();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Sub-resources
companyIntelligenceRouter.get('/:id/identifiers', generalApiLimiter, requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    withUserId(req);
    const result = await apiService.getIdentifiers(paramId(req));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

companyIntelligenceRouter.get('/:id/relationships', generalApiLimiter, requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    withUserId(req);
    const result = await apiService.getRelationships(paramId(req));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

companyIntelligenceRouter.get('/:id/locations', generalApiLimiter, requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    withUserId(req);
    const result = await apiService.getLocations(paramId(req));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

companyIntelligenceRouter.get('/:id/classification', generalApiLimiter, requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    withUserId(req);
    const result = await apiService.getClassification(paramId(req));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

companyIntelligenceRouter.get('/:id/timeline', generalApiLimiter, requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    withUserId(req);
    const result = await apiService.getTimeline(paramId(req));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

companyIntelligenceRouter.get('/:id/health', generalApiLimiter, requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    withUserId(req);
    const result = await apiService.getHealth(paramId(req));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

companyIntelligenceRouter.get('/:id/hiring', generalApiLimiter, requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    withUserId(req);
    const result = await apiService.getHiring(paramId(req));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

companyIntelligenceRouter.get('/:id/authenticity', generalApiLimiter, requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    withUserId(req);
    const result = await apiService.getAuthenticity(paramId(req));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /:id/intelligence
 * Run AI capabilities (understand/infer/predict) against a company entity.
 * Content is sourced from the existing company health + hiring signals.
 */
companyIntelligenceRouter.post('/:id/intelligence', writeLimiter, requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = withUserId(req);
    const companyId = String(paramId(req));
    const { content, intent } = req.body as { content?: string; intent?: string };

    const [healthResult, hiringResult] = await Promise.allSettled([
      apiService.getHealth(companyId),
      apiService.getHiring(companyId),
    ]);

    const contextContent = content ??
      JSON.stringify({
        health: healthResult.status === 'fulfilled' ? healthResult.value : {},
        hiring: hiringResult.status === 'fulfilled' ? hiringResult.value : {},
      });

    const result = await planner.run({
      userId,
      entityId: companyId,
      entityType: 'company',
      content: contextContent,
      intent: (intent as 'understand' | 'infer' | 'predict' | 'recommend' | undefined) ?? 'understand',
    });

    res.json({
      success: true,
      data: {
        planId: result.planId,
        intent: result.intent,
        fields: result.results.flatMap((r) => r.fields),
        confidence: result.results.length
          ? result.results.reduce((s, r) => s + r.confidence, 0) / result.results.length
          : 0,
        latencyMs: result.totalLatencyMs,
      },
    });
  } catch (error) {
    next(error);
  }
});
