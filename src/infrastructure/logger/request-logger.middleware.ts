/**
 * Request logger and metrics middleware (hardened).
 *
 * Privacy controls added:
 *   - Authorization header value is never logged (only presence noted).
 *   - Cookie header value is never logged.
 *   - Request body is NOT logged (prevents PII / token leakage).
 *   - Query string is not included in the logged path to prevent
 *     token-in-URL leakage (e.g. ?code=, ?token=, ?state=).
 *   - x-user-id (test bypass header) is never logged.
 *   - x-internal-api-key is never logged.
 *
 * What IS logged:
 *   - requestId, correlationId (for correlation only — no user identity)
 *   - HTTP method, path (without query string)
 *   - Client IP (may be subject to regional privacy requirements)
 *   - Response status code, duration
 */
import { type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '../../lib/logger';
import { metrics } from '../telemetry/metrics';
import { config } from '../../config';

// ── Augment Express Request ───────────────────────────────────────────────────
declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
    correlationId: string;
    traceId?: string;
    spanId?: string;
  }
}

/**
 * Headers that must never appear in logs — their presence may be noted but
 * their values are always [REDACTED].
 */
const REDACTED_REQUEST_HEADERS = new Set([
  'authorization',
  'cookie',
  'x-user-id',
  'x-internal-api-key',
  'x-api-key',
  'x-auth-token',
]);

/**
 * Sanitize the URL path for logging: strip query string to prevent
 * tokens (e.g. ?code=..., ?state=...) from appearing in logs.
 */
function sanitizePathForLog(req: Request): string {
  // Only log the pathname, not the query string
  return req.path;
}

/**
 * Attach requestId + correlationId, set response headers, log request/response, and record metrics.
 */
export const requestLogger: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const requestId = randomUUID();
  const correlationId =
    (Array.isArray(req.headers['x-correlation-id'])
      ? req.headers['x-correlation-id'][0]
      : req.headers['x-correlation-id']) ?? requestId;

  req.requestId = requestId;
  req.correlationId = correlationId;

  res.setHeader('x-request-id', requestId);
  res.setHeader('x-correlation-id', correlationId);

  const startAt = process.hrtime();
  const safePath = sanitizePathForLog(req);

  logger.info('→ request', {
    requestId,
    correlationId,
    method: req.method,
    path: safePath,
    // Log whether sensitive headers are present (not their values)
    hasAuthorization: !!req.headers['authorization'],
    hasCookie: !!req.headers['cookie'],
    ip: req.ip ?? req.socket.remoteAddress,
    // DO NOT log: req.body, req.query, authorization value, cookie value
  });

  const requestSize = req.headers['content-length']
    ? parseInt(req.headers['content-length'], 10)
    : 0;
  if (requestSize > 0) {
    metrics.httpRequestSize.observe({ method: req.method, path: safePath }, requestSize);
  }

  res.on('finish', () => {
    const [sec, nanosec] = process.hrtime(startAt);
    const durationMs = sec * 1000 + nanosec / 1000000;
    const durationSec = durationMs / 1000;

    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level]('← response', {
      requestId,
      correlationId,
      method: req.method,
      path: safePath,
      status: res.statusCode,
      durationMs,
    });

    // Record metrics — use path without query string to avoid token cardinality explosion
    metrics.httpRequestCounter.inc({
      method: req.method,
      path: safePath,
      status_code: res.statusCode.toString(),
    });

    metrics.httpRequestDuration.observe({ method: req.method, path: safePath }, durationSec);

    const responseSize = res.getHeader('content-length');
    if (typeof responseSize === 'number') {
      metrics.httpResponseSize.observe({ method: req.method, path: safePath }, responseSize);
    }

    // Slow request logging
    if (durationMs > config.thresholds.slowRequest) {
      logger.warn('Slow request', {
        requestId,
        correlationId,
        method: req.method,
        path: safePath,
        durationMs,
        thresholdMs: config.thresholds.slowRequest,
      });
    }
  });

  next();
};

// Export for use in tests
export { REDACTED_REQUEST_HEADERS };
