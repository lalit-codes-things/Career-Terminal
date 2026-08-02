/**
 * Shared retry policy type for company intelligence data access.
 */

export interface RetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  /** Exponential backoff multiplier between attempts. */
  backoffMultiplier: number;
  /** Add randomized jitter to backoff delays. */
  jitter: boolean;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
};

/** Build a retry policy from partial overrides. */
export function buildRetryPolicy(overrides?: Partial<RetryPolicy>): RetryPolicy {
  return { ...DEFAULT_RETRY_POLICY, ...overrides };
}
