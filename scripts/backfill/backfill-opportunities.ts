/**
 * Canonical Opportunity Backfill Script.
 *
 * Iterates every existing `job_applications` row that still lacks an
 * `opportunity_id` and — using the same canonical-resolution logic from
 * `OpportunityService` — resolves (or creates) the canonical opportunity,
 * then writes the `opportunity_id` foreign key back onto the application.
 *
 * The denormalized columns (`company_name`, `role_title`, `location`,
 * etc.) are left untouched so the compatibility migration proceeds in a
 * two-step manner.
 *
 * Usage:
 *   npx tsx scripts/backfill/backfill-opportunities.ts [--dry-run] [--batch-size=200]
 *
 * The script is repeatable and safe to run multiple times:
 *   - applications already linked to an opportunity are skipped.
 *   - rows lacking both company + role are skipped (logged, can be fixed
 *     manually later).
 */
import 'dotenv/config';
import { prisma } from '../../src/config/database';
import { opportunityService } from '../../src/services/opportunity';
import type { OpportunityResolutionInput } from '../../src/services/opportunity/opportunity.service';
import { logger } from '../../src/lib/logger';

const BATCH_SIZE = Number.parseInt(process.env.BATCH_SIZE ?? '200', 10);
const DRY_RUN = process.argv.includes('--dry-run');

async function backfillOpportunities(): Promise<{
  linked: number;
  skipped: number;
  failed: Array<{ applicationId: string; error: string }>;
}> {
  let linked = 0;
  let skipped = 0;
  const failed: Array<{ applicationId: string; error: string }> = [];

  let cursorId: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await prisma.jobApplication.findMany({
      where: {
        opportunityId: null,
        AND: [
          { companyName: { not: '' } },
          { roleTitle: { not: '' } },
        ],
      },
      select: {
        id: true,
        companyName: true,
        companyDomain: true,
        roleTitle: true,
        location: true,
      },
      take: BATCH_SIZE,
      cursor: cursorId ? { id: cursorId } : undefined,
      skip: cursorId ? 1 : 0,
      orderBy: { id: 'asc' },
    });

    if (batch.length === 0) break;

    logger.info('[backfill-opportunities] Processing batch', {
      linked,
      skipped,
      failures: failed.length,
      batchSize: batch.length,
      lastCursor: batch[batch.length - 1].id,
    });

    for (const app of batch) {
      cursorId = app.id;

      if (!app.companyName || !app.roleTitle) {
        skipped++;
        continue;
      }

      try {
        const input: OpportunityResolutionInput = {
          companyName: app.companyName,
          companyDomain: app.companyDomain || undefined,
          roleTitle: app.roleTitle,
          location: app.location || undefined,
          sourceMetadata: {
            backfill: true,
            sourceApplicationId: app.id,
          },
        };

        const { opportunityId } = await opportunityService.resolve(input);

        if (DRY_RUN) {
          linked++;
          continue;
        }

        await prisma.jobApplication.update({
          where: { id: app.id },
          data: { opportunityId },
        });
        linked++;
      } catch (err) {
        failed.push({
          applicationId: app.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return { linked, skipped, failed };
}

async function main(): Promise<void> {
  logger.info('[backfill-opportunities] Starting', { dryRun: DRY_RUN, batchSize: BATCH_SIZE });

  try {
    const summary = await backfillOpportunities();
    logger.info('[backfill-opportunities] Complete', {
      linked: summary.linked,
      skipped: summary.skipped,
      failedCount: summary.failed.length,
      failedSamples: summary.failed.slice(0, 10),
    });
  } catch (err) {
    logger.error('[backfill-opportunities] Fatal error', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
