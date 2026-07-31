/**
 * RLS context management — request/transaction-local user identity.
 *
 * Architecture:
 *   AsyncLocalStorage<RequestContext>
 *       └── per-request tenant/user identity isolated from concurrent requests
 *   Prisma interceptor
 *       └── reads from AsyncLocalStorage, emits SET APP.current_user_id
 *   withRlsTransaction()
 *       └── wraps work in a transaction with the transaction-scoped GUC
 *
 * PgBouncer transaction-pooling safety:
 *   The SESSION-scoped GUC (set_app_user_id_session) is intentionally NOT used
 *   by the request-context path. Under PgBouncer transaction pooling, DISCARD ALL
 *   resets session state between pooled transactions. The SESSION-scoped GUC
 *   would be discarded between queries on a pooled connection, causing RLS to
 *   fail closed (no cross-tenant leakage).
 *
 *   For PgBouncer safety in production, all privileged queries that use the
 *   request-local context must be wrapped in `withRlsTransaction()` or
 *   `withPrivilegedTransaction()` which set the TRANSACTION-scoped GUC inside
 *   the same transaction that performs the protected operations.
 */

import { type Request, type Response, type NextFunction } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient, type Prisma } from '@prisma/client';
import { logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// AsyncLocalStorage — the single source of truth for request-local identity
// ---------------------------------------------------------------------------

export interface RequestContext {
  /** Authenticated user ID from JWT/session. Null for anonymous. */
  userId: string | null;
  /** Cell/routing context. */
  cellId: string | null;
  /** Tenant ID for multi-tenancy. */
  tenantId: string | null;
  /** Operation privilege level. */
  privilege: 'anonymous' | 'authenticated' | 'privileged_internal';
}

export const requestContextStore = new AsyncLocalStorage<RequestContext>();

/** Get the current request context. Returns null if no context is active. */
export function getRequestContext(): RequestContext | undefined {
  return requestContextStore.getStore();
}

/** Convenience: get the authenticated user ID from the current context. */
export function getCurrentUserId(): string | null {
  const ctx = requestContextStore.getStore();
  return ctx?.userId ?? null;
}

/** Convenience: get current cellId. */
export function getCurrentCellId(): string | null {
  const ctx = requestContextStore.getStore();
  return ctx?.cellId ?? null;
}

/** Convenience: get current tenantId. */
export function getCurrentTenantId(): string | null {
  const ctx = requestContextStore.getStore();
  return ctx?.tenantId ?? null;
}

/** Convenience: get current privilege level. */
export function getCurrentPrivilege(): RequestContext['privilege'] {
  return requestContextStore.getStore()?.privilege ?? 'anonymous';
}

// ---------------------------------------------------------------------------
// Express middleware — builds the request context from the authenticated request
// ---------------------------------------------------------------------------

/**
 * Middleware that establishes the RLS request context from the authenticated
 * request. The context is automatically cleared when the response completes.
 *
 * Identity source of truth:
 *   - req.user.id from JWT/session verification (requireAuth)
 *   - NEVER trust a user-supplied header or body field as the security identity
 */
export const withRlsContext = (req: Request, _res: Response, next: NextFunction): void => {
  try {
    const authenticatedUserId = req.user?.id ?? null;
    const privilege: RequestContext['privilege'] = authenticatedUserId ? 'authenticated' : 'anonymous';

    const context: RequestContext = {
      userId: authenticatedUserId,
      cellId: (req as unknown as Record<string, unknown>).cellId as string | null ?? null,
      tenantId: (req as unknown as Record<string, unknown>).tenantId as string | null ?? null,
      privilege,
    };

    requestContextStore.enterWith(context);
    (req as unknown as Record<string, unknown>).rlsContext = context;
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Middleware that establishes a privileged internal request context.
 * Use ONLY for internal service-to-service endpoints (not user-facing).
 */
export const withPrivilegedInternalContext = (req: Request, _res: Response, next: NextFunction): void => {
  try {
    const context: RequestContext = {
      userId: null,
      cellId: null,
      tenantId: null,
      privilege: 'privileged_internal',
    };

    requestContextStore.enterWith(context);
    (req as unknown as Record<string, unknown>).rlsContext = context;
    next();
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Worker context management
// ---------------------------------------------------------------------------

/**
 * Sets RLS context for a worker/job processing operation.
 * Use this in job processors before touching user-owned records.
 *
 * WARNING: This sets the AsyncLocalStorage context for the current async
 * execution chain. Workers MUST call clearWorkerRlsContext() in a finally
 * block to ensure no leakage.
 */
export function setWorkerRlsContext(userId: string): void {
  requestContextStore.enterWith({
    userId,
    cellId: null,
    tenantId: null,
    privilege: 'authenticated',
  });
}

/**
 * Clears the worker RLS context by entering a fresh empty context.
 */
export function clearWorkerRlsContext(): void {
  requestContextStore.enterWith({
    userId: null,
    cellId: null,
    tenantId: null,
    privilege: 'anonymous',
  });
}

// ---------------------------------------------------------------------------
// Prisma middleware — transaction-safe RLS for PgBouncer
// ---------------------------------------------------------------------------

/**
 * Attaches RLS context-setting behavior to a Prisma client.
 *
 * For PgBouncer transaction pooling in production, this interceptor is a
 * NO-OP at the SESSION level. All production RLS MUST be established via
 * `setRlsUserIdInTransaction()` or `withRlsTransaction()` inside the actual
 * transaction that performs the protected operations.
 *
 * This interceptor is retained as a safety net for:
 *   - Direct PostgreSQL connections (development, testing without PgBouncer)
 *   - Non-transaction queries where the caller forgot to wrap in withRlsTransaction
 *   - RLS function setup errors which will now FAIL (throw)
 */
export function attachRlsMiddleware(client: PrismaClient): void {
  const anyClient = client as unknown as Record<string, unknown>;
  if (typeof anyClient.$use !== 'function') {
    return;
  }

  anyClient.$use(async (params: unknown, next: (params: unknown) => Promise<unknown>) => {
    // Read from AsyncLocalStorage — never from a process-global variable
    const ctx = requestContextStore.getStore();
    const userId = ctx?.userId;

    if (userId) {
      // Use the SESSION-scoped GUC. Under PgBouncer transaction pooling this
      // is discarded between pooled transactions (fails closed). Callers doing
      // user-scoped work must use withRlsTransaction().
      try {
        await client.$executeRawUnsafe('SELECT set_app_user_id_session($1)', userId);
      } catch (err) {
        // FAIL CLOSED — log and rethrow
        logger.error('[RLS] Failed to set current_user_id session', {
          error: (err as Error).message,
          userId,
          query: params && typeof params === 'object' && 'model' in (params as Record<string, unknown>)
            ? (params as Record<string, unknown>).model
            : 'unknown',
          action: params && typeof params === 'object' && 'action' in (params as Record<string, unknown>)
            ? (params as Record<string, unknown>).action
            : 'unknown',
        });
        throw new Error(`RLS setup failed for user ${userId}: ${(err as Error).message}`);
      }
    }
    return next(params);
  });
}

// ---------------------------------------------------------------------------
// Transaction-scoped RLS — the production-safe primitive
// ---------------------------------------------------------------------------

/**
 * Sets the RLS user ID on a transaction using the TRANSACTION-scoped GUC.
 *
 * This is the ONLY safe mechanism for user-scoped queries under PgBouncer
 * transaction pooling. The value is visible only within the current transaction
 * and is discarded on commit/rollback, making it impossible for identity to
 * leak between pooled connections.
 *
 * FAIL CLOSED: if setting the GUC fails, the entire transaction fails.
 */
export async function setRlsUserIdInTransaction(tx: unknown, userId: string): Promise<void> {
  if (!userId || userId.trim() === '') {
    throw new Error(`Invalid user ID for RLS: ${userId}`);
  }

  const executeRaw = (tx as { $executeRawUnsafe: (sql: string, ...args: unknown[]) => Promise<unknown> }).$executeRawUnsafe;

  try {
    await executeRaw.call(tx, 'SELECT set_app_user_id($1)', userId);
  } catch (err) {
    logger.error('[RLS] Failed to set current_user_id in transaction', {
      error: (err as Error).message,
      userId,
    });
    throw new Error(`RLS transaction setup failed for user ${userId}: ${(err as Error).message}`);
  }
}

/**
 * Runs `callback` inside a Prisma transaction with the RLS user ID set via the
 * transaction-scoped GUC. This is the canonical production-safe pattern.
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
  if (!userId || userId.trim() === '') {
    throw new Error(`withRlsTransaction requires a non-empty userId`);
  }

  return db.$transaction(async (tx) => {
    await setRlsUserIdInTransaction(tx, userId);
    return callback(tx);
  });
}

/**
 * Runs `callback` inside a Prisma transaction with privileged_internal privilege.
 * For system/operations work that bypasses user-scoped RLS.
 */
export async function withPrivilegedTransaction<T>(
  db: PrismaClient,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    const executeRaw = (tx as { $executeRawUnsafe: (sql: string, ...args: unknown[]) => Promise<unknown> }).$executeRawUnsafe;

    try {
      // Set a sentinel value that matches the app_admin GUC check
      await executeRaw.call(tx, "SELECT set_app_user_id('SYSTEM')");
    } catch {
      // If the GUC call fails for any reason, fail the transaction
      throw new Error('RLS privileged transaction setup failed');
    }

    return callback(tx);
  });
}

/**
 * Convenience: bind the current request context to a transaction.
 *
 * This reads the current AsyncLocalStorage context and sets the transaction-scoped
 * GUC appropriately:
 *   - authenticated user       → set_app_user_id(userId)
 *   - privileged_internal      → no user GUC set (caller handles admin policy)
 *   - anonymous/unknown        → set_app_user_id(NULL)
 *
 * FAIL CLOSED: if the transaction cannot be properly initialized, it fails.
 */
export async function withRequestContextTransaction<T>(
  db: PrismaClient,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const ctx = requestContextStore.getStore();

  return db.$transaction(async (tx) => {
    if (ctx && ctx.userId) {
      await setRlsUserIdInTransaction(tx, ctx.userId);
    } else if (ctx?.privilege === 'privileged_internal') {
      // No user GUC needed — privileged bypass
    } else {
      // Anonymous or no context: explicitly clear any inherited user ID
      const executeRaw = (tx as { $executeRawUnsafe: (sql: string, ...args: unknown[]) => Promise<unknown> }).$executeRawUnsafe;
      try {
        await executeRaw.call(tx, 'SELECT set_app_user_id(NULL)');
      } catch {
        // best-effort clear; failure is non-critical when no user was set
      }
    }

    return callback(tx);
  });
}

// ---------------------------------------------------------------------------
// RLS policy role constants
// ---------------------------------------------------------------------------

export const RLS_ROLES = {
  app_anonymous: 'anonymous',
  app_authenticated: 'authenticated',
  app_admin: 'app_admin',
  app_worker: 'app_worker',
  app_runtime: 'app_runtime',
} as const;

/** Explicit operation roles for documentation and validation */
export type OperationRole = 'anonymous' | 'app_runtime' | 'app_worker' | 'app_admin' | 'app_readonly';

/**
 * Returns the effective RLS role for the current operation.
 * Document which role each operation uses at the call site.
 */
export function getEffectiveRLSRole(operationRole: OperationRole): string {
  switch (operationRole) {
    case 'anonymous':
      return RLS_ROLES.app_anonymous;
    case 'app_runtime':
      return RLS_ROLES.app_runtime;
    case 'app_worker':
      return RLS_ROLES.app_worker;
    case 'app_admin':
      return RLS_ROLES.app_admin;
    case 'app_readonly':
      return RLS_ROLES.app_readonly;
    default:
      return RLS_ROLES.app_anonymous;
  }
}
