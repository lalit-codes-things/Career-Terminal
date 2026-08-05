import { Router, Request, Response } from 'express';
import { CompanyIntelligenceApiService } from '../services/company-intelligence/api.service';
import { planner } from '../services/planner';

export const companyIntelligenceRouter = Router();
const apiService = new CompanyIntelligenceApiService();

// Middleware placeholder for rate limiting and auth
const requireAuth = (_req: Request, _res: Response, next: Function) => next();
const rateLimiter = (_req: Request, _res: Response, next: Function) => next();

companyIntelligenceRouter.use(requireAuth);
companyIntelligenceRouter.use(rateLimiter);

// Lookup & Search
companyIntelligenceRouter.get('/lookup/:id', async (req, res) => {
  const result = await apiService.lookup(req.params.id);
  res.json(result);
});

companyIntelligenceRouter.get('/search', async (req, res) => {
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
});

companyIntelligenceRouter.post('/bulk-lookup', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : [];
  const result = await apiService.bulkLookup(ids);
  res.json(result);
});

companyIntelligenceRouter.get('/metadata', async (_req, res) => {
  const result = await apiService.getMetadata();
  res.json(result);
});

// Sub-resources
companyIntelligenceRouter.get('/:id/identifiers', async (req, res) => {
  const result = await apiService.getIdentifiers(req.params.id);
  res.json(result);
});

companyIntelligenceRouter.get('/:id/relationships', async (req, res) => {
  const result = await apiService.getRelationships(req.params.id);
  res.json(result);
});

companyIntelligenceRouter.get('/:id/locations', async (req, res) => {
  const result = await apiService.getLocations(req.params.id);
  res.json(result);
});

companyIntelligenceRouter.get('/:id/classification', async (req, res) => {
  const result = await apiService.getClassification(req.params.id);
  res.json(result);
});

companyIntelligenceRouter.get('/:id/timeline', async (req, res) => {
  const result = await apiService.getTimeline(req.params.id);
  res.json(result);
});

companyIntelligenceRouter.get('/:id/health', async (req, res) => {
  const result = await apiService.getHealth(req.params.id);
  res.json(result);
});

companyIntelligenceRouter.get('/:id/hiring', async (req, res) => {
  const result = await apiService.getHiring(req.params.id);
  res.json(result);
});

companyIntelligenceRouter.get('/:id/authenticity', async (req, res) => {
  const result = await apiService.getAuthenticity(req.params.id);
  res.json(result);
});

/**
 * POST /:id/intelligence
 * Run AI capabilities (understand/infer/predict) against a company entity.
 * Content is sourced from the existing company health + hiring signals.
 */
companyIntelligenceRouter.post('/:id/intelligence', async (req: Request, res) => {
  const userId = (req as Request & { user?: { id: string } }).user?.id ?? 'system';
  const companyId = req.params.id;
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
});
