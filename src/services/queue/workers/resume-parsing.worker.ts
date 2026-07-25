/**
 * Resume Parsing Worker — processes jobs from the "resume-parsing" BullMQ queue.
 *
 * Concurrency : 5 jobs in parallel
 * Retry policy: 3 attempts, exponential backoff (set by producer)
 *
 * Each job receives:
 *   - userId       — the owning user (partition key for any DB writes)
 *   - storageKey   — S3/GCS object key to fetch the file from cloud storage
 *   - fileHash     — SHA-256 pre-computed by the upload handler (dedup key)
 *   - mimeType     — so the parser knows how to decode the file
 *
 * Design note: we do NOT accept a raw `fileBuffer` in the job payload.
 * Storing large binaries in Redis bloats memory, slows serialisation, and
 * breaks BullMQ's default 1 MB message limit. Instead the upload handler
 * writes the file to cloud storage first and only passes the storage key here.
 */
import { Worker, type Job } from 'bullmq';
import { bullMQConnection } from '../../../config/redis';
import { logger } from '../../../lib/logger';
import {
  QUEUE_NAMES,
  type ResumeParsingJobPayload,
  ResumeParsingJobPayloadSchema,
} from '../queue.types';

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

export async function processResumeParsingJob(job: Job<ResumeParsingJobPayload>): Promise<void> {
  const { userId, storageKey, originalFilename, mimeType, fileHash } =
    ResumeParsingJobPayloadSchema.parse(job.data);

  logger.info('[ResumeParsingWorker] Processing job', {
    jobId: job.id,
    attempt: job.attemptsMade + 1,
    userId,
    storageKey,
    mimeType,
  });

  // ── Step 1: Fetch file from cloud storage ──────────────────────────────
  // TODO: replace with your storage client
  // const fileBuffer = await storageService.download(storageKey);
  logger.info('[ResumeParsingWorker] Step 1 — would fetch from storage', {
    storageKey,
    userId,
  });

  // ── Step 2: Extract text from the file ────────────────────────────────
  // TODO: wire to pdfParse / docx-parser based on mimeType
  // const rawText = await textExtractor.extract(fileBuffer, mimeType);
  logger.info('[ResumeParsingWorker] Step 2 — would extract text', {
    mimeType,
    originalFilename,
  });

  // ── Step 3: Run NLP / AI parsing ──────────────────────────────────────
  // TODO: call your AI/NLP service (e.g. OpenAI structured output)
  // const parsedResume = await resumeAiParser.parse(rawText);
  logger.info('[ResumeParsingWorker] Step 3 — would run AI parsing');

  // ── Step 4: Persist parsed data ───────────────────────────────────────
  // TODO: upsert into a `parsed_resumes` table, keyed by userId + fileHash
  // await parsedResumeRepository.upsert({ userId, fileHash, ...parsedResume });
  logger.info('[ResumeParsingWorker] Step 4 — would persist parsed resume', {
    userId,
    fileHash,
  });

  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Worker instantiation
// ---------------------------------------------------------------------------

export function startResumeParsingWorker(): Worker<ResumeParsingJobPayload> {
  const worker = new Worker<ResumeParsingJobPayload>(
    QUEUE_NAMES.RESUME_PARSING,
    processResumeParsingJob,
    {
      connection: bullMQConnection,
      concurrency: Number.parseInt(process.env.WORKER_CONCURRENCY ?? '5', 10),
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
