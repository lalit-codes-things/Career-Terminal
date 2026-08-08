import { randomUUID } from 'crypto';
import { dbRouter } from '../../config/database';
import { pipeline } from '../recruiter-intelligence/ai/pipeline.factory';
import type { ExtractionInput, ExtractionOutput } from '../recruiter-intelligence/ai/types';
import { toConfidenceBand } from '../recruiter-intelligence/ai/utils';
import type { CapabilityInput, CapabilityName, CapabilityResult } from './types';
import { CapabilityBase } from './capability.base';
import { withAiSpan, recordAiAttributes } from '../../infrastructure/telemetry/ai-spans';

interface SessionData {
  roleTitle: string;
  jobLevel: string;
  loopType: string;
  sourceType: string;
  status?: string;
  finalDecision?: string;
  offerExtended?: boolean;
  offerAccepted?: boolean;
  companyNameRaw?: string;
}

interface RoundData {
  roundType: string;
  sequenceNumber: number;
  interviewerLabel?: string;
  durationMinutes?: number;
  outcomeScore?: number;
  outcomeLabel?: string;
  notes?: string;
}

interface EventData {
  eventType: string;
  eventCategory: string;
  title: string;
  description?: string;
  effectiveDate?: Date;
  sequenceNumber: number;
}

interface CompetencyData {
  competency: string;
  name: string;
  category: string;
  demonstratedLevel: number;
  evidenceExcerpt: string;
}

interface SignalData {
  signalType: string;
  signalCategory: string;
  signalName: string;
  signalValue: Record<string, unknown>;
  sourceEventId?: string;
}

interface DecisionData {
  finalDecision: string;
  confidence: number;
}

export class InterviewExtractionCapability extends CapabilityBase {
  readonly name: CapabilityName = 'interview-extract';

  protected defaultTemplateId(): string {
    return 'interview-transcript-extraction';
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

      const extractionRun = await dbRouter.write().extractionRun.create({
        data: {
          userId: input.userId,
          sourceType: 'interview-transcript',
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

      const provenance = await dbRouter.write().factProvenance.create({
        data: {
          userId: input.userId,
          sourceType: 'interview-transcript',
          sourceId: input.entityId,
          extractionRunId: extractionRun.id,
          parserVersion: output.templateVersion,
          modelProvider: output.provider,
          modelVersion: output.model,
          promptVersion: output.templateVersion,
          schemaVersion: '1.0.0',
        },
      });

      const sessionId = await this.writeInterviewData(input, output);

      const factIds = await this.writeInterviewFactObservations(input, output, sessionId, extractionRun.id, provenance.id);

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

  private async writeInterviewData(
    input: CapabilityInput,
    output: ExtractionOutput,
  ): Promise<string> {
    const now = new Date();
    const fields = output.fields;

    const sessionField = fields.find((f) => f.field === 'session');
    const sessionData: SessionData | undefined = sessionField?.value as SessionData | undefined;

    const existingSessionId = input.context?.['sessionId'] as string | undefined;

    let sessionId: string;
    if (existingSessionId) {
      const existing = await dbRouter.write().interviewSession.findUnique({ where: { id: existingSessionId } });
      if (existing) {
        sessionId = existing.id;
      } else {
        sessionId = await this.createSession(input, sessionData, now);
      }
    } else {
      sessionId = await this.createSession(input, sessionData, now);
    }

    const roundFields = fields.filter((f) => f.field === 'round');
    const eventFields = fields.filter((f) => f.field === 'event');
    const competencyFields = fields.filter((f) => f.field === 'competency');
    const signalFields = fields.filter((f) => f.field === 'signal');
    const decisionField = fields.find((f) => f.field === 'decision');

    const roundIdMap = new Map<string, string>();

    for (const field of roundFields) {
      const roundData = field.value as RoundData;
      if (!roundData) continue;

      const round = await dbRouter.write().interviewRound.create({
        data: {
          sessionId,
          userId: input.userId,
          roundType: roundData.roundType,
          sequenceNumber: roundData.sequenceNumber,
          interviewerLabel: roundData.interviewerLabel ?? null,
          durationMinutes: roundData.durationMinutes ?? null,
          outcomeScore: roundData.outcomeScore ?? null,
          outcomeLabel: roundData.outcomeLabel ?? null,
          notes: roundData.notes ?? null,
          confidence: field.confidence,
        },
      });
      roundIdMap.set(`round_${roundData.sequenceNumber}`, round.id);
    }

    for (const field of eventFields) {
      const eventData = field.value as EventData;
      if (!eventData) continue;

      const roundId = eventData.sequenceNumber !== undefined && roundIdMap.has(`round_${eventData.sequenceNumber}`)
        ? roundIdMap.get(`round_${eventData.sequenceNumber}`)!
        : null;

      try {
        await dbRouter.write().interviewEvent.create({
          data: {
            userId: input.userId,
            sessionId,
            roundId: roundId ?? undefined,
            eventType: eventData.eventType,
            eventCategory: eventData.eventCategory,
            title: eventData.title,
            description: eventData.description ?? null,
            effectiveDate: eventData.effectiveDate ?? null,
            sequenceNumber: eventData.sequenceNumber,
            confidence: field.confidence,
            validFrom: now,
            isCurrent: true,
          },
        });
      } catch {
        // Non-fatal
      }
    }

    for (const field of competencyFields) {
      const compData = field.value as CompetencyData;
      if (!compData) continue;

      const competencyId = await this.resolveCompetencyId(compData.competency, compData.name);
      if (!competencyId) continue;

      const roundId = compData.evidenceExcerpt && roundIdMap.size > 0
        ? roundIdMap.values().next().value ?? undefined
        : undefined;

      try {
        await dbRouter.write().interviewCompetencyObservation.create({
          data: {
            userId: input.userId,
            sessionId,
            roundId: roundId ?? undefined,
            competencyId,
            demonstratedLevel: Math.max(0, Math.min(1, compData.demonstratedLevel)),
            evidenceExcerpt: compData.evidenceExcerpt ?? null,
            confidence: field.confidence,
            validFrom: now,
            isCurrent: true,
          },
        });
      } catch {
        // Non-fatal
      }
    }

    for (const field of signalFields) {
      const signalData = field.value as SignalData;
      if (!signalData) continue;

      const roundId = signalData.sourceEventId && roundIdMap.size > 0
        ? roundIdMap.values().next().value ?? undefined
        : undefined;

      try {
        await dbRouter.write().interviewSignal.create({
          data: {
            userId: input.userId,
            sessionId,
            roundId: roundId ?? undefined,
            signalType: signalData.signalType,
            signalCategory: signalData.signalCategory,
            signalName: signalData.signalName,
            signalValue: signalData.signalValue as any,
            sourceEventId: signalData.sourceEventId ?? null,
            confidence: field.confidence,
            validFrom: now,
            isCurrent: true,
          },
        });
      } catch {
        // Non-fatal
      }
    }

    if (decisionField) {
      const decisionData = decisionField.value as DecisionData | undefined;
      if (decisionData) {
        try {
          await dbRouter.write().interviewSession.update({
            where: { id: sessionId },
            data: {
              finalDecision: decisionData.finalDecision,
              status: 'COMPLETED',
              updatedAt: now,
            },
          });
        } catch {
          // Non-fatal
        }
      }
    }

    return sessionId;
  }

  private async createSession(input: CapabilityInput, sessionData: SessionData | undefined, now: Date): Promise<string> {
    const session = await dbRouter.write().interviewSession.create({
      data: {
        userId: input.userId,
        roleTitle: sessionData?.roleTitle ?? 'Unknown Role',
        jobLevel: sessionData?.jobLevel ?? 'unknown',
        loopType: sessionData?.loopType ?? 'STANDARD',
        sourceType: sessionData?.sourceType ?? 'MANUAL_ENTRY',
        companyNameRaw: sessionData?.companyNameRaw ?? null,
        status: sessionData?.status ?? 'SCHEDULED',
        finalDecision: sessionData?.finalDecision ?? null,
        offerExtended: sessionData?.offerExtended ?? null,
        offerAccepted: sessionData?.offerAccepted ?? null,
        shareForGlobalIntelligence: false,
        confidence: 0.5,
        validFrom: now,
        isCurrent: true,
      },
    });
    return session.id;
  }

  private async resolveCompetencyId(extractedKey: string, extractedName: string): Promise<string | null> {
    const normalizedKey = this.normalizeKey(extractedKey);
    if (!normalizedKey) return null;

    const byKey = await dbRouter.write().interviewCompetency.findUnique({ where: { key: normalizedKey } });
    if (byKey) return byKey.id;

    const allCompetencies = await dbRouter.write().interviewCompetency.findMany();
    let bestMatch: { id: string; similarity: number } | null = null;

    for (const comp of allCompetencies) {
      const sim = this.stringSimilarity(extractedName, comp.name);
      if (sim > 0.75 && (!bestMatch || sim > bestMatch.similarity)) {
        bestMatch = { id: comp.id, similarity: sim };
      }
    }

    if (bestMatch) return bestMatch.id;

    const category = this.inferCategory(extractedKey);
    const newCompetency = await dbRouter.write().interviewCompetency.create({
      data: {
        key: normalizedKey,
        name: extractedName,
        category,
        isActive: true,
      },
    });

    return newCompetency.id;
  }

  private normalizeKey(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  }

  private stringSimilarity(a: string, b: string): number {
    const na = this.normalizeKey(a);
    const nb = this.normalizeKey(b);
    if (na === nb) return 1.0;

    const bigrams = (s: string) => {
      const set = new Set<string>();
      for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
      return set;
    };

    const aBigrams = bigrams(na);
    const bBigrams = bigrams(nb);
    const intersection = new Set([...aBigrams].filter((x) => bBigrams.has(x)));
    const union = new Set([...aBigrams, ...bBigrams]);

    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  private inferCategory(key: string): 'HARD_SKILL' | 'SOFT_SKILL' | 'LEADERSHIP' | 'MANAGEMENT' | 'EXECUTIVE' {
    const hardSkillKeys = ['system_design', 'caching', 'consistency_models', 'sharding', 'load_balancing', 'failure_recovery', 'capacity_estimation', 'algorithms', 'complexity_analysis', 'data_structures', 'optimization', 'coding_practice', 'debugging', 'code_review', 'testing', 'domain_expertise', 'security', 'data_engineering', 'ml_systems', 'mobile', 'frontend_architecture'];
    const softSkillKeys = ['communication', 'clarity', 'structured_thinking', 'active_listening', 'collaboration', 'conflict_resolution', 'giving_feedback', 'problem_solving', 'trade_off_analysis', 'ambiguity_handling', 'adaptability'];
    const leadershipKeys = ['ownership', 'influencing_without_authority', 'mentorship', 'decision_making_under_uncertainty'];
    const managementKeys = ['people_management', 'org_design'];
    const executiveKeys = ['strategic_planning', 'stakeholder_management'];

    if (hardSkillKeys.includes(key)) return 'HARD_SKILL';
    if (softSkillKeys.includes(key)) return 'SOFT_SKILL';
    if (leadershipKeys.includes(key)) return 'LEADERSHIP';
    if (managementKeys.includes(key)) return 'MANAGEMENT';
    if (executiveKeys.includes(key)) return 'EXECUTIVE';

    if (key.includes('design') || key.includes('algorithm') || key.includes('coding') || key.includes('data') || key.includes('security') || key.includes('mobile') || key.includes('frontend')) return 'HARD_SKILL';
    if (key.includes('communication') || key.includes('collaboration') || key.includes('problem') || key.includes('adaptability')) return 'SOFT_SKILL';
    if (key.includes('ownership') || key.includes('influencing') || key.includes('mentorship') || key.includes('decision')) return 'LEADERSHIP';
    if (key.includes('people') || key.includes('org')) return 'MANAGEMENT';
    if (key.includes('strategic') || key.includes('stakeholder')) return 'EXECUTIVE';

    return 'HARD_SKILL';
  }

  private async writeInterviewFactObservations(
    input: CapabilityInput,
    output: ExtractionOutput,
    sessionId: string,
    extractionRunId: string,
    provenanceId: string,
  ): Promise<string[]> {
    const now = new Date();
    const factIds: string[] = [];

    for (const field of output.fields) {
      if (field.confidence < 0.4) continue;

      const fieldNeedsReview = field.confidence < 0.55;

      try {
        const fact = await dbRouter.write().factObservation.create({
          data: {
            userId: input.userId,
            factType: `interview.${field.field}`,
            factData: {
              value: field.value,
              rawValue: field.rawValue,
              field: field.field,
              sessionId,
            } as any,
            sourceType: 'interview-transcript',
            sourceId: sessionId,
            sourceVersion: output.templateVersion,
            extractionMethod: 'interview-transcript-extraction',
            modelVersion: output.model,
            confidence: field.confidence,
            evidenceReference: field.evidence.map((e) => e.excerpt).join(',') || null,
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

export const interviewExtractCapability = new InterviewExtractionCapability();
