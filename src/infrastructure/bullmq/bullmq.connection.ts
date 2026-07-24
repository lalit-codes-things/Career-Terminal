/**
 * BullMQ Redis connection abstraction.
 *
 * Provides a factory for creating typed BullMQ connection objects that
 * future queue registrations can import without touching src/config/redis.ts.
 *
 * The connection object is intentionally a plain config object (not an ioredis
 * instance) because BullMQ creates and manages its own connections internally.
 *
 * Usage (in a future queue module):
 *   import { createBullMQConnection } from '../../infrastructure/bullmq/bullmq.connection';
 *   const queue = new Queue('my-queue', { connection: createBullMQConnection() });
 */

export interface BullMQConnectionOptions {
  host: string;
  port: number;
  password?: string;
  db?: number;
  /** Must be null for BullMQ — disables the per-command retry limit. */
  maxRetriesPerRequest: null;
  /** Reconnect strategy: exponential backoff capped at 10 s. */
  retryStrategy?: (times: number) => number;
}

/**
 * Creates a BullMQ-compatible Redis connection configuration.
 * Call this once per Queue or Worker constructor.
 */
export function createBullMQConnection(): BullMQConnectionOptions {
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB ?? '0', 10),
    maxRetriesPerRequest: null,
    retryStrategy: (times: number) => Math.min(times * 200, 10_000),
  };
}

/**
 * Singleton connection config — shared across all queues in the same process.
 * BullMQ duplicates the connection internally for each Queue/Worker.
 */
export const bullMQConnection = createBullMQConnection();
