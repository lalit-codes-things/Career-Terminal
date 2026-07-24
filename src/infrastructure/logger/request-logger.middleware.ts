/**
 * Request logger and metrics middleware.
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

  logger.info('→ request', {
    requestId,
    correlationId,
    method: req.method,
    path: req.path,
    ip: req.ip ?? req.socket.remoteAddress,
  });

  const requestSize = req.headers['content-length']
    ? parseInt(req.headers['content-length'], 10)
    : 0;
  if (requestSize > 0) {
    metrics.httpRequestSize.observe({ method: req.method, path: req.path }, requestSize);
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
      path: req.path,
      status: res.statusCode,
      durationMs,
    });

    // Record metrics
    metrics.httpRequestCounter.inc({
      method: req.method,
      path: req.path,
      status_code: res.statusCode.toString(),
    });

    metrics.httpRequestDuration.observe({ method: req.method, path: req.path }, durationSec);

    const responseSize = res.getHeader('content-length');
    if (typeof responseSize === 'number') {
      metrics.httpResponseSize.observe({ method: req.method, path: req.path }, responseSize);
    }

    // Slow request logging
    if (durationMs > config.thresholds.slowRequest) {
      logger.warn('Slow request', {
        requestId,
        correlationId,
        method: req.method,
        path: req.path,
        durationMs,
        thresholdMs: config.thresholds.slowRequest,
      });
    }
  });

  next();
};
