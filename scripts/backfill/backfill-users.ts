/**
 * User Identity Backfill Script — Prompt 1.
 *
 * Idempotently creates `users` and `candidate_profiles` rows for every
 * distinct `legacyUserId` found in the existing user-scoped tables:
 *   - job_applications
 *   - email_messages
 *   - user_resumes
 *   - sync_jobs
 *   - gmail_sync_state
 *   - user_email_connections
 *
 * If the legacy `legacyUserId` is already a valid UUID, it is reused as the
 * user's primary key (no mapping needed). Otherwise a new v7 UUID is issued
 * and a row is written to `user_id_mapping`.
 *
 * After user creation, the script updates the `user_id` FK on each of the
 * tables above so that subsequent queries can join through the canonical
 * `users` table.  The `legacyUserId` column is preserved for the entire
 * migration window.
 *
 * Usage:
 *   npx tsx scripts/backfill/backfill-users.ts [--dry-run] [--batch-size=500]
 *
 * The script is repeatable and safe to run multiple times.
 */
import 'dotenv/config';
import { prisma } from '../../src/config/database';
import { userService } from '../../src/services/user';
import { isValidUuid } from '../../src/utils/user-ownership';
import { logger } from '../../src/lib/logger';

const BATCH_SIZE = Number.parseInt(process.env.BATCH_SIZE ?? '500', 10);
const DRY_RUN = process.argv.includes('--dry-run');

type LegacyIdRow = { legacyUserId: string };

const LEGACY_COLUMNS: ReadonlyArray<{
  table: string;
  /** Prisma-generated camelCase name (we use a raw query). */
  idColumn: string;
}> = [
  { table: 'job_applications', idColumn: 'id' },
  { table: 'email_messages', idColumn: 'id' },
  { table: 'user_resumes', idColumn: 'id' },
  { table: 'sync_jobs', idColumn: 'id' },
  { table: 'gmail_sync_state', idColumn: 'id' },
  { table: 'user_email_connections', idColumn: 'id' },
];

async function collectDistinctLegacyUserIds(): Promise<string[]> {
  const unions = LEGACY_COLUMNS.map(
    (t) =>
      `SELECT DISTINCT legacy_user_id AS id FROM ${t.table} WHERE legacy_user_id IS NOT NULL`,
  ).join(' UNION ');

  const result = (await prisma.$queryRawUnsafe<Array<{ id: string }>>(unions)) as Array<{
    id: string;
  }>;

  return result.map((row) => row.id).filter(Boolean);
}

async function backfillUsers(legacyIds: readonly string[]): Promise<{
  created: number;
  alreadyExisted: number;
  failures: Array<{ id: string; error: string }>;
}> {
  let created = 0;
  let alreadyExisted = 0;
  const failures: Array<{ id: string; error: string }> = [];

  for (let i = 0; i < legacyIds.length; i += BATCH_SIZE) {
    const batch = legacyIds.slice(i, i + BATCH_SIZE);
    logger.info('[backfill-users] Processing batch', {
      start: i,
      batchSize: batch.length,
      total: legacyIds.length,
    });

    await Promise.all(
      batch.map(async (legacyId) => {
        try {
          const internalId = isValidUuid(legacyId)
            ? legacyId
            : await userService.resolveUserId(legacyId);

          const existing = await prisma.user.findUnique({ where: { id: internalId } });
          if (existing) {
            alreadyExisted++;
            return;
          }

          if (DRY_RUN) {
            created++;
            return;
          }

          await userService.getOrCreateUser(legacyId);
          created++;
        } catch (err) {
          failures.push({
            id: legacyId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
  }

  return { created, alreadyExisted, failures };
}

async function backfillForeignKeys(legacyIds: readonly string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  for (const { table, idColumn } of LEGACY_COLUMNS) {
    let updated = 0;

    for (let i = 0; i < legacyIds.length; i += BATCH_SIZE) {
      const batch = legacyIds.slice(i, i + BATCH_SIZE);
      const inClause = batch.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
      if (!inClause) continue;

      const cases = batch
        .map((legacyId) => {
          const internalId = isValidUuid(legacyId)
            ? legacyId
            : null; /* mapping lookup done via subquery */
          if (internalId) {
            return `WHEN legacy_user_id = '${legacyId.replace(/'/g, "''")}' THEN '${internalId}'::uuid`;
          }
          return null;
        })
        .filter(Boolean)
        .join('\n          ');

      const sql = `
        UPDATE ${table}
        SET user_id = CASE legacy_user_id
          ${cases}
          ELSE (SELECT user_id FROM user_id_mapping WHERE external_id = legacy_user_id LIMIT 1)::uuid
        END
        WHERE legacy_user_id IN (${inClause})
          AND user_id IS NULL;
      `;

      if (DRY_RUN) {
        updated += batch.length;
        continue;
      }

      try {
        const res = (await prisma.$executeRawUnsafe(sql)) as number;
        updated += res;
      } catch (err) {
        logger.warn('[backfill-users] FK update failed for table', {
          table,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    counts[table] = updated;
  }

  return counts;
}

async function main(): Promise<void> {
  logger.info('[backfill-users] Starting', { dryRun: DRY_RUN, batchSize: BATCH_SIZE });

  try {
    const legacyIds = await collectDistinctLegacyUserIds();
    logger.info('[backfill-users] Collected distinct legacy user ids', { count: legacyIds.length });

    const userSummary = await backfillUsers(legacyIds);
    logger.info('[backfill-users] User creation complete', userSummary);

    const fkSummary = await backfillForeignKeys(legacyIds);
    logger.info('[backfill-users] FK backfill complete', fkSummary);

    logger.info('[backfill-users] Done');
  } catch (err) {
    logger.error('[backfill-users] Fatal error', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
