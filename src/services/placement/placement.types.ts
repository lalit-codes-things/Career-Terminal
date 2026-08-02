/**
 * Placement metadata types.
 *
 * These are light, serializable structs describing WHERE a user's data
 * should live.  They do NOT perform any routing themselves — that is the
 * responsibility of `PlacementService` and the downstream database router.
 */

/** Canonical list of supported AWS regions (mirrors the Prisma enum). */
export const SUPPORTED_REGIONS = [
  'us-east-1',
  'us-west-2',
  'eu-west-1',
  'eu-central-1',
  'ap-southeast-1',
  'ap-northeast-1',
] as const;

export type SupportedRegion = (typeof SUPPORTED_REGIONS)[number];

export const DEFAULT_REGION: SupportedRegion = 'us-east-1';

/**
 * Number of logical shards per region.
 *
 * Changing this after production data has been written would require
 * re-sharding all users — do NOT change without a full migration plan.
 */
export const SHARD_COUNT = 256 as const;

/**
 * Placement context attached to `req.placement` by the placement middleware.
 * Read-heavy: cached in memory + Redis via PlacementService.
 */
export interface PlacementContext {
  /** Canonical home region (primary storage cell). */
  region: SupportedRegion;
  /** Deterministic home cell identifier. */
  cellId: string;
  /** Legal data-residency region (usually === region, sometimes stricter). */
  dataResidencyRegion: SupportedRegion;
  /** Integer shard key in [0, SHARD_COUNT) — for future DB partitioning. */
  shardKey: number;
  /**
   * Tenant ID for enterprise multi-tenancy.  `null` for individual users.
   * A per-tenant isolation layer will key off this value in later prompts.
   */
  tenantId: string | null;
  /**
   * True when the placement context was computed from a cached or defaulted
   * value and should be validated against the DB on a warm path.
   */
  stale: boolean;
}

/** Lightweight "data plane" descriptor returned from `resolveDataPlane`. */
export interface DataPlaneTarget {
  region: SupportedRegion;
  shardKey: number;
  dataResidencyRegion: SupportedRegion;
  cellId: string;
}

export function isSupportedRegion(candidate: unknown): candidate is SupportedRegion {
  return (
    typeof candidate === 'string' && (SUPPORTED_REGIONS as readonly string[]).includes(candidate)
  );
}

export function normalizeRegion(candidate: string | null | undefined): SupportedRegion {
  if (!candidate) return DEFAULT_REGION;
  const lower = candidate.trim().toLowerCase();
  return (SUPPORTED_REGIONS as readonly string[]).includes(lower)
    ? (lower as SupportedRegion)
    : DEFAULT_REGION;
}
