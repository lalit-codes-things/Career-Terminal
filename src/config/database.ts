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
  process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'];

function enrichUrl(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return undefined;
  try {
    const url = new URL(baseUrl);
    if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', '20');
    if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '10');
    return url.toString();
  } catch {
    return baseUrl;
  }
}

export const prisma: PrismaClient =
  g.prisma ??
  new PrismaClient({
    datasources: { db: { url: enrichUrl(process.env.DATABASE_URL) } },
    log: logLevels,
  });

if (process.env.NODE_ENV !== 'production') {
  g.prisma = prisma;
}

// ---------------------------------------------------------------------------
// Replica client (reads)
// Falls back to master when DATABASE_REPLICA_URL is absent.
// ---------------------------------------------------------------------------

const replicaUrl = process.env.DATABASE_REPLICA_URL;

export const prismaReplica: PrismaClient =
  g.prismaReplica ??
  (replicaUrl
    ? new PrismaClient({
        datasources: { db: { url: enrichUrl(replicaUrl) } },
        log: logLevels,
      })
    : prisma); // same reference → zero overhead when no replica is configured

if (process.env.NODE_ENV !== 'production') {
  g.prismaReplica = prismaReplica;
}

// ---------------------------------------------------------------------------
// DatabaseRouter singleton — import this everywhere
// ---------------------------------------------------------------------------

export const dbRouter = new DatabaseRouter(prisma, prismaReplica);
