/**
 * Health router — exposes liveness, readiness, full health, and metrics endpoints.
 */
import { Router, type Request, type Response } from 'express';
import { healthService } from './health.service';
import { getMetrics } from '../telemetry/metrics';

export const healthRouter = Router();

// ── GET /live ─────────────────────────────────────────────────────────────────
healthRouter.get('/live', (_req: Request, res: Response): void => {
  res.status(200).json(healthService.getLiveness());
});

// ── GET /ready ────────────────────────────────────────────────────────────────
healthRouter.get('/ready', async (_req: Request, res: Response): Promise<void> => {
  const report = await healthService.getReadinessReport();
  const statusCode = report.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(report);
});

// ── GET /health ───────────────────────────────────────────────────────────────
healthRouter.get('/health', async (_req: Request, res: Response): Promise<void> => {
  const report = await healthService.getHealthReport();
  const statusCode = report.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(report);
});

// ── GET /metrics ──────────────────────────────────────────────────────────────
healthRouter.get('/metrics', async (_req: Request, res: Response): Promise<void> => {
  try {
    const metricsData = await getMetrics();
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metricsData);
  } catch (err) {
    res.status(500).send('Failed to get metrics');
  }
});
