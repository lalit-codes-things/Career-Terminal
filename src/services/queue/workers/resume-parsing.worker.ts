/**
 * Resume Parsing Worker - processes jobs from the "resume-parsing" queue.
 *
 * By the time a job reaches this worker, malware scanning should already
 * have promoted the file into clean storage.
 */
import { Worker, type Job } from 'bullmq';
import { bullMQConnection } from '../../../config/redis';
import { logger } from '../../../lib/logger';
import { storageService } from '../../storage/storage.service';
import { resumeIntelligenceService } from '../../resume/resume-intelligence.service';
import { dbRouter } from '../../../config/database';
import { cellService } from '../../cell/cell.service';
import { placementService } from '../../placement/placement.service';
import { config } from '../../../config';
import { withEventLifecycle } from '../../event/event-worker';
import {
  QUEUE_NAMES,
  type ResumeParsingJobPayload,
  ResumeParsingJobPayloadSchema,
} from '../queue.types';

export async function processResumeParsingJob(job: Job<ResumeParsingJobPayload>): Promise<void> {
  return withEventLifecycle(job, async (job) => {
    const { userId, storageKey, originalFilename, mimeType, fileHash } =
      ResumeParsingJobPayloadSchema.parse(job.data);

    logger.info('[ResumeParsingWorker] Processing job', {
      jobId: job.id,
      attempt: job.attemptsMade + 1,
      userId,
      storageKey,
      mimeType,
      originalFilename,
    });

    const placement = await placementService.resolvePlacementContext(userId);
    await cellService.ensureRoutable(placement.cellId);
    if (job.data.cellId && job.data.cellId !== placement.cellId) {
      throw new Error(`Resume parsing job routed to wrong cell: ${job.data.cellId}`);
    }

    const fileBuffer = await storageService.download(storageKey);
    const matchingResume = await dbRouter.read().userResume.findFirst({
      where: {
        legacyUserId: userId,
        resumeHash: { hash: fileHash },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!matchingResume) {
      logger.warn('[ResumeParsingWorker] No resume row found for parsing job', {
        userId,
        storageKey,
        fileHash,
      });
      return;
    }

    // AI intelligence pipeline: text extraction → capability extraction → facts + pgvector
    await resumeIntelligenceService.analyzeBuffer(
      fileBuffer,
      mimeType,
      userId,
      matchingResume.id,
    ).catch((err) => {
      logger.warn('[ResumeParsingWorker] Intelligence analysis failed (non-fatal)', {
        userId,
        userResumeId: matchingResume.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    await dbRouter.write().userResume.update({
      where: { id: matchingResume.id },
      data: { scanningStatus: 'clean', status: 'ready' },
    });
  });
}

export function startResumeParsingWorker(): Worker<ResumeParsingJobPayload> {
  const worker = new Worker<ResumeParsingJobPayload>(
    QUEUE_NAMES.RESUME_PARSING,
    processResumeParsingJob,
    {
      connection: bullMQConnection,
      concurrency: config.worker.concurrency,
    },
  );

  worker.on('completed', (job) =>
    logger.info('[ResumeParsingWorker] Job completed', {
      jobId: job.id,
      userId: job.data.userId,
    }),
  );

  worker.on('failed', (job, err) =>
    logger.error('[ResumeParsingWorker] Job failed', {
      jobId: job?.id,
      userId: job?.data.userId,
      attempt: job?.attemptsMade,
      error: err.message,
    }),
  );

  worker.on('error', (err) =>
    logger.error('[ResumeParsingWorker] Worker error', { message: err.message }),
  );

  logger.info('[ResumeParsingWorker] Started', { concurrency: worker.opts.concurrency });
  return worker;
}
