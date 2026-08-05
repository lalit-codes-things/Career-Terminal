/**
 * IntelligenceWorker — processes jobs from the "intelligence" BullMQ queue.
 *
 * Job types (from IntelligenceJobTypeSchema):
 *   GENERATE_EMBEDDING   → embed entity text into pgvector tables
 *   MATCH_RESUME         → run planner(extract) on a resume, persist facts
 *   MATCH_SKILLS         → run AI taxonomy extraction on text
 *   GENERATE_RECOMMENDATION → run planner(recommend)
 *   GENERATE_PREDICTION  → run planner(predict)
 *
 * This is a NEW consumer of the existing intelligence queue — the queue
 * already existed and was being populated by the OutboxDispatcher but had
 * no worker processing it. No new tables or queue names were added.
 */
import { Worker, type Job } from 'bullmq';
import { bullMQConnection } from '../../../config/redis';
import { logger } from '../../../lib/logger';
import { config } from '../../../config';
import { QUEUE_NAMES, type IntelligenceJobPayload, IntelligenceJobPayloadSchema } from '../queue.types';
import { withEventLifecycle } from '../../event/event-worker';
import { planner } from '../../planner';
import { hybridRetrievalService } from '../../recruiter-intelligence/vector-search/hybrid-retrieval.service';
import { aiTaxonomyService } from '../../career-taxonomy/ai-taxonomy.service';
import type { CapabilityInput } from '../../capabilities/types';

// ─── Job processor ────────────────────────────────────────────────────────────

export async function processIntelligenceJob(job: Job<IntelligenceJobPayload>): Promise<void> {
  return withEventLifecycle(job, async (job) => {
    const payload = IntelligenceJobPayloadSchema.parse(job.data);
    const { type, userId, targetId, targetType, metadata } = payload;

    logger.info('[IntelligenceWorker] Processing job', {
      jobId: job.id,
      attempt: job.attemptsMade + 1,
      type,
      userId,
      targetId,
    });

    switch (type) {
      case 'GENERATE_EMBEDDING': {
        if (!targetId || !targetType) break;
        const text = String((metadata as Record<string, unknown>)?.['text'] ?? targetId);
        const entityType = resolveEntityType(targetType);
        await hybridRetrievalService.embed(text, targetId, entityType, userId).catch((err) => {
          logger.warn('[IntelligenceWorker] Embedding failed (non-fatal)', {
            targetId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
        break;
      }

      case 'MATCH_RESUME': {
        if (!targetId) break;
        const resumeText = String((metadata as Record<string, unknown>)?.['resumeText'] ?? '');
        if (!resumeText) {
          logger.warn('[IntelligenceWorker] MATCH_RESUME job missing resumeText', { targetId });
          break;
        }
        await planner.run({
          userId,
          entityId: targetId,
          entityType: 'resume',
          content: resumeText,
          intent: 'extract',
          plannerContext: { triggeredBy: 'intelligence_worker', jobId: job.id },
        });
        break;
      }

      case 'MATCH_SKILLS': {
        if (!targetId) break;
        const text = String((metadata as Record<string, unknown>)?.['text'] ?? '');
        await Promise.allSettled([
          aiTaxonomyService.matchSkills(text, userId, targetId),
          aiTaxonomyService.matchOccupations(text, userId, targetId),
        ]);
        break;
      }

      case 'GENERATE_RECOMMENDATION': {
        if (!targetId) break;
        const capInput: CapabilityInput = {
          userId,
          entityId: targetId,
          entityType: resolveCapabilityEntityType(targetType ?? 'recruiter'),
          content: String((metadata as Record<string, unknown>)?.['content'] ?? targetId),
          plannerContext: { triggeredBy: 'intelligence_worker', jobId: job.id },
        };
        await planner.run({ ...capInput, intent: 'recommend' });
        break;
      }

      case 'GENERATE_PREDICTION': {
        if (!targetId) break;
        const capInput: CapabilityInput = {
          userId,
          entityId: targetId,
          entityType: resolveCapabilityEntityType(targetType ?? 'opportunity'),
          content: String((metadata as Record<string, unknown>)?.['content'] ?? targetId),
          plannerContext: { triggeredBy: 'intelligence_worker', jobId: job.id },
        };
        await planner.run({ ...capInput, intent: 'predict' });
        break;
      }

      default:
        logger.warn('[IntelligenceWorker] Unknown job type', { type });
    }

    logger.info('[IntelligenceWorker] Job completed', { jobId: job.id, type });
  });
}

// ─── Worker factory ───────────────────────────────────────────────────────────

export function startIntelligenceWorker(): Worker<IntelligenceJobPayload> {
  const worker = new Worker<IntelligenceJobPayload>(
    QUEUE_NAMES.INTELLIGENCE,
    processIntelligenceJob,
    {
      connection: bullMQConnection,
      concurrency: Math.max(1, Math.floor((config.worker.concurrency ?? 4) / 2)),
    },
  );

  worker.on('completed', (job) =>
    logger.info('[IntelligenceWorker] Job completed', { jobId: job.id, type: job.data.type }),
  );

  worker.on('failed', (job, err) =>
    logger.error('[IntelligenceWorker] Job failed', {
      jobId: job?.id,
      type: job?.data.type,
      attempt: job?.attemptsMade,
      error: err.message,
    }),
  );

  worker.on('error', (err) =>
    logger.error('[IntelligenceWorker] Worker error', { message: err.message }),
  );

  logger.info('[IntelligenceWorker] Started', { concurrency: worker.opts.concurrency });
  return worker;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type EntityType = import('../../../domain/recruiter-intelligence/semantic-representation/contracts').EntityType;
type CapabilityEntityType = CapabilityInput['entityType'];

function resolveEntityType(targetType: string): EntityType {
  const map: Record<string, EntityType> = {
    resume: 'resume',
    opportunity: 'opportunity',
    application: 'observation',
    recruiter: 'recruiter_profile',
    company: 'company',
    candidate: 'recruiter_profile',
  };
  return map[targetType.toLowerCase()] ?? 'observation';
}

function resolveCapabilityEntityType(targetType: string): CapabilityEntityType {
  const map: Record<string, CapabilityEntityType> = {
    resume: 'resume',
    opportunity: 'opportunity',
    application: 'application',
    recruiter: 'recruiter',
    company: 'company',
    candidate: 'candidate',
  };
  return map[targetType.toLowerCase()] ?? 'candidate';
}
