/**
 * Redis health checker.
 * Issues a PING command and measures round-trip latency.
 */
import Redis from 'ioredis';
import { type IHealthChecker, type HealthCheckResult } from '../health.types';

export class RedisChecker implements IHealthChecker {
  readonly name = 'redis';

  private readonly client: Redis;

  constructor() {
    this.client = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB ?? '0', 10),
      lazyConnect: true,
      connectTimeout: 3_000,
      commandTimeout: 3_000,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
    });

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
