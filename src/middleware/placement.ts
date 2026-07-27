/**
 * Placement middleware — attaches placement context to authenticated requests.
 *
 * Runs AFTER `requireAuth` / `optionalAuth`.  For authenticated users, it
 * resolves placement (region + shardKey + tenant) via `PlacementService`
 * and attaches it to `req.placement`.  Anonymous requests receive a
 * default-route placement so downstream code can read `req.placement`
 * unconditionally.
 *
 * ── Performance ────────────────────────────────────────────────────────────
 *
 * The first request per user pays a Redis + DB cache-miss cost.  Subsequent
 * requests (up to 5 min) serve from either:
 *   - in-process TTL cache (0 ms)
 *   - Redis (single hop)
 *
 * If the placement service itself is unavailable we fall back to a
 * deterministic best-effort context so the request never fails.
 */
import { type Request, type Response, type NextFunction } from 'express';
import { placementService } from '../services/placement/placement.service';
import {
  DEFAULT_REGION,
  computeShardKey,
  type PlacementContext,
} from '../services/placement';
import { DataPlaneClient } from '../services/data-plane-client.service';
import { logger } from '../lib/logger';

declare module 'express' {
  interface Request {
    placement?: PlacementContext;
    region?: string;
    dataPlaneClient?: DataPlaneClient;
  }
}

const anonymousPlacement = (req: Request): PlacementContext => {
  const hints = {
    country: Array.isArray(req.headers['cf-ipcountry'])
      ? req.headers['cf-ipcountry'][0]
      : req.headers['cf-ipcountry'],
    acceptLanguage: Array.isArray(req.headers['accept-language'])
      ? req.headers['accept-language'][0]
      : req.headers['accept-language'],
  };
  const region = placementService.resolveRegionFromRequest(hints);
  return {
    region,
    dataResidencyRegion: region,
    shardKey: 0,
    tenantId: null,
    stale: false,
  };
};

export const placementMiddleware = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const userId = req.user?.id;

  if (!userId) {
    const context = anonymousPlacement(req);
    req.placement = context;
    req.region = context.region;
    req.dataPlaneClient = new DataPlaneClient(context.region);
    return next();
  }

  try {
    const context = await placementService.resolvePlacementContext(userId);
    req.placement = context;
    req.region = context.region;
    req.dataPlaneClient = new DataPlaneClient(context.region);
  } catch (err) {
    logger.warn('[placement] middleware fell back to defaults', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    const fallback = {
      region: DEFAULT_REGION,
      dataResidencyRegion: DEFAULT_REGION,
      shardKey: computeShardKey(userId),
      tenantId: null,
      stale: true,
    };
    req.placement = fallback;
    req.region = fallback.region;
    req.dataPlaneClient = new DataPlaneClient(fallback.region);
  }

  next();
};
