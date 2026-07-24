import { collectDefaultMetrics, register, Counter, Histogram, Gauge } from 'prom-client';
import { config } from '../../config';
import { logger } from '../../lib/logger';

const httpRequestCounter = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status_code'],
});

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

const httpRequestSize = new Histogram({
  name: 'http_request_size_bytes',
  help: 'HTTP request size in bytes',
  labelNames: ['method', 'path'],
  buckets: [100, 1000, 10000, 100000, 1000000],
});

const httpResponseSize = new Histogram({
  name: 'http_response_size_bytes',
  help: 'HTTP response size in bytes',
  labelNames: ['method', 'path'],
  buckets: [100, 1000, 10000, 100000, 1000000],
});

const databaseQueryDuration = new Histogram({
  name: 'database_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['operation'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
});

const redisCommandDuration = new Histogram({
  name: 'redis_command_duration_seconds',
  help: 'Redis command duration in seconds',
  labelNames: ['command'],
  buckets: [0.0001, 0.001, 0.005, 0.01, 0.05, 0.1],
});

const eventLoopLagGauge = new Gauge({
  name: 'nodejs_event_loop_lag_ms',
  help: 'Node.js event loop lag in milliseconds',
});

export const metrics = {
  httpRequestCounter,
  httpRequestDuration,
  httpRequestSize,
  httpResponseSize,
  databaseQueryDuration,
  redisCommandDuration,
  eventLoopLagGauge,
};

export function initMetrics(): void {
  if (!config.telemetry.metricsEnabled) {
    logger.info('Metrics are disabled');
    return;
  }

  collectDefaultMetrics({ register });
  logger.info('Metrics initialized');
}

export function getMetrics(): Promise<string> {
  return register.metrics();
}
