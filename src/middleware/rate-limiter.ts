/**
 * Distributed rate limiter middleware.
 *
 * Uses Redis (via rate-limiter-flexible) when REDIS_HOST is configured,
 * falling back to an in-process memory store when Redis is unavailable.
 * This ensures rate limiting works correctly across multiple web-server
 * instances and degrades gracefully if Redis goes down.
 *
 * Usage:
 *   const limiter = createRateLimiter(15 * 60 * 1000, 100); // 100 req / 15 min
 *   router.get('/endpoint', limiter, handler);
 */
import { type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { RateLimiterMemory, RateLimiterRedis, type RateLimiterRes } from 'rate-limiter-flexible';
import Redis from 'ioredis';
import { AppError } from '../errors/app-errors';

// ---------------------------------------------------------------------------
// Error class — kept identical to the previous implementation so existing
// tests and error-handler logic are unaffected.
// ---------------------------------------------------------------------------

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests, please try again later.') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

// ---------------------------------------------------------------------------
// Shared Redis client for rate limiting.
// Created lazily — only when REDIS_HOST is configured.
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
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a rate limiter middleware.
 *
 * @param windowMs    - Time window in milliseconds
 * @param maxRequests - Maximum requests allowed within the window
 */
export const createRateLimiter = (windowMs: number, maxRequests: number): RequestHandler => {
  const windowSec = Math.ceil(windowMs / 1000);

  const memoryLimiter = new RateLimiterMemory({
    points: maxRequests,
    duration: windowSec,
  });

  const redisLimiter = redisClient
    ? new RateLimiterRedis({
        storeClient: redisClient,
        points: maxRequests,
        duration: windowSec,
        // Do not block if Redis is slow — fail open to memory limiter
        insuranceLimiter: memoryLimiter,
      })
    : null;

  const activeLimiter = redisLimiter ?? memoryLimiter;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';

    try {
      await activeLimiter.consume(key);
      next();
    } catch (err: unknown) {
      // RateLimiterRes thrown when limit is exceeded
      const isRateLimitExceeded = err !== null && typeof err === 'object' && 'msBeforeNext' in err;

      if (isRateLimitExceeded) {
        const rateLimitRes = err as RateLimiterRes;
        const retryAfterSeconds = Math.ceil(rateLimitRes.msBeforeNext / 1000);
        res.setHeader('Retry-After', retryAfterSeconds);
        next(new RateLimitError());
        return;
      }

      // Unexpected error (Redis failure not caught by insuranceLimiter)
      // Fall through to allow the request rather than blocking legitimate traffic.
      next();
    }
  };
};
