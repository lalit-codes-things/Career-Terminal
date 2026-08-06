import { Worker, type Job } from 'bullmq';
import { bullMQConnection } from '../../../config/redis';
import { logger } from '../../../lib/logger';
import { QUEUE_NAMES, type EconomicDocumentJobPayload, EconomicDocumentJobPayloadSchema } from '../queue.types';
import { config } from '../../../config';
import { prisma } from '../../../config/database';
import { pipeline } from '../../../services/recruiter-intelligence/ai/pipeline.factory';
import { randomUUID } from 'crypto';

async function processEconomicDocumentJob(job: Job<EconomicDocumentJobPayload>): Promise<void> {
  const { type, userId, documentId, documentType, documentCategory, s3Key, mimeType, originalFilename, content, sourceName, sourceUri, currency, locale, validFrom, validTo, transactionStart, transactionEnd, metadata } = EconomicDocumentJobPayloadSchema.parse(job.data);

  logger.info('[EconomicWorker] Processing economic document job', {
    jobId: job.id,
    attempt: job.attemptsMade + 1,
    type,
    userId,
    documentId,
    documentType,
    documentCategory,
  });

  let extractedText = content;

  if (!extractedText) {
    throw new Error(`No content available for economic document ${documentId}`);
  }

  const extractionId = randomUUID();
  const templateId = 'economic-document-extraction';

  const output = await pipeline.extract(templateId, {
    extractionId,
    tenantId: userId,
    sourceType: 'document',
    sourceId: documentId,
    content: extractedText,
    metadata: {
      entityType: 'economicDocument',
      documentType,
      documentCategory,
      originalFilename,
      sourceName: sourceName ?? '',
      sourceUri: sourceUri ?? '',
      currency: currency ?? '',
      locale: locale ?? '',
      validFrom: validFrom ?? '',
      validTo: validTo ?? '',
      transactionStart: transactionStart ?? '',
      transactionEnd: transactionEnd ?? '',
      ...(metadata ?? {}),
    },
    requestedAt: new Date(),
  }, {
    documentType,
    documentCategory,
    originalFilename,
    sourceName: sourceName ?? '',
    sourceUri: sourceUri ?? '',
    currency: currency ?? '',
    locale: locale ?? '',
    validFrom: validFrom ?? '',
    validTo: validTo ?? '',
    transactionStart: transactionStart ?? '',
    transactionEnd: transactionEnd ?? '',
    content: extractedText,
  });

  const fields = normalizeEconomicFields(output.fields);

  const overallConfidence = fields.length > 0
    ? fields.reduce((sum, f) => sum + f.confidence, 0) / fields.length
    : 0;

  const economicDocument = await prisma.economicDocument.create({
    data: {
      userId,
      documentType,
      documentCategory,
      title: originalFilename,
      sourceName: sourceName ?? null,
      sourceUri: sourceUri ?? null,
      s3Key,
      mimeType,
      rawText: extractedText,
      extractedJson: { fields } as any,
      extractionMethod: 'economic-document-extraction',
      modelVersion: output.model,
      confidence: overallConfidence,
      currency: currency ?? null,
      locale: locale ?? null,
      validFrom: validFrom ? new Date(validFrom) : null,
      validTo: validTo ? new Date(validTo) : null,
      transactionStart: transactionStart ? new Date(transactionStart) : null,
      transactionEnd: transactionEnd ? new Date(transactionEnd) : null,
    },
  });

  const factIds: string[] = [];
  for (const field of fields) {
    if (field.confidence < 0.4) continue;

    try {
      const fact = await prisma.factObservation.create({
        data: {
          userId,
          factType: `economic.${field.field}`,
          factData: {
            value: field.value,
            rawValue: field.rawValue,
            field: field.field,
            documentId: economicDocument.id,
          } as any,
          sourceType: 'economic-document',
          sourceId: economicDocument.id,
          sourceVersion: output.templateVersion,
          extractionMethod: 'economic-document-extraction',
          modelVersion: output.model,
          confidence: field.confidence,
          evidenceReference: field.evidence.map((e) => e.sourceId).join(',') || null,
          validFrom: new Date(),
          observedAt: new Date(),
          extractedAt: new Date(),
          isCurrent: true,
          version: 1,
        },
      });
      factIds.push(fact.id);
    } catch {
      // Non-fatal — log and continue with remaining fields
    }
  }

  const signals = inferEconomicSignals(fields, economicDocument.id);
  for (const signal of signals) {
    try {
      await prisma.economicSignal.create({
        data: {
          userId,
          signalType: signal.signalType,
          signalCategory: signal.signalCategory,
          signalName: signal.signalName,
          signalValue: signal.signalValue as any,
          sourceDocumentId: economicDocument.id,
          entityId: economicDocument.id,
          entityType: 'EconomicDocument',
          confidence: signal.confidence,
          validFrom: new Date(),
          isCurrent: true,
        },
      });
    } catch {
      // Non-fatal
    }
  }

  logger.info('[EconomicWorker] Economic document processed', {
    jobId: job.id,
    documentId: economicDocument.id,
    fieldsExtracted: fields.length,
    factsCreated: factIds.length,
    signalsCreated: signals.length,
    overallConfidence,
  });
}

function normalizeEconomicFields(
  fields: Array<{ field: string; value: unknown; rawValue: string; confidence: number; evidence: Array<{ excerpt?: string; confidence?: number }> }>,
) {
  return fields.map((f) => {
    const confidence = typeof f.confidence === 'number'
      ? Math.max(0, Math.min(1, f.confidence))
      : 0.5;
    return {
      field: f.field,
      value: f.value,
      rawValue: f.rawValue,
      confidence,
      confidenceBand: confidence >= 0.8 ? 'high' : confidence >= 0.5 ? 'medium' : 'low',
      evidence: (f.evidence ?? []).map((e) => ({
        sourceId: '',
        excerpt: String(e.excerpt ?? ''),
        confidence: typeof e.confidence === 'number' ? e.confidence : confidence,
      })),
    };
  });
}

interface InferredSignal {
  signalType: string;
  signalCategory: string;
  signalName: string;
  signalValue: Record<string, unknown>;
  confidence: number;
}

function inferEconomicSignals(
  fields: Array<{ field: string; value: unknown; confidence: number }>,
  documentId: string,
): InferredSignal[] {
  const signals: InferredSignal[] = [];
  const fieldNames = fields.map((f) => f.field.toLowerCase());

  const hasCompensation = fieldNames.some((n) => n.includes('salary') || n.includes('compensation') || n.includes('total_comp'));
  const hasEquity = fieldNames.some((n) => n.includes('equity') || n.includes('stock') || n.includes('rsu'));
  const hasBonus = fieldNames.some((n) => n.includes('bonus'));
  const hasSigning = fieldNames.some((n) => n.includes('signing'));

  if (hasCompensation) {
    signals.push({
      signalType: 'OFFER_COMPETITIVENESS',
      signalCategory: 'compensation',
      signalName: 'Offer Competitiveness',
      signalValue: {
        documentId,
        hasMarketData: false,
        note: 'Compensation amount extracted; market comparison requires external data',
      },
      confidence: 0.6,
    });
  }

  if (hasEquity && hasCompensation) {
    signals.push({
      signalType: 'COMPENSATION_MIX',
      signalCategory: 'compensation',
      signalName: 'Compensation Mix Analysis',
      signalValue: {
        documentId,
        hasBaseSalary: hasCompensation,
        hasEquity: hasEquity,
        hasBonus: hasBonus,
        hasSigningBonus: hasSigning,
      },
      confidence: 0.7,
    });
  }

  if (hasSigning) {
    signals.push({
      signalType: 'NEGOTIATION_LEVERAGE',
      signalCategory: 'negotiation',
      signalName: 'Signing Bonus Signal',
      signalValue: {
        documentId,
        hasSigningBonus: true,
        note: 'Signing bonus may indicate employer urgency or negotiation leverage',
      },
      confidence: 0.65,
    });
  }

  return signals;
}

export function startEconomicDocumentWorker(): Worker<EconomicDocumentJobPayload> {
  const worker = new Worker<EconomicDocumentJobPayload>(QUEUE_NAMES.ECONOMIC_DOCUMENT, processEconomicDocumentJob, {
    connection: bullMQConnection,
    concurrency: config.worker.concurrency,
  });

  worker.on('completed', (job) =>
    logger.info('[EconomicWorker] Job completed', { jobId: job.id, type: job.data.type, userId: job.data.userId }),
  );

  worker.on('failed', (job, err) =>
    logger.error('[EconomicWorker] Job failed', {
      jobId: job?.id,
      attempt: job?.attemptsMade,
      error: err.message,
    }),
  );

  worker.on('error', (err) => logger.error('[EconomicWorker] Worker error', { message: err.message }));

  logger.info('[EconomicWorker] Started', { concurrency: worker.opts.concurrency });
  return worker;
}