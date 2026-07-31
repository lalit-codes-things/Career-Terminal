/**
 * Redis health checker.
 * Issues a PING command and measures round-trip latency.
 */
import Redis, { type RedisOptions } from 'ioredis';
import { readFileSync } from 'fs';
import { type IHealthChecker, type HealthCheckResult } from '../health.types';
import { config } from '../../../config';

export class RedisChecker implements IHealthChecker {
  readonly name = 'redis';

  private readonly client: Redis;

  constructor() {
    const clientConfig: RedisOptions = {
      host: config.redisCache.host ?? config.redis.host,
      port: config.redisCache.port ?? config.redis.port,
      password: config.redisCache.password ?? config.redis.password,
      db: config.redisCache.db ?? config.redis.db,
      lazyConnect: true,
      connectTimeout: 3_000,
      commandTimeout: 3_000,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
    };

    if (config.redisAcl.username) {
      clientConfig.username = config.redisAcl.username;
    }

    if (config.redisAcl.tlsEnabled) {
      clientConfig.tls = {
        ca: config.redisAcl.tlsCaPath ? readFileSync(config.redisAcl.tlsCaPath) : undefined,
        rejectUnauthorized: true,
      };
    }

    this.client = new Redis(clientConfig);

    // Suppress unhandled error events on the health-check client.
    this.client.on('error', () => {
      /* intentionally silent */
    });
  }

  async check(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const response = await this.client.ping();
      const latencyMs = Date.now() - start;
      return {
        name: this.name,
        status: response === 'PONG' ? 'healthy' : 'degraded',
        message: response,
        latencyMs,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        name: this.name,
        status: 'unhealthy',
        message: message.slice(0, 200),
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
      };
    }
  }
}

export const redisChecker = new RedisChecker();
