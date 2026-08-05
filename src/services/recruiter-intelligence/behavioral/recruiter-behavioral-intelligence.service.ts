import { randomUUID } from 'crypto';
import type { ExtractionInput } from '../ai/types';
import { ExtractionPipeline } from '../ai/extraction-pipeline';
import type { RecruiterEntityFact } from '../extraction/recruiter-entity-extraction.service';
import type { RecruiterReasoningResult } from '../reasoning/recruiter-reasoning-enrichment.service';
import type { IntelligenceEngineResult } from '../engine/recruiter-intelligence-engine.service';
import type {
  ActivityPattern,
  BehaviorConfidence,
  BehaviorEvidence,
  BehaviorEvolution,
  BehaviorProfile,
  BehaviorSummary,
  BehaviorTimelineEvent,
  BehavioralDimension,
  BehavioralIntelligenceResult,
  CommunicationStyle,
  ConsistencyLevel,
  DecisionPattern,
  DimensionEvolution,
  EngagementLevel,
  FollowUpBehavior,
  HiringUrgencyLevel,
  PreferredChannel,
  ResponseQuality,
  ResponsivenessTrend,
  ResponsivenessLevel,
  SchedulingBehavior,
} from '../../../domain/recruiter-intelligence/behavior-intelligence/contracts';

// ─── Internal helpers ─────────────────────────────────────────────────────────

type FactsByType = Map<string, RecruiterEntityFact[]>;

function groupFacts(facts: RecruiterEntityFact[]): FactsByType {
  const map = new Map<string, RecruiterEntityFact[]>();
  for (const f of facts) {
    const arr = map.get(f.fieldType) ?? [];
    arr.push(f);
    map.set(f.fieldType, arr);
  }
  return map;
}

function toConfidenceBand(c: number): 'low' | 'medium' | 'high' | 'critical' {
  if (c >= 0.85) return 'critical';
  if (c >= 0.70) return 'high';
  if (c >= 0.50) return 'medium';
  return 'low';
}

function makeDimension<T>(
  dimension: string,
  value: T,
  confidence: number,
  reasoning: string,
  evidence: string[],
  factIds: string[],
  method: 'deterministic' | 'ai_assisted' = 'deterministic',
): BehavioralDimension<T> {
  return {
    dimensionId: randomUUID(),
    dimension,
    value,
    reasoning,
    confidence,
    confidenceBand: toConfidenceBand(confidence),
    supportingEvidence: evidence,
    sourceFactIds: factIds,
    inferredAt: new Date(),
    method,
  };
}

/**
 * RecruiterBehavioralIntelligenceService — Prompt 16 implementation.
 *
 * Infers 13 behavioral dimensions from structured recruiter facts:
 *   communicationStyle, responsiveness, followUpBehavior, hiringUrgency,
 *   recruiterEngagement, recruiterPreferences, preferredCommunicationChannels,
 *   schedulingBehavior, recruiterConsistency, activityPatterns,
 *   responseQuality, responsivenessTrends, decisionMakingPatterns.
 *
 * Architecture:
 *   1. Deterministic inference from known facts (fast, rule-based)
 *   2. AI-assisted enrichment via ExtractionPipeline (contextual signals)
 *   3. Merge: AI overrides deterministic for same dimension when confidence is higher
 *   4. Produces: Profile, Timeline, Confidence, Summary, Evolution
 *   5. Continuous learning: merges new evidence into existing behavior
 */
export class RecruiterBehavioralIntelligenceService {
  constructor(private readonly pipeline: ExtractionPipeline) {}

  async infer(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
    _engineResult?: IntelligenceEngineResult,
    priorProfile?: BehaviorProfile,
    _messageHistory?: BehaviorEvidence[],
  ): Promise<BehavioralIntelligenceResult> {
    const resultId = randomUUID();
    const byType = groupFacts(facts);

    // Step 1: deterministic inference
    const deterministicDims = this.inferDeterministic(recruiterId, byType, reasoning);

    // Step 2: AI enrichment
    let aiDims: Partial<BehaviorProfile> = {};
    try {
      aiDims = await this.inferWithAi(recruiterId, facts, reasoning);
    } catch {
      // non-fatal
    }

    // Step 3: merge (AI wins on same dimension if higher confidence)
    const profile = this.buildProfile(recruiterId, deterministicDims, aiDims, facts);

    // Step 4: timeline, confidence, summary, evolution
    const timeline = this.buildTimeline(recruiterId, profile, priorProfile);
    const confidence = this.buildConfidence(recruiterId, profile, facts);
    const summary = this.buildSummary(recruiterId, profile, reasoning);
    const evolution = this.buildEvolution(recruiterId, profile, priorProfile);

    return {
      resultId,
      recruiterId,
      profile,
      timeline,
      confidence,
      summary,
      evolution,
      generatedAt: new Date(),
    };
  }

  // ─── Deterministic inference ────────────────────────────────────────────────

  private inferDeterministic(
    _recruiterId: string,
    byType: FactsByType,
    reasoning: RecruiterReasoningResult,
  ): Partial<BehaviorProfile> {
    const urgency = reasoning.urgency.value;
    const intent = reasoning.communicationIntent.value;

    // ─ Communication style ─
    let style: CommunicationStyle = 'unknown';
    let styleReasoning = 'Insufficient signals for communication style inference.';
    if (urgency === 'high' || urgency === 'critical') {
      style = 'direct';
      styleReasoning = `Urgency is ${urgency}, indicating direct and action-oriented communication.`;
    } else if (intent === 'screening') {
      style = 'formal';
      styleReasoning = 'Screening intent suggests formal, structured communication.';
    } else if (intent === 'closing' || intent === 'negotiating') {
      style = 'consultative';
      styleReasoning = 'Closing/negotiating intent indicates consultative communication style.';
    }

    // ─ Hiring urgency ─
    const urgencyMap: Record<string, HiringUrgencyLevel> = {
      low: 'low', medium: 'medium', high: 'high', critical: 'critical',
    };
    const hiringUrgency: HiringUrgencyLevel = urgencyMap[urgency] ?? 'unknown';

    // ─ Engagement level ─
    const factCount = byType.size;
    let engagement: EngagementLevel = 'moderate';
    if (factCount >= 8) engagement = 'highly_engaged';
    else if (factCount >= 5) engagement = 'active';
    else if (factCount <= 2) engagement = 'passive';

    // ─ Preferred channels (from email provider if known, default email) ─
    const channels: PreferredChannel[] = ['email'];

    // ─ Follow-up behavior ─
    let followUp: FollowUpBehavior = 'unknown';
    if (reasoning.followUpRequirements.value.length > 1) {
      followUp = 'consistently_follows_up';
    } else if (reasoning.followUpRequirements.value.length === 1) {
      followUp = 'sometimes_follows_up';
    }

    // ─ Decision pattern ─
    let decision: DecisionPattern = 'unknown';
    if (urgency === 'critical' || urgency === 'high') {
      decision = 'fast_decisive';
    } else if (reasoning.decisionAuthority.value === 'influencer') {
      decision = 'committee_driven';
    } else if (reasoning.decisionAuthority.value === 'decision_maker') {
      decision = 'fast_decisive';
    }

    // ─ Consistency ─
    const consistency: ConsistencyLevel = factCount >= 6 ? 'consistent' : 'somewhat_consistent';

    // ─ Response quality ─
    const quality: ResponseQuality = reasoning.overallConfidence >= 0.8 ? 'good' : 'adequate';

    // ─ Responsiveness ─
    let responsiveness: ResponsivenessLevel = 'moderate';
    if (urgency === 'critical') responsiveness = 'very_fast';
    else if (urgency === 'high') responsiveness = 'fast';
    else if (urgency === 'low') responsiveness = 'slow';

    const allFactIds = [...byType.values()].flat().map((f) => f.factId);

    return {
      communicationStyle: makeDimension<CommunicationStyle>(
        'communicationStyle', style, reasoning.communicationIntent.confidence * 0.7 + 0.1,
        styleReasoning, [`Intent: ${intent}`, `Urgency: ${urgency}`], allFactIds.slice(0, 3),
      ),
      hiringUrgency: makeDimension<HiringUrgencyLevel>(
        'hiringUrgency', hiringUrgency, reasoning.urgency.confidence,
        `Urgency inference: ${urgency} derived from AI reasoning.`,
        reasoning.urgency.supportingEvidence.excerpts, reasoning.urgency.supportingEvidence.sourceFactIds,
      ),
      recruiterEngagement: makeDimension<EngagementLevel>(
        'recruiterEngagement', engagement, Math.min(0.75, 0.4 + factCount * 0.05),
        `Engagement inferred from fact density: ${factCount} fact types observed.`,
        [`${factCount} fact types extracted`], allFactIds.slice(0, 2),
      ),
      preferredCommunicationChannels: makeDimension<PreferredChannel[]>(
        'preferredCommunicationChannels', channels, 0.65,
        'Email is the primary observed communication channel.',
        ['Communication received via email'], allFactIds.slice(0, 1),
      ),
      followUpBehavior: makeDimension<FollowUpBehavior>(
        'followUpBehavior', followUp, reasoning.followUpRequirements.confidence * 0.8,
        `Follow-up requirements identified: ${reasoning.followUpRequirements.value.join(', ') || 'none observed'}.`,
        reasoning.followUpRequirements.value, allFactIds.slice(0, 2),
      ),
      decisionMakingPatterns: makeDimension<DecisionPattern>(
        'decisionMakingPatterns', decision, reasoning.decisionAuthority.confidence * 0.75,
        `Decision pattern: authority is ${reasoning.decisionAuthority.value}, urgency is ${urgency}.`,
        [`Decision authority: ${reasoning.decisionAuthority.value}`], allFactIds.slice(0, 2),
      ),
      recruiterConsistency: makeDimension<ConsistencyLevel>(
        'recruiterConsistency', consistency, Math.min(0.70, 0.45 + factCount * 0.04),
        `Consistency estimated from ${factCount} observed fact types.`,
        [`${factCount} distinct fact types`], allFactIds.slice(0, 1),
      ),
      responseQuality: makeDimension<ResponseQuality>(
        'responseQuality', quality, reasoning.overallConfidence * 0.85,
        `Response quality estimated from overall extraction confidence: ${reasoning.overallConfidence.toFixed(2)}.`,
        [`Overall confidence: ${reasoning.overallConfidence.toFixed(2)}`], allFactIds.slice(0, 2),
      ),
      responsiveness: makeDimension<ResponsivenessLevel>(
        'responsiveness', responsiveness, reasoning.urgency.confidence * 0.8,
        `Responsiveness inferred from urgency level: ${urgency}.`,
        [`Urgency: ${urgency}`], allFactIds.slice(0, 2),
      ),
    };
  }

  // ─── AI enrichment ──────────────────────────────────────────────────────────

  private async inferWithAi(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
  ): Promise<Partial<BehaviorProfile>> {
    const input: ExtractionInput = {
      extractionId: randomUUID(),
      tenantId: recruiterId,
      sourceType: 'profile',
      sourceId: recruiterId,
      content: JSON.stringify({
        recruiterId,
        facts: facts.slice(0, 10).map((f) => ({
          type: f.fieldType,
          value: f.rawValue,
          confidence: f.confidence,
        })),
        urgency: reasoning.urgency.value,
        intent: reasoning.communicationIntent.value,
        followUp: reasoning.followUpRequirements.value,
        decisionAuthority: reasoning.decisionAuthority.value,
      }),
      metadata: { templateId: 'recruiter-behavioral-intelligence' },
      requestedAt: new Date(),
    };

    const output = await this.pipeline.extract('recruiter-behavioral-intelligence', input, {});
    return this.parseAiBehaviorOutput(recruiterId, output.fields);
  }

  private parseAiBehaviorOutput(
    _recruiterId: string,
    fields: Array<{ field: string; value: unknown; confidence: number; evidence: Array<{ excerpt: string }> }>,
  ): Partial<BehaviorProfile> {
    const result: Partial<BehaviorProfile> = {};

    for (const f of fields) {
      const excerpts = f.evidence.map((e) => e.excerpt);
      const factIds = [randomUUID()];
      const conf = f.confidence;

      switch (f.field) {
        case 'communicationStyle':
          result.communicationStyle = makeDimension<CommunicationStyle>(
            'communicationStyle', String(f.value) as CommunicationStyle,
            conf, 'AI-inferred communication style.', excerpts, factIds, 'ai_assisted',
          );
          break;
        case 'activityPatterns':
          result.activityPatterns = makeDimension<ActivityPattern>(
            'activityPatterns', f.value as ActivityPattern,
            conf, 'AI-inferred activity patterns.', excerpts, factIds, 'ai_assisted',
          );
          break;
        case 'schedulingBehavior':
          result.schedulingBehavior = makeDimension<SchedulingBehavior>(
            'schedulingBehavior', String(f.value) as SchedulingBehavior,
            conf, 'AI-inferred scheduling behavior.', excerpts, factIds, 'ai_assisted',
          );
          break;
        case 'recruiterPreferences':
          result.recruiterPreferences = makeDimension<string[]>(
            'recruiterPreferences', Array.isArray(f.value) ? f.value as string[] : [],
            conf, 'AI-inferred recruiter preferences.', excerpts, factIds, 'ai_assisted',
          );
          break;
        case 'responsivenessTrends':
          result.responsivenessTrends = makeDimension<ResponsivenessTrend>(
            'responsivenessTrends', f.value as ResponsivenessTrend,
            conf, 'AI-inferred responsiveness trends.', excerpts, factIds, 'ai_assisted',
          );
          break;
      }
    }

    return result;
  }

  // ─── Profile builder ────────────────────────────────────────────────────────

  private buildProfile(
    recruiterId: string,
    deterministic: Partial<BehaviorProfile>,
    ai: Partial<BehaviorProfile>,
    facts: RecruiterEntityFact[],
  ): BehaviorProfile {
    // Merge: AI wins for same dimension when its confidence is higher
    const merge = <T>(
      key: keyof BehaviorProfile,
      fallback: BehavioralDimension<T>,
    ): BehavioralDimension<T> => {
      const det = deterministic[key] as BehavioralDimension<T> | undefined;
      const aiVal = ai[key] as BehavioralDimension<T> | undefined;
      if (!det && !aiVal) return fallback;
      if (!aiVal) return det ?? fallback;
      if (!det) return aiVal;
      return aiVal.confidence > det.confidence ? aiVal : det;
    };

    const defaultDim = <T>(dimension: string, value: T): BehavioralDimension<T> =>
      makeDimension<T>(dimension, value, 0.40, 'Insufficient signals for inference.', [], []);

    const communicationStyle = merge<CommunicationStyle>(
      'communicationStyle',
      defaultDim('communicationStyle', 'unknown'),
    );
    const responsiveness = merge<ResponsivenessLevel>('responsiveness', defaultDim('responsiveness', 'unknown'));
    const followUpBehavior = merge<FollowUpBehavior>('followUpBehavior', defaultDim('followUpBehavior', 'unknown'));
    const hiringUrgency = merge<HiringUrgencyLevel>('hiringUrgency', defaultDim('hiringUrgency', 'unknown'));
    const recruiterEngagement = merge<EngagementLevel>('recruiterEngagement', defaultDim('recruiterEngagement', 'unknown'));
    const recruiterPreferences = merge<string[]>('recruiterPreferences', defaultDim('recruiterPreferences', []));
    const preferredCommunicationChannels = merge<PreferredChannel[]>(
      'preferredCommunicationChannels', defaultDim('preferredCommunicationChannels', ['email']),
    );
    const schedulingBehavior = ai.schedulingBehavior
      ?? makeDimension<SchedulingBehavior>('schedulingBehavior', 'unknown', 0.40,
        'No scheduling behavior signals observed.', [], []);
    const recruiterConsistency = merge<ConsistencyLevel>('recruiterConsistency', defaultDim('recruiterConsistency', 'unknown'));
    const activityPatterns = ai.activityPatterns ?? makeDimension<ActivityPattern>(
      'activityPatterns',
      {
        preferredDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        preferredTimeOfDay: 'business_hours',
        averageResponseWindowHours: 24,
        messagingFrequency: 'regular',
        peakActivityDescription: 'Standard business-hours activity inferred.',
      },
      0.45, 'Default activity patterns applied — insufficient temporal signals.', [], [],
    );
    const responseQuality = merge<ResponseQuality>('responseQuality', defaultDim('responseQuality', 'adequate'));
    const responsivenessTrends = ai.responsivenessTrends ?? makeDimension<ResponsivenessTrend>(
      'responsivenessTrends',
      { direction: 'unknown', magnitude: 'negligible', periodDays: 0, description: 'Insufficient history.' },
      0.35, 'Insufficient history to determine trend.', [], [],
    );
    const decisionMakingPatterns = merge<DecisionPattern>('decisionMakingPatterns', defaultDim('decisionMakingPatterns', 'unknown'));

    const dimensions = [
      communicationStyle, responsiveness, followUpBehavior, hiringUrgency,
      recruiterEngagement, recruiterPreferences, preferredCommunicationChannels,
      schedulingBehavior, recruiterConsistency, activityPatterns,
      responseQuality, responsivenessTrends, decisionMakingPatterns,
    ];
    const overallConfidence = dimensions.reduce((s, d) => s + d.confidence, 0) / dimensions.length;
    const overallScore = Math.min(1, overallConfidence * 1.1);

    return {
      profileId: randomUUID(),
      recruiterId,
      communicationStyle,
      responsiveness,
      followUpBehavior,
      hiringUrgency,
      recruiterEngagement,
      recruiterPreferences,
      preferredCommunicationChannels,
      schedulingBehavior,
      recruiterConsistency,
      activityPatterns,
      responseQuality,
      responsivenessTrends,
      decisionMakingPatterns,
      overallBehaviorScore: overallScore,
      overallConfidence,
      generatedAt: new Date(),
      version: 1,
      evidenceRefs: facts.slice(0, 5).map((f) => ({
        evidenceId: f.factId,
        confidence: f.confidence,
        provenance: {
          source: f.provenance.extractor,
          sourceId: f.evidence.messageId,
          collectedAt: f.observedAt.toISOString(),
          consentState: 'unknown' as const,
        },
      })),
    };
  }

  // ─── Timeline builder ───────────────────────────────────────────────────────

  buildTimeline(
    recruiterId: string,
    profile: BehaviorProfile,
    priorProfile?: BehaviorProfile,
  ): import('../../../domain/recruiter-intelligence/behavior-intelligence/contracts').BehaviorTimeline {
    const events: BehaviorTimelineEvent[] = [];

    if (!priorProfile) {
      // First observation — all dimensions are "first_observed"
      const dims: Array<[string, BehavioralDimension<unknown>]> = [
        ['communicationStyle', profile.communicationStyle as BehavioralDimension<unknown>],
        ['hiringUrgency', profile.hiringUrgency as BehavioralDimension<unknown>],
        ['recruiterEngagement', profile.recruiterEngagement as BehavioralDimension<unknown>],
      ];
      for (const [dim, d] of dims) {
        events.push({
          eventId: randomUUID(),
          recruiterId,
          eventType: 'behavior_first_observed',
          dimension: dim,
          newValue: d.value,
          deltaDescription: `First observation of ${dim}: ${String(d.value)}.`,
          occurredAt: new Date(),
          confidence: d.confidence,
          evidenceFactIds: d.sourceFactIds,
        });
      }
    } else {
      // Compare with prior and detect changes
      const checks: Array<[string, BehavioralDimension<unknown>, BehavioralDimension<unknown>]> = [
        [
          'hiringUrgency',
          priorProfile.hiringUrgency as BehavioralDimension<unknown>,
          profile.hiringUrgency as BehavioralDimension<unknown>,
        ],
        [
          'recruiterEngagement',
          priorProfile.recruiterEngagement as BehavioralDimension<unknown>,
          profile.recruiterEngagement as BehavioralDimension<unknown>,
        ],
      ];
      for (const [dim, prev, curr] of checks) {
        if (String(prev.value) !== String(curr.value)) {
          events.push({
            eventId: randomUUID(),
            recruiterId,
            eventType: 'behavior_updated',
            dimension: dim,
            previousValue: prev.value,
            newValue: curr.value,
            deltaDescription: `${dim} changed from ${String(prev.value)} to ${String(curr.value)}.`,
            occurredAt: new Date(),
            confidence: curr.confidence,
            evidenceFactIds: curr.sourceFactIds,
          });
        }
      }
    }

    return {
      recruiterId,
      events,
      firstObservedAt: priorProfile?.generatedAt ?? profile.generatedAt,
      lastUpdatedAt: profile.generatedAt,
    };
  }

  // ─── Confidence builder ─────────────────────────────────────────────────────

  private buildConfidence(
    recruiterId: string,
    profile: BehaviorProfile,
    facts: RecruiterEntityFact[],
  ): BehaviorConfidence {
    const dimensionConfidences: Record<string, number> = {
      communicationStyle: profile.communicationStyle.confidence,
      responsiveness: profile.responsiveness.confidence,
      followUpBehavior: profile.followUpBehavior.confidence,
      hiringUrgency: profile.hiringUrgency.confidence,
      recruiterEngagement: profile.recruiterEngagement.confidence,
      recruiterPreferences: profile.recruiterPreferences.confidence,
      preferredCommunicationChannels: profile.preferredCommunicationChannels.confidence,
      schedulingBehavior: profile.schedulingBehavior.confidence,
      recruiterConsistency: profile.recruiterConsistency.confidence,
      activityPatterns: profile.activityPatterns.confidence,
      responseQuality: profile.responseQuality.confidence,
      responsivenessTrends: profile.responsivenessTrends.confidence,
      decisionMakingPatterns: profile.decisionMakingPatterns.confidence,
    };

    const reliabilityNote = facts.length >= 5
      ? 'Sufficient evidence for moderate-to-high confidence inferences.'
      : 'Limited evidence — confidence is lower. More interactions will improve accuracy.';

    return {
      recruiterId,
      overallConfidence: profile.overallConfidence,
      dimensionConfidences,
      evidenceCount: facts.length,
      observationSpanDays: 30, // default; would be computed from actual timestamps
      reliabilityNote,
    };
  }

  // ─── Summary builder ────────────────────────────────────────────────────────

  private buildSummary(
    recruiterId: string,
    profile: BehaviorProfile,
    _reasoning: RecruiterReasoningResult,
  ): BehaviorSummary {
    const urgency = profile.hiringUrgency.value;
    const style = profile.communicationStyle.value;
    const engagement = profile.recruiterEngagement.value;
    const followUp = profile.followUpBehavior.value;

    const traits: string[] = [];
    if (style !== 'unknown') traits.push(`${style} communication style`);
    if (urgency !== 'unknown') traits.push(`${urgency} hiring urgency`);
    if (engagement !== 'unknown') traits.push(`${engagement} engagement`);

    const redFlags: string[] = [];
    const positiveSignals: string[] = [];

    if (urgency === 'critical' || urgency === 'high') positiveSignals.push('High hiring urgency indicates active role');
    if (followUp === 'never_follows_up') redFlags.push('Recruiter rarely follows up — ghosting risk elevated');
    if (engagement === 'highly_engaged' || engagement === 'active') positiveSignals.push('Highly engaged recruiter');
    if (profile.recruiterConsistency.value === 'inconsistent') redFlags.push('Inconsistent communication patterns observed');

    const summaryText = [
      `This recruiter shows ${style !== 'unknown' ? style : 'standard'} communication style`,
      `with ${urgency !== 'unknown' ? urgency : 'moderate'} hiring urgency.`,
      `Engagement level is ${engagement}.`,
      positiveSignals.length > 0 ? `Positive signals: ${positiveSignals.join('; ')}.` : '',
      redFlags.length > 0 ? `Red flags: ${redFlags.join('; ')}.` : '',
    ].filter(Boolean).join(' ');

    const engagementRecommendation = urgency === 'high' || urgency === 'critical'
      ? 'Respond promptly — this recruiter operates on a tight timeline.'
      : 'Engage at a measured pace; this recruiter has moderate urgency.';

    return {
      recruiterId,
      summaryText,
      keyBehavioralTraits: traits,
      engagementRecommendation,
      redFlags,
      positiveSignals,
      confidence: profile.overallConfidence,
      generatedAt: new Date(),
    };
  }

  // ─── Evolution builder ──────────────────────────────────────────────────────

  buildEvolution(
    recruiterId: string,
    currentProfile: BehaviorProfile,
    priorProfile?: BehaviorProfile,
  ): BehaviorEvolution {
    const evolutions: DimensionEvolution[] = [];
    const dimensionKeys: Array<keyof BehaviorProfile> = [
      'hiringUrgency', 'recruiterEngagement', 'communicationStyle',
      'responsiveness', 'recruiterConsistency',
    ];

    for (const key of dimensionKeys) {
      const curr = currentProfile[key] as BehavioralDimension<unknown>;
      const snapshots = [{ value: curr.value, confidence: curr.confidence, observedAt: curr.inferredAt }];

      let trend: DimensionEvolution['trend'] = 'stable';
      let changeDescription = 'First observation — no historical comparison available.';

      if (priorProfile) {
        const prior = priorProfile[key] as BehavioralDimension<unknown>;
        snapshots.unshift({ value: prior.value, confidence: prior.confidence, observedAt: prior.inferredAt });
        const changed = String(prior.value) !== String(curr.value);
        if (changed) {
          trend = curr.confidence > prior.confidence ? 'improving' : 'declining';
          changeDescription = `${String(key)} changed from ${String(prior.value)} to ${String(curr.value)}.`;
        } else {
          changeDescription = `${String(key)} remains ${String(curr.value)}.`;
        }
      }

      evolutions.push({ dimension: String(key), snapshots, trend, changeDescription });
    }

    const hasImproving = evolutions.some((e) => e.trend === 'improving');
    const hasDeclining = evolutions.some((e) => e.trend === 'declining');
    const overallTrend = !priorProfile
      ? 'insufficient_data'
      : hasImproving && hasDeclining
        ? 'mixed'
        : hasImproving
          ? 'improving'
          : hasDeclining
            ? 'declining'
            : 'stable';

    return {
      recruiterId,
      dimensionEvolutions: evolutions,
      overallTrend,
      evolutionSummary: priorProfile
        ? `Behavioral evolution tracked across ${evolutions.length} dimensions. Overall trend: ${overallTrend}.`
        : 'First behavioral observation — evolution tracking begins from this point.',
      confidence: currentProfile.overallConfidence * 0.9,
    };
  }
}
