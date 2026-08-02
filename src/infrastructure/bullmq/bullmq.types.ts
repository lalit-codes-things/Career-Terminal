/**
 * Shared BullMQ type definitions.
 *
 * Future queue modules should define their job payloads here or in their own
 * domain-specific types file, then import this base for common patterns.
 */
import type { JobsOptions } from 'bullmq';

/**
 * Standard retry policy for all queues.
 * 3 attempts with exponential backoff: 2s → 4s → 8s.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2_000,
  },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 1_000 },
};

/**
 * Base interface for all job payloads.
 * Every job must carry a userId for partition-key enforcement.
 */
export interface BaseJobPayload {
  /** The user who owns this job. Used as the partition key. */
  userId: string;
  /** ISO timestamp when the job was enqueued — for tracing. */
  enqueuedAt: string;
}

/**
 * Helper to build a typed job payload with required base fields.
 */
export function createJobPayload<T>(userId: string, data: T): T & BaseJobPayload {
  return {
    userId,
    enqueuedAt: new Date().toISOString(),
    ...data,
  };
}
