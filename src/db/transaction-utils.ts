import { Prisma, PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';

export interface TransactionRetryOptions {
  maxRetries: number;
  baseDelayMs: number;
}

/**
 * Executes a Prisma transaction with an exponential backoff retry mechanism.
 * ONLY retries on transient serialization/deadlock errors (P2034).
 */
export async function executeWithTransientRetry<T>(
  client: PrismaClient,
  action: (tx: Prisma.TransactionClient) => Promise<T>,
  options: TransactionRetryOptions = { maxRetries: 3, baseDelayMs: 100 },
): Promise<T> {
  let attempts = 0;
  let lastError: unknown;

  do {
    try {
      return await client.$transaction(action, {
        timeout: 15000,
        maxWait: 5000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      });
    } catch (error) {
      attempts++;
      lastError = error;

      // P2034: Transaction failed due to a write conflict or a deadlock.
      const isTransient =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';

      if (!isTransient || attempts > options.maxRetries) {
        throw error;
      }

      // Exponential backoff with jitter
      const delay = options.baseDelayMs * Math.pow(2, attempts - 1) + Math.random() * 50;
      logger.warn('[TransactionUtils] Transient transaction error (P2034) caught. Retrying.', {
        attempt: attempts,
        delayMs: Math.round(delay),
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  } while (attempts <= options.maxRetries);

  throw lastError;
}
