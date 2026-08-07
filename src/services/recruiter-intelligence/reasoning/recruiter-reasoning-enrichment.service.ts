import { randomUUID } from 'crypto';
import type { ExtractionInput, ExtractionOutput } from '../ai/types';
import { ExtractionPipeline } from '../ai/extraction-pipeline';
import type { RecruiterEntityFact } from '../extraction/recruiter-entity-extraction.service';

// ─── Inference types ──────────────────────────────────────────────────────────

export type SeniorityLevel = 'junior' | 'mid' | 'senior' | 'lead' | 'executive';
export type SpecializationKind =
  | 'engineering' | 'product' | 'design' | 'sales' | 'finance'
  | 'operations' | 'legal' | 'marketing' | 'general';
export type DecisionAuthority = 'initiator' | 'influencer' | 'decision_maker' | 'unknown';
export type CommunicationIntent =
  | 'informational' | 'screening' | 'scheduling' | 'negotiating' | 'closing' | 'unknown';
export type UrgencyLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ReasoningEvidence {
  sourceFactIds: string[];
  excerpts: string[];
}

export interface InferredAttribute<T = unknown> {
  inferenceId: string;
  recruiterId: string;
  attribute: string;
  value: T;
  reasoning: string;
  confidence: number;
  confidenceBand: 'low' | 'medium' | 'high' | 'critical';
  supportingEvidence: ReasoningEvidence;
  inferredAt: Date;
  method: 'deterministic' | 'ai_assisted';
  provenance: InferenceProvenance;
}

export interface InferenceProvenance {
  inferrer: string;
  templateId: string;
  templateVersion: string;
  provider: string;
  model: string;
  inferredAt: Date;
}

export interface RecruiterReasoningResult {
  reasoningId: string;
  recruiterId: string;
  inferences: InferredAttribute[];
  seniority: InferredAttribute<SeniorityLevel>;
  specialization: InferredAttribute<SpecializationKind>;
  hiringFocus: InferredAttribute<string[]>;
  technicalDomains: InferredAttribute<string[]>;
  businessDomains: InferredAttribute<string[]>;
  geographicResponsibility: InferredAttribute<string[]>;
  decisionAuthority: InferredAttribute<DecisionAuthority>;
  likelyHiringManagerRelationships: InferredAttribute<string[]>;
  candidateOwnership: InferredAttribute<string[]>;
  communicationIntent: InferredAttribute<CommunicationIntent>;
  urgency: InferredAttribute<UrgencyLevel>;
  followUpRequirements: InferredAttribute<string[]>;
  overallConfidence: number;
  completedAt: Date;
}

/**
 * RecruiterReasoningEnrichmentService —  implementation.
 *
 * Infers recruiter attributes beyond what is explicitly stated:
 *   seniority, specialization, hiring focus, technical/business domains,
 *   geographic responsibility, decision authority, hiring manager relationships,
 *   candidate ownership, communication intent, urgency, follow-up requirements.
 *
 * Architecture:
 *   1. Deterministic inference from known facts (fast, rule-based)
 *   2. AI reasoning enriches with contextual, multi-signal inferences
 *   3. Every inference carries: reasoning, confidence, supportingEvidence, explainability
 *   4. No inference can be emitted without referencing at least one evidence source
 */
export class RecruiterReasoningEnrichmentService {
  constructor(private readonly pipeline: ExtractionPipeline) {}

  async infer(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    options: { communicationSummary?: string; messageCount?: number } = {},
  ): Promise<RecruiterReasoningResult> {
    const reasoningId = randomUUID();

    // Step 1: deterministic inferences
    const deterministicInferences = this.inferDeterministic(recruiterId, facts);

    // Step 2: AI-assisted inferences
    let aiInferences: InferredAttribute[] = [];
    try {
      aiInferences = await this.inferWithAi(recruiterId, facts, options);
    } catch {
      // AI failure is non-fatal; deterministic inferences still returned
    }

    // Step 3: merge (AI overrides deterministic for the same attribute when higher confidence)
    const merged = this.mergeInferences(deterministicInferences, aiInferences);

    // Step 4: project into typed result
    return this.buildResult(reasoningId, recruiterId, merged);
  }

  // ─── Deterministic inference ────────────────────────────────────────────────

  inferDeterministic(
    recruiterId: string,
    facts: RecruiterEntityFact[],
  ): InferredAttribute[] {
    const inferences: InferredAttribute[] = [];
    const now = new Date();

    const factsByType = this.groupByFieldType(facts);
    const titleFacts = factsByType.get('recruiter_title') ?? [];
    const techFacts = factsByType.get('technology') ?? [];
    const skillFacts = factsByType.get('skill') ?? [];
    const stageFacts = factsByType.get('interview_stage') ?? [];
    const compFacts = factsByType.get('compensation_mention') ?? [];
    const priorityFacts = factsByType.get('hiring_priority') ?? [];
    const locationFacts = factsByType.get('hiring_location') ?? [];
    const domainFacts = factsByType.get('hiring_domain') ?? [];
    const respFacts = factsByType.get('recruiter_responsibility') ?? [];

    const add = <T>(
      attribute: string,
      value: T,
      reasoning: string,
      confidence: number,
      sourceFacts: RecruiterEntityFact[],
    ): void => {
      inferences.push({
        inferenceId: randomUUID(),
        recruiterId,
        attribute,
        value,
        reasoning,
        confidence: Math.max(0, Math.min(1, confidence)),
        confidenceBand: this.toConfidenceBand(confidence),
        supportingEvidence: {
          sourceFactIds: sourceFacts.map((f) => f.factId),
          excerpts: sourceFacts.map((f) => f.rawValue).slice(0, 5),
        },
        inferredAt: now,
        method: 'deterministic',
        provenance: {
          inferrer: 'deterministic-reasoning-v1',
          templateId: 'deterministic',
          templateVersion: '1.0.0',
          provider: 'none',
          model: 'rule-engine',
          inferredAt: now,
        },
      });
    };

    // Seniority from title
    const seniorityResult = this.inferSeniorityFromTitles(titleFacts);
    if (seniorityResult) {
      add('seniority', seniorityResult.value, seniorityResult.reasoning, seniorityResult.confidence, titleFacts);
    }

    // Specialization from tech + domain signals
    const specializationResult = this.inferSpecialization(techFacts, domainFacts, skillFacts);
    if (specializationResult) {
      add('specialization', specializationResult.value, specializationResult.reasoning, specializationResult.confidence, [...techFacts, ...domainFacts]);
    }

    // Hiring focus from domain + title
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const hiringFocusDomains = domainFacts.map((f) => String((f.structuredValue)['domain'] ?? f.rawValue));
    if (hiringFocusDomains.length > 0) {
      add('hiringFocus', hiringFocusDomains, `Derived from ${hiringFocusDomains.length} domain signals in communication`, 0.75, domainFacts);
    }

    // Technical domains
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const techNames = techFacts.map((f) => String((f.structuredValue)['name'] ?? f.rawValue));
    if (techNames.length > 0) {
      add('technicalDomains', techNames, `Extracted ${techNames.length} technology signals`, 0.82, techFacts);
    }

    // Geographic responsibility from location facts
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const locations = locationFacts.map((f) => String((f.structuredValue)['location'] ?? f.rawValue));
    if (locations.length > 0) {
      add('geographicResponsibility', locations, `Hiring locations mentioned in communication`, 0.70, locationFacts);
    }

    // Decision authority from compensation mention + title seniority
    const hasComp = compFacts.length > 0;
    const titleText = titleFacts.map((f) => f.rawValue.toLowerCase()).join(' ');
    const isLead = /\b(senior|lead|principal|head|director|vp)\b/.test(titleText);
    if (hasComp && isLead) {
      add('decisionAuthority', 'decision_maker', 'Discusses compensation independently and holds a senior title', 0.78, [...compFacts, ...titleFacts]);
    } else if (hasComp) {
      add('decisionAuthority', 'influencer', 'Mentions compensation but seniority is unclear', 0.62, compFacts);
    }

    // Urgency from priority + stage signals
    const hasPriority = priorityFacts.some((f) => f.structuredValue['priority'] === 'high');
    const isLateStage = stageFacts.some((f) => {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      const stage = String((f.structuredValue)['stage'] ?? '');
      return ['final_round', 'offer', 'onsite'].includes(stage);
    });
    if (hasPriority || isLateStage) {
      add('urgency', 'high', 'High priority hiring signal or late-stage interview detected', 0.80, [...priorityFacts, ...stageFacts]);
    } else if (stageFacts.length > 0) {
      add('urgency', 'medium', 'Active interview stage detected', 0.65, stageFacts);
    } else {
      add('urgency', 'low', 'No strong urgency signals detected', 0.55, facts.slice(0, 2));
    }

    // Communication intent from stage
    const stageValue = stageFacts[0]?.structuredValue['stage'] as string | undefined;
    const intent = this.inferIntentFromStage(stageValue);
    if (intent) {
      add('communicationIntent', intent.value, intent.reasoning, intent.confidence, stageFacts);
    }

    // Follow-up requirements from responsibility + stage
    const followUps: string[] = [];
    if (stageFacts.length > 0) followUps.push('Confirm interview availability');
    if (compFacts.length > 0) followUps.push('Review and respond to compensation discussion');
    if (respFacts.length > 0) followUps.push('Acknowledge recruiter responsibilities');
    if (followUps.length > 0) {
      add('followUpRequirements', followUps, `Derived ${followUps.length} follow-up actions from communication signals`, 0.72, [...stageFacts, ...compFacts, ...respFacts]);
    }

    return inferences;
  }

  // ─── AI inference ────────────────────────────────────────────────────────────

  private async inferWithAi(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    options: { communicationSummary?: string; messageCount?: number },
  ): Promise<InferredAttribute[]> {
    const knownFacts = facts
      .map((f) => `[${f.fieldType}] ${f.rawValue} (confidence: ${f.confidence.toFixed(2)})`)
      .join('\n');

    const input: ExtractionInput = {
      extractionId: randomUUID(),
      tenantId: recruiterId,
      sourceType: 'profile',
      sourceId: recruiterId,
      content: knownFacts,
      metadata: { recruiterId, factCount: facts.length },
      requestedAt: new Date(),
    };

    const variables: Record<string, string> = {
      recruiterId,
      knownFacts,
      messageCount: String(options.messageCount ?? facts.length),
      communicationSummary: options.communicationSummary ?? knownFacts.slice(0, 1000),
    };

    const output: ExtractionOutput = await this.pipeline.extract(
      'recruiter-reasoning-enrichment',
      input,
      variables,
    );

    return this.normalizeAiInferences(recruiterId, output);
  }

  private normalizeAiInferences(
    recruiterId: string,
    output: ExtractionOutput,
  ): InferredAttribute[] {
    return output.fields.map((f) => ({
      inferenceId: randomUUID(),
      recruiterId,
      attribute: f.field,
      value: f.value,
      reasoning: f.reasoning ??
        String(
          // eslint-disable-next-line @typescript-eslint/no-base-to-string
          (f.value as Record<string, unknown> | null)?.['reasoning'] ??
            `AI inferred from ${output.fields.length} signals`,
        ),
      confidence: f.confidence,
      confidenceBand: f.confidenceBand,
      supportingEvidence: {
        sourceFactIds: [],
        excerpts: f.evidence.map((e) => e.excerpt),
      },
      inferredAt: output.completedAt,
      method: 'ai_assisted' as const,
      provenance: {
        inferrer: 'ai-reasoning-enrichment-v1',
        templateId: output.templateId,
        templateVersion: output.templateVersion,
        provider: output.provider,
        model: output.model,
        inferredAt: output.completedAt,
      },
    }));
  }

  // ─── Merge ───────────────────────────────────────────────────────────────────

  private mergeInferences(
    deterministic: InferredAttribute[],
    ai: InferredAttribute[],
  ): InferredAttribute[] {
    const byAttr = new Map<string, InferredAttribute>();

    for (const inf of deterministic) {
      byAttr.set(inf.attribute, inf);
    }
    for (const inf of ai) {
      const existing = byAttr.get(inf.attribute);
      if (!existing || inf.confidence >= existing.confidence) {
        byAttr.set(inf.attribute, {
          ...inf,
          // Prefer deterministic reasoning (grounded in observed signals) while
          // retaining the AI inference's confidence and value.
          reasoning: existing?.reasoning ?? inf.reasoning,
          // Merge evidence from both sources
          supportingEvidence: {
            sourceFactIds: [
              ...(existing?.supportingEvidence.sourceFactIds ?? []),
              ...inf.supportingEvidence.sourceFactIds,
            ],
            excerpts: [
              ...(existing?.supportingEvidence.excerpts ?? []),
              ...inf.supportingEvidence.excerpts,
            ].slice(0, 8),
          },
        });
      }
    }

    return [...byAttr.values()];
  }

  // ─── Result builder ───────────────────────────────────────────────────────────

  private buildResult(
    reasoningId: string,
    recruiterId: string,
    inferences: InferredAttribute[],
  ): RecruiterReasoningResult {
    const byAttr = new Map(inferences.map((i) => [i.attribute, i]));
    const now = new Date();

    const getOrDefault = <T>(
      attribute: string,
      defaultValue: T,
      defaultReasoning: string,
    ): InferredAttribute<T> => {
      const existing = byAttr.get(attribute) as InferredAttribute<T> | undefined;
      if (existing) return existing;
      return {
        inferenceId: randomUUID(),
        recruiterId,
        attribute,
        value: defaultValue,
        reasoning: defaultReasoning,
        confidence: 0.40,
        confidenceBand: 'low',
        supportingEvidence: { sourceFactIds: [], excerpts: [] },
        inferredAt: now,
        method: 'deterministic',
        provenance: {
          inferrer: 'default-fallback',
          templateId: 'none',
          templateVersion: '1.0.0',
          provider: 'none',
          model: 'none',
          inferredAt: now,
        },
      };
    };

    const overallConfidence =
      inferences.length > 0
        ? inferences.reduce((s, i) => s + i.confidence, 0) / inferences.length
        : 0;

    return {
      reasoningId,
      recruiterId,
      inferences,
      seniority: getOrDefault<SeniorityLevel>('seniority', 'mid', 'No title signals found; defaulting to mid'),
      specialization: getOrDefault<SpecializationKind>('specialization', 'general', 'Insufficient signals for specialization'),
      hiringFocus: getOrDefault<string[]>('hiringFocus', [], 'No domain signals found'),
      technicalDomains: getOrDefault<string[]>('technicalDomains', [], 'No technology signals found'),
      businessDomains: getOrDefault<string[]>('businessDomains', [], 'No business domain signals found'),
      geographicResponsibility: getOrDefault<string[]>('geographicResponsibility', [], 'No location signals found'),
      decisionAuthority: getOrDefault<DecisionAuthority>('decisionAuthority', 'unknown', 'Insufficient signals for decision authority'),
      likelyHiringManagerRelationships: getOrDefault<string[]>('likelyHiringManagerRelationships', [], 'No relationship signals found'),
      candidateOwnership: getOrDefault<string[]>('candidateOwnership', [], 'No ownership signals found'),
      communicationIntent: getOrDefault<CommunicationIntent>('communicationIntent', 'unknown', 'Insufficient signals for communication intent'),
      urgency: getOrDefault<UrgencyLevel>('urgency', 'low', 'No urgency signals found'),
      followUpRequirements: getOrDefault<string[]>('followUpRequirements', [], 'No explicit follow-up requirements'),
      overallConfidence: Number(overallConfidence.toFixed(4)),
      completedAt: now,
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private inferSeniorityFromTitles(
    titleFacts: RecruiterEntityFact[],
  ): { value: SeniorityLevel; reasoning: string; confidence: number } | null {
    if (titleFacts.length === 0) return null;
    const text = titleFacts.map((f) => f.rawValue).join(' ').toLowerCase();

    if (/\b(vp|vice president|chief|cto|ceo|cpo|executive)\b/.test(text)) {
      return { value: 'executive', reasoning: 'Executive-level title detected', confidence: 0.92 };
    }
    if (/\b(director|head of|principal)\b/.test(text)) {
      return { value: 'lead', reasoning: 'Director or head-of title detected', confidence: 0.88 };
    }
    if (/\b(senior|sr\.?|lead|staff)\b/.test(text)) {
      return { value: 'senior', reasoning: 'Senior/Lead qualifier found in title', confidence: 0.85 };
    }
    if (/\b(junior|jr\.?|associate|entry)\b/.test(text)) {
      return { value: 'junior', reasoning: 'Junior/Associate qualifier found in title', confidence: 0.82 };
    }
    return { value: 'mid', reasoning: 'No seniority qualifier found; defaulting to mid', confidence: 0.60 };
  }

  private inferSpecialization(
    techFacts: RecruiterEntityFact[],
    domainFacts: RecruiterEntityFact[],
    skillFacts: RecruiterEntityFact[],
  ): { value: SpecializationKind; reasoning: string; confidence: number } | null {
    const allText = [
      ...techFacts,
      ...domainFacts,
      ...skillFacts,
    ].map((f) => f.rawValue.toLowerCase()).join(' ');

    if (techFacts.length >= 2 || /\b(engineer|backend|frontend|fullstack|devops|platform|infra)\b/.test(allText)) {
      return { value: 'engineering', reasoning: `${techFacts.length} technology signals indicate engineering focus`, confidence: 0.85 };
    }
    if (/\b(product|pm|product manager)\b/.test(allText)) {
      return { value: 'product', reasoning: 'Product management signals detected', confidence: 0.80 };
    }
    if (/\b(design|ux|ui|designer)\b/.test(allText)) {
      return { value: 'design', reasoning: 'Design signals detected', confidence: 0.78 };
    }
    if (/\b(sales|account|revenue|quota)\b/.test(allText)) {
      return { value: 'sales', reasoning: 'Sales signals detected', confidence: 0.78 };
    }
    if (/\b(finance|accounting|controller|cfo)\b/.test(allText)) {
      return { value: 'finance', reasoning: 'Finance signals detected', confidence: 0.78 };
    }
    if (techFacts.length > 0) {
      return { value: 'engineering', reasoning: 'Single technology signal suggests engineering', confidence: 0.68 };
    }
    return null;
  }

  private inferIntentFromStage(
    stage: string | undefined,
  ): { value: CommunicationIntent; reasoning: string; confidence: number } | null {
    if (!stage) return null;
    const intentMap: Record<string, { value: CommunicationIntent; confidence: number }> = {
      phone_screen: { value: 'screening', confidence: 0.88 },
      recruiter_screen: { value: 'screening', confidence: 0.88 },
      technical_screen: { value: 'screening', confidence: 0.82 },
      technical_interview: { value: 'scheduling', confidence: 0.80 },
      onsite: { value: 'scheduling', confidence: 0.82 },
      interview_loop: { value: 'scheduling', confidence: 0.78 },
      final_round: { value: 'negotiating', confidence: 0.75 },
      offer: { value: 'closing', confidence: 0.90 },
      initial_screen: { value: 'screening', confidence: 0.80 },
    };
    const mapped = intentMap[stage];
    if (!mapped) return null;
    return { ...mapped, reasoning: `Stage "${stage}" maps to intent "${mapped.value}"` };
  }

  private groupByFieldType(
    facts: RecruiterEntityFact[],
  ): Map<string, RecruiterEntityFact[]> {
    const map = new Map<string, RecruiterEntityFact[]>();
    for (const fact of facts) {
      const bucket = map.get(fact.fieldType) ?? [];
      bucket.push(fact);
      map.set(fact.fieldType, bucket);
    }
    return map;
  }

  private toConfidenceBand(confidence: number): InferredAttribute['confidenceBand'] {
    if (confidence >= 0.90) return 'critical';
    if (confidence >= 0.72) return 'high';
    if (confidence >= 0.50) return 'medium';
    return 'low';
  }
}
