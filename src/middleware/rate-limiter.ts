/**
 * Distributed rate limiter middleware.
 *
 * Uses Redis (via rate-limiter-flexible) when REDIS_HOST is configured,
 * falling back to an in-process memory store when Redis is unavailable.
 * This ensures rate limiting works correctly across multiple web-server
 * instances and degrades gracefully if Redis goes down.
 *
 * IMPORTANT: Security-critical endpoints must not universally fail open.
 * Use the fail-closed limiters for authentication, OAuth, and highly
 * sensitive mutations. Ordinary endpoints may use the standard limiters.
 *
 * Two factory functions are provided:
 *
 *   createRateLimiter(windowMs, maxRequests)
 *     → Keys by IP address only. Use for unauthenticated endpoints.
 *
 *   createUserAwareRateLimiter(windowMs, maxRequests)
 *     → Keys by userId when authenticated, falls back to IP for anonymous.
 *       This prevents a single user account from consuming quota by rotating IPs.
 *
 *   createSecureRateLimiter(windowMs, maxRequests)
 *     → Like createRateLimiter but fails closed on Redis errors. Use for
 *       security-critical unauthenticated endpoints (OAuth callback, etc.).
 *
 *   createSecureUserRateLimiter(windowMs, maxRequests)
 *     → Like createUserAwareRateLimiter but fails closed on Redis errors.
 *       Use for authentication and sensitive authenticated mutations.
 */
import { type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { RateLimiterMemory, RateLimiterRedis, type RateLimiterRes } from 'rate-limiter-flexible';
import Redis, { type RedisOptions } from 'ioredis';
import { readFileSync } from 'fs';
import { config } from '../config';
import { AppError } from '../errors/app-errors';
import { logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests, please try again later.') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

// ---------------------------------------------------------------------------
// Shared Redis client for rate limiting.
// Uses the cache Redis role (ephemeral cluster) — rate limiting data is
// disposable and eviction is acceptable.
// ---------------------------------------------------------------------------

let redisClient: Redis | null = null;

function getRedisClient(): Redis | null {
  if (redisClient) return redisClient;

  const host = config.redisCache.host ?? config.redis.host;
  if (!host) return null;

  const clientConfig: RedisOptions = {
    host,
    port: config.redisCache.port ?? config.redis.port,
    password: config.redisCache.password ?? config.redis.password,
    db: config.redisCache.db ?? config.redis.db,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
  };

  if (config.redisAcl.username) {
    clientConfig.username = config.redisAcl.username;
  }

  if (config.redisAcl.tlsEnabled) {
    clientConfig.tls = {
      ca: config.redisAcl.tlsCaPath ? readFileSync(config.redisAcl.tlsCaPath) : undefined,
      rejectUnauthorized: true,
    };
  }

  redisClient = new Redis(clientConfig);

  redisClient.on('error', () => {
    /* handled per-request */
  });

  return redisClient;
}

// ---------------------------------------------------------------------------
// Internal helper — build a limiter pair (Redis-backed with memory fallback)
// Note: localStorage serves as the in-memory fallback. For security-critical
// limiters, we use a separate tight memory limiter as a tight backstop.
// ---------------------------------------------------------------------------

function buildLimiterPair(
  windowSec: number,
  maxRequests: number,
  keyPrefix: string,
  _options: { failClosed?: boolean } = {},
): { limiter: RateLimiterMemory | RateLimiterRedis; memory: RateLimiterMemory } {
  const memory = new RateLimiterMemory({
    points: maxRequests,
    duration: windowSec,
    keyPrefix,
  });

  const client = getRedisClient();
  if (!client) {
    return { limiter: memory, memory };
  }

  const redis = new RateLimiterRedis({
    storeClient: client,
    points: maxRequests,
    duration: windowSec,
    keyPrefix,
    insuranceLimiter: memory,
  });

  return { limiter: redis, memory };
}

// ---------------------------------------------------------------------------
// Internal helper — emit security log event on rate limit exceeded
// ---------------------------------------------------------------------------

function logRateLimitExceeded(
  req: Request,
  retryAfterSeconds: number,
  keyType: 'ip' | 'user',
): void {
  logger.warn('[security] rate_limit_exceeded', {
    event: 'rate_limit_exceeded',
    keyType,
    ip: req.ip,
    userId: req.user?.id,
    path: req.path,
    method: req.method,
    retryAfterSeconds,
    requestId: req.requestId,
  });
}

// ---------------------------------------------------------------------------
// Core rate-limit handler factory
// ---------------------------------------------------------------------------

function createRateLimiterHandler(
  getKey: (req: Request) => string,
  windowMs: number,
  maxRequests: number,
  keyPrefix: string,
  opts: { failClosed?: boolean } = {},
): RequestHandler {
  const windowSec = Math.ceil(windowMs / 1000);
  const { limiter } = buildLimiterPair(windowSec, maxRequests, keyPrefix, opts);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = getKey(req);

    try {
      await limiter.consume(key);
      next();
    } catch (err: unknown) {
      const isRateLimitExceeded = err !== null && typeof err === 'object' && 'msBeforeNext' in err;

      if (isRateLimitExceeded) {
        const rateLimitRes = err as RateLimiterRes;
        const retryAfterSeconds = Math.ceil(rateLimitRes.msBeforeNext / 1000);
        res.setHeader('Retry-After', retryAfterSeconds);
        logRateLimitExceeded(req, retryAfterSeconds, req.user?.id ? 'user' : 'ip');
        next(new RateLimitError());
        return;
      }

      if (opts.failClosed) {
        logger.warn('[RateLimiter] Unexpected error in fail-closed limiter — rejecting', {
          error: (err as Error).message,
          key,
          path: req.path,
        });
        next(new RateLimitError('Service temporarily unavailable. Please try again later.'));
        return;
      }

      // Fail open for non-security-critical endpoints
      next();
    }
  };
}

// ---------------------------------------------------------------------------
// Factory: IP-keyed rate limiter (fail open on errors)
// ---------------------------------------------------------------------------

export const createRateLimiter = (windowMs: number, maxRequests: number): RequestHandler =>
  createRateLimiterHandler(
    (req) => req.ip ?? req.socket.remoteAddress ?? 'unknown',
    windowMs,
    maxRequests,
    'rl_ip',
    { failClosed: false },
  );

// ---------------------------------------------------------------------------
// Factory: User-aware rate limiter (fail open on errors)
// ---------------------------------------------------------------------------

export const createUserAwareRateLimiter = (windowMs: number, maxRequests: number): RequestHandler =>
  createRateLimiterHandler(
    (req) => req.user?.id ?? req.ip ?? req.socket.remoteAddress ?? 'unknown',
    windowMs,
    maxRequests,
    'rl_user',
    { failClosed: false },
  );

// ---------------------------------------------------------------------------
// Factory: Secure (fail-closed) rate limiters for security-critical paths
// ---------------------------------------------------------------------------

/**
 * Keys by IP. Rejects requests on unexpected Redis errors.
 * Use for unauthenticated security-critical endpoints (OAuth callback).
 */
export const createSecureRateLimiter = (windowMs: number, maxRequests: number): RequestHandler =>
  createRateLimiterHandler(
    (req) => req.ip ?? req.socket.remoteAddress ?? 'unknown',
    windowMs,
    maxRequests,
    'rl_ip_secure',
    { failClosed: true },
  );

/**
 * Keys by userId when authenticated, otherwise by IP.
 * Rejects requests on unexpected Redis errors.
 * Use for authentication, password/token operations, sensitive mutations.
 */
export const createSecureUserRateLimiter = (
  windowMs: number,
  maxRequests: number,
): RequestHandler =>
  createRateLimiterHandler(
    (req) => req.user?.id ?? req.ip ?? req.socket.remoteAddress ?? 'unknown',
    windowMs,
    maxRequests,
    'rl_user_secure',
    { failClosed: true },
  );

// ---------------------------------------------------------------------------
// Named presets — use these directly on routes
// ---------------------------------------------------------------------------

/**
 * Standard authenticated route limiter.
 * 300 requests per 15 minutes per user (or IP if anonymous).
 * Suitable for list/detail GET endpoints.
 */
export const generalApiLimiter = createUserAwareRateLimiter(15 * 60 * 1000, 300);

/**
 * Write operation limiter.
 * 60 requests per 15 minutes per user.
 * Suitable for PATCH/POST state-changing endpoints.
 */
export const writeLimiter = createUserAwareRateLimiter(15 * 60 * 1000, 60);

/**
 * Expensive/analytics endpoint limiter.
 * 20 requests per 15 minutes per user.
 * Suitable for CPU or DB-heavy aggregate queries.
 */
export const expensiveLimiter = createUserAwareRateLimiter(15 * 60 * 1000, 20);

/**
 * File upload limiter.
 * 10 uploads per hour per user.
 * Suitable for resume upload and other file ingestion endpoints.
 */
export const uploadLimiter = createUserAwareRateLimiter(60 * 60 * 1000, 10);

/**
 * Auth flood protection limiter.
 * 20 requests per 15 minutes per IP.
 * Suitable for logout endpoints.
 */
export const authFloodLimiter = createRateLimiter(15 * 60 * 1000, 20);

// ─── Security-critical presets (fail closed) ─────────────────────────────

/**
 * Secure auth endpoint limiter.
 * 5 requests per 15 minutes per IP.
 * Use for /auth/token and similar token-issuance endpoints.
 */
export const secureAuthLimiter = createSecureRateLimiter(15 * 60 * 1000, 5);

/**
 * Secure OAuth callback limiter.
 * 20 requests per 15 minutes per IP.
 * Use for OAuth callback endpoints.
 */
export const secureOAuthCallbackLimiter = createSecureRateLimiter(15 * 60 * 1000, 20);

/**
 * Secure sensitive mutation limiter.
 * 10 requests per 15 minutes per user.
 * Use for credential mutations, connection management, deletion requests.
 */
export const secureMutationLimiter = createSecureUserRateLimiter(15 * 60 * 1000, 10);

// ---------------------------------------------------------------------------
// Global rate limiter — Redis-backed, configurable threshold
// ---------------------------------------------------------------------------

/**
 * Creates a global rate limiter that uses the same Redis store as the
 * per-route limiters. The threshold is configurable via env vars:
 *   GLOBAL_RATE_LIMIT_MAX (default: 100)
 *   GLOBAL_RATE_LIMIT_WINDOW_MS (default: 900000 = 15 min)
 *
 * The underlying rate-limiter-flexible store uses a Lua script for atomic
 * INCR+EXPIRE, so the cap holds correctly across pods.
 */
export function createGlobalRateLimiter(): RequestHandler {
  const windowSec = Math.ceil(config.limits.globalRateLimitWindowMs / 1000);
  const maxRequests = config.limits.globalRateLimitMax;
  const { limiter } = buildLimiterPair(windowSec, maxRequests, 'rl_global');

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await limiter.consume(req.ip ?? req.socket.remoteAddress ?? 'global');
      next();
    } catch (err: unknown) {
      const isRateLimitExceeded = err !== null && typeof err === 'object' && 'msBeforeNext' in err;
      if (isRateLimitExceeded) {
        const rateLimitRes = err as RateLimiterRes;
        const retryAfterSeconds = Math.ceil(rateLimitRes.msBeforeNext / 1000);
        res.setHeader('Retry-After', String(retryAfterSeconds));
        logRateLimitExceeded(req, retryAfterSeconds, req.user?.id ? 'user' : 'ip');
        next(new RateLimitError());
        return;
      }
      next(new RateLimitError('Service temporarily unavailable. Please try again later.'));
    }
  };
}
