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
  jobIdForEmailIngestion,
  jobIdForResumeOperation,
} from '../idempotency/idempotency.keys';
import {
  QUEUE_NAMES,
  type EmailJobPayload,
  type ResumeParsingJobPayload,
  type ApplicationTrackingJobPayload,
  type MalwareScanJobPayload,
  type IntelligenceJobPayload,
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
  addMalwareScanJob(payload: MalwareScanJobPayload, opts?: JobsOptions): Promise<string>;
  addApplicationTrackingJob(
    payload: ApplicationTrackingJobPayload,
    opts?: JobsOptions,
  ): Promise<string>;
  addIntelligenceJob(payload: IntelligenceJobPayload, opts?: JobsOptions): Promise<string>;
  getDepths(): Promise<Record<string, number>>;
  close(): Promise<void>;
}

export class QueueService implements IQueueService {
  private readonly emailQueue: Queue<EmailJobPayload>;
  private readonly resumeQueue: Queue<ResumeParsingJobPayload>;
  private readonly trackingQueue: Queue<ApplicationTrackingJobPayload>;
  private readonly malwareQueue: Queue<MalwareScanJobPayload>;
  private readonly intelligenceQueue: Queue<IntelligenceJobPayload>;

  constructor() {
    const conn = { connection: bullMQConnection };

    this.emailQueue = new Queue<EmailJobPayload>(QUEUE_NAMES.EMAIL, conn);
    this.resumeQueue = new Queue<ResumeParsingJobPayload>(QUEUE_NAMES.RESUME_PARSING, conn);
    this.trackingQueue = new Queue<ApplicationTrackingJobPayload>(
      QUEUE_NAMES.APPLICATION_TRACKING,
      conn,
    );
    this.malwareQueue = new Queue<MalwareScanJobPayload>(QUEUE_NAMES.MALWARE_SCAN, conn);
    this.intelligenceQueue = new Queue<IntelligenceJobPayload>(QUEUE_NAMES.INTELLIGENCE, conn);

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
    // A resume parsing job is keyed by (fileHash, operation) so double-submits
    // of the same file (e.g. page refresh,  retries of the producer) land on
    // the same BullMQ job id and get deduplicated by Redis before any worker
    // even picks them up.
    const deterministicId =
      opts.jobId ?? jobIdForResumeOperation(payload.fileHash, 'parse');

    const job = await this.resumeQueue.add('PARSE_RESUME', payload, {
      ...DEFAULT_JOB_OPTIONS,
      jobId: deterministicId,
      ...opts,
    });
    logger.info('[QueueService] Resume parsing job enqueued', {
      jobId: job.id,
      userId: payload.userId,
      storageKey: payload.storageKey,
    });
    return job.id!;
  }

  async addMalwareScanJob(payload: MalwareScanJobPayload, opts: JobsOptions = {}): Promise<string> {
    const job = await this.malwareQueue.add('SCAN_RESUME', payload, {
      ...DEFAULT_JOB_OPTIONS,
      ...opts,
    });
    logger.info('[QueueService] Malware scan job enqueued', {
      jobId: job.id,
      userId: payload.userId,
      userResumeId: payload.userResumeId,
      quarantineKey: payload.quarantineKey,
    });
    return job.id!;
  }

  /**
   * Enqueue an application tracking / status-refresh job.
   *
   * For `PROCESS_EMAIL` payloads we derive a BullMQ job id from
   * `emailMessageId` so webhook retries / duplicate Gmail pushes coalesce.
   */
  async addApplicationTrackingJob(
    payload: ApplicationTrackingJobPayload,
    opts: JobsOptions = {},
  ): Promise<string> {
    let deterministicId: string | undefined = opts.jobId;
    if (!deterministicId) {
      if (payload.type === 'PROCESS_EMAIL' && payload.emailMessageId) {
        deterministicId = jobIdForEmailIngestion(payload.emailMessageId);
      } else if (payload.type === 'REFRESH_STATUS' && payload.applicationId) {
        deterministicId = `refresh:${payload.applicationId}`;
      } else if (payload.type === 'SYNC_ATS' && payload.applicationId) {
        deterministicId = `sync:${payload.applicationId}`;
      }
    }

    const job = await this.trackingQueue.add(payload.type, payload, {
      ...DEFAULT_JOB_OPTIONS,
      ...(deterministicId ? { jobId: deterministicId } : {}),
      ...opts,
    });
    logger.info('[QueueService] Application tracking job enqueued', {
      jobId: job.id,
      type: payload.type,
      userId: payload.userId,
      applicationId: payload.applicationId,
      deterministicId,
    });
    return job.id!;
  }

  async addIntelligenceJob(
    payload: IntelligenceJobPayload,
    opts: JobsOptions = {},
  ): Promise<string> {
    const job = await this.intelligenceQueue.add(payload.type, payload, {
      ...DEFAULT_JOB_OPTIONS,
      ...opts,
    });
    logger.info('[QueueService] Intelligence job enqueued', {
      jobId: job.id,
      type: payload.type,
      userId: payload.userId,
      targetId: payload.targetId,
    });
    return job.id!;
  }

  async getDepths(): Promise<Record<string, number>> {
    const [email, resume, tracking, malware, intelligence] = await Promise.all([
      this.emailQueue.getJobCounts(),
      this.resumeQueue.getJobCounts(),
      this.trackingQueue.getJobCounts(),
      this.malwareQueue.getJobCounts(),
      this.intelligenceQueue.getJobCounts(),
    ]);
    return {
      email: (email.waiting ?? 0) + (email.active ?? 0) + (email.delayed ?? 0),
      resume: (resume.waiting ?? 0) + (resume.active ?? 0) + (resume.delayed ?? 0),
      tracking: (tracking.waiting ?? 0) + (tracking.active ?? 0) + (tracking.delayed ?? 0),
      malware: (malware.waiting ?? 0) + (malware.active ?? 0) + (malware.delayed ?? 0),
      intelligence: (intelligence.waiting ?? 0) + (intelligence.active ?? 0) + (intelligence.delayed ?? 0),
    };
  }

  /** Gracefully close all queue connections. Call during server shutdown. */
  async close(): Promise<void> {
    await Promise.all([
      this.emailQueue.close(),
      this.resumeQueue.close(),
      this.trackingQueue.close(),
      this.malwareQueue.close(),
      this.intelligenceQueue.close(),
    ]);
    logger.info('[QueueService] All queues closed');
  }
}

// Singleton — one set of queue connections per process
export const queueService = new QueueService();
