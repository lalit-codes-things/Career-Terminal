/**
 * Planner
 *
 * Takes a user request, decides which capability(ies) to call, executes them
 * in the right order, and logs every decision as a Prediction row for audit.
 *
 * Design:
 *  - Deterministic routing: intent keyword → capability list (no LLM tokens for routing)
 *  - Logs the routing decision itself into Prediction BEFORE calling capabilities
 *  - Delegates execution to capability singletons from src/services/capabilities/
 *  - Returns aggregated CapabilityResult[]
 *
 * Intent → Capability mapping:
 *   understand  → [understand]
 *   extract     → [extract]
 *   infer       → [extract, infer]
 *   predict     → [extract, infer, predict]
 *   recommend   → [understand, infer, recommend]
 *   verify      → [verify]
 *   full        → [extract, infer, predict, recommend]
 *   (default)   → [understand, extract]
 */

import { prisma } from '../config/database';
import {
  understandCapability,
  extractCapability,
  inferCapability,
  predictCapability,
  recommendCapability,
  verifyCapability,
} from './capabilities';
import type { CapabilityInput, CapabilityResult } from './capabilities/types';
import { CapabilityBase } from './capabilities/capability.base';
import { withAiSpan, recordAiAttributes } from '../infrastructure/telemetry/ai-spans';

type Capability = CapabilityBase;

export type PlannerIntent =
  | 'understand'
  | 'extract'
  | 'infer'
  | 'predict'
  | 'recommend'
  | 'verify'
  | 'full';

export interface PlannerRequest {
  userId: string;
  entityId: string;
  entityType: CapabilityInput['entityType'];
  content: string;
  intent?: PlannerIntent;
  context?: Record<string, string>;
  intentHints?: string[];
  plannerContext?: Record<string, unknown>;
}

export interface PlannerResult {
  planId: string;
  intent: PlannerIntent;
  capabilitiesRun: string[];
  results: CapabilityResult[];
  totalLatencyMs: number;
  totalCostUsd: number;
  planPredictionId: string;
}

// Capability chains per intent
const INTENT_CHAINS: Record<PlannerIntent, Capability[]> = {
  understand:  [understandCapability],
  extract:     [extractCapability],
  infer:       [extractCapability, inferCapability],
  predict:     [extractCapability, inferCapability, predictCapability],
  recommend:   [understandCapability, inferCapability, recommendCapability],
  verify:      [verifyCapability],
  full:        [extractCapability, inferCapability, predictCapability, recommendCapability],
};

function resolveIntent(req: PlannerRequest): PlannerIntent {
  if (req.intent) return req.intent;
  const hints = (req.intentHints ?? []).join(' ').toLowerCase();
  if (hints.includes('predict') || hints.includes('probability')) return 'predict';
  if (hints.includes('recommend') || hints.includes('suggest')) return 'recommend';
  if (hints.includes('infer') || hints.includes('insight')) return 'infer';
  if (hints.includes('verify') || hints.includes('check')) return 'verify';
  if (hints.includes('extract') || hints.includes('parse')) return 'extract';
  if (hints.includes('full') || hints.includes('all')) return 'full';
  return 'understand';
}

export class Planner {
  /**
   * Plan and execute capability chain for a user request.
   * Logs the plan itself to Prediction before running capabilities.
   */
  async run(req: PlannerRequest): Promise<PlannerResult> {
    const start = Date.now();
    const intent = resolveIntent(req);
    const chain = INTENT_CHAINS[intent];
    const capabilityNames = chain.map((c) => c.name);

    return withAiSpan('planner', {
      capability: 'planner',
      entityType: req.entityType,
      entityId: req.entityId,
    }, async () => {
      // Record the planner decision as a Prediction row
      const planPrediction = await prisma.prediction.create({
        data: {
          modelId: 'deepseek/deepseek-chat',
          userId: req.userId,
          recruiterId: req.entityType === 'recruiter' ? req.entityId : undefined,
          applicationId: req.entityType === 'application' ? req.entityId : undefined,
          opportunityId: req.entityType === 'opportunity' ? req.entityId : undefined,
          predictionType: 'PLANNER_DECISION',
          capability: 'planner',
          predictionValue: {
            intent,
            capabilityChain: capabilityNames,
            entityType: req.entityType,
            entityId: req.entityId,
          },
          confidenceScore: 1.0,
          confidenceBand: 'critical',
          plannerContext: {
            intentHints: req.intentHints ?? [],
            requestedIntent: req.intent ?? null,
          },
          timestamp: new Date(),
        },
      });

      const results: CapabilityResult[] = [];
      const capInput: CapabilityInput = {
        userId: req.userId,
        entityId: req.entityId,
        entityType: req.entityType,
        content: req.content,
        context: req.context,
        plannerContext: { planPredictionId: planPrediction.id, intent },
      };

      for (const capability of chain) {
        try {
          const result = await capability.run(capInput);
          results.push(result);
        } catch {
          await prisma.prediction.create({
            data: {
              modelId: 'deepseek/deepseek-chat',
              userId: req.userId,
              predictionType: `CAPABILITY_${capability.name.toUpperCase()}_ERROR`,
              capability: capability.name,
              predictionValue: { error: `Capability ${capability.name} failed` },
              confidenceScore: 0,
              plannerContext: { planPredictionId: planPrediction.id },
              timestamp: new Date(),
            },
          });
        }
      }

      const totalLatencyMs = Date.now() - start;
      const totalCostUsd = results.reduce((s, r) => s + r.estimatedCostUsd, 0);

      // Attach aggregate telemetry to the planner span
      recordAiAttributes({ latencyMs: totalLatencyMs, costUsd: totalCostUsd, planId: planPrediction.id });

      return {
        planId: planPrediction.id,
        intent,
        capabilitiesRun: capabilityNames,
        results,
        totalLatencyMs,
        totalCostUsd,
        planPredictionId: planPrediction.id,
      };
    });
  }
}

export const planner = new Planner();
