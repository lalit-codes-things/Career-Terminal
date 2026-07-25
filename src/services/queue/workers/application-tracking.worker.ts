/**
 * Application Tracking Worker — processes jobs from the "application-tracking" queue.
 *
 * Concurrency : 5 jobs in parallel
 * Retry policy: 3 attempts, exponential backoff (set by producer)
 *
 * Handles three job subtypes:
 *   PROCESS_EMAIL   — parse a new email and update application status
 *   REFRESH_STATUS  — re-evaluate an application's current stage
 *   SYNC_ATS        — push/pull data from an external ATS (Greenhouse, Lever…)
 */
import { Worker, type Job } from 'bullmq';
import { bullMQConnection } from '../../../config/redis';
import { logger } from '../../../lib/logger';
import {
  QUEUE_NAMES,
  type ApplicationTrackingJobPayload,
  ApplicationTrackingJobPayloadSchema,
} from '../queue.types';

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

export async function processApplicationTrackingJob(
  job: Job<ApplicationTrackingJobPayload>,
): Promise<void> {
  const { type, userId, applicationId, emailMessageId, metadata } =
    ApplicationTrackingJobPayloadSchema.parse(job.data);

  logger.info('[AppTrackingWorker] Processing job', {
    jobId: job.id,
    attempt: job.attemptsMade + 1,
    type,
    userId,
    applicationId,
  });

  switch (type) {
    case 'PROCESS_EMAIL': {
      if (!emailMessageId) {
        throw new Error('PROCESS_EMAIL job missing emailMessageId');
      }
      // TODO: fetch email → run classifier → update application status
      // const email = await emailMessageRepository.findFirst({ userId, id: emailMessageId });
      // const classification = await jobEmailClassifier.classify(email);
      // await applicationCommandService.applyClassification(userId, classification);
      logger.info('[AppTrackingWorker] Would process email', {
        userId,
        emailMessageId,
      });
      break;
    }

    case 'REFRESH_STATUS': {
      if (!applicationId) {
        throw new Error('REFRESH_STATUS job missing applicationId');
      }
      // TODO: re-run status engine for this application
      // await statusEngine.refresh(userId, applicationId);
      logger.info('[AppTrackingWorker] Would refresh application status', {
        userId,
        applicationId,
      });
      break;
    }

    case 'SYNC_ATS': {
      // TODO: push/pull with external ATS provider
      // await atsSync.run(userId, metadata);
      logger.info('[AppTrackingWorker] Would sync with ATS', {
        userId,
        metadata,
      });
      break;
    }

    default: {
      // Exhaustive check — TypeScript will warn if a new type is added without a case
      const _exhaustive: never = type;
      logger.warn('[AppTrackingWorker] Unknown job type', { type: _exhaustive });
    }
  }

  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Worker instantiation
// ---------------------------------------------------------------------------

export function startApplicationTrackingWorker(): Worker<ApplicationTrackingJobPayload> {
  const worker = new Worker<ApplicationTrackingJobPayload>(
    QUEUE_NAMES.APPLICATION_TRACKING,
    processApplicationTrackingJob,
    {
      connection: bullMQConnection,
      concurrency: Number.parseInt(process.env.WORKER_CONCURRENCY ?? '5', 10),
    },
  );

  worker.on('completed', (job) =>
    logger.info('[AppTrackingWorker] Job completed', {
      jobId: job.id,
      type: job.data.type,
    }),
  );

  worker.on('failed', (job, err) =>
    logger.error('[AppTrackingWorker] Job failed', {
      jobId: job?.id,
      type: job?.data.type,
      userId: job?.data.userId,
      attempt: job?.attemptsMade,
      error: err.message,
    }),
  );

  worker.on('error', (err) =>
    logger.error('[AppTrackingWorker] Worker error', { message: err.message }),
  );

  logger.info('[AppTrackingWorker] Started', { concurrency: worker.opts.concurrency });
  return worker;
}
