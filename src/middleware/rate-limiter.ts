import { Request, Response, NextFunction, RequestHandler } from 'express';
import { AppError } from '../errors/app-errors';

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests, please try again later.') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

interface RateLimitStore {
  count: number;
  resetAt: number;
}

/**
 * In-Memory Rate Limiter Middleware
 * 
 * Protects endpoints against brute-force and DoS attacks.
 * Note: In a multi-node production environment, this should be replaced
 * with a Redis-backed rate limiter (e.g., rate-limiter-flexible).
 */
export const createRateLimiter = (windowMs: number, maxRequests: number): RequestHandler => {
  const store = new Map<string, RateLimitStore>();

  return (req: Request, res: Response, next: NextFunction) => {
    // Use IP address as the identifier. 
    // In production behind a proxy, ensure req.ip is correctly populated (trust proxy).
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    let record = store.get(key);

    if (!record || now > record.resetAt) {
      // Create new window
      record = { count: 1, resetAt: now + windowMs };
      store.set(key, record);
      return next();
    }

    record.count++;

    if (record.count > maxRequests) {
      // Calculate how long to wait
      const retryAfterSeconds = Math.ceil((record.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfterSeconds);
      return next(new RateLimitError());
    }

    store.set(key, record);
    next();
  };
};
