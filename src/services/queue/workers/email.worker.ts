/**
 * Email Worker — processes jobs from the "email" BullMQ queue.
 *
 * Concurrency : 5 jobs in parallel
 * Retry policy: inherited from the producer (3 attempts, exponential backoff)
 *
 * The worker is intentionally thin — it delegates to an EmailSenderService
 * that you wire to your transactional email provider (SendGrid, SES, Postmark…).
 * Swap the implementation without touching the worker.
 */
import { Worker, type Job } from 'bullmq';
import { bullMQConnection } from '../../../config/redis';
import { logger } from '../../../lib/logger';
import { QUEUE_NAMES, type EmailJobPayload, EmailJobPayloadSchema } from '../queue.types';

// ---------------------------------------------------------------------------
// Processor — pure function, easy to unit-test in isolation
// ---------------------------------------------------------------------------

export async function processEmailJob(job: Job<EmailJobPayload>): Promise<void> {
  const { type, userId, toAddress, subject, bodyText, bodyHtml } = EmailJobPayloadSchema.parse(job.data);

  logger.info('[EmailWorker] Processing job', {
    jobId: job.id,
    attempt: job.attemptsMade + 1,
    type,
    userId,
  });

  // TODO: replace with your email provider client (e.g. SendGrid, AWS SES)
  // Example wiring:
  //   await emailSenderService.send({ to: toAddress, subject, bodyText, bodyHtml });
  //
  // For now we log the intent so the worker is runnable without a live provider.
  logger.info('[EmailWorker] Would send email', {
    type,
    userId,
    toAddress,
    subject,
    hasHtml: !!bodyHtml,
    bodyTextPreview: bodyText.slice(0, 80),
  });

  // Simulate async work
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Worker instantiation
// ---------------------------------------------------------------------------

export function startEmailWorker(): Worker<EmailJobPayload> {
  const worker = new Worker<EmailJobPayload>(QUEUE_NAMES.EMAIL, processEmailJob, {
    connection: bullMQConnection,
    concurrency: 5,
    // BullMQ handles retries per the job's `attempts` + `backoff` options set
    // by the producer — no additional config needed here.
  });

  worker.on('completed', (job) =>
    logger.info('[EmailWorker] Job completed', { jobId: job.id, type: job.data.type }),
  );

  worker.on('failed', (job, err) =>
    logger.error('[EmailWorker] Job failed', {
      jobId: job?.id,
      attempt: job?.attemptsMade,
      error: err.message,
    }),
  );

  worker.on('error', (err) => logger.error('[EmailWorker] Worker error', { message: err.message }));

  logger.info('[EmailWorker] Started (concurrency=5)');
  return worker;
}
