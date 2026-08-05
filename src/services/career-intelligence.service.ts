/**
 * CareerIntelligenceService
 *
 * The single orchestration layer that routes all calls.
 * Routes call this instead of the four domain services directly.
 *
 * Responsibilities:
 *  - Route by entityType to the right domain service
 *  - Expose a unified query() method for the planner
 *  - Surface memory state alongside capability results
 *  - Wrap everything in a consistent CareerIntelligenceResponse
 *
 * This replaces direct service calls at the API boundary — it does NOT
 * replace the internals of recruiter/company/opportunity/resume services.
 */

import { planner, type PlannerIntent } from './planner';
import { recruiterIntelligenceConnectorService } from './recruiter-intelligence/recruiter-intelligence-connector.service';
import { opportunityIntelligenceService } from './opportunity/opportunity-intelligence.service';
import { companyIntelligenceService } from './company-intelligence/company-intelligence.service';
import { resumeIntelligenceService } from './resume/resume-intelligence.service';
import { recruiterMemoryService } from './recruiter-intelligence/memory/recruiter-memory.service';
import { prisma } from '../config/database';

export type IntelligenceEntityType =
  | 'recruiter'
  | 'opportunity'
  | 'company'
  | 'resume'
  | 'candidate';

export interface CareerIntelligenceRequest {
  userId: string;
  entityId: string;
  entityType: IntelligenceEntityType;
  content?: string;
  intent?: PlannerIntent;
  context?: Record<string, string>;
  /** When true, include the entity's current memory state in the response */
  includeMemory?: boolean;
}

export interface MemorySummary {
  factCount: number;
  factTypes: string[];
  latestObservationAt: Date | null;
}

export interface CareerIntelligenceResponse {
  entityId: string;
  entityType: IntelligenceEntityType;
  planId: string;
  intent: PlannerIntent;
  capabilitiesRun: string[];
  fields: Array<{ name: string; value: unknown; confidence: number }>;
  overallConfidence: number;
  memory?: MemorySummary;
  domainResult?: Record<string, unknown>;
  latencyMs: number;
  totalCostUsd: number;
}

export class CareerIntelligenceService {
  /**
   * Unified query method — routes to the appropriate domain service,
   * runs the planner, returns a consistent response.
   */
  async query(req: CareerIntelligenceRequest): Promise<CareerIntelligenceResponse> {
    const start = Date.now();
    let domainResult: Record<string, unknown> | undefined;

    // Run domain-specific pre-processing before the planner
    domainResult = await this.runDomainPreprocessing(req).catch(() => undefined);

    // Run the planner (core capability chain)
    const planResult = await planner.run({
      userId: req.userId,
      entityId: req.entityId,
      entityType: req.entityType,
      content: req.content ?? `${req.entityType}:${req.entityId}`,
      intent: req.intent,
      context: req.context,
      plannerContext: { entryPoint: 'career-intelligence', entityType: req.entityType },
    });

    const allFields = planResult.results.flatMap((r) => r.fields);
    const overallConfidence = planResult.results.length > 0
      ? planResult.results.reduce((s, r) => s + r.confidence, 0) / planResult.results.length
      : 0;

    // Optionally include memory summary for recruiter entities
    let memory: MemorySummary | undefined;
    if (req.includeMemory && req.entityType === 'recruiter') {
      const observations = await recruiterMemoryService
        .read(req.entityId)
        .catch(() => []);
      const factTypes = [...new Set(observations.map((o) => o.factType))];
      const latest = observations.reduce<Date | null>((max, o) => {
        return max === null || o.validFrom > max ? o.validFrom : max;
      }, null);
      memory = { factCount: observations.length, factTypes, latestObservationAt: latest };
    }

    return {
      entityId: req.entityId,
      entityType: req.entityType,
      planId: planResult.planId,
      intent: planResult.intent,
      capabilitiesRun: planResult.capabilitiesRun,
      fields: allFields.map((f) => ({ name: f.name, value: f.value, confidence: f.confidence })),
      overallConfidence,
      memory,
      domainResult,
      latencyMs: Date.now() - start,
      totalCostUsd: planResult.totalCostUsd,
    };
  }

  /**
   * Convenience: rank opportunities for a candidate.
   */
  async rankOpportunities(
    userId: string,
    opportunityIds: string[],
  ) {
    return opportunityIntelligenceService.rankForCandidate(userId, opportunityIds);
  }

  /**
   * Convenience: process recruiter communication (full pipeline).
   */
  async processRecruiterCommunication(
    userId: string,
    recruiterId: string,
    communicationText: string,
  ) {
    return recruiterIntelligenceConnectorService.process({
      userId,
      recruiterId,
      communicationText,
    });
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async runDomainPreprocessing(
    req: CareerIntelligenceRequest,
  ): Promise<Record<string, unknown> | undefined> {
    switch (req.entityType) {
      case 'recruiter': {
        // Load existing recruiter facts to provide context
        const facts = await prisma.recruiterFact.findMany({
          where: { recruiterId: req.entityId, deletedAt: null },
          select: { factType: true, factValue: true, confidence: true },
          orderBy: { confidence: 'desc' },
          take: 10,
        });
        return { recruiterFactCount: facts.length, topFacts: facts.slice(0, 3) };
      }
      case 'opportunity': {
        const opp = await prisma.opportunity.findUnique({
          where: { id: req.entityId },
          select: { title: true, company: { select: { name: true } } },
        }).catch(() => null);
        return opp ? { opportunityTitle: opp.title, companyName: opp.company.name } : undefined;
      }
      case 'company': {
        const company = await prisma.company.findUnique({
          where: { id: req.entityId },
          select: { name: true, industry: true, domain: true },
        }).catch(() => null);
        return company ?? undefined;
      }
      default:
        return undefined;
    }
  }
}

export const careerIntelligenceService = new CareerIntelligenceService();
