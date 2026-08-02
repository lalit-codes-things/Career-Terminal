import { Job } from 'bullmq';
import { prisma } from '../../config/database';
import { logger } from '../../lib/logger';
import { BaseJobPayload } from '../queue/queue.types';

export async function withEventLifecycle<T extends BaseJobPayload>(
  job: Job<T>,
  processor: (job: Job<T>) => Promise<void>,
): Promise<void> {
  const { eventId, correlationId } = job.data;

  // If no eventId is provided, this is a legacy job or direct queue dispatch.
  // We just run it directly.
  if (!eventId) {
    return processor(job);
  }

  // Increment retry count
  if (job.attemptsMade > 0) {
    await prisma.event.update({
      where: { id: eventId },
      data: {
        retryCount: { increment: 1 },
      },
    });
  }

  try {
    await processor(job);

    // Mark event as processed
    await prisma.event.update({
      where: { id: eventId },
      data: {
        status: 'processed',
        processedAt: new Date(),
      },
    });

    logger.info('[EventWorker] Event processed successfully', {
      eventId,
      correlationId,
      jobId: job.id,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const isPermanent = job.attemptsMade >= (job.opts.attempts || 3) - 1;

    await prisma.event.update({
      where: { id: eventId },
      data: {
        status: isPermanent ? 'dlq' : 'failed',
        error: errorMsg,
      },
    });

    logger.error(
      `[EventWorker] Event processing failed. Status: ${isPermanent ? 'dlq' : 'failed'}`,
      {
        eventId,
        correlationId,
        jobId: job.id,
        attempt: job.attemptsMade + 1,
        error: errorMsg,
      },
    );

    throw err; // Let BullMQ handle retries and move to failed set
  }
}
