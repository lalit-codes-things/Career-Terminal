import { randomUUID } from 'crypto';
import { prisma } from '../../config/database';
import { pipeline } from '../recruiter-intelligence/ai/pipeline.factory';
import type { ExtractionInput, ExtractionOutput } from '../recruiter-intelligence/ai/types';
import { toConfidenceBand } from '../recruiter-intelligence/ai/utils';
import type { CapabilityInput, CapabilityName, CapabilityResult } from './types';
import { CapabilityBase } from './capability.base';
import { withAiSpan, recordAiAttributes } from '../../infrastructure/telemetry/ai-spans';

export class EconomicDocumentExtractionCapability extends CapabilityBase {
  readonly name: CapabilityName = 'economic-extract';

  protected defaultTemplateId(): string {
    return 'economic-document-extraction';
  }

  async run(input: CapabilityInput): Promise<CapabilityResult> {
    const start = Date.now();

    return withAiSpan(this.name, {
      capability: this.name,
      entityType: input.entityType,
      entityId: input.entityId,
    }, async () => {
      const extractionId = randomUUID();
      const templateId = input.templateId ?? this.defaultTemplateId();

      const aiInput: ExtractionInput = {
        extractionId,
        tenantId: input.userId,
        sourceType: 'document',
        sourceId: input.entityId,
        content: input.content,
        metadata: {
          entityType: input.entityType,
          capability: this.name,
          ...(input.context ?? {}),
        },
        requestedAt: new Date(),
      };

      let output: ExtractionOutput;
      try {
        output = await pipeline.extract(templateId, aiInput, input.context ?? {});
      } catch (err) {
        await this.writePrediction(input, null, Date.now() - start, err);
        throw err;
      }

      const latencyMs = Date.now() - start;
      const band = toConfidenceBand(output.overallConfidence);

      recordAiAttributes({
        provider: output.provider,
        model: output.model,
        inputTokens: output.usage.inputTokens,
        outputTokens: output.usage.outputTokens,
        costUsd: output.usage.estimatedCostUsd,
        latencyMs,
        confidence: output.overallConfidence,
        confidenceBand: band,
        requiresReview: output.requiresHumanReview,
      });

      const extractionRun = await prisma.extractionRun.create({
        data: {
          userId: input.userId,
          sourceType: 'economic-document',
          sourceId: input.entityId,
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

      const provenance = await prisma.factProvenance.create({
        data: {
          userId: input.userId,
          sourceType: 'economic-document',
          sourceId: input.entityId,
          extractionRunId: extractionRun.id,
          parserVersion: output.templateVersion,
          modelProvider: output.provider,
          modelVersion: output.model,
          promptVersion: output.templateVersion,
          schemaVersion: '1.0.0',
        },
      });

      const economicDocumentId = await this.writeEconomicDocument(input, output);

      const factIds = await this.writeEconomicFactObservations(input, output, economicDocumentId, extractionRun.id, provenance.id);

      const predictionId = await this.writePrediction(input, output, latencyMs, null);

      return {
        predictionId,
        capability: this.name,
        fields: output.fields.map((f) => ({
          name: f.field,
          value: f.value,
          confidence: f.confidence,
          evidence: f.evidence.map((e) => e.excerpt).join(' | '),
        })),
        confidence: output.overallConfidence,
        confidenceBand: band,
        recruiterFactIds: factIds,
        latencyMs,
        inputTokens: output.usage.inputTokens,
        outputTokens: output.usage.outputTokens,
        estimatedCostUsd: output.usage.estimatedCostUsd,
        completedAt: output.completedAt,
      };
    });
  }

  private async writeEconomicDocument(
    input: CapabilityInput,
    output: ExtractionOutput,
  ): Promise<string> {
    const doc = await prisma.economicDocument.create({
      data: {
        userId: input.userId,
        documentType: input.context?.['documentType'] ?? 'unknown',
        documentCategory: input.context?.['documentCategory'] ?? 'general',
        title: input.context?.['documentTitle'] ?? null,
        sourceName: input.context?.['sourceName'] ?? null,
        sourceUri: input.context?.['sourceUri'] ?? null,
        s3Key: input.context?.['s3Key'] ?? null,
        mimeType: input.context?.['mimeType'] ?? null,
        rawText: input.content,
        extractedJson: { fields: output.fields } as any,
        extractionMethod: 'economic-document-extraction',
        modelVersion: output.model,
        confidence: output.overallConfidence,
        currency: input.context?.['currency'] ?? null,
        locale: input.context?.['locale'] ?? null,
        validFrom: input.context?.['validFrom'] ? new Date(input.context['validFrom']) : null,
        validTo: input.context?.['validTo'] ? new Date(input.context['validTo']) : null,
        transactionStart: input.context?.['transactionStart'] ? new Date(input.context['transactionStart']) : null,
        transactionEnd: input.context?.['transactionEnd'] ? new Date(input.context['transactionEnd']) : null,
      },
    });
    return doc.id;
  }

  private async writeEconomicFactObservations(
    input: CapabilityInput,
    output: ExtractionOutput,
    economicDocumentId: string,
    extractionRunId: string,
    provenanceId: string,
  ): Promise<string[]> {
    const now = new Date();
    const factIds: string[] = [];

    for (const field of output.fields) {
      if (field.confidence < 0.4) continue;

      const fieldNeedsReview = field.confidence < 0.55;

      try {
        const fact = await prisma.factObservation.create({
          data: {
            userId: input.userId,
            factType: `economic.${field.field}`,
            factData: {
              value: field.value,
              rawValue: field.rawValue,
              field: field.field,
              documentId: economicDocumentId,
            } as any,
            sourceType: 'economic-document',
            sourceId: economicDocumentId,
            sourceVersion: output.templateVersion,
            extractionMethod: 'economic-document-extraction',
            modelVersion: output.model,
            confidence: field.confidence,
            evidenceReference: field.evidence.map((e) => e.sourceId).join(',') || null,
            extractionRunId: extractionRunId,
            provenanceId: provenanceId,
            validFrom: now,
            observedAt: now,
            extractedAt: now,
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

    return factIds;
  }
}

export const economicExtractCapability = new EconomicDocumentExtractionCapability();