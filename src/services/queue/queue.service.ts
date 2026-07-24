/**
 * QueueService — BullMQ-backed async job producer.
 *
 * Provides typed methods for enqueuing the three job families:
 *   - addEmailJob()              → email queue
 *   - addResumeParsingJob()      → resume-parsing queue
 *   - addApplicationTrackingJob() → application-tracking queue
 *
 * All queues share the same Redis connection config but are independent
 * BullMQ Queue instances so they can be scaled and monitored separately.
 *
 * Retry policy (all queues):
 *   - 3 attempts with exponential backoff (2s → 4s → 8s)
 *   - Failed jobs land in the "failed" set for inspection / replay
 */
import { Queue, type JobsOptions } from 'bullmq';
import { bullMQConnection } from '../../config/redis';
import { logger } from '../../lib/logger';
import {
  QUEUE_NAMES,
  type EmailJobPayload,
  type ResumeParsingJobPayload,
  type ApplicationTrackingJobPayload,
} from './queue.types';

// ---------------------------------------------------------------------------
// Shared default job options
// ---------------------------------------------------------------------------

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2_000, // 2s → 4s → 8s
  },
  removeOnComplete: { count: 500 }, // keep last 500 completed for auditing
  removeOnFail: { count: 1_000 }, // keep last 1000 failures for inspection
};

// ---------------------------------------------------------------------------
// QueueService
// ---------------------------------------------------------------------------

export interface IQueueService {
  addEmailJob(payload: EmailJobPayload, opts?: JobsOptions): Promise<string>;
  addResumeParsingJob(payload: ResumeParsingJobPayload, opts?: JobsOptions): Promise<string>;
  addApplicationTrackingJob(
    payload: ApplicationTrackingJobPayload,
    opts?: JobsOptions,
  ): Promise<string>;
  close(): Promise<void>;
}

export class QueueService implements IQueueService {
  private readonly emailQueue: Queue<EmailJobPayload>;
  private readonly resumeQueue: Queue<ResumeParsingJobPayload>;
  private readonly trackingQueue: Queue<ApplicationTrackingJobPayload>;

  constructor() {
    const conn = { connection: bullMQConnection };

    this.emailQueue = new Queue<EmailJobPayload>(QUEUE_NAMES.EMAIL, conn);
    this.resumeQueue = new Queue<ResumeParsingJobPayload>(QUEUE_NAMES.RESUME_PARSING, conn);
    this.trackingQueue = new Queue<ApplicationTrackingJobPayload>(
      QUEUE_NAMES.APPLICATION_TRACKING,
      conn,
    );

    logger.info('[QueueService] Queues initialised', {
      queues: Object.values(QUEUE_NAMES),
    });
  }

  /**
   * Enqueue an outbound email job.
   * Returns the BullMQ job id for tracing.
   */
  async addEmailJob(payload: EmailJobPayload, opts: JobsOptions = {}): Promise<string> {
    const job = await this.emailQueue.add(payload.type, payload, {
      ...DEFAULT_JOB_OPTIONS,
      ...opts,
    });
    logger.info('[QueueService] Email job enqueued', {
      jobId: job.id,
      type: payload.type,
      userId: payload.userId,
    });
    return job.id!;
  }

  /**
   * Enqueue a resume parsing job.
   *
   * Heavy AI/NLP processing belongs here — never block the HTTP request.
   * The payload carries a storage key (S3 object key) rather than the raw
   * file buffer so the job message stays small and Redis memory stays sane.
   */
  async addResumeParsingJob(
    payload: ResumeParsingJobPayload,
    opts: JobsOptions = {},
  ): Promise<string> {
    const job = await this.resumeQueue.add('PARSE_RESUME', payload, {
      ...DEFAULT_JOB_OPTIONS,
      ...opts,
    });
    logger.info('[QueueService] Resume parsing job enqueued', {
      jobId: job.id,
      userId: payload.userId,
      storageKey: payload.storageKey,
    });
    return job.id!;
  }

  /**
   * Enqueue an application tracking / status-refresh job.
   */
  async addApplicationTrackingJob(
    payload: ApplicationTrackingJobPayload,
    opts: JobsOptions = {},
  ): Promise<string> {
    const job = await this.trackingQueue.add(payload.type, payload, {
      ...DEFAULT_JOB_OPTIONS,
      ...opts,
    });
    logger.info('[QueueService] Application tracking job enqueued', {
      jobId: job.id,
      type: payload.type,
      userId: payload.userId,
      applicationId: payload.applicationId,
    });
    return job.id!;
  }

  /** Gracefully close all queue connections. Call during server shutdown. */
  async close(): Promise<void> {
    await Promise.all([
      this.emailQueue.close(),
      this.resumeQueue.close(),
      this.trackingQueue.close(),
    ]);
    logger.info('[QueueService] All queues closed');
  }
}

// Singleton — one set of queue connections per process
export const queueService = new QueueService();
