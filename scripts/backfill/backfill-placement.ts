/**
 * Placement metadata backfill script.
 *
 * For every row in `users`, ensures three placement columns are populated:
 *   - region              (set to default `us-east-1` if somehow empty — the
 *                         migration already makes this NOT NULL with a default,
 *                         but we guard anyway)
 *   - data_residency_region  (defaults to `region` when absent)
 *   - shard_key           (deterministic hash of user id, mod 256)
 *   - tenant_id           (left null for existing individual users)
 *
 * Properties:
 *   - Idempotent: safe to re-run. Only rows with at least one NULL column
 *     are updated.
 *   - Bounded per batch: reads BATCH_SIZE rows, then issues per-row updates.
 *     This keeps lock-hold time small on hot user rows.
 *   - Dry-run flag: `--dry-run` prints the planned updates without writing.
 *   - Deterministic shard keys: uses the same `computeShardKey` algorithm as
 *     PlacementService so backfilled keys match freshly-written keys.
 *
 * Usage:
 *   npx tsx scripts/backfill/backfill-placement.ts [--dry-run] [--batch-size=500]
 */
import 'dotenv/config';
import { prisma } from '../../src/config/database';
import { computeShardKey } from '../../src/services/placement/placement.service';
import { DEFAULT_REGION, normalizeRegion } from '../../src/services/placement/placement.types';
import { logger } from '../../src/lib/logger';

const BATCH_SIZE = Number.parseInt(process.env.BATCH_SIZE ?? '500', 10);
const DRY_RUN = process.argv.includes('--dry-run');

type Summary = {
  updated: number;
  skipped: number;
  regionNormalized: number;
  residencyBackfilled: number;
  shardKeyBackfilled: number;
  failed: Array<{ userId: string; error: string }>;
};

type CandidateRow = {
  id: string;
  region: string | null;
  dataResidencyRegion: string | null;
  shardKey: number | null;
};

async function backfillPlacement(): Promise<Summary> {
  const summary: Summary = {
    updated: 0,
    skipped: 0,
    regionNormalized: 0,
    residencyBackfilled: 0,
    shardKeyBackfilled: 0,
    failed: [],
  };

  let cursorId: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch: CandidateRow[] = await prisma.user.findMany({
      where: {
        OR: [
          { dataResidencyRegion: null },
          { shardKey: null },
          { region: null },
        ],
      },
      select: {
        id: true,
        region: true,
        dataResidencyRegion: true,
        shardKey: true,
      },
      take: BATCH_SIZE,
      cursor: cursorId ? { id: cursorId } : undefined,
      skip: cursorId ? 1 : 0,
      orderBy: { id: 'asc' },
    });

    if (batch.length === 0) break;

    cursorId = batch[batch.length - 1].id;

    logger.info('[backfill-placement] Processing batch', {
      size: batch.length,
      updated: summary.updated,
      lastCursor: cursorId,
    });

    for (const row of batch) {
      try {
        const normalizedRegion = normalizeRegion(row.region);
        const regionChanged = (row.region ?? null) !== normalizedRegion;

        const residencyMissing = row.dataResidencyRegion === null;
        const finalResidency = residencyMissing
          ? normalizedRegion
          : normalizeRegion(row.dataResidencyRegion);

        const shardMissing = row.shardKey === null;
        const computedShard = row.shardKey ?? computeShardKey(row.id);

        const needsUpdate = regionChanged || residencyMissing || shardMissing;

        if (!needsUpdate) {
          summary.skipped++;
          continue;
        }

        if (regionChanged) summary.regionNormalized++;
        if (residencyMissing) summary.residencyBackfilled++;
        if (shardMissing) summary.shardKeyBackfilled++;

        if (!DRY_RUN) {
          await prisma.user.update({
            where: { id: row.id },
            data: {
              region: normalizedRegion,
              dataResidencyRegion: finalResidency,
              shardKey: computedShard,
            },
            select: { id: true },
          });
        }

        summary.updated++;
      } catch (err) {
        summary.failed.push({
          userId: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return summary;
}

async function main(): Promise<void> {
  logger.info('[backfill-placement] Starting', {
    dryRun: DRY_RUN,
    batchSize: BATCH_SIZE,
    defaultRegion: DEFAULT_REGION,
  });

  try {
    const summary = await backfillPlacement();
    logger.info('[backfill-placement] Complete', {
      updated: summary.updated,
      skipped: summary.skipped,
      regionNormalized: summary.regionNormalized,
      residencyBackfilled: summary.residencyBackfilled,
      shardKeyBackfilled: summary.shardKeyBackfilled,
      failedCount: summary.failed.length,
      failedSamples: summary.failed.slice(0, 10),
    });
  } catch (err) {
    logger.error('[backfill-placement] Fatal error', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
