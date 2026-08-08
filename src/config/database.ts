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
 * 4. `createPrismaClient(role)` — creates a new PrismaClient with the
 *                       specified PostgreSQL role via connection URL options.
 *                       Use this for workers and migration processes that
 *                       need different role contexts.
 *
 * Role separation:
 *   In production, the base database user is a member of multiple roles.
 *   The `options=-c+role%3D<role>` parameter in the connection URL sets
 *   the PostgreSQL role for the session, enforcing least-privilege access.
 *
 *   app_runtime   — normal API query + DML (no DDL)
 *   app_worker    — same as runtime but for background workers
 *   app_migration — schema changes, migrations (DDL)
 *   app_readonly  — read-only reporting
 *   app_admin     — elevated operations
 *
 * Prevents connection exhaustion during hot-reloads in development by
 * stashing clients on the global object (standard Prisma pattern).
 */
import { PrismaClient } from '@prisma/client';
import { DatabaseRouter } from '../db/database-router';
import { config } from './index';
import { attachRlsMiddleware } from '../middleware/rls';
import { attachTenantExtension } from '../middleware/rls';

// ---------------------------------------------------------------------------
// Global stash (hot-reload safety)
// ---------------------------------------------------------------------------

const g = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaReplica: PrismaClient | undefined;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const logLevels: ('query' | 'warn' | 'error')[] =
  config.nodeEnv === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'];

function enrichUrl(baseUrl: string | undefined, role?: string): string | undefined {
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
    if (role && !url.searchParams.has('options')) {
      url.searchParams.set('options', `-c+role%3D${role}`);
    }
    return url.toString();
  } catch {
    return baseUrl;
  }
}

/**
 * Select the least-privilege base URL for a PostgreSQL role.
 *
 * In production each role has a dedicated login user/URL:
 *   app_runtime  → DATABASE_APP_URL (or DATABASE_URL)
 *   app_worker   → DATABASE_WORKER_URL (or DATABASE_URL)
 *   app_migration → DATABASE_MIGRATION_URL (or DATABASE_URL)
 *
 * This guarantees the application never inherits the superuser or a
 * cross-role credential: `career_terminal_runtime` is a member of exactly
 * one DML group role and cannot SET ROLE into another.
 */
export function databaseUrlForRole(role?: string): string {
  if (role === 'app_worker' && config.databaseWorkerUrl) {
    return config.databaseWorkerUrl;
  }
  if (role === 'app_migration' && config.databaseMigrationUrl) {
    return config.databaseMigrationUrl;
  }
  if (role === 'app_runtime' && config.databaseAppUrl) {
    return config.databaseAppUrl;
  }
  return config.databaseUrl;
}

/**
 * Creates a PrismaClient with the specified PostgreSQL role.
 * The role is set via the connection URL options parameter, which PostgreSQL
 * applies on session initialization. This works with direct connections and
 * PgBouncer transaction pooling (provided the login user is a member of the
 * target role).
 *
 * The base URL is chosen per role (see databaseUrlForRole) so a worker or
 * migration process never reuses the runtime credential.
 */
export function createPrismaClient(role?: string): PrismaClient {
   const roleOrDefault = role ?? config.databaseRole;
   const baseUrl = databaseUrlForRole(roleOrDefault);
   const url = enrichUrl(baseUrl, roleOrDefault);
   let client = new PrismaClient({
     datasources: { db: { url: url ?? baseUrl } },
     log: logLevels,
   });

    client = attachRlsMiddleware(client);
    client = attachTenantExtension(client);

    return client;
 }

// ---------------------------------------------------------------------------
// Master client (writes) — default to app_runtime role
// ---------------------------------------------------------------------------

export const prisma: PrismaClient = g.prisma ?? createPrismaClient(config.databaseRole);

if (config.nodeEnv !== 'production') {
  g.prisma = prisma;
}

// ---------------------------------------------------------------------------
// Replica client (reads) — uses DATABASE_REPLICA_URL when configured
// ---------------------------------------------------------------------------

const replicaUrl = config.databaseReplicaUrl;

export const prismaReplica: PrismaClient =
  g.prismaReplica ??
  (replicaUrl
    ? (() => {
        let client = new PrismaClient({
          datasources: { db: { url: replicaUrl } },
          log: logLevels,
        });
        client = attachRlsMiddleware(client);
        return attachTenantExtension(client);
      })()
    : prisma);

if (config.nodeEnv !== 'production') {
  g.prismaReplica = prismaReplica;
}

// ---------------------------------------------------------------------------
// DatabaseRouter singleton — import this everywhere
// ---------------------------------------------------------------------------

export const dbRouter = new DatabaseRouter(prisma, prismaReplica);
