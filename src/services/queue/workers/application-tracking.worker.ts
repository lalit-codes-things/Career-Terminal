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
import { prisma } from '../../../config/database';
import {
  jobEmailClassifier,
  JobEmailCategory,
  type ClassifiableEmail,
} from '../../job-intelligence';
import { applicationCommandService } from '../../application-command/application-command.service';
import { gmailCheckpointService } from '../../gmail/checkpoint.service';

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
    emailMessageId,
  });

  switch (type) {
    case 'PROCESS_EMAIL': {
      if (!emailMessageId) {
        throw new Error('PROCESS_EMAIL job missing emailMessageId');
      }

      // 1. Fetch email from DB
      const email = await prisma.emailMessage.findUnique({
        where: { id: emailMessageId },
      });

      if (!email) {
        logger.warn('[AppTrackingWorker] Email not found, skipping', { emailMessageId });
        return;
      }

      // 2. Map to ClassifiableEmail
      const classifiableEmail: ClassifiableEmail = {
        emailId: email.providerMessageId,
        sender: email.from ?? '',
        subject: email.subject ?? '',
        bodyText: email.bodyText ?? undefined,
        bodyHtml: email.bodyHtml ?? undefined,
        receivedAt: email.receivedAt,
        threadId: email.threadId ?? undefined,
      };

      // 3. Classify
      const classification = jobEmailClassifier.classify(classifiableEmail);

            // 4. If job-related, process for application tracking
      try {
        if (classification.category !== JobEmailCategory.NOT_JOB_RELATED) {
          await applicationCommandService.processEmailForJobApplication(
            classifiableEmail,
            classification,
            userId,
          );
          logger.info('[AppTrackingWorker] Processed email for application tracking', {
            userId,
            emailMessageId,
            category: classification.category,
          });
        } else {
          logger.info('[AppTrackingWorker] Email not job-related, skipping tracking', {
            userId,
            emailMessageId,
          });
        }

        // 5. Report success to checkpoint service (Micro-task 8.5)
        if (metadata?.batchId) {
          await gmailCheckpointService.markEmailProcessed(
            metadata.batchId as string,
            emailMessageId,
            email.providerMessageId,
            'completed'
          );
          
          // Check if batch is complete
          await gmailCheckpointService.completeBatch(metadata.batchId as string);
        }
      } catch (err) {
        // Report failure to checkpoint service
        if (metadata?.batchId) {
          await gmailCheckpointService.markEmailProcessed(
            metadata.batchId as string,
            emailMessageId,
            email.providerMessageId,
            'failed',
            err instanceof Error ? err.message : String(err)
          );
        }
        throw err; // Re-throw for BullMQ retry
      }

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

  worker.on('failed', async (job, err) => {
    logger.error('[AppTrackingWorker] Job failed', {
      jobId: job?.id,
      type: job?.data.type,
      userId: job?.data.userId,
      attempt: job?.attemptsMade,
      error: err.message,
    });

    // Micro-task 7.7: Move to Dead Letter Table after max attempts
    if (job && job.data.type === 'PROCESS_EMAIL' && job.data.emailMessageId) {
      const maxAttempts = job.opts.attempts || 3;
      if (job.attemptsMade >= maxAttempts) {
        try {
          // Fetch providerMessageId for the dead letter record
          const email = await prisma.emailMessage.findUnique({
            where: { id: job.data.emailMessageId },
            select: { providerMessageId: true },
          });

          await prisma.deadLetterEmail.create({
            data: {
              emailId: job.data.emailMessageId,
              userId: job.data.userId,
              providerMessageId: email?.providerMessageId || 'unknown',
              error: err.message,
              attempts: job.attemptsMade,
            },
          });
          logger.info('[AppTrackingWorker] Job moved to Dead Letter Table', {
            jobId: job.id,
            emailId: job.data.emailMessageId,
          });
        } catch (dbErr) {
          logger.error('[AppTrackingWorker] Failed to create dead letter record', {
            error: dbErr instanceof Error ? dbErr.message : String(dbErr),
          });
        }
      }
    }
  });

  worker.on('error', (err) =>
    logger.error('[AppTrackingWorker] Worker error', { message: err.message }),
  );

  logger.info('[AppTrackingWorker] Started', { concurrency: worker.opts.concurrency });
  return worker;
}
