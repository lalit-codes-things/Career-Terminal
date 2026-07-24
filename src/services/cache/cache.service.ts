/**
 * CacheService — Redis-backed cache abstraction.
 *
 * Design goals:
 *  1. Business logic never imports ioredis directly — it depends on the
 *     ICacheService interface, which makes unit-testing trivial (swap with
 *     an in-memory stub).
 *  2. The concrete RedisCacheService is injected via the factory / DI
 *     container — no `new Redis()` buried inside services.
 *  3. A no-op NullCacheService is provided for test environments where
 *     a live Redis isn't available.
 *
 * Key TTL conventions (ms):
 *   Refresh token    : 7 days  = 604_800_000
 *   Access token JTI : 15 min  =     900_000  (for revocation)
 *   Rate-limit window: 60 s    =      60_000
 *   General short    : 5 min   =     300_000
 */
import { type Redis } from 'ioredis';
import { createRedisClient } from '../../config/redis';
import { logger } from '../../lib/logger';

// ---------------------------------------------------------------------------
// Interface — depend on this, not the concrete class
// ---------------------------------------------------------------------------

export interface ICacheService {
  /** Retrieve a cached value. Returns null on miss or expired key. */
  get<T>(key: string): Promise<T | null>;

  /** Store a value with a TTL in milliseconds. */
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;

  /** Delete a single key. */
  del(key: string): Promise<void>;

  /** Delete all keys matching a prefix pattern (e.g. "refresh:userId:*"). */
  delByPrefix(prefix: string): Promise<void>;

  /** Check if a key exists without fetching the value. */
  exists(key: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Redis implementation
// ---------------------------------------------------------------------------

export class RedisCacheService implements ICacheService {
  private readonly client: Redis;

  constructor(client?: Redis) {
    this.client = client ?? createRedisClient('cache');
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.client.get(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      logger.warn('[CacheService] get failed', {
        key,
        error: (err as Error).message,
      });
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    try {
      const serialised = JSON.stringify(value);
      // PX = TTL in milliseconds
      await this.client.set(key, serialised, 'PX', ttlMs);
    } catch (err) {
      logger.warn('[CacheService] set failed', {
        key,
        error: (err as Error).message,
      });
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (err) {
      logger.warn('[CacheService] del failed', {
        key,
        error: (err as Error).message,
      });
    }
  }

  async delByPrefix(prefix: string): Promise<void> {
    try {
      // SCAN is non-blocking; safe for production unlike KEYS
      let cursor = '0';
      const pattern = `${prefix}*`;
      do {
        const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.client.del(...keys);
        }
      } while (cursor !== '0');
    } catch (err) {
      logger.warn('[CacheService] delByPrefix failed', {
        prefix,
        error: (err as Error).message,
      });
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch {
      return false;
    }
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  /** Gracefully disconnect. Call during server shutdown. */
  async disconnect(): Promise<void> {
    await this.client.quit();
    logger.info('[CacheService] Redis connection closed');
  }
}

// ---------------------------------------------------------------------------
// Null implementation — for tests / environments without Redis
// ---------------------------------------------------------------------------

export class NullCacheService implements ICacheService {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async get<T>(_key: string): Promise<T | null> {
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async set<T>(_key: string, _value: T, _ttlMs: number): Promise<void> {
    /* noop */
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async del(_key: string): Promise<void> {
    /* noop */
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async delByPrefix(_prefix: string): Promise<void> {
    /* noop */
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async exists(_key: string): Promise<boolean> {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Singleton — swap for NullCacheService in tests by re-assigning this export
// ---------------------------------------------------------------------------

export const cacheService: ICacheService =
  process.env.NODE_ENV === 'test' ? new NullCacheService() : new RedisCacheService();
