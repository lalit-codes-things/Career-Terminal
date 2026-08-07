/**
 * Application ↔ Resume Link Backfill Script.
 *
 * Iterates every existing `job_applications` row that still lacks a matching
 * `application_resumes` row and — for each — resolves the most likely resume
 * version the user had active at (or just before) the application's
 * `applied_date`.  It then writes an immutable `application_resumes` row
 * snapshotting the storage key and metadata exactly like the real-time
 * ingestion pipeline does in `ApplicationCommandService`.
 *
 * Linkage strategy per application:
 *   1. Gather all `user_resumes` rows for the owner (by `user_id` /
 *      `legacy_user_id`), sorted by `created_at DESC`.
 *   2. Pick the most recent one whose `created_at` is ≤ the application's
 *      `applied_date` (simulating "what was active when the user applied").
 *   3. If no such resume exists but the user has *any* resume, fall back to
 *      the most recent one (best-effort for retro-active uploads), and log a
 *      warning so the operator can review.
 *   4. If the user has zero resumes, the application is skipped (logged).
 *
 * Usage:
 *   npx tsx scripts/backfill/backfill-application-resumes.ts [--dry-run] [--batch-size=200]
 *
 * The script is repeatable and safe to run multiple times:
 *   - applications already linked via `application_resumes` are skipped.
 *   - uses `upsert` on the `applicationId` unique key so a partial run can
 *     be resumed without producing duplicates.
 */
import 'dotenv/config';
import { prisma } from '../../src/config/database';
import type { Prisma } from '@prisma/client';
import { logger } from '../../src/lib/logger';

const BATCH_SIZE = Number.parseInt(process.env.BATCH_SIZE ?? '200', 10);
const DRY_RUN = process.argv.includes('--dry-run');

type ApplicationRow = {
  id: string;
  userId: string | null;
  legacyUserId: string;
  appliedDate: Date;
};

type ResumeRow = {
  id: string;
  userId: string | null;
  legacyUserId: string;
  createdAt: Date;
  resumeHashId: string;
  version: number;
  originalName: string;
  resumeHash: {
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    hash: string;
  };
};

type BackfillSummary = {
  linked: number;
  skippedNoResume: number;
  skippedBestEffort: number;
  failed: Array<{ applicationId: string; error: string }>;
};

async function pickResumeForApplication(
  app: ApplicationRow,
  allResumes: readonly ResumeRow[],
): Promise<{ resume: ResumeRow; bestEffort: boolean } | null> {
  const userResumes = allResumes.filter((r) => {
    const byUserId = app.userId && r.userId && r.userId === app.userId;
    const byLegacyId = r.legacyUserId === app.legacyUserId;
    return byUserId || byLegacyId;
  });

  if (userResumes.length === 0) return null;

  const atOrBeforeApplied = userResumes
    .filter((r) => r.createdAt.getTime() <= app.appliedDate.getTime())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  if (atOrBeforeApplied.length > 0) {
    return { resume: atOrBeforeApplied[0], bestEffort: false };
  }

  const newestOverall = [...userResumes].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
  return { resume: newestOverall, bestEffort: true };
}

async function backfillApplicationResumes(): Promise<BackfillSummary> {
  const summary: BackfillSummary = {
    linked: 0,
    skippedNoResume: 0,
    skippedBestEffort: 0,
    failed: [],
  };

  const alreadyLinkedIds = new Set(
    (
      await prisma.applicationResume.findMany({
        select: { applicationId: true },
      })
    ).map((r) => r.applicationId),
  );

  logger.info('[backfill-application-resumes] Pre-fetched existing links', {
    count: alreadyLinkedIds.size,
  });

  let cursorId: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const applicationsBatch: ApplicationRow[] = await prisma.jobApplication.findMany({
      where: {
        id: { notIn: [...alreadyLinkedIds] },
      },
      select: {
        id: true,
        userId: true,
        legacyUserId: true,
        appliedDate: true,
      },
      take: BATCH_SIZE,
      cursor: cursorId ? { id: cursorId } : undefined,
      skip: cursorId ? 1 : 0,
      orderBy: { id: 'asc' },
    });

    if (applicationsBatch.length === 0) break;

    cursorId = applicationsBatch[applicationsBatch.length - 1].id;

    const userIds = applicationsBatch
      .map((a) => a.userId)
      .filter((id): id is string => Boolean(id));
    const legacyUserIds = applicationsBatch.map((a) => a.legacyUserId);

    const allResumesForBatch: ResumeRow[] = await prisma.userResume.findMany({
      where: {
        OR: [{ userId: { in: userIds } }, { legacyUserId: { in: legacyUserIds } }],
      },
      include: {
        resumeHash: {
          select: {
            storageKey: true,
            mimeType: true,
            sizeBytes: true,
            hash: true,
          },
        },
      },
    });

    logger.info('[backfill-application-resumes] Processing batch', {
      linked: summary.linked,
      skippedNoResume: summary.skippedNoResume,
      skippedBestEffort: summary.skippedBestEffort,
      failures: summary.failed.length,
      batchSize: applicationsBatch.length,
      resumesLoaded: allResumesForBatch.length,
      lastCursor: cursorId,
    });

    for (const app of applicationsBatch) {
      try {
        const pickResult = await pickResumeForApplication(app, allResumesForBatch);

        if (!pickResult) {
          summary.skippedNoResume++;
          continue;
        }

        const { resume, bestEffort } = pickResult;

        const snapshotMetadata: Prisma.InputJsonObject = {
          originalName: resume.originalName,
          mimeType: resume.resumeHash.mimeType,
          sizeBytes: resume.resumeHash.sizeBytes,
          sha256: resume.resumeHash.hash,
          version: resume.version,
          backfillBestEffort: bestEffort,
        };

        if (bestEffort) {
          logger.warn('[backfill-application-resumes] Best-effort linkage', {
            applicationId: app.id,
            resumeId: resume.id,
            resumeCreatedAt: resume.createdAt.toISOString(),
            appliedDate: app.appliedDate.toISOString(),
          });
          summary.skippedBestEffort++;
        }

        if (!DRY_RUN) {
          await prisma.applicationResume.upsert({
            where: { applicationId: app.id },
            create: {
              applicationId: app.id,
              resumeVersionId: resume.id,
              snapshotKey: resume.resumeHash.storageKey,
              snapshotMetadata,
              appliedAt: app.appliedDate,
              usageContext: {
                strategy: 'generic',
                backfilled: true,
                bestEffort,
              } as unknown as Prisma.InputJsonObject,
            },
            update: {},
          });
        }

        summary.linked++;
      } catch (err) {
        summary.failed.push({
          applicationId: app.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return summary;
}

async function main(): Promise<void> {
  logger.info('[backfill-application-resumes] Starting', {
    dryRun: DRY_RUN,
    batchSize: BATCH_SIZE,
  });

  try {
    const summary = await backfillApplicationResumes();
    logger.info('[backfill-application-resumes] Complete', {
      linked: summary.linked,
      skippedNoResume: summary.skippedNoResume,
      skippedBestEffort: summary.skippedBestEffort,
      failedCount: summary.failed.length,
      failedSamples: summary.failed.slice(0, 10),
    });
  } catch (err) {
    logger.error('[backfill-application-resumes] Fatal error', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
