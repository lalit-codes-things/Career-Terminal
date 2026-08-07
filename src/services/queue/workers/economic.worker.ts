import { Worker, type Job } from 'bullmq';
import { bullMQConnection } from '../../../config/redis';
import { logger } from '../../../lib/logger';
import { QUEUE_NAMES, type EconomicDocumentJobPayload, EconomicDocumentJobPayloadSchema } from '../queue.types';
import { config } from '../../../config';
import { dbRouter } from '../../../config/database';
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

  const needsReview = overallConfidence < 0.55;

  const extractionRun = await dbRouter.write().extractionRun.create({
    data: {
      userId,
      sourceType: 'economic-document',
      sourceId: documentId,
      modelId: 'deepseek/deepseek-chat',
      modelVersion: output.model,
      status: 'completed',
      startedAt: new Date(),
      completedAt: output.completedAt,
      parserVersion: output.templateVersion,
      modelProvider: output.provider,
      promptVersion: output.templateVersion,
      schemaVersion: '1.0.0',
    },
  });

  const provenance = await dbRouter.write().factProvenance.create({
    data: {
      userId,
      sourceType: 'economic-document',
      sourceId: documentId,
      extractionRunId: extractionRun.id,
      parserVersion: output.templateVersion,
      modelProvider: output.provider,
      modelVersion: output.model,
      promptVersion: output.templateVersion,
      schemaVersion: '1.0.0',
    },
  });

  const economicDocument = await dbRouter.write().economicDocument.create({
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
    const fieldConfidence = field.confidence;
    const fieldNeedsReview = fieldConfidence < 0.55;

    try {
        const fact = await dbRouter.write().factObservation.create({
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
          confidence: fieldConfidence,
          evidenceReference: field.evidence.map((e) => e.excerpt).join(',') || null,
          extractionRunId: extractionRun.id,
          provenanceId: provenance.id,
          validFrom: new Date(),
          observedAt: new Date(),
          extractedAt: new Date(),
          isCurrent: true,
          needsReview: fieldNeedsReview,
          reviewStatus: fieldNeedsReview ? 'pending' : 'approved',
          version: 1,
        },
      });
      factIds.push(fact.id);
    } catch {
      // Non-fatal — log and continue with remaining fields
    }
  }

  const economicEvents = buildEconomicEvents(fields, economicDocument.id, userId, documentType);
  for (const event of economicEvents) {
    try {
        await dbRouter.write().economicEvent.create({
        data: {
          userId,
          eventType: event.eventType,
          eventCategory: event.eventCategory,
          sourceDocumentId: economicDocument.id,
          title: event.title,
          description: event.description,
          amount: event.amount,
          currency: event.currency,
          effectiveDate: event.effectiveDate,
          validFrom: new Date(),
          validTo: null,
          sequenceNumber: event.sequenceNumber,
          confidence: event.confidence,
          isCurrent: true,
        },
      });
    } catch {
      // Non-fatal
    }
  }

  const signals = inferEconomicSignals(fields, economicDocument.id);
  for (const signal of signals) {
    try {
        await dbRouter.write().economicSignal.create({
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

  await storeEconomicMemory(userId, economicDocument.id, fields, signals, economicEvents);

  logger.info('[EconomicWorker] Economic document processed', {
    jobId: job.id,
    documentId: economicDocument.id,
    extractionRunId: extractionRun.id,
    provenanceId: provenance.id,
    fieldsExtracted: fields.length,
    factsCreated: factIds.length,
    eventsCreated: economicEvents.length,
    signalsCreated: signals.length,
    needsReview,
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

interface EconomicEventData {
  eventType: string;
  eventCategory: string;
  title: string;
  description: string | null;
  amount: number | null;
  currency: string | null;
  effectiveDate: Date | null;
  sequenceNumber: number;
  confidence: number;
}

function buildEconomicEvents(
  fields: Array<{ field: string; value: unknown; confidence: number }>,
  _documentId: string,
  _userId: string,
  documentType: string,
): EconomicEventData[] {
  const events: EconomicEventData[] = [];
  const fieldMap = new Map(fields.map((f) => [f.field.toLowerCase(), f]));

  const salaryFields = Array.from(fieldMap.entries()).filter(([, f]) =>
    f.field.toLowerCase().includes('salary') || f.field.toLowerCase().includes('base'),
  );

  if (salaryFields.length > 0) {
    const salaryField = salaryFields[0];
    if (!salaryField) return events;
    const value = salaryField[1].value;
    const amount = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.]/g, ''));

    events.push({
      eventType: 'OFFER',
      eventCategory: 'compensation',
      title: 'Offer Created',
      description: `Base salary offer of ${amount} detected from ${documentType} document`,
      amount: isNaN(amount) ? null : amount,
      currency: null,
      effectiveDate: null,
      sequenceNumber: 1,
      confidence: salaryField[1].confidence,
    });
  }

  const bonusFields = Array.from(fieldMap.entries()).filter(([, f]) =>
    f.field.toLowerCase().includes('bonus'),
  );

  if (bonusFields.length > 0) {
    const bonusField = bonusFields[0];
    if (!bonusField) return events;
    const bonusValue = bonusField[1].value;
    const bonusAmount = typeof bonusValue === 'number' ? bonusValue : parseFloat(String(bonusValue).replace(/[^0-9.]/g, ''));

    events.push({
      eventType: 'BONUS',
      eventCategory: 'compensation',
      title: 'Bonus Detected',
      description: `Bonus of ${bonusAmount} detected from ${documentType} document`,
      amount: isNaN(bonusAmount) ? null : bonusAmount,
      currency: null,
      effectiveDate: null,
      sequenceNumber: 2,
      confidence: bonusField[1].confidence,
    });
  }

  const equityFields = Array.from(fieldMap.entries()).filter(([, f]) =>
    f.field.toLowerCase().includes('equity') || f.field.toLowerCase().includes('stock') || f.field.toLowerCase().includes('rsu'),
  );

  if (equityFields.length > 0) {
    const equityField = equityFields[0];
    if (!equityField) return events;
    events.push({
      eventType: 'EQUITY',
      eventCategory: 'compensation',
      title: 'Equity Grant Detected',
      description: `Equity grant detected from ${documentType} document`,
      amount: null,
      currency: null,
      effectiveDate: null,
      sequenceNumber: 3,
      confidence: equityField[1].confidence,
    });
  }

  return events;
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

async function storeEconomicMemory(
  userId: string,
  documentId: string,
  fields: Array<{ field: string; value: unknown; confidence: number }>,
  signals: InferredSignal[],
  events: EconomicEventData[],
): Promise<void> {
  try {
    const memoryEntries = [
      ...fields.map((f) => ({
        factType: `economic.${f.field}`,
        factValue: { value: f.value, confidence: f.confidence, documentId },
        confidence: f.confidence,
      })),
      ...signals.map((s) => ({
        factType: `signal.${s.signalType}`,
        factValue: { signalName: s.signalName, signalValue: s.signalValue, confidence: s.confidence, documentId },
        confidence: s.confidence,
      })),
      ...events.map((e) => ({
        factType: `event.${e.eventType}`,
        factValue: { eventType: e.eventType, title: e.title, amount: e.amount, confidence: e.confidence, documentId },
        confidence: e.confidence,
      })),
    ];

    for (const entry of memoryEntries) {
      await dbRouter.write().recruiterMemoryObservation.create({
        data: {
          recruiterId: userId,
          factType: entry.factType,
          factValue: entry.factValue as any,
          confidence: entry.confidence,
           validFrom: new Date(),
           validTo: null,
           provenanceJson: { documentId },
           evidenceJson: [],
         },
      });
    }
  } catch {
    // Non-fatal — memory integration is best-effort
  }
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