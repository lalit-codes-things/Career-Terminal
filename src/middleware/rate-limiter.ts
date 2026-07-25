/**
 * Distributed rate limiter middleware.
 *
 * Uses Redis (via rate-limiter-flexible) when REDIS_HOST is configured,
 * falling back to an in-process memory store when Redis is unavailable.
 * This ensures rate limiting works correctly across multiple web-server
 * instances and degrades gracefully if Redis goes down.
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
 * Named presets:
 *   generalApiLimiter   — standard authenticated routes (300/15 min per user)
 *   writeLimiter        — state-changing routes (60/15 min per user)
 *   expensiveLimiter    — CPU/DB-heavy endpoints (20/15 min per user)
 *   uploadLimiter       — file upload endpoints (10/hour per user)
 *   authFloodLimiter    — auth logout flood protection (20/15 min per IP)
 */
import { type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { RateLimiterMemory, RateLimiterRedis, type RateLimiterRes } from 'rate-limiter-flexible';
import Redis from 'ioredis';
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
// Created at module load time only when REDIS_HOST is configured.
// lazyConnect + enableOfflineQueue=false ensures Redis downtime never blocks
// HTTP requests; failures fall back to the in-memory limiter.
// ---------------------------------------------------------------------------

let redisClient: Redis | null = null;

if (process.env.REDIS_HOST) {
  redisClient = new Redis({
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
  });

  // Suppress unhandled error events — failures are caught per-request below.
  redisClient.on('error', () => {
    /* handled in createRateLimiter */
  });
}

// ---------------------------------------------------------------------------
// Internal helper — build a limiter pair (Redis-backed with memory fallback)
// ---------------------------------------------------------------------------

function buildLimiterPair(
  windowSec: number,
  maxRequests: number,
  keyPrefix: string,
): { limiter: RateLimiterMemory | RateLimiterRedis; memory: RateLimiterMemory } {
  const memory = new RateLimiterMemory({
    points: maxRequests,
    duration: windowSec,
    keyPrefix,
  });

  if (!redisClient) {
    return { limiter: memory, memory };
  }

  const redis = new RateLimiterRedis({
    storeClient: redisClient,
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
// Factory: IP-keyed rate limiter
// ---------------------------------------------------------------------------

/**
 * Creates a rate limiter middleware keyed by client IP address.
 * Use for unauthenticated endpoints.
 */
export const createRateLimiter = (windowMs: number, maxRequests: number): RequestHandler => {
  const windowSec = Math.ceil(windowMs / 1000);
  const { limiter } = buildLimiterPair(windowSec, maxRequests, 'rl_ip');

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';

    try {
      await limiter.consume(key);
      next();
    } catch (err: unknown) {
      const isRateLimitExceeded = err !== null && typeof err === 'object' && 'msBeforeNext' in err;

      if (isRateLimitExceeded) {
        const rateLimitRes = err as RateLimiterRes;
        const retryAfterSeconds = Math.ceil(rateLimitRes.msBeforeNext / 1000);
        res.setHeader('Retry-After', retryAfterSeconds);
        logRateLimitExceeded(req, retryAfterSeconds, 'ip');
        next(new RateLimitError());
        return;
      }

      // Unexpected error (Redis failure not caught by insuranceLimiter) — fail open.
      next();
    }
  };
};

// ---------------------------------------------------------------------------
// Factory: User-aware rate limiter
// ---------------------------------------------------------------------------

/**
 * Creates a rate limiter middleware that:
 *  - Keys by userId when req.user is populated (authenticated request).
 *  - Falls back to IP address for anonymous requests.
 *
 * This prevents a single account from exhausting quota by rotating IP addresses.
 * Use on all authenticated API routes.
 */
export const createUserAwareRateLimiter = (
  windowMs: number,
  maxRequests: number,
): RequestHandler => {
  const windowSec = Math.ceil(windowMs / 1000);
  const { limiter } = buildLimiterPair(windowSec, maxRequests, 'rl_user');

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Key by userId if authenticated, otherwise by IP
    const key = req.user?.id ?? req.ip ?? req.socket.remoteAddress ?? 'unknown';

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

      // Fail open on unexpected errors
      next();
    }
  };
};

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
