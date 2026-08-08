import { Worker, type Job } from 'bullmq';
import { bullMQConnection } from '../../../config/redis';
import { logger } from '../../../lib/logger';
import { QUEUE_NAMES, type InterviewSessionJobPayload, InterviewSessionJobPayloadSchema } from '../queue.types';
import { config } from '../../../config';
import { interviewExtractCapability } from '../../../services/capabilities/interview-extraction';

async function processInterviewSessionJob(job: Job<InterviewSessionJobPayload>): Promise<void> {
  const { type, userId, sessionId, sourceType, content, canonicalCompanyId, companyNameRaw, roleTitle, loopType, metadata } = InterviewSessionJobPayloadSchema.parse(job.data);

  logger.info('[InterviewWorker] Processing interview session job', {
    jobId: job.id,
    attempt: job.attemptsMade + 1,
    type,
    userId,
    sessionId,
    sourceType,
  });

  if (!content) {
    throw new Error(`No content available for interview session ${sessionId}`);
  }

  const context: Record<string, string> = {
    sessionId,
    sourceType,
    ...(canonicalCompanyId ? { canonicalCompanyId } : {}),
    ...(companyNameRaw ? { companyNameRaw } : {}),
    ...(roleTitle ? { roleTitle } : {}),
    ...(loopType ? { loopType } : {}),
    ...(metadata ?? {}),
  } as Record<string, string>;

  const result = await interviewExtractCapability.run({
    userId,
    entityId: sessionId,
    entityType: 'interviewSession',
    content,
    context,
    templateId: 'interview-transcript-extraction',
  });

  logger.info('[InterviewWorker] Interview session processed', {
    jobId: job.id,
    sessionId,
    extractionRunId: result.predictionId,
    factsCreated: result.recruiterFactIds.length,
    needsReview: result.confidenceBand === 'low',
    overallConfidence: result.confidence,
  });
}

export function startInterviewSessionWorker(): Worker<InterviewSessionJobPayload> {
  const worker = new Worker<InterviewSessionJobPayload>(QUEUE_NAMES.INTERVIEW_SESSION, processInterviewSessionJob, {
    connection: bullMQConnection,
    concurrency: config.worker.concurrency,
  });

  worker.on('completed', (job) =>
    logger.info('[InterviewWorker] Job completed', { jobId: job.id, type: job.data.type, userId: job.data.userId, sessionId: job.data.sessionId }),
  );

  worker.on('failed', (job, err) =>
    logger.error('[InterviewWorker] Job failed', {
      jobId: job?.id,
      attempt: job?.attemptsMade,
      error: err.message,
    }),
  );

  worker.on('error', (err) => logger.error('[InterviewWorker] Worker error', { message: err.message }));

  logger.info('[InterviewWorker] Started', { concurrency: worker.opts.concurrency });
  return worker;
}
