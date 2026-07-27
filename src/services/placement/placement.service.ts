/**
 * PlacementService — resolves user → region / shard / tenant metadata.
 *
 * This service is the single source of truth for *where* a user's data
 * lives.  Downstream systems (database router, object-storage prefixes,
 * queue sharding, cache namespacing) must read placement from this service
 * and not re-derive it independently.
 *
 * ── Design notes ────────────────────────────────────────────────────────────
 *
 * Metadata is read extremely often (every authenticated request, every
 * worker job).  Therefore we layer caching:
 *
 *   1. in-process TTL cache (1 min)            — 0 IO, 0 serialization
 *   2. Redis-backed CacheService (5 min)       — single cross-process hop
 *   3. Database read (uncached, users table)   — last-resort source of truth
 *
 * Shard keys are *deterministic functions of userId*, so the service can
 * even recover them without a DB round-trip as long as the user ID is
 * trusted.  Region *cannot* be derived offline, so we always fall back to
 * the DB (or default) for those.
 *
 * ── External usage ──────────────────────────────────────────────────────────
 *
 *   // request-scoped placement middleware calls this once per request
 *   const ctx = await placementService.resolvePlacementContext(userId);
 *
 *   // worker resolving the target shard for a job
 *   const target = placementService.resolveDataPlane(userId);
 */
import type { ICacheService } from '../cache/cache.service';
import { cacheService } from '../cache/cache.service';
import { prisma } from '../../config/database';
import {
  DEFAULT_REGION,
  SHARD_COUNT,
  type DataPlaneTarget,
  type PlacementContext,
  type SupportedRegion,
  isSupportedRegion,
  normalizeRegion,
} from './placement.types';
import { logger } from '../../lib/logger';
import { ValidationError } from '../../errors/app-errors';

const CACHE_KEY_PREFIX = 'placement:v1';
const IN_PROCESS_TTL_MS = 60_000; // 1 min

type InProcessEntry = {
  ctx: PlacementContext;
  expiresAt: number;
};

/**
 * Compute a deterministic, uniformly-distributed shard key for a given
 * userId.  Algorithm:
 *
 *   1. Treat the user ID string as a UTF-8 byte sequence.
 *   2. Walk *every* character of the string and accumulate a 32-bit value
 *      with the classic FNV-1a mixing step:
 *          hash = ((hash ^ charCode) * 16777619) >>> 0
 *      This avalanches even small input differences into all 32 bits, which
 *      is critical because many UUIDs only differ in the trailing bytes.
 *   3. Take the unsigned hash modulo SHARD_COUNT.
 *
 * This is intentionally NOT a cryptographic hash.  We need speed + stable,
 * even distribution.  Changing this function would re-shard every user,
 * which is a breaking change.
 */
export function computeShardKey(userId: string): number {
  if (!userId) return 0;

  const FNV_OFFSET_BASIS = 2166136261 >>> 0;
  const FNV_PRIME = 16777619;

  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    // Cap at 32-bit unsigned to avoid V8 tagged-integer overflow
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }

  const key = hash % SHARD_COUNT;
  return Number.isFinite(key) ? key : 0;
}

const regionFromAcceptLanguage = (raw: string | undefined): SupportedRegion | null => {
  if (!raw) return null;
  const first = raw.split(',')[0]?.toLowerCase() ?? '';
  const tag = first.split(';')[0]?.trim();
  if (!tag) return null;

  if (tag.startsWith('en-us') || tag.startsWith('es-us')) return 'us-east-1';
  if (tag.startsWith('en-gb') || tag.startsWith('en-ie')) return 'eu-west-1';
  if (tag.startsWith('de') || tag.startsWith('fr') || tag.startsWith('nl') || tag.startsWith('pl')) {
    return 'eu-central-1';
  }
  if (tag.startsWith('en-au') || tag.startsWith('en-nz') || tag.startsWith('en-sg') || tag.startsWith('id')) {
    return 'ap-southeast-1';
  }
  if (tag.startsWith('ja')) return 'ap-northeast-1';
  return null;
};

const regionFromCfCountry = (raw: string | undefined): SupportedRegion | null => {
  if (!raw) return null;
  const code = raw.toUpperCase();
  if (code === 'US') return 'us-east-1';
  if (code === 'CA') return 'us-west-2';
  if (code === 'GB' || code === 'IE') return 'eu-west-1';
  if (code === 'DE' || code === 'FR' || code === 'NL' || code === 'PL' || code === 'BE') {
    return 'eu-central-1';
  }
  if (code === 'SG' || code === 'AU' || code === 'ID' || code === 'MY') {
    return 'ap-southeast-1';
  }
  if (code === 'JP') return 'ap-northeast-1';
  return null;
};

export type RegionResolutionHints = {
  country?: string;
  acceptLanguage?: string;
  suggestedRegion?: string;
};

/**
 * Stateless region resolver.  Usable without a PlacementService instance
 * (e.g. from UserService.getOrCreateUser) so we don't trigger cache-layer
 * work during onboarding inserts.
 */
export function resolveRegionFromHints(hints: RegionResolutionHints = {}): SupportedRegion {
  if (hints.suggestedRegion && isSupportedRegion(hints.suggestedRegion)) {
    return hints.suggestedRegion;
  }
  return (
    regionFromCfCountry(hints.country) ??
    regionFromAcceptLanguage(hints.acceptLanguage) ??
    DEFAULT_REGION
  );
}

export class PlacementService {
  private readonly inProcess: Map<string, InProcessEntry> = new Map();

  constructor(private readonly cache: ICacheService = cacheService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Resolve the full placement context for a user, using layered caching.
   *
   * If the user row does not exist yet (possible during the onboarding
   * handshake), we return a deterministic best-effort context and mark it
   * `stale: true` so the caller can re-resolve after the user record is
   * persisted.
   */
  async resolvePlacementContext(userId: string): Promise<PlacementContext> {
    if (!userId) {
      throw new ValidationError('userId is required to resolve placement context');
    }

    const cached = this.readInProcess(userId);
    if (cached) return cached;

    const cacheKey = this.cacheKey(userId);
    try {
      const redisCached = await this.cache.get<PlacementContext>(cacheKey);
      if (redisCached) {
        this.writeInProcess(userId, redisCached);
        return redisCached;
      }
    } catch (err) {
      logger.warn('[placement] redis cache read failed, falling back to DB', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const fromDb = await this.readFromDatabase(userId);
    const ctx: PlacementContext = fromDb ?? this.computeFallbackContext(userId, true);

    try {
      await this.cache.set(cacheKey, ctx, 300);
    } catch (err) {
      logger.warn('[placement] redis cache write failed', { userId });
    }
    this.writeInProcess(userId, ctx);

    return ctx;
  }

  /** Home region (convenience accessor). */
  async getHomeRegion(userId: string): Promise<SupportedRegion> {
    const ctx = await this.resolvePlacementContext(userId);
    return ctx.region;
  }

  /**
   * Get (or compute) the shard key.  Because keys are deterministic, we can
   * return them without a DB round-trip, which is helpful for workers that
   * have a userId but not yet a user row.
   */
  async getShardKey(userId: string): Promise<number> {
    const cached = this.readInProcess(userId);
    if (cached) return cached.shardKey;

    return computeShardKey(userId);
  }

  /**
   * Synchronously compute the routing target.  Region is read from the
   * in-process cache (or defaulted), shardKey is always recomputed.
   *
   * Intended for hot paths where an await would introduce measurable
   * latency (e.g. partitioning outbound queue jobs).
   */
  resolveDataPlane(userId: string): DataPlaneTarget {
    const region = this.readInProcess(userId)?.region ?? DEFAULT_REGION;
    const dataResidencyRegion =
      this.readInProcess(userId)?.dataResidencyRegion ?? region;
    const shardKey = computeShardKey(userId);

    const cellId = `${region}-shard-${String(shardKey).padStart(3, '0')}`;
    return { region, shardKey, dataResidencyRegion, cellId };
  }

  /**
   * Update a user's home region (user-initiated, rare).  Propagates to
   * `data_residency_region` only when the current residency matches the old
   * region — otherwise the legal residency override is preserved.
   *
   * Invalidates caches for the user so subsequent reads pick up the change.
   */
  async setUserRegion(userId: string, nextRegion: string): Promise<void> {
    if (!userId) throw new ValidationError('userId is required');
    if (!isSupportedRegion(nextRegion)) {
      throw new ValidationError(
        `Unsupported region: ${nextRegion}. Allowed: ${Array.from(DEFAULT_REGION).join(', ')}`,
      );
    }

    const current = await this.readFromDatabase(userId);
    const residencyMigrates =
      current?.dataResidencyRegion &&
      current.dataResidencyRegion === (current.region ?? DEFAULT_REGION);

    await prisma.user.update({
      where: { id: userId },
      data: {
        region: nextRegion,
        dataResidencyRegion: residencyMigrates ? nextRegion : undefined,
      },
      select: { id: true },
    });

    await this.invalidateCache(userId);
  }

  /**
   * Best-effort region resolution from request-level metadata.  The result
   * should be stored permanently on the user row so it doesn't shift.
   */
  resolveRegionFromRequest(hints: RegionResolutionHints = {}): SupportedRegion {
    return resolveRegionFromHints(hints);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ─────────────────────────────────────────────────────────────────────────

  private cacheKey(userId: string): string {
    return `${CACHE_KEY_PREFIX}:${userId}`;
  }

  private readInProcess(userId: string): PlacementContext | null {
    const entry = this.inProcess.get(userId);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.inProcess.delete(userId);
      return null;
    }
    return entry.ctx;
  }

  private writeInProcess(userId: string, ctx: PlacementContext): void {
    this.inProcess.set(userId, {
      ctx,
      expiresAt: Date.now() + IN_PROCESS_TTL_MS,
    });

    // Cap the in-process LRU crudely: drop oldest entries if we exceed it.
    if (this.inProcess.size > 4096) {
      const firstKey = this.inProcess.keys().next().value;
      if (firstKey !== undefined) this.inProcess.delete(firstKey);
    }
  }

  private async readFromDatabase(userId: string): Promise<PlacementContext | null> {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        region: true,
        dataResidencyRegion: true,
        shardKey: true,
        tenantId: true,
      },
    });

    if (!row) return null;

    const region = normalizeRegion(row.region);
    const dataResidencyRegion = row.dataResidencyRegion
      ? normalizeRegion(row.dataResidencyRegion)
      : region;

    return {
      region,
      dataResidencyRegion,
      shardKey: row.shardKey ?? computeShardKey(userId),
      tenantId: row.tenantId ?? null,
      stale: row.shardKey === null || row.dataResidencyRegion === null,
    };
  }

  private computeFallbackContext(userId: string, stale: boolean): PlacementContext {
    const shardKey = computeShardKey(userId);
    return {
      region: DEFAULT_REGION,
      dataResidencyRegion: DEFAULT_REGION,
      shardKey,
      tenantId: null,
      stale,
    };
  }

  private async invalidateCache(userId: string): Promise<void> {
    this.inProcess.delete(userId);
    try {
      await this.cache.del(this.cacheKey(userId));
    } catch {
      /* cache layer will self-heal via TTL */
    }
  }
}

export const placementService = new PlacementService();
