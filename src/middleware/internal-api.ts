/**
 * Internal API key middleware.
 *
 * Some endpoints (e.g. POST /auth/token) are only intended to be called
 * server-side from within our own infrastructure — never by end users.
 * This middleware enforces that by requiring an `x-internal-api-key` header
 * whose value must match the INTERNAL_API_KEY environment variable.
 *
 * Usage:
 *   router.post('/token', requireInternalApiKey, handler);
 *
 * In development / test the check is skipped when INTERNAL_API_KEY is not
 * set, so existing tests keep working without configuration changes.
 * In production the server will refuse to start if INTERNAL_API_KEY is absent
 * (enforced in config/index.ts).
 */
import { type Request, type Response, type NextFunction } from 'express';
import { AppError } from '../errors/app-errors';

class ForbiddenInternalError extends AppError {
  constructor() {
    super('Forbidden: internal endpoint', 403, 'FORBIDDEN_INTERNAL');
  }
}

export function requireInternalApiKey(req: Request, _res: Response, next: NextFunction): void {
  const configuredKey = process.env.INTERNAL_API_KEY;

  // In test / dev without the key configured, allow through so existing
  // tests are unaffected. In production, config validation ensures the key
  // is present before the server starts.
  if (!configuredKey) {
    return next();
  }

  const provided = req.headers['x-internal-api-key'];
  const providedKey = Array.isArray(provided) ? provided[0] : provided;

  if (!providedKey || providedKey !== configuredKey) {
    return next(new ForbiddenInternalError());
  }

  next();
}
