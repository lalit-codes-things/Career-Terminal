/**
 * RLS middleware — sets the PostgreSQL session variable `app.current_user_id`
 * for Row-Level Security policies on every request.
 *
 * This is the second, independent tenant-isolation layer. Application-level
 * authorization remains the primary defense; RLS is defense in depth.
 *
 * How it works:
 *   1. Extracts `req.user.id` from the authenticated request.
 *   2. Calls `setRlsUserId()` so the Prisma query interceptor emits
 *      `SELECT set_app_user_id(?)` before each model query.
 *   3. Service/worker processes must set the user explicitly before
 *      operating on user-owned data.
 */

import { type Request, type Response, type NextFunction } from 'express';
import { logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Per-request context
// ---------------------------------------------------------------------------

/**
 * Stores the current request-scoped user ID.
 * In production, this is set by the rls middleware per-request.
 * Workers should set it explicitly when processing jobs.
 */
let currentUserId: string | null = null;

export function getCurrentUserId(): string | null {
  return currentUserId;
}

export function setRlsUserId(userId: string): void {
  currentUserId = userId;
}

export function clearRlsUserId(): void {
  currentUserId = null;
}

// ---------------------------------------------------------------------------
// Express middleware
// ---------------------------------------------------------------------------

/**
 * Middleware that sets RLS context for authenticated requests.
 * Attaches `req.rlsUserId` to the request for downstream use.
 */
export const withRlsContext = (req: Request, _res: Response, next: NextFunction): void => {
  try {
    const userId = req.user?.id;
    if (userId) {
      setRlsUserId(userId);
      (req as unknown as Record<string, unknown>).rlsUserId = userId;
    }
    next();
  } catch (err) {
    clearRlsUserId();
    next(err);
  }
};

/**
 * Clears RLS context after the response has been sent.
 * Prevents user ID leakage between requests on reused connections.
 */
export const clearRlsContextAfterResponse = (_req: Request, _res: Response, next: NextFunction): void => {
  next();
  clearRlsUserId();
};

/**
 * Sets RLS context for a worker/job processing operation.
 * Use this in job processors before touching user-owned records.
 */
export function setWorkerRlsContext(userId: string): void {
  setRlsUserId(userId);
}

/**
 * Clears RLS context after worker processing completes.
 */
export function clearWorkerRlsContext(): void {
  clearRlsUserId();
}

// ---------------------------------------------------------------------------
// Prisma middleware — injects SET app.current_user_id before each query
// ---------------------------------------------------------------------------

import { PrismaClient } from '@prisma/client';

/**
 * Attaches RLS context-setting behavior to the Prisma client.
 * Call once after creating the PrismaClient instance.
 */
export function attachRlsMiddleware(client: PrismaClient): void {
  const anyClient = client as unknown as Record<string, unknown>;
  if (typeof anyClient.$use !== 'function') {
    return;
  }

  anyClient.$use(async (params: unknown, next: (params: unknown) => Promise<unknown>) => {
    const userId = currentUserId;
    if (userId) {
      try {
        await client.$executeRawUnsafe('SELECT set_app_user_id($1)', userId);
      } catch (err) {
        logger.warn('[RLS] Failed to set current_user_id', {
          error: (err as Error).message,
          userId,
        });
      }
    }
    return next(params);
  });
}

/**
 * Sets the RLS user ID on a transaction. Call this inside every $transaction
 * callback before performing model operations.
 */
export async function setRlsUserIdInTransaction(tx: unknown, userId: string): Promise<void> {
  try {
    await (tx as { $executeRawUnsafe: (sql: string, ...args: unknown[]) => Promise<unknown> }).$executeRawUnsafe(
      'SELECT set_app_user_id($1)',
      userId,
    );
  } catch (err) {
    logger.warn('[RLS] Failed to set current_user_id in transaction', {
      error: (err as Error).message,
      userId,
    });
  }
}
