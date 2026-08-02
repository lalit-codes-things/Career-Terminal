import { Router, Request, Response } from 'express';
import { CompanyIntelligenceApiService } from '../services/company-intelligence/api.service';

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
