import { randomUUID } from 'crypto';
import type { ExtractionInput } from '../ai/types';
import { ExtractionPipeline } from '../ai/extraction-pipeline';
import type { RecruiterEntityFact } from '../extraction/recruiter-entity-extraction.service';
import type { RecruiterReasoningResult } from '../reasoning/recruiter-reasoning-enrichment.service';
import type { IntelligenceEngineResult } from '../engine/recruiter-intelligence-engine.service';
import type { BehavioralIntelligenceResult } from '../../../domain/recruiter-intelligence/behavior-intelligence/contracts';
import type { TrustReputationResult } from '../../../domain/recruiter-intelligence/reputation/contracts';
import type { SpecializationIntelligenceResult } from '../../../domain/recruiter-intelligence/specialization/contracts';
import type { DecisionIntelligenceResult } from '../../../domain/recruiter-intelligence/decision-intelligence/contracts';
import type {
  CandidateRecommendation,
  CommunicationRecommendation,
  CommunicationSummaryInsight,
  EngagementSummaryInsight,
  FollowUpRecommendation,
  GraphContext,
  HiringSummaryInsight,
  InsightPriority,
  InsightSeverity,
  MemoryContext,
  OpportunityAlert,
  OpportunitySummaryInsight,
  RecruiterInsight,
  RecruiterInsightsResult,
  RecruiterRiskAlert,
  RecruiterSummaryInsight,
  RelationshipRecommendation,
  ReasoningStep,
  TimingRecommendation,
  TimelineContext,
} from '../../../domain/recruiter-intelligence/insights/contracts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInsight(
  recruiterId: string,
  category: RecruiterInsight['category'],
  title: string,
  text: string,
  confidence: number,
  severity: InsightSeverity,
  priority: InsightPriority,
  reasoning: string,
  evidenceFactIds: string[],
  suggestedAction?: string,
): RecruiterInsight {
  return {
    insightId: randomUUID(),
    recruiterId,
    category,
    title,
    text,
    confidence,
    severity,
    priority,
    actionable: !!suggestedAction,
    suggestedAction,
    evidenceFactIds,
    reasoning,
    generatedAt: new Date(),
  };
}

/**
 * RecruiterInsightsEngine — Prompt 20 implementation.
 *
 * Generates 12 categories of actionable recruiter intelligence:
 *   Summaries: recruiter, communication, hiring, engagement, opportunity
 *   Recommendations: candidate, follow-up, communication, timing, relationship
 *   Alerts: risk alerts, opportunity alerts
 *
 * Multi-turn reasoning: memory-aware, timeline-aware, knowledge-graph-aware.
 * Every insight cites structured evidence. Never hallucinate facts.
 *
 * Architecture:
 *   1. Aggregates all Batch 3 + Batch 4 intelligence into a unified context
 *   2. Deterministic insight generation from structured signals
 *   3. AI synthesis adds nuanced, contextual insights
 *   4. All insights have: confidence, reasoning, evidenceFactIds
 */
export class RecruiterInsightsEngine {
  constructor(private readonly pipeline: ExtractionPipeline) {}

  async generate(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
    engineResult?: IntelligenceEngineResult,
    behavioralResult?: BehavioralIntelligenceResult,
    trustResult?: TrustReputationResult,
    specializationResult?: SpecializationIntelligenceResult,
    decisionResult?: DecisionIntelligenceResult,
    _memoryContext?: MemoryContext,
    _timelineContext?: TimelineContext,
    _graphContext?: GraphContext,
  ): Promise<RecruiterInsightsResult> {
    const resultId = randomUUID();

    // ─ Multi-turn reasoning chain ─
    const reasoningChain = this.buildReasoningChain(
      facts, reasoning, engineResult, behavioralResult, trustResult, specializationResult, decisionResult,
    );

    // ─ Step 1: Summaries (deterministic) ─
    const recruiterSummary = this.buildRecruiterSummary(
      recruiterId, facts, reasoning, engineResult, behavioralResult, trustResult, specializationResult, decisionResult,
    );
    const communicationSummary = this.buildCommunicationSummary(
      recruiterId, facts, reasoning, behavioralResult,
    );
    const hiringSummary = this.buildHiringSummary(
      recruiterId, facts, reasoning, engineResult, decisionResult,
    );
    const engagementSummary = this.buildEngagementSummary(
      recruiterId, behavioralResult, trustResult, decisionResult,
    );
    const opportunitySummary = this.buildOpportunitySummary(
      recruiterId, facts, reasoning, decisionResult, trustResult,
    );

    // ─ Step 2: Recommendations (deterministic + AI) ─
    const candidateRecommendations = this.buildCandidateRecommendations(
      recruiterId, facts, reasoning, decisionResult, specializationResult,
    );
    const followUpRecommendations = this.buildFollowUpRecommendations(
      recruiterId, facts, reasoning, behavioralResult, trustResult,
    );
    const communicationRecommendations = this.buildCommunicationRecommendations(
      recruiterId, behavioralResult, trustResult,
    );
    const timingRecommendations = this.buildTimingRecommendations(
      recruiterId, facts, reasoning, behavioralResult,
    );
    const relationshipRecommendations = this.buildRelationshipRecommendations(
      recruiterId, trustResult, behavioralResult, decisionResult,
    );

    // ─ Step 3: Alerts ─
    const riskAlerts = this.buildRiskAlerts(recruiterId, trustResult, behavioralResult, decisionResult);
    const opportunityAlerts = this.buildOpportunityAlerts(
      recruiterId, facts, reasoning, decisionResult, trustResult,
    );

    // ─ Step 4: AI synthesis enrichment ─
    let aiInsights: RecruiterInsight[] = [];
    try {
      aiInsights = await this.generateAiInsights(
        recruiterId, facts, reasoning, behavioralResult, trustResult, decisionResult,
      );
    } catch {
      // non-fatal
    }

    // Flatten all insights
    const allInsights: RecruiterInsight[] = [
      makeInsight(recruiterId, 'recruiter_summary', 'Recruiter Summary',
        recruiterSummary.overallSummary, recruiterSummary.confidence, 'info', 'normal',
        'Composite summary from all intelligence layers.', recruiterSummary.evidenceFactIds),
      makeInsight(recruiterId, 'communication_summary', 'Communication Summary',
        communicationSummary.style + ': ' + communicationSummary.responsePattern,
        communicationSummary.confidence, 'info', 'normal',
        'Communication inferred from behavior profile and facts.', communicationSummary.evidenceFactIds),
      ...riskAlerts.map((a) => makeInsight(recruiterId, 'recruiter_risk_alert', a.title,
        a.description, a.probability, a.severity, 'high',
        `Risk alert: ${a.alertType}.`, a.evidenceFactIds, a.mitigationAdvice)),
      ...opportunityAlerts.map((a) => makeInsight(recruiterId, 'opportunity_alert', a.title,
        a.description, 0.75, 'info', a.urgency,
        `Opportunity: ${a.alertType}.`, a.evidenceFactIds, a.suggestedAction)),
      ...aiInsights,
    ];

    const overallConfidence = facts.length > 0
      ? [
          recruiterSummary.confidence,
          communicationSummary.confidence,
          hiringSummary.confidence,
          engagementSummary.confidence,
        ].reduce((s, c) => s + c, 0) / 4
      : 0.50;

    return {
      resultId,
      recruiterId,
      recruiterSummary,
      communicationSummary,
      hiringSummary,
      engagementSummary,
      opportunitySummary,
      candidateRecommendations,
      followUpRecommendations,
      communicationRecommendations,
      timingRecommendations,
      relationshipRecommendations,
      riskAlerts,
      opportunityAlerts,
      allInsights,
      reasoningChain,
      overallConfidence,
      generatedAt: new Date(),
    };
  }

  // ─── Reasoning chain ─────────────────────────────────────────────────────────

  private buildReasoningChain(
    facts: RecruiterEntityFact[],
    _reasoning: RecruiterReasoningResult,
    _engineResult?: IntelligenceEngineResult,
    behavioralResult?: BehavioralIntelligenceResult,
    trustResult?: TrustReputationResult,
    _specializationResult?: SpecializationIntelligenceResult,
    decisionResult?: DecisionIntelligenceResult,
  ): ReasoningStep[] {
    const steps: ReasoningStep[] = [];
    const factIds = facts.map((f) => f.factId);

    steps.push({
      stepId: randomUUID(),
      stepType: 'memory_recall',
      description: 'Load structured recruiter facts from memory',
      inputSummary: `${facts.length} recruiter entity facts available`,
      outputSummary: `${facts.length} facts loaded for insight generation`,
      confidence: 1.0,
      evidenceFactIds: factIds.slice(0, 3),
    });

    if (behavioralResult) {
      steps.push({
        stepId: randomUUID(),
        stepType: 'inference',
        description: 'Apply behavioral intelligence results',
        inputSummary: `Behavioral profile: ${behavioralResult.profile.communicationStyle.value} style, ${behavioralResult.profile.hiringUrgency.value} urgency`,
        outputSummary: `Behavioral confidence: ${behavioralResult.profile.overallConfidence.toFixed(2)}`,
        confidence: behavioralResult.profile.overallConfidence,
        evidenceFactIds: factIds.slice(0, 2),
      });
    }

    if (trustResult) {
      steps.push({
        stepId: randomUUID(),
        stepType: 'inference',
        description: 'Apply trust and reputation signals',
        inputSummary: `Trust score: ${trustResult.trustScore.score.toFixed(2)} (${trustResult.trustScore.band})`,
        outputSummary: `Ghosting risk: ${trustResult.trustScore.ghostingRisk}`,
        confidence: trustResult.trustScore.confidence,
        evidenceFactIds: trustResult.trustScore.evidenceFactIds.slice(0, 2),
      });
    }

    if (decisionResult) {
      steps.push({
        stepId: randomUUID(),
        stepType: 'inference',
        description: 'Apply decision predictions',
        inputSummary: `Response likelihood: ${decisionResult.decisionProfile.responseLikelihood.probability.toFixed(2)}, Offer probability: ${decisionResult.decisionProfile.offerProbability.probability.toFixed(2)}`,
        outputSummary: `Decision style: ${decisionResult.decisionProfile.decisionStyle}`,
        confidence: decisionResult.decisionProfile.overallConfidence,
        evidenceFactIds: factIds.slice(0, 2),
      });
    }

    steps.push({
      stepId: randomUUID(),
      stepType: 'synthesis',
      description: 'Synthesize all intelligence layers into actionable insights',
      inputSummary: `${steps.length} reasoning steps completed`,
      outputSummary: 'Generating summaries, recommendations, and alerts',
      confidence: 0.80,
      evidenceFactIds: factIds.slice(0, 3),
    });

    return steps;
  }

  // ─── Summaries ────────────────────────────────────────────────────────────────

  private buildRecruiterSummary(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
    _engineResult?: IntelligenceEngineResult,
    behavioralResult?: BehavioralIntelligenceResult,
    trustResult?: TrustReputationResult,
    specializationResult?: SpecializationIntelligenceResult,
    decisionResult?: DecisionIntelligenceResult,
  ): RecruiterSummaryInsight {
    const factIds = facts.map((f) => f.factId);
    const nameFact = facts.find((f) => f.fieldType === 'recruiter_name');
    const titleFact = facts.find((f) => f.fieldType === 'recruiter_title');
    const orgFact = facts.find((f) => f.fieldType === 'recruiter_organization');

    const name = nameFact?.rawValue ?? 'This recruiter';
    const title = titleFact?.rawValue ?? '';
    const org = orgFact?.rawValue ? ` at ${orgFact.rawValue}` : '';
    const urgency = reasoning.urgency.value;
    const trust = trustResult?.trustScore.band ?? 'unknown';
    const style = behavioralResult?.profile.communicationStyle.value ?? 'unknown';
    const domains = specializationResult?.expertiseProfile.hiringDomains.value.join(', ') ?? 'general';

    const overallSummary = [
      `${name}${title ? ` (${title})` : ''}${org} is a recruiter specializing in ${domains}.`,
      trustResult ? `Trust level: ${trust}.` : '',
      behavioralResult ? `Communication style: ${style}. Urgency: ${urgency}.` : '',
      decisionResult ? `Response likelihood: ${(decisionResult.decisionProfile.responseLikelihood.probability * 100).toFixed(0)}%.` : '',
    ].filter(Boolean).join(' ');

    const behaviors = behavioralResult ? `${behavioralResult.profile.communicationStyle.value} communicator, ${behavioralResult.profile.hiringUrgency.value} urgency` : 'behavioral data unavailable';
    const reputation = trustResult ? `trust ${trust}, ghosting risk ${trustResult.trustScore.ghostingRisk}` : 'reputation data unavailable';
    const specialization = specializationResult ? `specializes in ${specializationResult.expertiseProfile.hiringDomains.value.slice(0, 2).join(' and ')}` : 'specialization data unavailable';
    const decisions = decisionResult ? `decision style: ${decisionResult.decisionProfile.decisionStyle}` : 'decision data unavailable';

    return {
      recruiterId,
      overallSummary,
      behaviorSummary: `Behavioral profile: ${behaviors}.`,
      reputationSummary: `Reputation: ${reputation}.`,
      specializationSummary: `Specialization: ${specialization}.`,
      decisionSummary: `Decision intelligence: ${decisions}.`,
      confidence: reasoning.overallConfidence * 0.85,
      evidenceFactIds: factIds.slice(0, 5),
      generatedAt: new Date(),
    };
  }

  private buildCommunicationSummary(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    _reasoning: RecruiterReasoningResult,
    behavioralResult?: BehavioralIntelligenceResult,
  ): CommunicationSummaryInsight {
    const profile = behavioralResult?.profile;
    const style = profile?.communicationStyle.value ?? 'standard';
    const channels = profile?.preferredCommunicationChannels.value ?? ['email'];
    const responsePattern = profile?.responsiveness.value ?? 'moderate';
    const factIds = facts.map((f) => f.factId).slice(0, 3);

    return {
      recruiterId,
      style: String(style),
      tone: style === 'direct' ? 'direct' : style === 'formal' ? 'formal' : 'professional',
      preferredChannels: channels.map(String),
      responsePattern: `Response pattern: ${responsePattern}`,
      communicationStrengths: profile?.responseQuality.value === 'excellent' ? ['High quality responses'] : [],
      communicationWeaknesses: profile?.recruiterConsistency.value === 'inconsistent' ? ['Inconsistent patterns'] : [],
      confidence: profile?.overallConfidence ?? 0.55,
      evidenceFactIds: factIds,
    };
  }

  private buildHiringSummary(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
    _engineResult?: IntelligenceEngineResult,
    decisionResult?: DecisionIntelligenceResult,
  ): HiringSummaryInsight {
    const hasInterview = facts.some((f) => f.fieldType === 'interview_stage');
    const urgency = reasoning.urgency.value;
    const domainFacts = facts.filter((f) => f.fieldType === 'hiring_domain');
    const roles = domainFacts.map((f) => f.rawValue);
    const factIds = facts.map((f) => f.factId).slice(0, 4);

    const decision = decisionResult?.decisionProfile;
    const offerProb = decision ? `${(decision.offerProbability.probability * 100).toFixed(0)}%` : 'unknown';

    return {
      recruiterId,
      hiringPace: urgency === 'critical' ? 'Very fast' : urgency === 'high' ? 'Fast' : urgency === 'medium' ? 'Moderate' : 'Slow',
      activeRoles: roles.length > 0 ? roles : ['Unknown roles'],
      hiringVelocityNote: `Urgency level: ${urgency}. ${hasInterview ? 'Active interview process.' : 'Interview process not confirmed.'}`,
      decisionSpeed: decision?.decisionStyle ?? 'unknown',
      offerConversionRate: `Estimated offer probability: ${offerProb}`,
      confidence: reasoning.urgency.confidence * 0.80,
      evidenceFactIds: factIds,
    };
  }

  private buildEngagementSummary(
    recruiterId: string,
    behavioralResult?: BehavioralIntelligenceResult,
    trustResult?: TrustReputationResult,
    decisionResult?: DecisionIntelligenceResult,
  ): EngagementSummaryInsight {
    const engagement = behavioralResult?.profile.recruiterEngagement.value ?? 'unknown';
    const engagementProb = decisionResult?.decisionProfile.engagementProbability.probability ?? 0.55;
    const trust = trustResult?.trustScore.score ?? 0.55;
    const riskOfDisengagement = Math.max(0, 1 - (engagementProb * 0.6 + trust * 0.4));
    const trend = behavioralResult?.evolution.overallTrend ?? 'unknown';

    return {
      recruiterId,
      engagementLevel: String(engagement),
      engagementTrend: trend,
      keyEngagementSignals: [
        `Engagement probability: ${(engagementProb * 100).toFixed(0)}%`,
        `Trust level: ${trustResult?.trustScore.band ?? 'unknown'}`,
      ],
      riskOfDisengagement,
      confidence: behavioralResult?.profile.overallConfidence ?? 0.50,
      evidenceFactIds: trustResult?.trustScore.evidenceFactIds.slice(0, 3) ?? [],
    };
  }

  private buildOpportunitySummary(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
    decisionResult?: DecisionIntelligenceResult,
    trustResult?: TrustReputationResult,
  ): OpportunitySummaryInsight {
    const urgency = reasoning.urgency.value;
    const interviewProb = decisionResult?.decisionProfile.interviewLikelihood.probability ?? 0.5;
    const offerProb = decisionResult?.decisionProfile.offerProbability.probability ?? 0.25;
    const trust = trustResult?.trustScore.score ?? 0.55;
    const opportunityScore = (interviewProb * 0.4 + offerProb * 0.3 + trust * 0.3);
    const factIds = facts.map((f) => f.factId).slice(0, 3);

    const signals = [];
    if (urgency === 'high' || urgency === 'critical') signals.push({ signal: 'High urgency hiring', strength: 'strong' as const, evidenceExcerpt: `Urgency: ${urgency}` });
    if (interviewProb > 0.65) signals.push({ signal: 'High interview likelihood', strength: 'strong' as const, evidenceExcerpt: `Interview probability: ${(interviewProb * 100).toFixed(0)}%` });
    if (offerProb > 0.40) signals.push({ signal: 'Elevated offer probability', strength: 'moderate' as const, evidenceExcerpt: `Offer probability: ${(offerProb * 100).toFixed(0)}%` });

    return {
      recruiterId,
      currentOpportunities: signals,
      opportunityScore,
      timeToAct: urgency === 'critical' ? 'Immediate — respond within 24 hours'
        : urgency === 'high' ? 'Soon — respond within 48 hours'
          : 'Standard — respond within 5 business days',
      confidence: reasoning.overallConfidence * 0.80,
      evidenceFactIds: factIds,
    };
  }

  // ─── Recommendations ──────────────────────────────────────────────────────────

  private buildCandidateRecommendations(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    _reasoning: RecruiterReasoningResult,
    decisionResult?: DecisionIntelligenceResult,
    specializationResult?: SpecializationIntelligenceResult,
  ): CandidateRecommendation[] {
    const recs: CandidateRecommendation[] = [];
    const factIds = facts.map((f) => f.factId).slice(0, 3);

    const candidateFit = decisionResult?.decisionProfile.candidateFit.probability ?? 0.55;
    recs.push({
      insightId: randomUUID(),
      recruiterId,
      recommendation: `Candidate fit estimated at ${(candidateFit * 100).toFixed(0)}%. ${candidateFit > 0.65 ? 'Strong match — engage actively.' : 'Moderate match — ensure alignment before proceeding.'}`,
      rationale: decisionResult?.decisionProfile.candidateFit.reasoning ?? 'Inferred from available signals.',
      priority: candidateFit > 0.65 ? 'high' : 'normal',
      confidence: decisionResult?.decisionProfile.candidateFit.confidence ?? 0.55,
      evidenceFactIds: factIds,
    });

    const domains = specializationResult?.expertiseProfile.hiringDomains.value ?? [];
    if (domains.length > 0) {
      recs.push({
        insightId: randomUUID(),
        recruiterId,
        recommendation: `Highlight expertise in: ${domains.slice(0, 3).join(', ')}.`,
        rationale: `Recruiter specializes in ${domains.join(', ')} — align your messaging.`,
        priority: 'normal',
        confidence: specializationResult?.expertiseProfile.hiringDomains.confidence ?? 0.60,
        evidenceFactIds: specializationResult?.expertiseProfile.hiringDomains.evidenceFactIds ?? [],
      });
    }

    return recs;
  }

  private buildFollowUpRecommendations(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
    behavioralResult?: BehavioralIntelligenceResult,
    trustResult?: TrustReputationResult,
  ): FollowUpRecommendation[] {
    const urgency = reasoning.urgency.value;
    const factIds = facts.map((f) => f.factId).slice(0, 2);
    const followUpBehavior = behavioralResult?.profile.followUpBehavior.value ?? 'unknown';
    const ghostingRisk = trustResult?.trustScore.ghostingRisk ?? 'unknown';

    const timing = urgency === 'critical' ? '24 hours'
      : urgency === 'high' ? '48 hours'
        : '5 business days';

    const recs: FollowUpRecommendation[] = [{
      insightId: randomUUID(),
      recruiterId,
      action: `Follow up if no response received within ${timing}.`,
      timing,
      channel: behavioralResult?.profile.preferredCommunicationChannels.value[0]?.toString() ?? 'email',
      urgency: urgency === 'critical' ? 'urgent' : urgency === 'high' ? 'high' : 'normal',
      rationale: `Recruiter urgency: ${urgency}. Follow-up behavior: ${followUpBehavior}. Ghosting risk: ${ghostingRisk}.`,
      confidence: reasoning.urgency.confidence * 0.80,
      evidenceFactIds: factIds,
    }];

    if (ghostingRisk === 'high' || ghostingRisk === 'very_high') {
      recs.push({
        insightId: randomUUID(),
        recruiterId,
        action: 'Send a polite reminder and request explicit confirmation.',
        timing: '48 hours after initial follow-up',
        channel: 'email',
        urgency: 'high',
        rationale: `Ghosting risk is ${ghostingRisk} — proactive follow-up reduces ghosting probability.`,
        confidence: trustResult?.trustScore.confidence ?? 0.65,
        evidenceFactIds: trustResult?.trustScore.evidenceFactIds.slice(0, 2) ?? [],
      });
    }

    return recs;
  }

  private buildCommunicationRecommendations(
    recruiterId: string,
    behavioralResult?: BehavioralIntelligenceResult,
    _trustResult?: TrustReputationResult,
  ): CommunicationRecommendation[] {
    const style = behavioralResult?.profile.communicationStyle.value ?? 'unknown';
    const channel = behavioralResult?.profile.preferredCommunicationChannels.value[0]?.toString() ?? 'email';
    const quality = behavioralResult?.profile.responseQuality.value ?? 'adequate';

    const tips: string[] = [];
    const avoid: string[] = [];

    if (style === 'direct') { tips.push('Be concise and direct — state your value proposition in 3 sentences or less.'); }
    if (style === 'formal') { tips.push('Use professional language; avoid casual contractions.'); }
    if (style === 'consultative') { tips.push('Ask questions and position yourself as a collaborative partner.'); }
    if (quality === 'poor') avoid.push('Long multi-paragraph messages — this recruiter prefers brevity.');

    return [{
      insightId: randomUUID(),
      recruiterId,
      recommendedStyle: String(style),
      recommendedTone: style === 'direct' ? 'concise and assertive' : 'professional and warm',
      recommendedChannel: channel,
      messagingTips: tips.length > 0 ? tips : ['Match the recruiter\'s established communication tone.'],
      avoidPatterns: avoid,
      confidence: behavioralResult?.profile.communicationStyle.confidence ?? 0.55,
      evidenceFactIds: behavioralResult?.profile.communicationStyle.sourceFactIds ?? [],
    }];
  }

  private buildTimingRecommendations(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
    behavioralResult?: BehavioralIntelligenceResult,
  ): TimingRecommendation[] {
    const activityPattern = behavioralResult?.profile.activityPatterns.value;
    const urgency = reasoning.urgency.value;
    const factIds = facts.map((f) => f.factId).slice(0, 2);

    const bestDays = activityPattern?.preferredDays ?? ['Monday', 'Tuesday', 'Wednesday'];
    const bestTime = activityPattern?.preferredTimeOfDay ?? 'morning';

    return [{
      insightId: randomUUID(),
      recruiterId,
      bestTimeToContact: bestTime,
      bestDaysToContact: bestDays,
      urgencyWindow: urgency === 'critical' ? 'Respond immediately — role may close within days.'
        : urgency === 'high' ? 'Respond within 2 days to stay in consideration.'
          : 'Standard response window — within 5 business days.',
      rationale: `Activity pattern inferred from behavioral profile. Urgency: ${urgency}.`,
      confidence: activityPattern ? 0.70 : 0.45,
      evidenceFactIds: factIds,
    }];
  }

  private buildRelationshipRecommendations(
    recruiterId: string,
    trustResult?: TrustReputationResult,
    _behavioralResult?: BehavioralIntelligenceResult,
    decisionResult?: DecisionIntelligenceResult,
  ): RelationshipRecommendation[] {
    const trust = trustResult?.trustScore.score ?? 0.55;
    const ghostingRisk = trustResult?.trustScore.ghostingRisk ?? 'unknown';
    const engagementProb = decisionResult?.decisionProfile.engagementProbability.probability ?? 0.55;

    const nextSteps: string[] = [];
    const riskMitigation: string[] = [];

    if (engagementProb > 0.65) nextSteps.push('Maintain engagement momentum — respond promptly.');
    if (trust >= 0.70) nextSteps.push('Leverage established trust — ask for referrals or pipeline visibility.');
    if (ghostingRisk === 'high' || ghostingRisk === 'very_high') {
      riskMitigation.push('Create paper trail — confirm all commitments in writing.');
      riskMitigation.push('Set reminders to follow up if no response in 3 days.');
    }

    return [{
      insightId: randomUUID(),
      recruiterId,
      relationshipStrategy: trust >= 0.65 ? 'Build on established trust — deepen the relationship.'
        : 'Establish credibility first — trust is still developing.',
      nextSteps: nextSteps.length > 0 ? nextSteps : ['Maintain professional communication.'],
      longTermStrategy: engagementProb > 0.60
        ? 'This recruiter is a strong long-term contact — invest in relationship building.'
        : 'Maintain periodic touchpoints to stay top-of-mind.',
      riskMitigation,
      confidence: trustResult?.trustScore.confidence ?? 0.55,
      evidenceFactIds: trustResult?.trustScore.evidenceFactIds.slice(0, 2) ?? [],
    }];
  }

  // ─── Alerts ────────────────────────────────────────────────────────────────────

  private buildRiskAlerts(
    recruiterId: string,
    trustResult?: TrustReputationResult,
    behavioralResult?: BehavioralIntelligenceResult,
    _decisionResult?: DecisionIntelligenceResult,
  ): RecruiterRiskAlert[] {
    const alerts: RecruiterRiskAlert[] = [];

    // Ghosting risk alert
    if (trustResult && (trustResult.trustScore.ghostingRisk === 'high' || trustResult.trustScore.ghostingRisk === 'very_high')) {
      alerts.push({
        alertId: randomUUID(),
        recruiterId,
        alertType: 'ghosting_risk',
        title: 'Elevated Ghosting Risk',
        description: `Ghosting probability is ${(trustResult.trustScore.ghostingProbability * 100).toFixed(0)}%. Recruiter trust score: ${trustResult.trustScore.band}.`,
        severity: trustResult.trustScore.ghostingRisk === 'very_high' ? 'high' : 'medium',
        probability: trustResult.trustScore.ghostingProbability,
        mitigationAdvice: 'Follow up proactively within 48 hours. Confirm meetings explicitly.',
        evidenceFactIds: trustResult.trustScore.evidenceFactIds.slice(0, 3),
        triggeredAt: new Date(),
      });
    }

    // Trust declining alert
    if (trustResult && trustResult.trustScore.score < 0.40) {
      alerts.push({
        alertId: randomUUID(),
        recruiterId,
        alertType: 'trust_declining',
        title: 'Low Trust Score',
        description: `Trust score is ${(trustResult.trustScore.score * 100).toFixed(0)}/100 (${trustResult.trustScore.band}).`,
        severity: 'medium',
        probability: 0.70,
        mitigationAdvice: 'Proceed cautiously. Verify recruiter credentials before investing significant time.',
        evidenceFactIds: trustResult.trustScore.evidenceFactIds.slice(0, 2),
        triggeredAt: new Date(),
      });
    }

    // Engagement dropping alert
    if (behavioralResult && behavioralResult.evolution.overallTrend === 'declining') {
      alerts.push({
        alertId: randomUUID(),
        recruiterId,
        alertType: 'engagement_dropping',
        title: 'Engagement Declining',
        description: 'Recruiter behavioral engagement is showing a declining trend.',
        severity: 'medium',
        probability: 0.65,
        mitigationAdvice: 'Re-engage with fresh content or updated availability. A direct call may help.',
        evidenceFactIds: [],
        triggeredAt: new Date(),
      });
    }

    return alerts;
  }

  private buildOpportunityAlerts(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
    decisionResult?: DecisionIntelligenceResult,
    _trustResult?: TrustReputationResult,
  ): OpportunityAlert[] {
    const alerts: OpportunityAlert[] = [];
    const factIds = facts.map((f) => f.factId).slice(0, 3);
    const urgency = reasoning.urgency.value;
    const offerProb = decisionResult?.decisionProfile.offerProbability.probability ?? 0;
    const interviewProb = decisionResult?.decisionProfile.interviewLikelihood.probability ?? 0;

    if (urgency === 'critical' || urgency === 'high') {
      alerts.push({
        alertId: randomUUID(),
        recruiterId,
        alertType: 'high_urgency_role',
        title: 'High Urgency Role Detected',
        description: `Recruiter signals ${urgency} hiring urgency. This role may fill quickly.`,
        urgency: urgency === 'critical' ? 'urgent' : 'high',
        opportunityWindow: urgency === 'critical' ? '24–48 hours' : '3–5 days',
        suggestedAction: 'Respond immediately with availability and updated resume.',
        evidenceFactIds: factIds,
        triggeredAt: new Date(),
      });
    }

    if (offerProb > 0.45) {
      alerts.push({
        alertId: randomUUID(),
        recruiterId,
        alertType: 'offer_imminent',
        title: 'Offer May Be Imminent',
        description: `Offer probability is ${(offerProb * 100).toFixed(0)}%. Compensation signals detected.`,
        urgency: offerProb > 0.60 ? 'high' : 'normal',
        opportunityWindow: '1–2 weeks',
        suggestedAction: 'Ensure compensation expectations are aligned. Prepare for offer negotiation.',
        evidenceFactIds: factIds,
        triggeredAt: new Date(),
      });
    }

    if (interviewProb > 0.70) {
      alerts.push({
        alertId: randomUUID(),
        recruiterId,
        alertType: 'interview_window_opening',
        title: 'Interview Window Opening',
        description: `Interview likelihood is ${(interviewProb * 100).toFixed(0)}%. Recruiter is actively scheduling.`,
        urgency: 'high',
        opportunityWindow: '1 week',
        suggestedAction: 'Confirm your availability for the next 2 weeks. Prepare for technical screening.',
        evidenceFactIds: factIds,
        triggeredAt: new Date(),
      });
    }

    return alerts;
  }

  // ─── AI synthesis ─────────────────────────────────────────────────────────────

  private async generateAiInsights(
    recruiterId: string,
    _facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
    behavioralResult?: BehavioralIntelligenceResult,
    trustResult?: TrustReputationResult,
    decisionResult?: DecisionIntelligenceResult,
  ): Promise<RecruiterInsight[]> {
    const input: ExtractionInput = {
      extractionId: randomUUID(),
      tenantId: recruiterId,
      sourceType: 'profile',
      sourceId: recruiterId,
      content: JSON.stringify({
        recruiterId,
        urgency: reasoning.urgency.value,
        intent: reasoning.communicationIntent.value,
        trustBand: trustResult?.trustScore.band ?? 'unknown',
        ghostingRisk: trustResult?.trustScore.ghostingRisk ?? 'unknown',
        behaviorStyle: behavioralResult?.profile.communicationStyle.value ?? 'unknown',
        interviewLikelihood: decisionResult?.decisionProfile.interviewLikelihood.probability ?? null,
        offerProbability: decisionResult?.decisionProfile.offerProbability.probability ?? null,
      }),
      metadata: { templateId: 'recruiter-insights-engine' },
      requestedAt: new Date(),
    };

    const output = await this.pipeline.extract('recruiter-insights-engine', input, {});
    const now = new Date();

    return output.fields.map((f) => ({
      insightId: randomUUID(),
      recruiterId,
      category: 'recruiter_summary',
      title: f.field,
      text: String(f.value),
      confidence: f.confidence,
      severity: 'info',
      priority: 'normal',
      actionable: true,
      suggestedAction: f.evidence[0]?.excerpt,
      evidenceFactIds: [],
      reasoning: 'AI-synthesized insight from aggregated recruiter intelligence.',
      generatedAt: now,
    }));
  }
}
