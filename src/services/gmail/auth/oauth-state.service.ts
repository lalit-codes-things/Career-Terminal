/**
 * OAuth State Service — CSRF protection for OAuth2 flows (Epic 0.7 hardened).
 *
 * Generates, validates, and expires temporary state tokens that are passed
 * through the OAuth authorization redirect. This prevents CSRF attacks by
 * ensuring the callback was initiated by a legitimate authorization request
 * from our application.
 *
 * Design decisions:
 *   - State tokens use cryptographically secure randomness (randomBytes(32))
 *     instead of uuid v4. This provides 256 bits of entropy, making tokens
 *     unpredictable even if the UUID RNG has weaknesses.
 *   - 15-minute TTL — states expire if the user doesn't complete OAuth quickly.
 *   - One-time use — state is consumed (deleted) upon validation.
 *   - Storage backend: Redis when REDIS_HOST is set (horizontal scale),
 *     falls back to in-memory Map for local development.
 *
 * Horizontal scale (Epic 0.7, Phase 4):
 *   In a multi-instance deployment (multiple API pods), the OAuth callback
 *   may be handled by a different pod than the one that initiated /connect.
 *   The RedisOAuthStateBackend stores state in Redis so any pod can validate
 *   the CSRF token — resolving the single-instance limitation of the prior
 *   in-memory implementation.
 *
 *   The Redis key format is:  oauth:state:<stateToken>
 *   Value: JSON-encoded { userId, createdAt } with TTL = STATE_TTL_SEC
 *
 * Security properties:
 *   - Unpredictable state: 256-bit random token (32 bytes hex = 64 chars).
 *   - One-time use: deleted on consumption, no replay possible.
 *   - TTL-enforced expiry: Redis automatically purges expired states.
 *   - No state enumeration: Redis key format includes the token, not userId.
 */
import { randomBytes } from 'crypto';
import { OAuthError } from '../../../errors/app-errors';
import { logger } from '../../../lib/logger';
import { config } from '../../../config';
import type { OAuthStateEntry } from '../models/gmail.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How long an OAuth state is valid (15 minutes). */
const STATE_TTL_MS = 15 * 60 * 1000;
const STATE_TTL_SEC = 15 * 60;

/** Redis key prefix for OAuth state entries. */
const REDIS_KEY_PREFIX = 'oauth:state:';

/** How often to run the in-memory cleanup sweep (5 minutes). */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Backend interface
// ---------------------------------------------------------------------------

interface IOAuthStateBackend {
  set(state: string, entry: OAuthStateEntry): Promise<void>;
  get(state: string): Promise<OAuthStateEntry | null>;
  delete(state: string): Promise<void>;
  size(): Promise<number>;
  destroy(): void;
}

// ---------------------------------------------------------------------------
// In-memory backend (development / test / single-instance)
// ---------------------------------------------------------------------------

class InMemoryStateBackend implements IOAuthStateBackend {
  private readonly states = new Map<string, OAuthStateEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cleanupTimer = setInterval(() => this.purgeExpired(), CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  async set(state: string, entry: OAuthStateEntry): Promise<void> {
    this.states.set(state, entry);
  }

  async get(state: string): Promise<OAuthStateEntry | null> {
    return this.states.get(state) ?? null;
  }

  async delete(state: string): Promise<void> {
    this.states.delete(state);
  }

  async size(): Promise<number> {
    return this.states.size;
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.states.clear();
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [state, entry] of this.states.entries()) {
      if (now - entry.createdAt > STATE_TTL_MS) {
        this.states.delete(state);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Redis backend (production / multi-instance)
// ---------------------------------------------------------------------------

/**
 * RedisStateBackend — stores OAuth CSRF state in Redis.
 *
 * Uses a lazy-loaded Redis client so no connection is opened unless this
 * backend is actually selected at runtime. The TTL is set on the Redis key
 * so expiry is handled automatically by Redis — no cleanup sweep needed.
 *
 * The Redis key includes the state token itself (not just a userId) so:
 *   1. Each state is a unique key — no collision between concurrent OAuth flows.
 *   2. Consumption (DELETE) is atomic.
 *   3. Redis TTL handles expiry without application-side cleanup.
 *
 * Availability: if Redis is temporarily unavailable, OAuth flows will fail
 * with a clear error (better than silently allowing unvalidated states).
 */
class RedisStateBackend implements IOAuthStateBackend {
  private client: import('ioredis').Redis | null = null;

  private getClient(): import('ioredis').Redis {
    if (!this.client) {
      // Dynamic import to avoid loading Redis when in-memory backend is used
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createRedisClient } = require('../../../config/redis');
      const client = createRedisClient('cache', 'oauth-state') as import('ioredis').Redis;

      client.on('error', (err: Error) => {
        logger.error('[OAuthStateService] Redis error', { message: err.message });
      });
      this.client = client;
    }
    return this.client;
  }

  async set(state: string, entry: OAuthStateEntry): Promise<void> {
    const key = `${REDIS_KEY_PREFIX}${state}`;
    const value = JSON.stringify(entry);
    await this.getClient().set(key, value, 'EX', STATE_TTL_SEC);
  }

  async get(state: string): Promise<OAuthStateEntry | null> {
    const key = `${REDIS_KEY_PREFIX}${state}`;
    const raw = await this.getClient().get(key);
    if (!raw) return null;
    return JSON.parse(raw) as OAuthStateEntry;
  }

  async delete(state: string): Promise<void> {
    const key = `${REDIS_KEY_PREFIX}${state}`;
    await this.getClient().del(key);
  }

  async size(): Promise<number> {
    // Use SCAN instead of KEYS to avoid blocking the Redis instance in production
    let count = 0;
    let cursor = '0';
    const pattern = `${REDIS_KEY_PREFIX}*`;
    do {
      const [nextCursor, keys] = await this.getClient().scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      count += keys.length;
    } while (cursor !== '0');
    return count;
  }

  destroy(): void {
    if (this.client) {
      void this.client.quit().catch(() => {
        /* silently ignored on shutdown */
      });
      this.client = null;
    }
  }
}

// ---------------------------------------------------------------------------
// OAuthStateService
// ---------------------------------------------------------------------------

export class OAuthStateService {
  private readonly backend: IOAuthStateBackend;

  constructor(backend?: IOAuthStateBackend) {
    if (backend) {
      this.backend = backend;
    } else if (config.redisCache.host || config.redis.host) {
      // Production / multi-instance: use Redis backend
      logger.info('[OAuthStateService] Using Redis-backed OAuth state storage');
      this.backend = new RedisStateBackend();
    } else {
      // Development / test: use in-memory backend
      logger.info('[OAuthStateService] Using in-memory OAuth state storage (single-instance only)');
      this.backend = new InMemoryStateBackend();
    }
  }

  /**
   * Generates a unique, time-limited OAuth state parameter.
   *
   * Uses 32 bytes of cryptographically secure randomness (256-bit entropy).
   * This is stronger than UUID v4 (122 bits) and resistant to prediction
   * even if the process PRNG is partially observed.
   *
   * IMPORTANT: State storage is awaited before returning. If persistence fails,
   * the OAuth flow fails rather than issuing an unpersisted state that may vanish.
   *
   * @param userId - The user ID to associate with this state
   * @returns A 64-character hex state string to include in the OAuth URL
   */
  async generateState(userId: string): Promise<string> {
    const state = randomBytes(32).toString('hex');
    const entry: OAuthStateEntry = {
      userId,
      createdAt: Date.now(),
    };

    try {
      await this.backend.set(state, entry);
    } catch (err: unknown) {
      logger.error('[OAuthStateService] Failed to persist state — failing OAuth initiation', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new OAuthError(
        'OAuth state could not be stored. Please try again.',
        'OAUTH_STATE_STORAGE_FAILED',
      );
    }

    return state;
  }

  /**
   * Validates and consumes an OAuth state parameter.
   * This is a one-time operation — the state is deleted after validation.
   *
   * @param state - The state parameter from the OAuth callback
   * @returns The userId associated with the state
   * @throws {OAuthError} If the state is missing, invalid, or expired
   */
  async validateAndConsume(state: string): Promise<string> {
    if (!state || typeof state !== 'string') {
      throw new OAuthError(
        'Invalid or expired OAuth state. Please initiate the connection again.',
        'INVALID_OAUTH_STATE',
      );
    }

    const entry = await this.backend.get(state);

    if (!entry) {
      throw new OAuthError(
        'Invalid or expired OAuth state. Please initiate the connection again.',
        'INVALID_OAUTH_STATE',
      );
    }

    // Check expiry (belt-and-suspenders; Redis TTL handles it independently)
    const age = Date.now() - entry.createdAt;
    if (age > STATE_TTL_MS) {
      await this.backend.delete(state);
      throw new OAuthError(
        'OAuth state has expired. Please initiate the connection again.',
        'EXPIRED_OAUTH_STATE',
      );
    }

    // Consume (one-time use) — delete before returning to prevent replay
    await this.backend.delete(state);
    return entry.userId;
  }

  /**
   * Returns the number of active (non-expired) states.
   * Useful for monitoring and testing.
   */
  async getActiveCount(): Promise<number> {
    return this.backend.size();
  }

  /**
   * Stops the cleanup timer. Call during graceful shutdown.
   */
  destroy(): void {
    this.backend.destroy();
  }
}

/**
 * Singleton instance of the OAuth state service.
 * Used across the application for state management.
 */
export const oauthStateService = new OAuthStateService();
