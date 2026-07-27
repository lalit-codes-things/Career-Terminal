import {
  PlacementService,
  computeShardKey,
  resolveRegionFromHints,
  type RegionResolutionHints,
} from '../services/placement/placement.service';
import {
  DEFAULT_REGION,
  SHARD_COUNT,
  SUPPORTED_REGIONS,
  type SupportedRegion,
  isSupportedRegion,
  normalizeRegion,
} from '../services/placement/placement.types';
import { prisma } from '../config/database';
import type { ICacheService } from '../services/cache/cache.service';
import { ValidationError } from '../errors/app-errors';

jest.mock('../config/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

function makeMockCache(): jest.Mocked<ICacheService> {
  return {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    delByPrefix: jest.fn(),
    exists: jest.fn(),
  };
}

type MockPrisma = {
  user: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
};

const mockPrisma = prisma as unknown as MockPrisma;

// ─────────────────────────────────────────────────────────────────────────────
// Shard key function
// ─────────────────────────────────────────────────────────────────────────────

describe('computeShardKey — determinism & distribution', () => {
  it('returns an integer inside [0, SHARD_COUNT) for any input', () => {
    const samples = [
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      'user_legacy_string_id',
      '',
    ];
    for (const id of samples) {
      const key = computeShardKey(id);
      expect(Number.isInteger(key)).toBe(true);
      expect(key).toBeGreaterThanOrEqual(0);
      expect(key).toBeLessThan(SHARD_COUNT);
    }
  });

  it('is deterministic: the same id always produces the same shard', () => {
    const id = '1d3f1a8c-2e4b-4c9d-b6a7-123456789abc';
    expect(computeShardKey(id)).toBe(computeShardKey(id));
    expect(computeShardKey(id)).toBe(computeShardKey(id));
  });

  it('different ids produce different shards (spread across the range)', () => {
    const keys = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const id = `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`;
      keys.add(computeShardKey(id));
    }
    expect(keys.size).toBeGreaterThan(SHARD_COUNT / 2);
  });

  it('distribution is reasonably even — no bucket over 3x the mean', () => {
    const N = 25_600;
    const counts = new Array<number>(SHARD_COUNT).fill(0);
    for (let i = 0; i < N; i++) {
      const id = `${String(i).padStart(8, '0')}-0000-0000-0000-${String(i * 7)
        .padStart(12, '0')}`;
      counts[computeShardKey(id)]!++;
    }
    const mean = N / SHARD_COUNT;
    const max = counts.reduce((a, b) => Math.max(a, b), 0);
    expect(max).toBeLessThan(3 * mean);
  });

  it('returns 0 for empty input (safe default, no crash)', () => {
    expect(computeShardKey('')).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Region utilities (placement.types)
// ─────────────────────────────────────────────────────────────────────────────

describe('region type utilities', () => {
  it('isSupportedRegion accepts all 6 supported regions', () => {
    for (const r of SUPPORTED_REGIONS) {
      expect(isSupportedRegion(r)).toBe(true);
    }
  });

  it('isSupportedRegion rejects unknown values', () => {
    expect(isSupportedRegion('us-east-2')).toBe(false);
    expect(isSupportedRegion('eu-west-99')).toBe(false);
    expect(isSupportedRegion(null)).toBe(false);
    expect(isSupportedRegion(123)).toBe(false);
  });

  it('normalizeRegion falls back to DEFAULT_REGION for junk', () => {
    expect(normalizeRegion(undefined)).toBe(DEFAULT_REGION);
    expect(normalizeRegion(null)).toBe(DEFAULT_REGION);
    expect(normalizeRegion('')).toBe(DEFAULT_REGION);
    expect(normalizeRegion('  EU-WEST-1  ')).toBe('eu-west-1');
    expect(normalizeRegion('Mars/Phobos-1')).toBe(DEFAULT_REGION);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Region hints resolution
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveRegionFromHints', () => {
  it('honours suggestedRegion when valid', () => {
    const hints: RegionResolutionHints = { suggestedRegion: 'eu-central-1' };
    expect(resolveRegionFromHints(hints)).toBe('eu-central-1');
  });

  it('ignores an invalid suggestedRegion and falls through', () => {
    const hints: RegionResolutionHints = {
      suggestedRegion: 'not-a-region',
      country: 'JP',
    };
    expect(resolveRegionFromHints(hints)).toBe('ap-northeast-1');
  });

  it('maps CF country codes correctly', () => {
    expect(resolveRegionFromHints({ country: 'US' })).toBe('us-east-1');
    expect(resolveRegionFromHints({ country: 'CA' })).toBe('us-west-2');
    expect(resolveRegionFromHints({ country: 'GB' })).toBe('eu-west-1');
    expect(resolveRegionFromHints({ country: 'DE' })).toBe('eu-central-1');
    expect(resolveRegionFromHints({ country: 'SG' })).toBe('ap-southeast-1');
    expect(resolveRegionFromHints({ country: 'JP' })).toBe('ap-northeast-1');
  });

  it('uses Accept-Language when country is absent', () => {
    expect(resolveRegionFromHints({ acceptLanguage: 'en-GB,en;q=0.9' })).toBe(
      'eu-west-1',
    );
    expect(resolveRegionFromHints({ acceptLanguage: 'de-DE,en;q=0.8' })).toBe(
      'eu-central-1',
    );
    expect(resolveRegionFromHints({ acceptLanguage: 'ja' })).toBe(
      'ap-northeast-1',
    );
    expect(resolveRegionFromHints({ acceptLanguage: 'en-SG,id;q=0.7' })).toBe(
      'ap-southeast-1',
    );
  });

  it('falls back to DEFAULT_REGION when no hints match', () => {
    expect(resolveRegionFromHints({})).toBe(DEFAULT_REGION);
    expect(resolveRegionFromHints({ country: 'ZZ' })).toBe(DEFAULT_REGION);
    expect(resolveRegionFromHints({ acceptLanguage: 'xx-YY' })).toBe(
      DEFAULT_REGION,
    );
  });

  it('priority order: suggestedRegion > country > acceptLanguage', () => {
    const all = {
      suggestedRegion: 'eu-west-1',
      country: 'JP',
      acceptLanguage: 'en-US',
    };
    expect(resolveRegionFromHints(all)).toBe('eu-west-1');

    const noSuggestion = { country: 'DE', acceptLanguage: 'ja' };
    expect(resolveRegionFromHints(noSuggestion)).toBe('eu-central-1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PlacementService — context resolution, caching, mutations
// ─────────────────────────────────────────────────────────────────────────────

const USER_ID = '1d3f1a8c-2e4b-4c9d-b6a7-123456789abc';

type DbRow = {
  id: string;
  region: string | null;
  dataResidencyRegion: string | null;
  shardKey: number | null;
  tenantId: string | null;
};

const FULL_ROW: DbRow = {
  id: USER_ID,
  region: 'eu-west-1',
  dataResidencyRegion: 'eu-west-1',
  shardKey: 123,
  tenantId: 'acme-corp',
};

describe('PlacementService', () => {
  let cache: jest.Mocked<ICacheService>;
  let service: PlacementService;

  beforeEach(() => {
    jest.clearAllMocks();
    cache = makeMockCache();
    service = new PlacementService(cache);
  });

  describe('resolvePlacementContext', () => {
    it('throws ValidationError without a userId', async () => {
      await expect(service.resolvePlacementContext('')).rejects.toThrow(
        ValidationError,
      );
    });

    it('uses the in-process cache on second call (no DB/cache.get hit)', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(FULL_ROW);

      const first = await service.resolvePlacementContext(USER_ID);
      const second = await service.resolvePlacementContext(USER_ID);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(1);
      expect(mockPrisma.user.findUnique).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { id: USER_ID },
        }),
      );
      const selectFields = mockPrisma.user.findUnique.mock.calls[0]?.[0]?.select;
      expect(selectFields).toBeDefined();
      expect(selectFields?.region).toBe(true);
      expect(selectFields?.dataResidencyRegion).toBe(true);
      expect(selectFields?.shardKey).toBe(true);
      expect(selectFields?.tenantId).toBe(true);
      expect(cache.set).toHaveBeenCalledTimes(1);
      expect(first.region).toBe('eu-west-1');
      expect(second).toEqual(first);
      expect(second.tenantId).toBe('acme-corp');
      expect(second.shardKey).toBe(123);
    });

    it('falls back to Redis cache between instances', async () => {
      const cached = {
        region: 'ap-southeast-1' as SupportedRegion,
        dataResidencyRegion: 'ap-southeast-1' as SupportedRegion,
        shardKey: 42,
        tenantId: null,
        stale: false,
      };
      cache.get.mockResolvedValueOnce(cached);

      const ctx = await service.resolvePlacementContext(USER_ID);
      expect(ctx).toEqual(cached);
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('marks context stale when DB row has missing placement columns', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: USER_ID,
        region: 'us-east-1',
        dataResidencyRegion: null,
        shardKey: null,
        tenantId: null,
      });

      const ctx = await service.resolvePlacementContext(USER_ID);
      expect(ctx.stale).toBe(true);
      expect(ctx.shardKey).toBe(computeShardKey(USER_ID));
      expect(ctx.dataResidencyRegion).toBe(ctx.region);
    });

    it('computes a deterministic fallback context when user row is absent', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      const ctx = await service.resolvePlacementContext(USER_ID);
      expect(ctx.stale).toBe(true);
      expect(ctx.region).toBe(DEFAULT_REGION);
      expect(ctx.shardKey).toBe(computeShardKey(USER_ID));
    });

    it('normalizes malformed region values coming back from DB', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: USER_ID,
        region: '  EU-WEST-1  ',
        dataResidencyRegion: null,
        shardKey: 7,
        tenantId: null,
      });

      const ctx = await service.resolvePlacementContext(USER_ID);
      expect(ctx.region).toBe('eu-west-1');
      expect(ctx.dataResidencyRegion).toBe('eu-west-1');
    });
  });

  describe('getHomeRegion / getShardKey convenience accessors', () => {
    it('getHomeRegion returns the cached region', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: USER_ID,
        region: 'eu-central-1',
        dataResidencyRegion: 'eu-central-1',
        shardKey: 9,
        tenantId: null,
      });
      expect(await service.getHomeRegion(USER_ID)).toBe('eu-central-1');
    });

    it('getShardKey does not require a DB round-trip', async () => {
      const key = await service.getShardKey(USER_ID);
      expect(key).toBe(computeShardKey(USER_ID));
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('resolveDataPlane (sync)', () => {
    it('builds a cellId combining region and padded shard key', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: USER_ID,
        region: 'ap-northeast-1',
        dataResidencyRegion: 'ap-northeast-1',
        shardKey: 7,
        tenantId: null,
      });
      await service.resolvePlacementContext(USER_ID);

      const target = service.resolveDataPlane(USER_ID);
      expect(target.region).toBe('ap-northeast-1');
      expect(target.shardKey).toBe(computeShardKey(USER_ID));
      expect(target.cellId).toMatch(/^ap-northeast-1-shard-\d{3}$/);
      expect(target.dataResidencyRegion).toBe('ap-northeast-1');
    });

    it('falls back to defaults when cache is cold', () => {
      const target = service.resolveDataPlane(USER_ID);
      expect(target.region).toBe(DEFAULT_REGION);
      expect(target.shardKey).toBe(computeShardKey(USER_ID));
      expect(target.cellId).toBe(
        `${DEFAULT_REGION}-shard-${String(computeShardKey(USER_ID)).padStart(3, '0')}`,
      );
    });
  });

  describe('setUserRegion', () => {
    it('validates the target region', async () => {
      await expect(
        service.setUserRegion(USER_ID, 'not-a-real-region'),
      ).rejects.toThrow(ValidationError);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('mirrors residency only when it matched the old region (preserves legal override)', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: USER_ID,
        region: 'us-east-1',
        dataResidencyRegion: 'us-east-1',
        shardKey: 0,
        tenantId: null,
      });
      await service.setUserRegion(USER_ID, 'eu-west-1');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: USER_ID },
          data: {
            region: 'eu-west-1',
            dataResidencyRegion: 'eu-west-1',
          },
        }),
      );

      jest.clearAllMocks();
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: USER_ID,
        region: 'us-west-2',
        dataResidencyRegion: 'eu-west-1',
        shardKey: 0,
        tenantId: null,
      });
      await service.setUserRegion(USER_ID, 'us-east-1');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            region: 'us-east-1',
            dataResidencyRegion: undefined,
          }),
        }),
      );
    });

    it('invalidates both in-process and Redis cache after a mutation', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(FULL_ROW);
      await service.resolvePlacementContext(USER_ID);

      await service.setUserRegion(USER_ID, 'ap-southeast-1');
      expect(cache.del).toHaveBeenCalledWith(expect.stringContaining(USER_ID));
      expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(2);
    });
  });
});
