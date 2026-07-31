/**
 * Internal API key middleware (Epic 0.7 hardened).
 *
 * Some endpoints (e.g. POST /auth/token) are only intended to be called
 * server-side from within our own infrastructure — never by end users.
 * This middleware enforces that by requiring an `x-internal-api-key` header
 * whose value must match the INTERNAL_API_KEY environment variable.
 *
 * Security hardening (Epic 0.7):
 *   - Comparison uses timingSafeStringEqual() to prevent timing attacks.
 *     A constant-time compare ensures an attacker cannot measure how many
 *     leading bytes of their guess matched the real key.
 *   - The provided key value is NEVER logged (redacted to [REDACTED]).
 *   - The configured key is read from config (centralised secret boundary),
 *     not directly from process.env.
 *
 * Usage:
 *   router.post('/token', requireInternalApiKey, handler);
 *
 * In development / test the check is skipped when INTERNAL_API_KEY is not
 * set, so existing tests keep working without configuration changes.
 * In production the server will refuse to start if INTERNAL_API_KEY is absent
 * (enforced in config/index.ts validateSecrets()).
 */
import { type Request, type Response, type NextFunction } from 'express';
import { AppError } from '../errors/app-errors';
import { timingSafeStringEqual } from '../utils/secure-compare';
import { logger } from '../lib/logger';
import { config } from '../config';

class ForbiddenInternalError extends AppError {
  constructor() {
    super('Forbidden: internal endpoint', 403, 'FORBIDDEN_INTERNAL');
  }
}

export function requireInternalApiKey(req: Request, _res: Response, next: NextFunction): void {
  const configuredKey = config.internalApiKey;

  // In test / dev without the key configured, allow through so existing
  // tests are unaffected. In production, config validation ensures the key
  // is present before the server starts.
  if (!configuredKey) {
    return next();
  }

  const provided = req.headers['x-internal-api-key'];
  const providedKey = Array.isArray(provided) ? provided[0] : provided;

  if (!providedKey) {
    logger.warn('[security] internal_api_key_missing', {
      event: 'internal_api_key_missing',
      ip: req.ip,
      path: req.path,
      requestId: req.requestId,
    });
    return next(new ForbiddenInternalError());
  }

  // Timing-safe comparison prevents brute-force enumeration via response latency
  if (!timingSafeStringEqual(configuredKey, providedKey)) {
    logger.warn('[security] internal_api_key_invalid', {
      event: 'internal_api_key_invalid',
      ip: req.ip,
      path: req.path,
      requestId: req.requestId,
      // NEVER log the actual provided key value
      providedKey: '[REDACTED]',
    });
    return next(new ForbiddenInternalError());
  }

  next();
}
