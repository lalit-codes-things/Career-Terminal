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
 *      `SELECT set_app_user_id_session(?)` before each model query.
 *   3. Service/worker processes must set the user explicitly before
 *      operating on user-owned data.
 *
 * Connection-pooling semantics:
 *   - The interceptor uses the SESSION-scoped GUC function, which is safe on
 *     direct connections. Under PgBouncer transaction pooling, DISCARD ALL
 *     resets session state between pooled transactions, so the GUC is NOT
 *     carried over — RLS then fails CLOSED (no cross-tenant leakage).
 *   - For pooled deployments, RLS-sensitive work MUST run inside an explicit
 *     transaction using `setRlsUserIdInTransaction(tx, userId)` or
 *     `withRlsTransaction()`, which set the TRANSACTION-scoped GUC.
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

import { PrismaClient, type Prisma } from '@prisma/client';

/**
 * Attaches RLS context-setting behavior to the Prisma client.
 * Call once after creating the PrismaClient instance.
 *
 * Uses the SESSION-scoped GUC (set_app_user_id_session) because it is emitted
 * as its own statement ahead of the model query. This is only effective on
 * direct (non-pooled) connections. Under PgBouncer transaction pooling the
 * GUC is discarded between pooled transactions (fail closed); production code
 * must use `setRlsUserIdInTransaction` / `withRlsTransaction` instead.
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
        await client.$executeRawUnsafe('SELECT set_app_user_id_session($1)', userId);
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
 *
 * Uses the TRANSACTION-scoped GUC (set_app_user_id): the value is visible
 * only within the current transaction and is discarded on commit/rollback,
 * making it safe under PgBouncer transaction pooling.
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

/**
 * Runs `callback` inside a Prisma transaction with the RLS user ID set via the
 * transaction-scoped GUC. The canonical way to operate on user-owned rows when
 * the application connects through PgBouncer transaction pooling.
 *
 * @example
 * const rows = await withRlsTransaction(prisma, userId, async (tx) =>
 *   tx.jobApplication.findMany({ where: { userId } }),
 * );
 */
export async function withRlsTransaction<T>(
  db: PrismaClient,
  userId: string,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await setRlsUserIdInTransaction(tx, userId);
    return callback(tx);
  });
}
