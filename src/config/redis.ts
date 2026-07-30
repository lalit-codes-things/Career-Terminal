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
import { config } from './index';

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  maxRetriesPerRequest?: number | null;
}

export function buildRedisConfig(): RedisConfig {
  return {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    db: config.redis.db,
    maxRetriesPerRequest: null,
  };
}

export function createRedisClient(label = 'redis'): Redis {
  const cfg = buildRedisConfig();

  const client = new Redis({
    host: cfg.host,
    port: cfg.port,
    password: cfg.password,
    db: cfg.db,
    maxRetriesPerRequest: cfg.maxRetriesPerRequest,
    retryStrategy: (times) => {
      if (times > 20) {
        logger.error(`[${label}] Redis max retries reached. Failing permanently.`);
        return null;
      }
      return Math.min(times * 200, 10_000);
    },
    commandTimeout: 5000,
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
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  db: config.redis.db,
};
