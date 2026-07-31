import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger';
import { config } from '../config';

// Lazily initialized — client is NOT created at module load time.
// This prevents open handles in test environments that never call acquireLock/releaseLock.
let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    const clientConfig: Redis.RedisOptions = {
      host: config.redisCache.host ?? config.redis.host,
      port: config.redisCache.port ?? config.redis.port,
      password: config.redisCache.password ?? config.redis.password,
      db: config.redisCache.db ?? config.redis.db,
      maxRetriesPerRequest: null,
      lazyConnect: true,
      enableReadyCheck: false,
      retryStrategy: (times) => {
        if (times > 20) {
          logger.error('[mutex] Redis max retries reached. Failing permanently.');
          return null;
        }
        return Math.min(times * 200, 10_000);
      },
    };

    if (config.redisAcl.username) {
      clientConfig.username = config.redisAcl.username;
    }

    if (config.redisAcl.tlsEnabled) {
      clientConfig.tls = {
        ca: config.redisAcl.tlsCaPath ? require('fs').readFileSync(config.redisAcl.tlsCaPath) : undefined,
        rejectUnauthorized: true,
      };
    }

    _redis = new Redis(clientConfig);

    _redis.on('connect', () => logger.info('[mutex] Connected to Redis'));
    _redis.on('error', (err: Error) =>
      logger.error('[mutex] Redis error', { message: err.message }),
    );
    _redis.on('reconnecting', () => logger.warn('[mutex] Reconnecting to Redis...'));
  }
  return _redis;
}

/**
 * Acquires a distributed lock using Redis SET NX.
 * Useful for preventing concurrent processing of the same entity (e.g. duplicate email ingestion).
 *
 * @param key The unique lock key.
 * @param ttlSeconds Time-to-live for the lock to prevent deadlocks if the process crashes.
 * @returns A unique lock token if acquired, or null if it is already locked.
 */
export async function acquireLock(key: string, ttlSeconds = 30): Promise<string | null> {
  try {
    const token = uuidv4();
    const result = await getRedis().set(key, token, 'EX', ttlSeconds, 'NX');
    if (result === 'OK') {
      return token;
    }
    return null;
  } catch (err) {
    logger.error('[Mutex] Failed to acquire lock', { key, error: (err as Error).message });
    return null;
  }
}

/**
 * Releases a distributed lock using a Lua script to ensure we only delete it
 * if the token matches. This prevents accidentally deleting another process's
 * lock if our lock expired and was acquired by someone else.
 *
 * @param key The unique lock key.
 * @param token The unique token returned by acquireLock.
 */
export async function releaseLock(key: string, token: string): Promise<void> {
  try {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await getRedis().eval(script, 1, key, token);
  } catch (err) {
    logger.error('[Mutex] Failed to release lock', { key, error: (err as Error).message });
  }
}
