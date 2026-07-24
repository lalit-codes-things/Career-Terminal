/**
 * Redis connection factory.
 *
 * Provides a single, reusable ioredis connection configuration consumed by
 * both the BullMQ job queue and the Redis CacheService.
 *
 * BullMQ requires its own connection instance (it calls .duplicate() internally),
 * so we export a factory function rather than a shared singleton.
 */
import Redis from 'ioredis';
import { logger } from '../lib/logger';

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  /** Database index (0–15). Defaults to 0. */
  db?: number;
  /** Max reconnection attempts before giving up. Defaults to 20. */
  maxRetriesPerRequest?: number | null;
}

function buildRedisConfig(): RedisConfig {
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB ?? '0', 10),
    // BullMQ requires this to be null (disables the default retry limit per command).
    maxRetriesPerRequest: null,
  };
}

/**
 * Creates a new ioredis client instance with standard error/connect logging.
 * Call this once per consumer (cache service, queue, worker) so each has its
 * own connection that BullMQ/ioredis can manage independently.
 */
export function createRedisClient(label = 'redis'): Redis {
  const cfg = buildRedisConfig();

  const client = new Redis({
    host: cfg.host,
    port: cfg.port,
    password: cfg.password,
    db: cfg.db,
    maxRetriesPerRequest: cfg.maxRetriesPerRequest,
    // Reconnect with exponential backoff, cap at 10 s
    retryStrategy: (times) => Math.min(times * 200, 10_000),
    enableReadyCheck: false,
    lazyConnect: false,
  });

  client.on('connect', () =>
    logger.info(`[${label}] Connected to Redis`, { host: cfg.host, port: cfg.port }),
  );
  client.on('error', (err: Error) =>
    logger.error(`[${label}] Redis error`, { message: err.message }),
  );
  client.on('reconnecting', () => logger.warn(`[${label}] Reconnecting to Redis...`));

  return client;
}

/** Shared BullMQ connection config (host/port only — BullMQ manages the socket). */
export const bullMQConnection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB ?? '0', 10),
};
