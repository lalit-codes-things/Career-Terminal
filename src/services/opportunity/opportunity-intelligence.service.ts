/**
 * OpportunityIntelligenceService
 *
 * Moves matching/ranking logic from OpportunityIntelligenceEngine (rule-based
 * validation only) to AI capability calls scored against RecruiterFact and
 * Prediction rows.
 *
 * Three operations:
 *   rankForCandidate()   — score a list of opportunities for a user using
 *                          planner(predict), returns ranked list with AI scores
 *   matchToRecruiter()   — score an opportunity against a recruiter's fact profile
 *   validateWithAi()     — run verify capability on an opportunity record, returns
 *                          a confidence-scored validation result that augments the
 *                          existing deterministic OpportunityIntelligenceEngine
 */

import { prisma } from '../../config/database';
import { planner } from '../planner';

export interface OpportunityRankItem {
  opportunityId: string;
  title: string;
  companyName: string;
  aiScore: number;
  aiConfidence: number;
  planId: string;
  signals: string[];
}

export interface RecruiterMatchResult {
  opportunityId: string;
  recruiterId: string;
  matchScore: number;
  confidence: number;
  planId: string;
  matchedFactTypes: string[];
}

export interface AiValidationResult {
  opportunityId: string;
  valid: boolean;
  confidence: number;
  planId: string;
  issues: string[];
}

export class OpportunityIntelligenceService {
  /**
   * Rank opportunities for a user using AI.
   * Pulls the user's current FactObservation rows as context,
   * then calls planner(recommend) on each opportunity's description.
   */
  async rankForCandidate(
    userId: string,
    opportunityIds: string[],
  ): Promise<OpportunityRankItem[]> {
    if (opportunityIds.length === 0) return [];

    // Load user facts for context
    const userFacts = await prisma.factObservation.findMany({
      where: { userId, isCurrent: true, deletedAt: null },
      select: { factType: true, factData: true, confidence: true },
      orderBy: { confidence: 'desc' },
      take: 30,
    });

    const userContext = userFacts
      .map((f) => `[${f.factType}] ${JSON.stringify(f.factData)}`)
      .join('\n');

    // Load opportunities
    const opportunities = await prisma.opportunity.findMany({
      where: { id: { in: opportunityIds } },
      select: {
        id: true,
        title: true,
        description: true,
        location: true,
        requirements: true,
        company: { select: { name: true } },
      },
    });

    const ranked: OpportunityRankItem[] = [];

    for (const opp of opportunities) {
      const content = [
        `Title: ${opp.title}`,
        `Company: ${opp.company.name}`,
        opp.description ? `Description: ${opp.description.slice(0, 1000)}` : '',
        opp.location ? `Location: ${opp.location}` : '',
        `Candidate profile:\n${userContext.slice(0, 1000)}`,
      ].filter(Boolean).join('\n');

      try {
        const result = await planner.run({
          userId,
          entityId: opp.id,
          entityType: 'opportunity',
          content,
          intent: 'predict',
          plannerContext: { purpose: 'opportunity_ranking', opportunityId: opp.id },
        });

        const allFields = result.results.flatMap((r) => r.fields);
        const scoreField = allFields.find((f) =>
          f.name.toLowerCase().includes('score') || f.name.toLowerCase().includes('match'),
        );
        const aiScore = scoreField
          ? Math.max(0, Math.min(1, Number(scoreField.value) || result.results[0]?.confidence ?? 0))
          : result.results[0]?.confidence ?? 0;

        ranked.push({
          opportunityId: opp.id,
          title: opp.title,
          companyName: opp.company.name,
          aiScore,
          aiConfidence: result.results[0]?.confidence ?? 0,
          planId: result.planId,
          signals: allFields.map((f) => `${f.name}: ${JSON.stringify(f.value)}`).slice(0, 5),
        });
      } catch {
        // Non-fatal — include with zero score
        ranked.push({
          opportunityId: opp.id,
          title: opp.title,
          companyName: opp.company.name,
          aiScore: 0,
          aiConfidence: 0,
          planId: 'error',
          signals: [],
        });
      }
    }

    return ranked.sort((a, b) => b.aiScore - a.aiScore);
  }

  /**
   * Score an opportunity against a recruiter's RecruiterFact profile.
   * Returns how well the opportunity aligns with what the recruiter typically hires for.
   */
  async matchToRecruiter(
    opportunityId: string,
    recruiterId: string,
    userId: string,
  ): Promise<RecruiterMatchResult> {
    const [opportunity, recruiterFacts] = await Promise.all([
      prisma.opportunity.findUnique({
        where: { id: opportunityId },
        select: { title: true, description: true, requirements: true },
      }),
      prisma.recruiterFact.findMany({
        where: { recruiterId, deletedAt: null },
        select: { factType: true, factValue: true, confidence: true },
        orderBy: { confidence: 'desc' },
        take: 20,
      }),
    ]);

    if (!opportunity) {
      return { opportunityId, recruiterId, matchScore: 0, confidence: 0, planId: 'not-found', matchedFactTypes: [] };
    }

    const recruiterContext = recruiterFacts
      .map((f) => `[${f.factType}] ${JSON.stringify(f.factValue)}`)
      .join('\n');

    const content = [
      `Opportunity: ${opportunity.title}`,
      opportunity.description ? `Description: ${opportunity.description.slice(0, 800)}` : '',
      `Recruiter facts:\n${recruiterContext.slice(0, 1000)}`,
    ].filter(Boolean).join('\n');

    const result = await planner.run({
      userId,
      entityId: opportunityId,
      entityType: 'opportunity',
      content,
      intent: 'verify',
      plannerContext: { purpose: 'recruiter_opportunity_match', recruiterId },
    });

    const matchedFactTypes = recruiterFacts
      .filter((f) => f.confidence > 0.6)
      .map((f) => f.factType)
      .slice(0, 10);

    return {
      opportunityId,
      recruiterId,
      matchScore: result.results[0]?.confidence ?? 0,
      confidence: result.results[0]?.confidence ?? 0,
      planId: result.planId,
      matchedFactTypes,
    };
  }

  /**
   * AI validation of an opportunity record — augments the existing deterministic engine.
   */
  async validateWithAi(opportunityId: string, userId: string): Promise<AiValidationResult> {
    const opportunity = await prisma.opportunity.findUnique({
      where: { id: opportunityId },
      select: {
        title: true,
        description: true,
        location: true,
        requirements: true,
        url: true,
        company: { select: { name: true, domain: true } },
      },
    });

    if (!opportunity) {
      return { opportunityId, valid: false, confidence: 0, planId: 'not-found', issues: ['Opportunity not found'] };
    }

    const content = JSON.stringify({
      title: opportunity.title,
      company: opportunity.company.name,
      domain: opportunity.company.domain,
      location: opportunity.location,
      url: opportunity.url,
      requirementsCount: Array.isArray(opportunity.requirements) ? opportunity.requirements.length : 0,
      hasDescription: Boolean(opportunity.description),
    });

    const result = await planner.run({
      userId,
      entityId: opportunityId,
      entityType: 'opportunity',
      content,
      intent: 'verify',
      plannerContext: { purpose: 'opportunity_validation' },
    });

    const issueFields = result.results
      .flatMap((r) => r.fields)
      .filter((f) => f.confidence < 0.5)
      .map((f) => `${f.name}: low confidence (${f.confidence.toFixed(2)})`);

    const overallConfidence = result.results[0]?.confidence ?? 0;

    return {
      opportunityId,
      valid: overallConfidence >= 0.6 && issueFields.length === 0,
      confidence: overallConfidence,
      planId: result.planId,
      issues: issueFields,
    };
  }
}

export const opportunityIntelligenceService = new OpportunityIntelligenceService();
