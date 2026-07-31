/**
 * Redis connection factory.
 *
 * Provides factories for two logical Redis roles:
 *
 *   createQueueRedisClient(label)  — BullMQ + queue-side coordination.
 *                                    Uses noeviction semantics (maxmemory-policy
 *                                    must never be allkeys-lru / volatile-lru).
 *
 *   createCacheRedisClient(label)  — cache + rate-limiting + OAuth state.
 *                                    Eviction policy is acceptable here.
 *
 * Both factories share the same underlying config interface so a single
 * instance deployment continues to work. In production, deploy two separate
 * Redis instances and configure REDIS_QUEUE_* / REDIS_CACHE_* accordingly.
 */
import Redis from 'ioredis';
import { config } from './index';
import { logger } from '../lib/logger';

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  maxRetriesPerRequest?: number | null;
  timeout?: number;
  label: string;
  username?: string;
  tlsEnabled?: boolean;
  tlsCaPath?: string;
}

export function buildRedisConfig(role: 'queue' | 'cache' = 'queue'): RedisConfig {
  if (role === 'queue') {
    return {
      host: config.redisQueue.host,
      port: config.redisQueue.port,
      password: config.redisQueue.password,
      db: config.redisQueue.db,
      label: 'redis-queue',
    };
  }

  return {
    host: config.redisCache.host,
    port: config.redisCache.port,
    password: config.redisCache.password,
    db: config.redisCache.db,
    label: 'redis-cache',
  };
}

export function createRedisClient(role: 'queue' | 'cache' = 'queue', label?: string): Redis {
  const cfg = buildRedisConfig(role);
  const clientLabel = label ?? cfg.label;

  const clientConfig: Redis.RedisOptions = {
    host: cfg.host,
    port: cfg.port,
    password: cfg.password,
    db: cfg.db,
    maxRetriesPerRequest: cfg.maxRetriesPerRequest ?? null,
    retryStrategy: (times) => {
      if (times > 20) {
        logger.error(`[${clientLabel}] Redis max retries reached. Failing permanently.`);
        return null;
      }
      return Math.min(times * 200, 10_000);
    },
    commandTimeout: cfg.timeout ?? 5000,
    enableReadyCheck: false,
    lazyConnect: false,
  };

  // Apply Redis ACL username if configured
  if (config.redisAcl.username) {
    clientConfig.username = config.redisAcl.username;
  }

  // Apply TLS configuration if enabled
  if (config.redisAcl.tlsEnabled) {
    clientConfig.tls = {
      ca: config.redisAcl.tlsCaPath ? require('fs').readFileSync(config.redisAcl.tlsCaPath) : undefined,
      rejectUnauthorized: true,
    };
  }

  const client = new Redis(clientConfig);

  client.on('connect', () =>
    logger.info(`[${clientLabel}] Connected to Redis`, { host: cfg.host, port: cfg.port, role }),
  );
  client.on('error', (err: Error) =>
    logger.error(`[${clientLabel}] Redis error`, { message: err.message, role }),
  );
  client.on('reconnecting', () => logger.warn(`[${clientLabel}] Reconnecting to Redis...`));

  return client;
}

/** Shared BullMQ connection config — BullMQ manages its own socket. */
export function createBullMQConnection(): BullMQConnectionOptions {
  const cfg = buildRedisConfig('queue');
  return {
    host: cfg.host,
    port: cfg.port,
    password: cfg.password,
    db: cfg.db,
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 200, 10_000),
  };
}

export interface BullMQConnectionOptions {
  host: string;
  port: number;
  password?: string;
  db?: number;
  maxRetriesPerRequest: null;
  retryStrategy?: (times: number) => number;
}

/**
 * Singleton connection config — shared across all queues in the same process.
 * BullMQ duplicates the connection internally for each Queue/Worker.
 */
export const bullMQConnection = createBullMQConnection();
