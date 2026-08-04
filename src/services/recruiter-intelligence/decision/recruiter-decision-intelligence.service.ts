import { randomUUID } from 'crypto';
import type { ExtractionInput } from '../ai/types';
import { ExtractionPipeline } from '../ai/extraction-pipeline';
import type { RecruiterEntityFact } from '../extraction/recruiter-entity-extraction.service';
import type { RecruiterReasoningResult } from '../reasoning/recruiter-reasoning-enrichment.service';
import type { BehaviorProfile } from '../../../domain/recruiter-intelligence/behavior-intelligence/contracts';
import type { TrustScore } from '../../../domain/recruiter-intelligence/reputation/contracts';
import type { RecruiterExpertiseProfile } from '../../../domain/recruiter-intelligence/specialization/contracts';
import type {
  DecisionConfidence,
  DecisionDimension,
  DecisionEvidence,
  DecisionIntelligenceResult,
  DecisionPrediction,
  DecisionProfile,
  DecisionStyle,
  DecisionTimeline,
  DecisionTimelineEvent,
  ExplanationFactor,
  PredictionExplanation,
} from '../../../domain/recruiter-intelligence/decision-intelligence/contracts';

// ─── Helper ───────────────────────────────────────────────────────────────────

function toConfidenceBand(c: number): 'low' | 'medium' | 'high' | 'critical' {
  if (c >= 0.85) return 'critical';
  if (c >= 0.70) return 'high';
  if (c >= 0.50) return 'medium';
  return 'low';
}

function makePrediction(
  dimension: DecisionDimension,
  label: string,
  probability: number,
  confidence: number,
  reasoning: string,
  evidence: string[],
  factIds: string[],
): DecisionPrediction {
  return {
    predictionId: randomUUID(),
    dimension,
    probability: Math.max(0, Math.min(1, probability)),
    confidence,
    confidenceBand: toConfidenceBand(confidence),
    label,
    reasoning,
    supportingEvidence: evidence,
    sourceFactIds: factIds,
    predictedAt: new Date(),
  };
}

/**
 * RecruiterDecisionIntelligenceService — Prompt 19 implementation.
 *
 * Predicts 9 decision probabilities with full explainability:
 *   interview_likelihood, response_likelihood, follow_up_likelihood,
 *   rejection_probability, offer_probability, escalation_probability,
 *   candidate_fit, hiring_confidence, engagement_probability.
 *
 * Architecture:
 *   1. Deterministic prediction from structured facts and prior inferences
 *   2. AI-enriched predictions via ExtractionPipeline
 *   3. Merge: AI wins if confidence is higher for same dimension
 *   4. Every prediction carries: reasoning, evidence, explanation factors
 */
export class RecruiterDecisionIntelligenceService {
  constructor(private readonly pipeline: ExtractionPipeline) {}

  async predict(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
    behaviorProfile?: BehaviorProfile,
    trustScore?: TrustScore,
    expertiseProfile?: RecruiterExpertiseProfile,
  ): Promise<DecisionIntelligenceResult> {
    const resultId = randomUUID();

    // Step 1: deterministic predictions
    const deterministicPredictions = this.inferDeterministic(
      recruiterId, facts, reasoning, behaviorProfile, trustScore, expertiseProfile,
    );

    // Step 2: AI enrichment
    let aiPredictions: Partial<Record<DecisionDimension, DecisionPrediction>> = {};
    try {
      aiPredictions = await this.inferWithAi(recruiterId, facts, reasoning, behaviorProfile, trustScore);
    } catch {
      // non-fatal
    }

    // Step 3: merge
    const predictions = this.mergePredictions(deterministicPredictions, aiPredictions);

    // Step 4: assemble outputs
    const decisionProfile = this.buildDecisionProfile(recruiterId, predictions, facts);
    const decisionTimeline = this.buildTimeline(recruiterId, predictions);
    const decisionConfidence = this.buildConfidence(recruiterId, predictions);
    const supportingEvidence = this.buildEvidence(recruiterId, predictions, facts);
    const explanations = this.buildExplanations(recruiterId, predictions);

    return {
      resultId,
      recruiterId,
      decisionProfile,
      decisionTimeline,
      decisionConfidence,
      supportingEvidence,
      explanations,
      generatedAt: new Date(),
    };
  }

  // ─── Deterministic predictions ──────────────────────────────────────────────

  private inferDeterministic(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
    behaviorProfile?: BehaviorProfile,
    trustScore?: TrustScore,
    expertiseProfile?: RecruiterExpertiseProfile,
  ): Record<DecisionDimension, DecisionPrediction> {
    const allFactIds = facts.map((f) => f.factId);
    const urgency = reasoning.urgency.value;
    const intent = reasoning.communicationIntent.value;
    const hasInterview = facts.some((f) => f.fieldType === 'interview_stage');
    const hasCompensation = facts.some((f) => f.fieldType === 'compensation_mention');
    const hasHiringPriority = facts.some((f) => f.fieldType === 'hiring_priority');
    const trust = trustScore?.score ?? 0.60;
    const behavior = behaviorProfile?.overallBehaviorScore ?? 0.60;

    // ─ Response likelihood ─
    let responseProb = 0.60;
    if (urgency === 'high' || urgency === 'critical') responseProb += 0.15;
    if (intent === 'scheduling' || intent === 'screening') responseProb += 0.10;
    if (trust >= 0.70) responseProb += 0.05;
    const responseLikelihood = makePrediction(
      'response_likelihood', 'Response Likelihood',
      responseProb, reasoning.urgency.confidence * 0.80,
      `Response likelihood: urgency=${urgency}, intent=${intent}, trust=${trust.toFixed(2)}.`,
      [`Urgency: ${urgency}`, `Intent: ${intent}`], allFactIds.slice(0, 2),
    );

    // ─ Interview likelihood ─
    let interviewProb = 0.50;
    if (hasInterview) interviewProb += 0.25;
    if (urgency === 'high' || urgency === 'critical') interviewProb += 0.10;
    if (hasCompensation) interviewProb += 0.05;
    const interviewLikelihood = makePrediction(
      'interview_likelihood', 'Interview Likelihood',
      interviewProb, hasInterview ? 0.80 : 0.55,
      `Interview facts: ${hasInterview ? 'present' : 'absent'}. Urgency: ${urgency}.`,
      hasInterview ? ['Interview stage fact present'] : ['No interview stage observed'],
      allFactIds.slice(0, 3),
    );

    // ─ Follow-up likelihood ─
    let followUpProb = 0.55;
    if (reasoning.followUpRequirements.value.length > 0) followUpProb += 0.20;
    if (intent === 'scheduling' || intent === 'closing') followUpProb += 0.10;
    const followUpLikelihood = makePrediction(
      'follow_up_likelihood', 'Follow-up Likelihood',
      followUpProb, reasoning.followUpRequirements.confidence * 0.80,
      `${reasoning.followUpRequirements.value.length} follow-up requirements identified.`,
      reasoning.followUpRequirements.value, allFactIds.slice(0, 2),
    );

    // ─ Rejection probability ─
    let rejectionProb = 0.30;
    if (urgency === 'low') rejectionProb += 0.10;
    if (!hasInterview && !hasCompensation) rejectionProb += 0.05;
    if (trust < 0.40) rejectionProb += 0.10;
    const rejectionProbability = makePrediction(
      'rejection_probability', 'Rejection Probability',
      rejectionProb, 0.60,
      `Rejection probability baseline with urgency ${urgency} and trust ${trust.toFixed(2)}.`,
      [`Urgency: ${urgency}`, `Trust: ${trust.toFixed(2)}`], allFactIds.slice(0, 2),
    );

    // ─ Offer probability ─
    let offerProb = 0.25;
    if (hasCompensation) offerProb += 0.25;
    if (reasoning.decisionAuthority.value === 'decision_maker') offerProb += 0.10;
    if (urgency === 'critical') offerProb += 0.10;
    const offerProbability = makePrediction(
      'offer_probability', 'Offer Probability',
      offerProb, hasCompensation ? 0.72 : 0.50,
      `Compensation disclosed: ${hasCompensation}. Decision authority: ${reasoning.decisionAuthority.value}.`,
      [hasCompensation ? 'Compensation disclosed' : 'No compensation signal',
        `Authority: ${reasoning.decisionAuthority.value}`],
      allFactIds.slice(0, 3),
    );

    // ─ Escalation probability ─
    let escalationProb = 0.20;
    if (urgency === 'critical') escalationProb += 0.30;
    if (hasHiringPriority) escalationProb += 0.15;
    if (reasoning.decisionAuthority.value === 'influencer') escalationProb += 0.10;
    const escalationProbability = makePrediction(
      'escalation_probability', 'Escalation Probability',
      escalationProb, 0.60,
      `Urgency: ${urgency}. Priority role: ${hasHiringPriority}. Authority: ${reasoning.decisionAuthority.value}.`,
      [`Urgency: ${urgency}`], allFactIds.slice(0, 2),
    );

    // ─ Candidate fit ─
    let fitProb = 0.55;
    if (expertiseProfile) {
      const techMatch = expertiseProfile.technicalSpecialization.value.length > 0 ? 0.10 : 0;
      fitProb += techMatch;
    }
    if (hasCompensation) fitProb += 0.05; // reveals they're actively recruiting
    const candidateFit = makePrediction(
      'candidate_fit', 'Candidate Fit',
      fitProb, expertiseProfile ? 0.68 : 0.50,
      `Candidate fit estimated from ${expertiseProfile?.technicalSpecialization.value.length ?? 0} technical signals.`,
      [`Technical signals: ${expertiseProfile?.technicalSpecialization.value.join(', ') ?? 'none'}`],
      allFactIds.slice(0, 2),
    );

    // ─ Hiring confidence ─
    const hiringConfidenceProb = (interviewProb + offerProb + responseLikelihood.probability) / 3;
    const hiringConfidence = makePrediction(
      'hiring_confidence', 'Hiring Confidence',
      hiringConfidenceProb, reasoning.overallConfidence * 0.80,
      `Composite of interview likelihood (${interviewProb.toFixed(2)}), offer probability (${offerProb.toFixed(2)}), response likelihood (${responseProb.toFixed(2)}).`,
      ['Composite prediction'], allFactIds.slice(0, 3),
    );

    // ─ Engagement probability ─
    let engagementProb = behavior * 0.6 + trust * 0.4;
    if (intent !== 'unknown') engagementProb += 0.05;
    const engagementProbability = makePrediction(
      'engagement_probability', 'Engagement Probability',
      engagementProb, behaviorProfile ? behaviorProfile.overallConfidence * 0.80 : 0.55,
      `Engagement: behavior score ${behavior.toFixed(2)}, trust ${trust.toFixed(2)}, intent ${intent}.`,
      [`Behavior score: ${behavior.toFixed(2)}`, `Trust: ${trust.toFixed(2)}`],
      allFactIds.slice(0, 2),
    );

    return {
      interview_likelihood: interviewLikelihood,
      response_likelihood: responseLikelihood,
      follow_up_likelihood: followUpLikelihood,
      rejection_probability: rejectionProbability,
      offer_probability: offerProbability,
      escalation_probability: escalationProbability,
      candidate_fit: candidateFit,
      hiring_confidence: hiringConfidence,
      engagement_probability: engagementProbability,
    };
  }

  // ─── AI enrichment ──────────────────────────────────────────────────────────

  private async inferWithAi(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
    behaviorProfile?: BehaviorProfile,
    trustScore?: TrustScore,
  ): Promise<Partial<Record<DecisionDimension, DecisionPrediction>>> {
    const input: ExtractionInput = {
      extractionId: randomUUID(),
      tenantId: recruiterId,
      sourceType: 'profile',
      sourceId: recruiterId,
      content: JSON.stringify({
        recruiterId,
        urgency: reasoning.urgency.value,
        intent: reasoning.communicationIntent.value,
        decisionAuthority: reasoning.decisionAuthority.value,
        factCount: facts.length,
        hasInterview: facts.some((f) => f.fieldType === 'interview_stage'),
        hasCompensation: facts.some((f) => f.fieldType === 'compensation_mention'),
        trustScore: trustScore?.score ?? null,
        behaviorScore: behaviorProfile?.overallBehaviorScore ?? null,
      }),
      metadata: { templateId: 'recruiter-decision-intelligence' },
      requestedAt: new Date(),
    };

    const output = await this.pipeline.extract(input, 'recruiter-decision-intelligence');
    const result: Partial<Record<DecisionDimension, DecisionPrediction>> = {};

    for (const f of output.fields) {
      const dim = f.field as DecisionDimension;
      const prob = typeof f.value === 'number' ? f.value : 0.60;
      result[dim] = makePrediction(
        dim, dim.replace(/_/g, ' '),
        prob, f.confidence,
        f.evidence[0]?.excerpt ?? 'AI-predicted probability.',
        f.evidence.map((e) => e.excerpt),
        [],
      );
    }

    return result;
  }

  // ─── Merge ───────────────────────────────────────────────────────────────────

  private mergePredictions(
    deterministic: Record<DecisionDimension, DecisionPrediction>,
    ai: Partial<Record<DecisionDimension, DecisionPrediction>>,
  ): Record<DecisionDimension, DecisionPrediction> {
    const merged = { ...deterministic };
    for (const [dim, aiPred] of Object.entries(ai) as Array<[DecisionDimension, DecisionPrediction]>) {
      if (aiPred && merged[dim] && aiPred.confidence > merged[dim].confidence) {
        merged[dim] = aiPred;
      }
    }
    return merged;
  }

  // ─── Decision profile ────────────────────────────────────────────────────────

  private buildDecisionProfile(
    recruiterId: string,
    predictions: Record<DecisionDimension, DecisionPrediction>,
    facts: RecruiterEntityFact[],
  ): DecisionProfile {
    const vals = Object.values(predictions);
    const overallScore = vals.reduce((s, p) => s + p.probability, 0) / vals.length;
    const overallConfidence = vals.reduce((s, p) => s + p.confidence, 0) / vals.length;

    let decisionStyle: DecisionStyle = 'unknown';
    const urgencyHigh = predictions.hiring_confidence.probability > 0.65;
    const offerHigh = predictions.offer_probability.probability > 0.50;
    const followHigh = predictions.follow_up_likelihood.probability > 0.65;

    if (urgencyHigh && offerHigh) decisionStyle = 'fast_mover';
    else if (predictions.escalation_probability.probability > 0.40) decisionStyle = 'committee_dependent';
    else if (followHigh) decisionStyle = 'thorough_evaluator';
    else if (predictions.engagement_probability.probability > 0.60) decisionStyle = 'deadline_driven';

    return {
      profileId: randomUUID(),
      recruiterId,
      interviewLikelihood: predictions.interview_likelihood,
      responseLikelihood: predictions.response_likelihood,
      followUpLikelihood: predictions.follow_up_likelihood,
      rejectionProbability: predictions.rejection_probability,
      offerProbability: predictions.offer_probability,
      escalationProbability: predictions.escalation_probability,
      candidateFit: predictions.candidate_fit,
      hiringConfidence: predictions.hiring_confidence,
      engagementProbability: predictions.engagement_probability,
      overallDecisionScore: Math.max(0, Math.min(1, overallScore)),
      overallConfidence,
      decisionStyle,
      generatedAt: new Date(),
      version: 1,
      evidenceRefs: facts.slice(0, 5).map((f) => ({
        evidenceId: f.factId,
        confidence: f.confidence,
        provenance: {
          source: f.provenance.extractor,
          collectedAt: f.observedAt.toISOString(),
          consentState: 'unknown' as const,
        },
      })),
    };
  }

  // ─── Timeline ────────────────────────────────────────────────────────────────

  private buildTimeline(
    recruiterId: string,
    predictions: Record<DecisionDimension, DecisionPrediction>,
  ): DecisionTimeline {
    const events: DecisionTimelineEvent[] = Object.values(predictions).map((p) => ({
      eventId: randomUUID(),
      recruiterId,
      dimension: p.dimension,
      newProbability: p.probability,
      deltaDescription: `Initial prediction: ${p.label} = ${(p.probability * 100).toFixed(0)}%.`,
      trigger: 'initial_inference',
      occurredAt: new Date(),
      confidence: p.confidence,
      evidenceFactIds: p.sourceFactIds,
    }));

    return {
      recruiterId,
      events,
      firstDecisionAt: new Date(),
      lastUpdatedAt: new Date(),
    };
  }

  // ─── Confidence ──────────────────────────────────────────────────────────────

  private buildConfidence(
    recruiterId: string,
    predictions: Record<DecisionDimension, DecisionPrediction>,
  ): DecisionConfidence {
    const dims = Object.fromEntries(
      Object.entries(predictions).map(([k, v]) => [k, v.confidence]),
    ) as Record<DecisionDimension, number>;

    const overall = Object.values(predictions).reduce((s, p) => s + p.confidence, 0) /
      Object.values(predictions).length;
    const dataQuality = Math.min(1, overall * 1.05);

    return {
      recruiterId,
      overallConfidence: overall,
      dimensionConfidences: dims,
      dataQualityScore: dataQuality,
      predictionReliabilityNote: overall >= 0.70
        ? 'Sufficient evidence for reliable predictions.'
        : 'Limited evidence — predictions are indicative. More data will improve accuracy.',
    };
  }

  // ─── Supporting evidence ─────────────────────────────────────────────────────

  private buildEvidence(
    recruiterId: string,
    predictions: Record<DecisionDimension, DecisionPrediction>,
    facts: RecruiterEntityFact[],
  ): DecisionEvidence[] {
    return Object.values(predictions).map((p) => ({
      evidenceId: randomUUID(),
      dimension: p.dimension,
      excerpts: p.supportingEvidence,
      sourceFactIds: p.sourceFactIds,
      weight: p.confidence,
      direction: p.probability >= 0.55 ? 'positive' : p.probability <= 0.35 ? 'negative' : 'neutral',
    }));
  }

  // ─── Explanations ─────────────────────────────────────────────────────────────

  private buildExplanations(
    recruiterId: string,
    predictions: Record<DecisionDimension, DecisionPrediction>,
  ): PredictionExplanation[] {
    return Object.values(predictions).map((p) => {
      const topFactors: ExplanationFactor[] = p.supportingEvidence.slice(0, 2).map((e) => ({
        factor: e,
        impact: p.probability > 0.65 ? 'high' : p.probability > 0.50 ? 'medium' : 'low',
        direction: p.probability >= 0.50 ? 'increases' : 'decreases',
        evidenceExcerpt: e,
      }));

      const counterFactors: ExplanationFactor[] = p.probability < 1.0 ? [{
        factor: 'Prediction uncertainty',
        impact: 'low',
        direction: 'decreases',
        evidenceExcerpt: 'Prediction has inherent uncertainty from limited evidence.',
      }] : [];

      return {
        recruiterId,
        dimension: p.dimension,
        topFactors,
        counterFactors,
        summaryText: `${p.label}: ${(p.probability * 100).toFixed(0)}% probability. ${p.reasoning}`,
        confidenceNote: `Prediction confidence: ${(p.confidence * 100).toFixed(0)}%.`,
      };
    });
  }

  // ─── Single-dimension explanation ────────────────────────────────────────────

  async explain(
    recruiterId: string,
    dimension: DecisionDimension,
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
  ): Promise<PredictionExplanation> {
    const result = await this.predict(recruiterId, facts, reasoning);
    const explanation = result.explanations.find((e) => e.dimension === dimension);
    return explanation ?? {
      recruiterId,
      dimension,
      topFactors: [],
      counterFactors: [],
      summaryText: `No explanation available for dimension: ${dimension}.`,
      confidenceNote: 'Dimension not predicted.',
    };
  }
}
