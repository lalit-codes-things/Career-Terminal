/**
 * Database connection management.
 *
 * Exports three things:
 *
 *  1. `prisma`        — the master (read-write) Prisma client singleton.
 *                       Use this for all writes (INSERT/UPDATE/DELETE).
 *
 *  2. `prismaReplica` — a read-only replica client singleton.
 *                       Falls back to `prisma` (master) if DATABASE_REPLICA_URL
 *                       is not configured, so the app works out-of-the-box in
 *                       dev/test without a replica.
 *
 *  3. `dbRouter`      — the DatabaseRouter instance. Import this wherever you
 *                       previously imported `prisma` directly and call
 *                       `dbRouter.read()` / `dbRouter.write()` to route
 *                       automatically.
 *
 * Prevents connection exhaustion during hot-reloads in development by
 * stashing clients on the global object (standard Prisma pattern).
 */
import { PrismaClient } from '@prisma/client';
import { DatabaseRouter } from '../db/database-router';
import { config } from './index';
import { attachRlsMiddleware } from '../middleware/rls';

// ---------------------------------------------------------------------------
// Global stash (hot-reload safety)
// ---------------------------------------------------------------------------

const g = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaReplica: PrismaClient | undefined;
};

// ---------------------------------------------------------------------------
// Master client (writes)
// ---------------------------------------------------------------------------

const logLevels: ('query' | 'warn' | 'error')[] =
  config.nodeEnv === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'];

function enrichUrl(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return undefined;
  try {
    const url = new URL(baseUrl);
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', String(config.limits.maxQueryParams));
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', String(config.databasePoolTimeout / 1000));
    }
    if (!url.searchParams.has('connect_timeout')) {
      url.searchParams.set('connect_timeout', String(config.databaseTimeout / 1000));
    }
    return url.toString();
  } catch {
    return baseUrl;
  }
}

export const prisma: PrismaClient =
  g.prisma ??
  new PrismaClient({
    datasources: { db: { url: enrichUrl(config.databaseUrl) } },
    log: logLevels,
  });

// Attach RLS middleware — sets app.current_user_id before each model query
attachRlsMiddleware(prisma);

if (config.nodeEnv !== 'production') {
  g.prisma = prisma;
}

// ---------------------------------------------------------------------------
// Replica client (reads)
// ---------------------------------------------------------------------------

const replicaUrl = config.databaseReplicaUrl;

export const prismaReplica: PrismaClient =
  g.prismaReplica ??
  (replicaUrl
    ? new PrismaClient({
        datasources: { db: { url: enrichUrl(replicaUrl) } },
        log: logLevels,
      })
    : prisma);

// Attach RLS middleware to replica as well
attachRlsMiddleware(prismaReplica);

if (config.nodeEnv !== 'production') {
  g.prismaReplica = prismaReplica;
}

// ---------------------------------------------------------------------------
// DatabaseRouter singleton — import this everywhere
// ---------------------------------------------------------------------------

export const dbRouter = new DatabaseRouter(prisma, prismaReplica);
