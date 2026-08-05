/**
 * Base class shared by all capability modules.
 *
 * Handles:
 *  - Calling ExtractionPipeline
 *  - Writing a Prediction row (latency, cost, confidence, raw output)
 *  - Writing RecruiterFact rows when entityType === 'recruiter'
 *  - Returning a CapabilityResult
 *
 * Subclasses only need to implement `templateId()` and optionally `factType()`.
 */

import { randomUUID } from 'crypto';
import { prisma } from '../../config/database';
import { pipeline } from '../recruiter-intelligence/ai/pipeline.factory';
import type { ExtractionInput, ExtractionOutput } from '../recruiter-intelligence/ai/types';
import { toConfidenceBand } from '../recruiter-intelligence/ai/utils';
import type { CapabilityInput, CapabilityName, CapabilityResult } from './types';
import { withAiSpan, recordAiAttributes } from '../../infrastructure/telemetry/ai-spans';

const DEFAULT_MODEL_ID = 'deepseek/deepseek-chat';

export abstract class CapabilityBase {
  abstract readonly name: CapabilityName;
  protected abstract defaultTemplateId(): string;

  async run(input: CapabilityInput): Promise<CapabilityResult> {
    const start = Date.now();

    return withAiSpan(this.name, {
      capability: this.name,
      entityType: input.entityType,
      entityId: input.entityId,
    }, async (span) => {
      const extractionId = randomUUID();
      const templateId = input.templateId ?? this.defaultTemplateId();

      const aiInput: ExtractionInput = {
        extractionId,
        tenantId: input.userId,
        sourceType: this.resolveSourceType(input.entityType),
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

      // Record telemetry on the span
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

      const recruiterFactIds: string[] = [];
      if (input.entityType === 'recruiter') {
        const factIds = await this.writeRecruiterFacts(input, output);
        recruiterFactIds.push(...factIds);
      }

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
        recruiterFactIds,
        latencyMs,
        inputTokens: output.usage.inputTokens,
        outputTokens: output.usage.outputTokens,
        estimatedCostUsd: output.usage.estimatedCostUsd,
        completedAt: output.completedAt,
      };
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async writePrediction(
    input: CapabilityInput,
    output: ExtractionOutput | null,
    latencyMs: number,
    error: unknown,
  ): Promise<string> {
    const confidence = output?.overallConfidence ?? 0;
    const band = toConfidenceBand(confidence);

    const prediction = await prisma.prediction.create({
      data: {
        modelId: DEFAULT_MODEL_ID,
        userId: input.userId,
        recruiterId: input.entityType === 'recruiter' ? input.entityId : undefined,
        applicationId: input.entityType === 'application' ? input.entityId : undefined,
        opportunityId: input.entityType === 'opportunity' ? input.entityId : undefined,
        predictionType: `CAPABILITY_${this.name.toUpperCase()}`,
        capability: this.name,
        predictionValue: output
          ? { fields: output.fields.map((f) => ({ field: f.field, value: f.value })) }
          : { error: error instanceof Error ? error.message : String(error) },
        confidenceScore: confidence,
        confidenceBand: band,
        provider: output?.provider,
        latencyMs,
        inputTokens: output?.usage.inputTokens,
        outputTokens: output?.usage.outputTokens,
        estimatedCostUsd: output?.usage.estimatedCostUsd,
        rawOutput: output ? { fields: output.fields } : null,
        outputValid: output ? !output.requiresHumanReview : false,
        outputErrors: [],
        requiresReview: output?.requiresHumanReview ?? false,
        reviewReason: output?.reviewReason,
        plannerContext: input.plannerContext ?? {},
        timestamp: new Date(),
      },
    });

    return prediction.id;
  }

  private async writeRecruiterFacts(
    input: CapabilityInput,
    output: ExtractionOutput,
  ): Promise<string[]> {
    const now = new Date();
    const factIds: string[] = [];

    for (const field of output.fields) {
      if (field.confidence < 0.4) continue; // skip very low confidence fields

      try {
        const fact = await prisma.recruiterFact.create({
          data: {
            recruiterId: input.entityId,
            factType: `${this.name}.${field.field}`,
            factValue: { value: field.value, rawValue: field.rawValue },
            confidence: field.confidence,
            verificationStatus: field.confidence >= 0.8 ? 'VERIFIED' : 'PENDING',
            validFrom: now,
            validTo: null,
            source: `capability:${this.name}`,
            provenanceJson: {
              templateId: output.templateId,
              model: output.model,
              provider: output.provider,
              extractionId: output.extractionId,
            },
            evidenceJson: field.evidence.map((e) => ({
              sourceId: e.sourceId,
              excerpt: e.excerpt,
              confidence: e.confidence,
            })),
          },
        });
        factIds.push(fact.id);
      } catch {
        // Non-fatal — log and continue with remaining fields
      }
    }

    return factIds;
  }

  private resolveSourceType(
    entityType: CapabilityInput['entityType'],
  ): ExtractionInput['sourceType'] {
    if (entityType === 'resume') return 'document';
    if (entityType === 'candidate' || entityType === 'recruiter') return 'profile';
    return 'document';
  }
}
