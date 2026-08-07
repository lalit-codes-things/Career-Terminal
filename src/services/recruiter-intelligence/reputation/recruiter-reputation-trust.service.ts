import { randomUUID } from 'crypto';
import type { ExtractionInput } from '../ai/types';
import { ExtractionPipeline } from '../ai/extraction-pipeline';
import type { RecruiterEntityFact } from '../extraction/recruiter-entity-extraction.service';
import type { RecruiterReasoningResult } from '../reasoning/recruiter-reasoning-enrichment.service';
import type { BehaviorProfile } from '../../../domain/recruiter-intelligence/behavior-intelligence/contracts';
import type {
  GhostingRisk,
  ReliabilitySummary,
  ReputationBand,
  ReputationScore,
  RiskFactor,
  TrustBand,
  TrustDimension,
  TrustIndicator,
  TrustInteractionRecord,
  TrustReputationResult,
  TrustScore,
  TrustSignal,
} from '../../../domain/recruiter-intelligence/reputation/contracts';

// ─── Dimension weight table ───────────────────────────────────────────────────

const TRUST_WEIGHTS: Record<TrustDimension, number> = {
  response_reliability:        0.15,
  communication_professionalism: 0.10,
  hiring_consistency:          0.12,
  ghosting_probability:        0.18,  // inverted (low ghosting → high trust)
  follow_up_reliability:       0.12,
  interview_reliability:       0.10,
  offer_reliability:           0.08,
  cancellation_behavior:       0.08,  // inverted
  candidate_experience:        0.07,
  recruiter_credibility:       0.10,
};

function toTrustBand(score: number): TrustBand {
  if (score >= 0.85) return 'very_high';
  if (score >= 0.70) return 'high';
  if (score >= 0.50) return 'moderate';
  if (score >= 0.30) return 'low';
  return 'very_low';
}

function toReputationBand(score: number): ReputationBand {
  if (score >= 0.85) return 'excellent';
  if (score >= 0.70) return 'good';
  if (score >= 0.50) return 'average';
  if (score >= 0.30) return 'below_average';
  return 'poor';
}

function toGhostingRisk(ghostingProb: number): GhostingRisk {
  if (ghostingProb >= 0.80) return 'very_high';
  if (ghostingProb >= 0.60) return 'high';
  if (ghostingProb >= 0.40) return 'moderate';
  if (ghostingProb >= 0.20) return 'low';
  return 'very_low';
}

/**
 * RecruiterReputationTrustEngine —  implementation.
 *
 * Estimates recruiter trustworthiness from 10 signal dimensions:
 *   response_reliability, communication_professionalism, hiring_consistency,
 *   ghosting_probability, follow_up_reliability, interview_reliability,
 *   offer_reliability, cancellation_behavior, candidate_experience, recruiter_credibility.
 *
 * Scoring rules:
 *   - Never single-signal: trust score is always a weighted multi-signal aggregate
 *   - Every score is explainable: reasoning + evidence for each signal
 *   - AI enrichment adds signals beyond what deterministic rules can infer
 *   - Ghosting and cancellation scores are inverted (lower = better trust)
 */
export class RecruiterReputationTrustEngine {
  constructor(private readonly pipeline: ExtractionPipeline) {}

  async score(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
    behaviorProfile?: BehaviorProfile,
    interactionHistory: TrustInteractionRecord[] = [],
  ): Promise<TrustReputationResult> {
    const resultId = randomUUID();

    // Step 1: deterministic signals
    const deterministicSignals = this.inferDeterministicSignals(
      recruiterId, facts, reasoning, behaviorProfile, interactionHistory,
    );

    // Step 2: AI-enriched signals
    let aiSignals: TrustSignal[] = [];
    try {
      aiSignals = await this.inferAiSignals(recruiterId, facts, reasoning, behaviorProfile);
    } catch {
      // non-fatal
    }

    // Step 3: merge signals (same dimension: AI wins if higher confidence)
    const signals = this.mergeSignals(deterministicSignals, aiSignals);

    // Step 4: compute scores
    const trustScore = this.computeTrustScore(recruiterId, signals, facts);
    const reputationScore = this.computeReputationScore(recruiterId, signals, facts);
    const reliabilitySummary = this.buildReliabilitySummary(recruiterId, signals, trustScore);
    const riskFactors = this.buildRiskFactors(recruiterId, signals, facts);
    const { positive, negative } = this.buildIndicators(recruiterId, signals, facts);

    const overallExplanation = this.buildExplanation(trustScore, reputationScore, signals);

    return {
      resultId,
      recruiterId,
      trustScore,
      reputationScore,
      reliabilitySummary,
      riskFactors,
      positiveIndicators: positive,
      negativeIndicators: negative,
      signals,
      overallExplanation,
      generatedAt: new Date(),
    };
  }

  // ─── Deterministic signal inference ────────────────────────────────────────

  private inferDeterministicSignals(
    _recruiterId: string,
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
    behaviorProfile?: BehaviorProfile,
    interactionHistory: TrustInteractionRecord[] = [],
  ): TrustSignal[] {
    const signals: TrustSignal[] = [];
    const allFactIds = facts.map((f) => f.factId);
    const now = new Date();

    // ─ Response reliability ─
    const urgency = reasoning.urgency.value;
    const responseScore = urgency === 'high' || urgency === 'critical' ? 0.75 : 0.60;
    signals.push({
      signalId: randomUUID(),
      dimension: 'response_reliability',
      score: responseScore,
      label: 'Response Reliability',
      reasoning: `Urgency level ${urgency} suggests ${urgency === 'high' ? 'prompt' : 'moderate'} response reliability.`,
      confidence: reasoning.urgency.confidence * 0.85,
      evidenceFactIds: allFactIds.slice(0, 2),
      observedAt: now,
    });

    // ─ Communication professionalism ─
    const intentScore = reasoning.communicationIntent.value !== 'unknown' ? 0.72 : 0.50;
    signals.push({
      signalId: randomUUID(),
      dimension: 'communication_professionalism',
      score: intentScore,
      label: 'Communication Professionalism',
      reasoning: `Communication intent is ${reasoning.communicationIntent.value}, indicating professional structured outreach.`,
      confidence: reasoning.communicationIntent.confidence * 0.80,
      evidenceFactIds: allFactIds.slice(0, 3),
      observedAt: now,
    });

    // ─ Hiring consistency ─
    const factDensity = Math.min(1, facts.length / 10);
    signals.push({
      signalId: randomUUID(),
      dimension: 'hiring_consistency',
      score: 0.50 + factDensity * 0.25,
      label: 'Hiring Consistency',
      reasoning: `${facts.length} structured facts extracted — higher density suggests more consistent engagement.`,
      confidence: Math.min(0.70, 0.45 + factDensity * 0.3),
      evidenceFactIds: allFactIds.slice(0, 3),
      observedAt: now,
    });

    // ─ Ghosting probability (inverted) ─
    const ghostingRaw = this.estimateGhostingProbability(reasoning, interactionHistory);
    signals.push({
      signalId: randomUUID(),
      dimension: 'ghosting_probability',
      score: 1 - ghostingRaw,  // inverted: low ghosting prob = high trust signal
      label: 'Ghosting Risk',
      reasoning: `Ghosting probability estimated at ${(ghostingRaw * 100).toFixed(0)}% based on follow-up requirements and urgency.`,
      confidence: 0.65,
      evidenceFactIds: allFactIds.slice(0, 2),
      observedAt: now,
    });

    // ─ Follow-up reliability ─
    const followUpScore = reasoning.followUpRequirements.value.length > 0 ? 0.70 : 0.45;
    signals.push({
      signalId: randomUUID(),
      dimension: 'follow_up_reliability',
      score: followUpScore,
      label: 'Follow-up Reliability',
      reasoning: `${reasoning.followUpRequirements.value.length} follow-up requirements identified in communication.`,
      confidence: reasoning.followUpRequirements.confidence * 0.75,
      evidenceFactIds: allFactIds.slice(0, 2),
      observedAt: now,
    });

    // ─ Interview reliability ─
    const hasInterviewFacts = facts.some((f) => f.fieldType === 'interview_stage');
    signals.push({
      signalId: randomUUID(),
      dimension: 'interview_reliability',
      score: hasInterviewFacts ? 0.72 : 0.55,
      label: 'Interview Reliability',
      reasoning: hasInterviewFacts
        ? 'Interview stage details observed — structured interview process in place.'
        : 'No interview stage details — interview reliability cannot be confirmed.',
      confidence: hasInterviewFacts ? 0.70 : 0.45,
      evidenceFactIds: allFactIds.filter((_, i) => i < 3),
      observedAt: now,
    });

    // ─ Offer reliability ─
    const hasCompensation = facts.some((f) => f.fieldType === 'compensation_mention');
    signals.push({
      signalId: randomUUID(),
      dimension: 'offer_reliability',
      score: hasCompensation ? 0.78 : 0.52,
      label: 'Offer Reliability',
      reasoning: hasCompensation
        ? 'Compensation details disclosed early — signal of serious intent and offer reliability.'
        : 'No compensation details — offer reliability unclear.',
      confidence: hasCompensation ? 0.72 : 0.45,
      evidenceFactIds: allFactIds.slice(0, 2),
      observedAt: now,
    });

    // ─ Cancellation behavior (inverted) ─
    const cancelledCount = interactionHistory.filter((r) => r.outcome === 'cancelled').length;
    const cancelScore = cancelledCount === 0 ? 0.80 : Math.max(0.20, 0.80 - cancelledCount * 0.15);
    signals.push({
      signalId: randomUUID(),
      dimension: 'cancellation_behavior',
      score: cancelScore,
      label: 'Cancellation Behavior',
      reasoning: `${cancelledCount} cancellations observed. ${cancelledCount === 0 ? 'No cancellations — positive signal.' : 'Cancellations detected — negative signal.'}`,
      confidence: cancelledCount > 0 ? 0.75 : 0.55,
      evidenceFactIds: allFactIds.slice(0, 1),
      observedAt: now,
    });

    // ─ Candidate experience ─
    const behaviorScore = behaviorProfile ? behaviorProfile.overallBehaviorScore : 0.55;
    signals.push({
      signalId: randomUUID(),
      dimension: 'candidate_experience',
      score: behaviorScore * 0.8 + 0.1,
      label: 'Candidate Experience',
      reasoning: `Candidate experience inferred from behavioral profile score: ${behaviorScore.toFixed(2)}.`,
      confidence: behaviorProfile ? behaviorProfile.overallConfidence * 0.75 : 0.40,
      evidenceFactIds: allFactIds.slice(0, 2),
      observedAt: now,
    });

    // ─ Recruiter credibility ─
    const hasTitle = facts.some((f) => f.fieldType === 'recruiter_title');
    const hasOrg = facts.some((f) => f.fieldType === 'recruiter_organization');
    const credScore = (hasTitle ? 0.35 : 0) + (hasOrg ? 0.35 : 0) + 0.20;
    signals.push({
      signalId: randomUUID(),
      dimension: 'recruiter_credibility',
      score: Math.min(1, credScore),
      label: 'Recruiter Credibility',
      reasoning: `Title: ${hasTitle ? 'present' : 'missing'}, Organization: ${hasOrg ? 'present' : 'missing'}.`,
      confidence: hasTitle && hasOrg ? 0.75 : 0.50,
      evidenceFactIds: allFactIds.slice(0, 3),
      observedAt: now,
    });

    return signals;
  }

  private estimateGhostingProbability(
    reasoning: RecruiterReasoningResult,
    history: TrustInteractionRecord[],
  ): number {
    let prob = 0.25; // baseline
    if (reasoning.followUpRequirements.value.length === 0) prob += 0.15;
    if (reasoning.urgency.value === 'low') prob += 0.10;
    if (reasoning.urgency.value === 'high' || reasoning.urgency.value === 'critical') prob -= 0.10;
    const ghostedCount = history.filter((r) => r.type === 'ghosting').length;
    prob += ghostedCount * 0.15;
    return Math.max(0.05, Math.min(0.95, prob));
  }

  // ─── AI signal inference ────────────────────────────────────────────────────

  private async inferAiSignals(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
    behaviorProfile?: BehaviorProfile,
  ): Promise<TrustSignal[]> {
    const input: ExtractionInput = {
      extractionId: randomUUID(),
      tenantId: recruiterId,
      sourceType: 'profile',
      sourceId: recruiterId,
      content: JSON.stringify({
        recruiterId,
        factCount: facts.length,
        urgency: reasoning.urgency.value,
        communicationIntent: reasoning.communicationIntent.value,
        followUpCount: reasoning.followUpRequirements.value.length,
        behaviorScore: behaviorProfile?.overallBehaviorScore ?? null,
      }),
      metadata: { templateId: 'recruiter-reputation-trust' },
      requestedAt: new Date(),
    };

    const output = await this.pipeline.extract('recruiter-reputation-trust', input, {});
    const now = new Date();

    return output.fields.map((f) => ({
      signalId: randomUUID(),
      dimension: f.field as TrustDimension,
      score: typeof f.value === 'number' ? f.value : 0.6,
      label: f.field.replace(/_/g, ' '),
      reasoning: (f.evidence[0]?.excerpt ?? 'AI-inferred signal.'),
      confidence: f.confidence,
      evidenceFactIds: [],
      observedAt: now,
    })).filter((s) => s.dimension in TRUST_WEIGHTS);
  }

  // ─── Merge signals ──────────────────────────────────────────────────────────

  private mergeSignals(deterministic: TrustSignal[], ai: TrustSignal[]): TrustSignal[] {
    const map = new Map<TrustDimension, TrustSignal>();
    for (const s of deterministic) map.set(s.dimension, s);
    for (const s of ai) {
      const existing = map.get(s.dimension);
      if (!existing || s.confidence > existing.confidence) {
        map.set(s.dimension, s);
      }
    }
    return [...map.values()];
  }

  // ─── Score computation ──────────────────────────────────────────────────────

  private computeTrustScore(
    recruiterId: string,
    signals: TrustSignal[],
    _facts: RecruiterEntityFact[],
  ): TrustScore {
    let weightedSum = 0;
    let totalWeight = 0;
    let ghostingProb = 0.25;
    const evidenceFactIds: string[] = [];

    for (const signal of signals) {
      const w = TRUST_WEIGHTS[signal.dimension] ?? 0;
      weightedSum += signal.score * w;
      totalWeight += w;
      evidenceFactIds.push(...signal.evidenceFactIds);
      if (signal.dimension === 'ghosting_probability') {
        ghostingProb = 1 - signal.score;  // re-invert
      }
    }

    const score = totalWeight > 0 ? weightedSum / totalWeight : 0.5;
    const overallConfidence = signals.reduce((s, sig) => s + sig.confidence, 0) / Math.max(1, signals.length);

    return {
      scoreId: randomUUID(),
      recruiterId,
      score: Math.max(0, Math.min(1, score)),
      band: toTrustBand(score),
      ghostingProbability: ghostingProb,
      ghostingRisk: toGhostingRisk(ghostingProb),
      signalCount: signals.length,
      confidence: overallConfidence,
      computedAt: new Date(),
      evidenceFactIds: [...new Set(evidenceFactIds)].slice(0, 10),
    };
  }

  private computeReputationScore(
    recruiterId: string,
    signals: TrustSignal[],
    facts: RecruiterEntityFact[],
  ): ReputationScore {
    // Reputation = trust score with recency-weighted signals
    const recencyWeight = Math.min(1, 0.5 + facts.length / 20);
    const baseScore = this.computeTrustScore(recruiterId, signals, facts).score;
    const score = baseScore * recencyWeight;
    const consistency = signals.filter((s) => s.score >= 0.65).length / Math.max(1, signals.length);

    return {
      scoreId: randomUUID(),
      recruiterId,
      score: Math.max(0, Math.min(1, score)),
      band: toReputationBand(score),
      historicalConsistency: consistency,
      recencyWeight,
      confidence: signals.reduce((s, sig) => s + sig.confidence, 0) / Math.max(1, signals.length),
      computedAt: new Date(),
      evidenceFactIds: signals.flatMap((s) => s.evidenceFactIds).slice(0, 8),
    };
  }

  // ─── Reliability summary ────────────────────────────────────────────────────

  private buildReliabilitySummary(
    recruiterId: string,
    signals: TrustSignal[],
    trust: TrustScore,
  ): ReliabilitySummary {
    const responseSignal = signals.find((s) => s.dimension === 'response_reliability');
    const followUpSignal = signals.find((s) => s.dimension === 'follow_up_reliability');
    const offerSignal = signals.find((s) => s.dimension === 'offer_reliability');

    let overallReliability: ReliabilitySummary['overallReliability'];
    if (trust.score >= 0.80) overallReliability = 'highly_reliable';
    else if (trust.score >= 0.65) overallReliability = 'reliable';
    else if (trust.score >= 0.50) overallReliability = 'moderately_reliable';
    else if (trust.score >= 0.35) overallReliability = 'unreliable_but_improving';
    else overallReliability = 'unreliable';

    return {
      recruiterId,
      summaryText: `This recruiter has a trust score of ${(trust.score * 100).toFixed(0)}/100 (${trust.band}). Ghosting risk is ${trust.ghostingRisk}.`,
      overallReliability,
      responseReliabilityNote: responseSignal
        ? `Response reliability: ${(responseSignal.score * 100).toFixed(0)}/100 — ${responseSignal.reasoning}`
        : 'Insufficient data for response reliability assessment.',
      followUpReliabilityNote: followUpSignal
        ? `Follow-up reliability: ${(followUpSignal.score * 100).toFixed(0)}/100 — ${followUpSignal.reasoning}`
        : 'Insufficient data for follow-up reliability assessment.',
      offerReliabilityNote: offerSignal
        ? `Offer reliability: ${(offerSignal.score * 100).toFixed(0)}/100 — ${offerSignal.reasoning}`
        : 'No offer reliability data available.',
      confidence: trust.confidence,
      generatedAt: new Date(),
    };
  }

  // ─── Risk factors ───────────────────────────────────────────────────────────

  private buildRiskFactors(
    _recruiterId: string,
    signals: TrustSignal[],
    _facts: RecruiterEntityFact[],
  ): RiskFactor[] {
    const risks: RiskFactor[] = [];

    const ghostingSignal = signals.find((s) => s.dimension === 'ghosting_probability');
    if (ghostingSignal && ghostingSignal.score < 0.55) {
      risks.push({
        riskId: randomUUID(),
        category: 'ghosting',
        description: 'Elevated ghosting risk detected based on follow-up patterns and urgency signals.',
        severity: ghostingSignal.score < 0.30 ? 'high' : 'medium',
        probability: 1 - ghostingSignal.score,
        mitigationSuggestion: 'Follow up proactively within 48 hours if no response received.',
        evidenceFactIds: ghostingSignal.evidenceFactIds,
      });
    }

    const cancelSignal = signals.find((s) => s.dimension === 'cancellation_behavior');
    if (cancelSignal && cancelSignal.score < 0.60) {
      risks.push({
        riskId: randomUUID(),
        category: 'cancellation',
        description: 'Cancellation pattern detected in interaction history.',
        severity: 'medium',
        probability: 1 - cancelSignal.score,
        mitigationSuggestion: 'Confirm all meetings 24 hours in advance.',
        evidenceFactIds: cancelSignal.evidenceFactIds,
      });
    }

    const credibilitySignal = signals.find((s) => s.dimension === 'recruiter_credibility');
    if (credibilitySignal && credibilitySignal.score < 0.50) {
      risks.push({
        riskId: randomUUID(),
        category: 'credibility',
        description: 'Limited identity verification — recruiter title and organization not fully confirmed.',
        severity: 'low',
        probability: 0.30,
        mitigationSuggestion: 'Verify recruiter identity via LinkedIn before proceeding.',
        evidenceFactIds: credibilitySignal.evidenceFactIds,
      });
    }

    return risks;
  }

  // ─── Indicators ─────────────────────────────────────────────────────────────

  private buildIndicators(
    _recruiterId: string,
    signals: TrustSignal[],
    _facts: RecruiterEntityFact[],
  ): { positive: TrustIndicator[]; negative: TrustIndicator[] } {
    const positive: TrustIndicator[] = [];
    const negative: TrustIndicator[] = [];

    for (const signal of signals) {
      const strength: TrustIndicator['strength'] =
        Math.abs(signal.score - 0.5) > 0.3 ? 'strong'
          : Math.abs(signal.score - 0.5) > 0.15 ? 'moderate'
            : 'weak';

      if (signal.score >= 0.65) {
        positive.push({
          indicatorId: randomUUID(),
          type: 'positive',
          dimension: signal.dimension,
          description: signal.label + ': ' + signal.reasoning,
          strength,
          confidence: signal.confidence,
          evidenceFactIds: signal.evidenceFactIds,
        });
      } else if (signal.score <= 0.45) {
        negative.push({
          indicatorId: randomUUID(),
          type: 'negative',
          dimension: signal.dimension,
          description: signal.label + ': ' + signal.reasoning,
          strength,
          confidence: signal.confidence,
          evidenceFactIds: signal.evidenceFactIds,
        });
      }
    }

    return { positive, negative };
  }

  // ─── Explanation ─────────────────────────────────────────────────────────────

  private buildExplanation(
    trust: TrustScore,
    reputation: ReputationScore,
    signals: TrustSignal[],
  ): string {
    const topSignals = [...signals]
      .sort((a, b) => Math.abs(b.score - 0.5) - Math.abs(a.score - 0.5))
      .slice(0, 3);

    return [
      `Trust score: ${(trust.score * 100).toFixed(0)}/100 (${trust.band}).`,
      `Reputation score: ${(reputation.score * 100).toFixed(0)}/100 (${reputation.band}).`,
      `Ghosting risk: ${trust.ghostingRisk}.`,
      `Key signals: ${topSignals.map((s) => `${s.label} (${(s.score * 100).toFixed(0)})`).join(', ')}.`,
      `Based on ${signals.length} independent trust signals.`,
    ].join(' ');
  }
}
