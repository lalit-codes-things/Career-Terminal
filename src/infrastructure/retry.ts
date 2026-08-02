import { logger } from '../lib/logger';

export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitter: boolean;
  retryOn?: (error: Error) => boolean;
}

const defaultRetryOptions: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  jitter: true,
};

function calculateDelay(attempt: number, options: RetryOptions): number {
  let delay = options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt);
  delay = Math.min(delay, options.maxDelayMs);
  if (options.jitter) {
    delay = delay * (0.5 + Math.random() * 0.5);
  }
  return delay;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>,
): Promise<T> {
  const retryOptions = { ...defaultRetryOptions, ...options };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retryOptions.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;

      if (retryOptions.retryOn && !retryOptions.retryOn(lastError)) {
        throw lastError;
      }

      if (attempt === retryOptions.maxRetries) {
        logger.error('Retry attempts exhausted', {
          attempts: attempt + 1,
          error: lastError.message,
        });
        throw lastError;
      }

      const delay = calculateDelay(attempt, retryOptions);

      logger.warn('Retrying operation', {
        attempt: attempt + 1,
        maxRetries: retryOptions.maxRetries,
        delayMs: Math.round(delay),
        error: lastError.message,
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // This should never be reached
  throw lastError ?? new Error('Unexpected error in retry loop');
}
