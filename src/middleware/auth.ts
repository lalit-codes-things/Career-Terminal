/**
 * Authentication middleware — stateless JWT verification.
 *
 * Every protected route runs through `requireAuth`, which:
 *  1. Extracts the Bearer token from the Authorization header.
 *  2. Verifies the JWT signature and expiry synchronously (no DB/cache hit).
 *  3. Attaches `req.user = { id: userId }` for downstream handlers.
 *
 * Refresh-token rotation is handled by the `/auth/refresh` route — not here.
 * This middleware only deals with access tokens, keeping it O(1) and stateless.
 *
 * Test environment:
 *   When NODE_ENV=test the `x-user-id` header is still accepted so existing
 *   integration tests keep working without a live JWT stack.
 */
import { type Request, type Response, type NextFunction } from 'express';
import { AppError } from '../errors/app-errors';
import { tokenService } from '../services/auth/token.service';
import { logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Augment Express Request with typed user property
// ---------------------------------------------------------------------------

export interface AuthenticatedUser {
  id: string;
  /** JWT ID — available for per-token audit logging. */
  jti?: string;
}

declare module 'express' {
  interface Request {
    user?: AuthenticatedUser;
  }
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Require a valid JWT access token on the Authorization header.
 *
 * On success  → attaches `req.user` and calls next().
 * On failure  → calls next(UnauthorizedError).
 */
export const requireAuth = (req: Request, _res: Response, next: NextFunction): void => {
  try {
    // ── Test escape-hatch (never active in production) ─────────────────────
    if (process.env.NODE_ENV === 'test') {
      const xUserId = req.headers['x-user-id'];
      const testUserId = Array.isArray(xUserId) ? xUserId[0] : xUserId;
      if (testUserId) {
        req.user = { id: testUserId };
        return next();
      }
    }

    // ── Extract Bearer token ───────────────────────────────────────────────
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError(
        'Authorization header missing or malformed. Expected: Bearer <token>',
      );
    }

    const token = authHeader.slice(7); // strip "Bearer "

    // ── Verify JWT (synchronous, stateless — no Redis/DB hit) ─────────────
    const payload = tokenService.verifyAccessToken(token);

    req.user = { id: payload.sub, jti: payload.jti };

    logger.debug('[auth] Request authenticated', { userId: payload.sub });

    next();
  } catch (err) {
    // Re-wrap all errors as UnauthorizedError so the API surface is consistent:
    // callers always receive a 401 UNAUTHORIZED, regardless of the internal
    // error type (TokenError, generic Error, etc.).
    if (err instanceof UnauthorizedError) {
      return next(err);
    }
    next(new UnauthorizedError('Authentication failed'));
  }
};

/**
 * Optional auth — populates req.user if a valid token is present,
 * but does NOT block requests without one. Useful for public routes
 * that return richer data when the caller is authenticated.
 */
export const optionalAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(); // anonymous — fine
  }

  try {
    const token = authHeader.slice(7);
    const payload = tokenService.verifyAccessToken(token);
    req.user = { id: payload.sub, jti: payload.jti };
  } catch {
    // Invalid token on an optional route — ignore silently
  }

  next();
};
