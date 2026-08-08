import { randomUUID } from 'crypto';
import { dbRouter } from '../../config/database';
import { pipeline } from '../recruiter-intelligence/ai/pipeline.factory';
import { toConfidenceBand } from '../recruiter-intelligence/ai/utils';
import type { CapabilityInput, CapabilityName, CapabilityResult } from './types';
import { withAiSpan, recordAiAttributes } from '../../infrastructure/telemetry/ai-spans';
import { interviewMemoryService } from '../interview/interview-memory.service';

const DEFAULT_MODEL_ID = 'deepseek/deepseek-chat';

interface RoleBaseline {
  roleTitle: string;
  jobLevel: string;
  competencies: Array<{
    competencyKey: string;
    requiredLevel: number;
    weight: number;
  }>;
}

const ROLE_BASELINES: RoleBaseline[] = [
  {
    roleTitle: 'senior backend engineer',
    jobLevel: 'senior',
    competencies: [
      { competencyKey: 'system_design', requiredLevel: 0.8, weight: 0.25 },
      { competencyKey: 'algorithms', requiredLevel: 0.7, weight: 0.2 },
      { competencyKey: 'coding_practice', requiredLevel: 0.8, weight: 0.2 },
      { competencyKey: 'communication', requiredLevel: 0.6, weight: 0.15 },
      { competencyKey: 'problem_solving', requiredLevel: 0.7, weight: 0.2 },
    ],
  },
  {
    roleTitle: 'staff engineer',
    jobLevel: 'staff',
    competencies: [
      { competencyKey: 'system_design', requiredLevel: 0.9, weight: 0.3 },
      { competencyKey: 'algorithms', requiredLevel: 0.7, weight: 0.15 },
      { competencyKey: 'coding_practice', requiredLevel: 0.7, weight: 0.15 },
      { competencyKey: 'communication', requiredLevel: 0.8, weight: 0.2 },
      { competencyKey: 'mentorship', requiredLevel: 0.6, weight: 0.2 },
    ],
  },
  {
    roleTitle: 'engineering manager',
    jobLevel: 'manager',
    competencies: [
      { competencyKey: 'people_management', requiredLevel: 0.9, weight: 0.3 },
      { competencyKey: 'communication', requiredLevel: 0.8, weight: 0.2 },
      { competencyKey: 'decision_making_under_uncertainty', requiredLevel: 0.7, weight: 0.2 },
      { competencyKey: 'collaboration', requiredLevel: 0.7, weight: 0.15 },
      { competencyKey: 'ownership', requiredLevel: 0.8, weight: 0.15 },
    ],
  },
  {
    roleTitle: 'product manager',
    jobLevel: 'mid',
    competencies: [
      { competencyKey: 'communication', requiredLevel: 0.8, weight: 0.25 },
      { competencyKey: 'problem_solving', requiredLevel: 0.8, weight: 0.25 },
      { competencyKey: 'trade_off_analysis', requiredLevel: 0.7, weight: 0.2 },
      { competencyKey: 'structured_thinking', requiredLevel: 0.7, weight: 0.15 },
      { competencyKey: 'ambiguity_handling', requiredLevel: 0.7, weight: 0.15 },
    ],
  },
];

interface CompetencyLevel {
  competencyKey: string;
  competencyName: string;
  category: string;
  userLevel: number;
  requiredLevel: number;
  weight: number;
  gap: number;
}

export class InterviewSimulationCapability {
  readonly name: CapabilityName = 'interview-simulate';

  async run(input: {
    userId: string;
    targetCompanyId?: string;
    targetRoleTitle: string;
    targetJobLevel?: string;
  }): Promise<CapabilityResult> {
    const start = Date.now();

    return withAiSpan(this.name, {
      capability: this.name,
      entityType: 'interviewSession',
      entityId: input.targetCompanyId ?? input.targetRoleTitle,
    }, async () => {
      const memory = await interviewMemoryService.getInterviewMemory(input.userId);

      const userCompetencyMap = new Map<string, { level: number; name: string; category: string }>();
      for (const trend of memory.competencyTrend) {
        const latestLevel = trend.observations.length > 0
          ? trend.observations[trend.observations.length - 1]!.demonstratedLevel
          : 0;
        userCompetencyMap.set(trend.competencyId, {
          level: latestLevel,
          name: trend.competencyName,
          category: trend.category,
        });
      }

      const baseline = this.resolveRoleBaseline(input.targetRoleTitle, input.targetJobLevel);
      const competencyGaps: CompetencyLevel[] = [];

      let weightedSum = 0;
      let weightTotal = 0;

      for (const req of baseline.competencies) {
        const userLevel = userCompetencyMap.get(req.competencyKey)?.level ?? 0;
        const cappedLevel = Math.min(userLevel / req.requiredLevel, 1);
        weightedSum += cappedLevel * req.weight;
        weightTotal += req.weight;

        if (cappedLevel < 1) {
          competencyGaps.push({
            competencyKey: req.competencyKey,
            competencyName: userCompetencyMap.get(req.competencyKey)?.name ?? req.competencyKey,
            category: userCompetencyMap.get(req.competencyKey)?.category ?? 'HARD_SKILL',
            userLevel,
            requiredLevel: req.requiredLevel,
            weight: req.weight,
            gap: req.requiredLevel - userLevel,
          });
        }
      }

      const readinessScore = weightTotal > 0 ? weightedSum / weightTotal : 0;
      const confidenceBand = toConfidenceBand(readinessScore);

      let preparationPlan = '';
      let aiLatencyMs = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let estimatedCostUsd = 0;
      let provider: string | undefined;
      let model: string | undefined;

      if (competencyGaps.length > 0) {
        const gapList = competencyGaps
          .map((g) => `- ${g.competencyName}: current ${g.userLevel.toFixed(2)} / required ${g.requiredLevel.toFixed(2)}`)
          .join('\n');

        const extractionId = randomUUID();
        const aiInput = {
          extractionId,
          tenantId: input.userId,
          sourceType: 'document' as const,
          sourceId: input.targetCompanyId ?? input.targetRoleTitle,
          content: '',
          metadata: {
            entityType: 'interviewSession',
            capability: this.name,
            targetRoleTitle: input.targetRoleTitle,
            targetJobLevel: input.targetJobLevel ?? 'unknown',
            targetCompanyId: input.targetCompanyId ?? '',
            competencyGaps: gapList,
          },
          requestedAt: new Date(),
        };

        const output = await pipeline.extract('interview-readiness-plan', aiInput, {
          targetRoleTitle: input.targetRoleTitle,
          targetJobLevel: input.targetJobLevel ?? 'unknown',
          targetCompanyId: input.targetCompanyId ?? '',
          competencyGaps: gapList,
        });

        const planField = output.fields.find((f) => f.field === 'preparationPlan');
        preparationPlan = (planField?.value as string) ?? '';

        aiLatencyMs = output.usage.latencyMs ?? 0;
        inputTokens = output.usage.inputTokens;
        outputTokens = output.usage.outputTokens;
        estimatedCostUsd = output.usage.estimatedCostUsd;
        provider = output.provider;
        model = output.model;
      }

      const latencyMs = Date.now() - start;

      const prediction = await dbRouter.write().prediction.create({
        data: {
          modelId: DEFAULT_MODEL_ID,
          userId: input.userId,
          predictionType: 'interview_readiness_simulation',
          capability: this.name,
          predictionValue: {
            readinessScore,
            confidenceBand,
            competencyGaps: competencyGaps.map((g) => ({
              competencyKey: g.competencyKey,
              competencyName: g.competencyName,
              category: g.category,
              userLevel: g.userLevel,
              requiredLevel: g.requiredLevel,
              gap: g.gap,
            })),
            preparationPlan,
            targetRoleTitle: input.targetRoleTitle,
            targetCompanyId: input.targetCompanyId ?? null,
          } as any,
          confidenceScore: readinessScore,
          confidenceBand,
          provider,
          latencyMs: latencyMs + aiLatencyMs,
          inputTokens,
          outputTokens,
          estimatedCostUsd,
          rawOutput: { preparationPlan } as any,
          outputValid: true,
          outputErrors: [],
          requiresReview: readinessScore < 0.5,
          reviewReason: readinessScore < 0.5 ? 'Low readiness score' : undefined,
          plannerContext: {},
          timestamp: new Date(),
        },
      });

      return {
        predictionId: prediction.id,
        capability: this.name,
        fields: competencyGaps.map((g) => ({
          name: `gap.${g.competencyKey}`,
          value: g.gap,
          confidence: readinessScore,
          evidence: `Required ${g.requiredLevel}, user has ${g.userLevel.toFixed(2)}`,
        })),
        confidence: readinessScore,
        confidenceBand,
        recruiterFactIds: [],
        latencyMs: latencyMs + aiLatencyMs,
        inputTokens,
        outputTokens,
        estimatedCostUsd,
        completedAt: new Date(),
      };
    });
  }

  private resolveRoleBaseline(roleTitle: string, jobLevel?: string): RoleBaseline {
    const normalizedTitle = roleTitle.toLowerCase().trim();
    const normalizedLevel = jobLevel?.toLowerCase().trim() ?? '';

    let bestMatch: RoleBaseline | undefined;
    let bestScore = 0;

    for (const baseline of ROLE_BASELINES) {
      const titleMatch = normalizedTitle.includes(baseline.roleTitle) || baseline.roleTitle.includes(normalizedTitle);
      const levelMatch = !normalizedLevel || normalizedLevel.includes(baseline.jobLevel) || baseline.jobLevel.includes(normalizedLevel);

      const score = (titleMatch ? 0.7 : 0) + (levelMatch ? 0.3 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = baseline;
      }
    }

    if (bestMatch && bestScore >= 0.5) {
      return bestMatch;
    }

    return ROLE_BASELINES[0] ?? ROLE_BASELINES[0]!;
  }
}

export const interviewSimulateCapability = new InterviewSimulationCapability();
