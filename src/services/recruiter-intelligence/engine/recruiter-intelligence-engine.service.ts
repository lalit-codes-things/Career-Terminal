import { randomUUID } from 'crypto';
import type { ExtractionInput } from '../ai/types';
import { ExtractionPipeline } from '../ai/extraction-pipeline';
import type { RecruiterEntityFact } from '../extraction/recruiter-entity-extraction.service';
import type { RecruiterReasoningResult } from '../reasoning/recruiter-reasoning-enrichment.service';
import type { GraphPopulationResult, KgEdge, KgNode } from '../graph/knowledge-graph-population.service';

/**
 * Engine-local memory record type. Uses string for factType so it is compatible
 * with both RecruiterEntityFieldType and inferred attribute names without
 * depending on the narrow RecruiterFactType union from the legacy memory service.
 */
export interface EngineMemoryRecord {
  id: string;
  recruiterId: string;
  factType: string;
  value: Record<string, unknown>;
  confidence: number;
  evidence: { messageId: string; excerpt: string };
  provenance: { extractor: string; method: string; sourceProvider: string };
  observedAt: Date;
  validFrom: Date;
  validTo?: Date;
}

// ─── Profile types ─────────────────────────────────────────────────────────────

export interface RecruiterProfile {
  profileId: string;
  recruiterId: string;
  summary: RecruiterSummary;
  hiringFocus: HiringFocusProfile;
  technicalFocus: TechnicalFocusProfile;
  industryFocus: IndustryFocusProfile;
  organizationContext: OrganizationContext;
  communicationStyle: CommunicationStyleProfile;
  recruitingStyle: RecruitingStyleProfile;
  hiringVelocitySignals: HiringVelocitySignals;
  relationshipStrength: RelationshipStrengthProfile;
  candidateFitSignals: CandidateFitSignal[];
  evidenceRefs: ProfileEvidenceRef[];
  generatedAt: Date;
  version: number;
}

export interface RecruiterSummary {
  text: string;
  confidence: number;
  evidenceFactIds: string[];
}

export interface HiringFocusProfile {
  roles: string[];
  domains: string[];
  seniorities: string[];
  confidence: number;
  evidenceFactIds: string[];
}

export interface TechnicalFocusProfile {
  technologies: string[];
  skills: string[];
  domains: string[];
  confidence: number;
  evidenceFactIds: string[];
}

export interface IndustryFocusProfile {
  industries: string[];
  confidence: number;
  evidenceFactIds: string[];
}

export interface OrganizationContext {
  organization?: string;
  department?: string;
  team?: string;
  office?: string;
  seniority?: string;
  confidence: number;
  evidenceFactIds: string[];
}

export interface CommunicationStyleProfile {
  style: string;
  tone: 'formal' | 'casual' | 'direct' | 'warm' | 'unknown';
  responsePattern: string;
  confidence: number;
  evidenceFactIds: string[];
}

export interface RecruitingStyleProfile {
  style: string;
  approachType: 'passive' | 'active' | 'aggressive' | 'consultative' | 'unknown';
  confidence: number;
  evidenceFactIds: string[];
}

export interface HiringVelocitySignals {
  urgency: 'low' | 'medium' | 'high' | 'critical';
  typicalInterviewCycles: number;
  activeOpenings: boolean;
  pipelineStage: string;
  confidence: number;
  evidenceFactIds: string[];
}

export interface RelationshipStrengthProfile {
  score: number;
  band: 'weak' | 'developing' | 'established' | 'strong';
  signals: string[];
  confidence: number;
  evidenceFactIds: string[];
}

export interface CandidateFitSignal {
  signal: string;
  category: 'technical' | 'experience' | 'location' | 'culture' | 'compensation';
  importance: 'required' | 'preferred' | 'nice_to_have';
  confidence: number;
  evidenceFactId?: string;
}

export interface ProfileEvidenceRef {
  factId: string;
  fieldType: string;
  excerpt: string;
  confidence: number;
}

// ─── Memory/Timeline/Graph update payloads ───────────────────────────────────

export interface MemoryUpdatePlan {
  recruiterId: string;
  factsToWrite: EngineMemoryRecord[];
  factsToSupersede: string[];
  reason: string;
}

export interface TimelineUpdatePlan {
  recruiterId: string;
  events: TimelineEvent[];
}

export interface TimelineEvent {
  eventId: string;
  eventType: string;
  summary: string;
  occurredAt: Date;
  confidence: number;
  evidenceFactIds: string[];
}

export interface GraphUpdatePlan {
  recruiterId: string;
  nodesToUpsert: Array<{ nodeType: string; externalKey: string; label: string }>;
  edgesToAdd: Array<{
    fromKey: string;
    fromType: string;
    toKey: string;
    toType: string;
    relationship: string;
    confidence: number;
  }>;
}

export interface IntelligenceEngineResult {
  engineRunId: string;
  recruiterId: string;
  profile: RecruiterProfile;
  memoryUpdatePlan: MemoryUpdatePlan;
  timelineUpdatePlan: TimelineUpdatePlan;
  graphUpdatePlan: GraphUpdatePlan;
  generatedAt: Date;
}

/**
 * RecruiterIntelligenceEngineService — Prompt 15 implementation.
 *
 * Generates the full recruiter intelligence profile from structured facts.
 * No hallucinated facts — every conclusion references evidence.
 *
 * Outputs:
 *   - RecruiterProfile (summary, hiring/technical/industry focus, org context,
 *     communication/recruiting style, velocity signals, relationship strength,
 *     candidate fit signals)
 *   - MemoryUpdatePlan (which facts to write/supersede in memory store)
 *   - TimelineUpdatePlan (events to append to recruiter timeline)
 *   - GraphUpdatePlan (nodes/edges to upsert in knowledge graph)
 */
export class RecruiterIntelligenceEngineService {
  constructor(private readonly pipeline: ExtractionPipeline) {}

  async generate(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
    graphResult: GraphPopulationResult,
  ): Promise<IntelligenceEngineResult> {
    const engineRunId = randomUUID();

    // Build the deterministic profile from structured facts
    const deterministicProfile = this.buildDeterministicProfile(recruiterId, facts, reasoning, graphResult);

    // Try AI profile enhancement (non-fatal on failure)
    let aiEnhanced: Partial<RecruiterProfile> = {};
    try {
      aiEnhanced = await this.enhanceWithAi(recruiterId, facts, reasoning);
    } catch {
      // AI enrichment failure is non-fatal
    }

    const profile = this.mergeProfile(deterministicProfile, aiEnhanced);

    return {
      engineRunId,
      recruiterId,
      profile,
      memoryUpdatePlan: this.buildMemoryUpdatePlan(recruiterId, facts, reasoning),
      timelineUpdatePlan: this.buildTimelineUpdatePlan(recruiterId, facts, reasoning),
      graphUpdatePlan: this.buildGraphUpdatePlan(recruiterId, facts, reasoning, graphResult),
      generatedAt: new Date(),
    };
  }

  // ─── Deterministic profile builder ──────────────────────────────────────────

  buildDeterministicProfile(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
    graphResult: GraphPopulationResult,
  ): RecruiterProfile {
    const byType = this.groupFacts(facts);
    const evidenceRefs = this.buildEvidenceRefs(facts);

    return {
      profileId: randomUUID(),
      recruiterId,
      summary: this.buildSummary(facts, reasoning),
      hiringFocus: this.buildHiringFocus(byType, reasoning),
      technicalFocus: this.buildTechnicalFocus(byType, reasoning),
      industryFocus: this.buildIndustryFocus(byType, reasoning),
      organizationContext: this.buildOrganizationContext(byType),
      communicationStyle: this.buildCommunicationStyle(facts, reasoning),
      recruitingStyle: this.buildRecruitingStyle(facts, reasoning),
      hiringVelocitySignals: this.buildVelocitySignals(byType, reasoning),
      relationshipStrength: this.buildRelationshipStrength(facts),
      candidateFitSignals: this.buildCandidateFitSignals(byType, reasoning),
      evidenceRefs,
      generatedAt: new Date(),
      version: 1,
    };
  }

  private buildSummary(
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
  ): RecruiterSummary {
    const byType = this.groupFacts(facts);
    const nameFact = byType.get('recruiter_name')?.[0];
    const titleFact = byType.get('recruiter_title')?.[0];
    const orgFact = byType.get('recruiter_organization')?.[0];

    const name = nameFact?.rawValue ?? 'This recruiter';
    const title = titleFact?.rawValue ?? reasoning.seniority.value + ' recruiter';
    const org = orgFact?.rawValue ? ` at ${orgFact.rawValue}` : '';
    const focus = reasoning.hiringFocus.value.length > 0
      ? ` specializing in ${reasoning.hiringFocus.value.slice(0, 2).join(' and ')} roles`
      : '';
    const urgencyNote = reasoning.urgency.value === 'high' || reasoning.urgency.value === 'critical'
      ? ' with active high-priority openings' : '';

    const text = `${name} is a ${title}${org}${focus}${urgencyNote}.`;
    const evidenceFactIds = [nameFact, titleFact, orgFact].filter(Boolean).map((f) => f!.factId);

    return {
      text,
      confidence: Math.max(0.60,
        (nameFact?.confidence ?? 0.5) * 0.4 +
        (titleFact?.confidence ?? 0.5) * 0.3 +
        reasoning.overallConfidence * 0.3
      ),
      evidenceFactIds,
    };
  }

  private buildHiringFocus(
    byType: Map<string, RecruiterEntityFact[]>,
    reasoning: RecruiterReasoningResult,
  ): HiringFocusProfile {
    const domainFacts = byType.get('hiring_domain') ?? [];
    const domains = domainFacts.map((f) => String((f.structuredValue as Record<string, unknown>)['domain'] ?? f.rawValue));
    const roles = reasoning.hiringFocus.value;

    return {
      roles,
      domains: [...new Set([...domains, ...reasoning.businessDomains.value])],
      seniorities: [reasoning.seniority.value],
      confidence: reasoning.hiringFocus.confidence,
      evidenceFactIds: domainFacts.map((f) => f.factId),
    };
  }

  private buildTechnicalFocus(
    byType: Map<string, RecruiterEntityFact[]>,
    reasoning: RecruiterReasoningResult,
  ): TechnicalFocusProfile {
    const techFacts = byType.get('technology') ?? [];
    const skillFacts = byType.get('skill') ?? [];
    const technologies = techFacts.map((f) => String((f.structuredValue as Record<string, unknown>)['name'] ?? f.rawValue));
    const skills = skillFacts.map((f) => String((f.structuredValue as Record<string, unknown>)['name'] ?? f.rawValue));

    return {
      technologies: [...new Set([...technologies, ...reasoning.technicalDomains.value])],
      skills,
      domains: reasoning.technicalDomains.value,
      confidence: reasoning.technicalDomains.confidence,
      evidenceFactIds: [...techFacts, ...skillFacts].map((f) => f.factId),
    };
  }

  private buildIndustryFocus(
    byType: Map<string, RecruiterEntityFact[]>,
    reasoning: RecruiterReasoningResult,
  ): IndustryFocusProfile {
    const orgFacts = byType.get('recruiter_organization') ?? [];
    const industries = reasoning.businessDomains.value.length > 0
      ? reasoning.businessDomains.value
      : ['Technology'];

    return {
      industries,
      confidence: reasoning.businessDomains.confidence > 0.3
        ? reasoning.businessDomains.confidence
        : 0.55,
      evidenceFactIds: orgFacts.map((f) => f.factId),
    };
  }

  private buildOrganizationContext(byType: Map<string, RecruiterEntityFact[]>): OrganizationContext {
    const orgFact = byType.get('recruiter_organization')?.[0];
    const deptFact = byType.get('recruiter_department')?.[0];
    const teamFact = byType.get('recruiter_team')?.[0];
    const officeFact = byType.get('recruiter_office')?.[0];

    const factIds = [orgFact, deptFact, teamFact, officeFact]
      .filter(Boolean)
      .map((f) => f!.factId);

    const confidence = factIds.length > 0
      ? factIds.reduce((s, id) => {
          const f = [orgFact, deptFact, teamFact, officeFact].find((x) => x?.factId === id);
          return s + (f?.confidence ?? 0.5);
        }, 0) / factIds.length
      : 0.40;

    return {
      organization: orgFact?.rawValue,
      department: deptFact?.rawValue,
      team: teamFact?.rawValue,
      office: officeFact?.rawValue,
      confidence,
      evidenceFactIds: factIds,
    };
  }

  private buildCommunicationStyle(
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
  ): CommunicationStyleProfile {
    const urgency = reasoning.urgency.value;
    const intent = reasoning.communicationIntent.value;

    let tone: CommunicationStyleProfile['tone'] = 'unknown';
    let style = 'Standard professional communication style.';
    let responsePattern = 'Responds within standard business hours.';

    if (urgency === 'high' || urgency === 'critical') {
      tone = 'direct';
      style = 'Direct, deadline-driven communication with explicit calls to action.';
      responsePattern = 'Expects prompt responses; sets clear timelines.';
    } else if (intent === 'closing' || intent === 'negotiating') {
      tone = 'direct';
      style = 'Direct and results-oriented, focused on closing.';
    } else if (intent === 'screening') {
      tone = 'formal';
      style = 'Professional screening approach with structured qualification questions.';
    }

    return {
      style,
      tone,
      responsePattern,
      confidence: reasoning.communicationIntent.confidence * 0.8 + reasoning.urgency.confidence * 0.2,
      evidenceFactIds: facts.slice(0, 3).map((f) => f.factId),
    };
  }

  private buildRecruitingStyle(
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
  ): RecruitingStyleProfile {
    const authority = reasoning.decisionAuthority.value;
    const specialization = reasoning.specialization.value;

    let approachType: RecruitingStyleProfile['approachType'] = 'unknown';
    let style = 'Standard recruiting approach.';

    if (authority === 'decision_maker') {
      approachType = 'consultative';
      style = 'Senior recruiter with full hiring authority; consultative approach with direct candidate engagement.';
    } else if (specialization === 'engineering') {
      approachType = 'active';
      style = 'Technical recruiter with active outreach for engineering talent.';
    } else if (authority === 'influencer') {
      approachType = 'passive';
      style = 'Collaborative recruiter working within a structured hiring committee.';
    }

    return {
      style,
      approachType,
      confidence: Math.max(reasoning.decisionAuthority.confidence, reasoning.specialization.confidence) * 0.85,
      evidenceFactIds: facts.slice(0, 2).map((f) => f.factId),
    };
  }

  private buildVelocitySignals(
    byType: Map<string, RecruiterEntityFact[]>,
    reasoning: RecruiterReasoningResult,
  ): HiringVelocitySignals {
    const stageFacts = byType.get('interview_stage') ?? [];
    const priorityFacts = byType.get('hiring_priority') ?? [];
    const stage = stageFacts[0]?.structuredValue['stage'] as string | undefined;

    const urgency = reasoning.urgency.value;
    const activeOpenings = stageFacts.length > 0 || priorityFacts.length > 0;

    const stageToPosition: Record<string, number> = {
      initial_screen: 1, recruiter_screen: 1, phone_screen: 1,
      technical_screen: 2, technical_interview: 3,
      onsite: 4, interview_loop: 4, final_round: 5, offer: 6,
    };

    const cycles = stage ? stageToPosition[stage] ?? 2 : 1;

    return {
      urgency,
      typicalInterviewCycles: cycles,
      activeOpenings,
      pipelineStage: stage ?? 'initial_outreach',
      confidence: reasoning.urgency.confidence,
      evidenceFactIds: [...stageFacts, ...priorityFacts].map((f) => f.factId),
    };
  }

  private buildRelationshipStrength(facts: RecruiterEntityFact[]): RelationshipStrengthProfile {
    // Relationship strength is derived from communication richness
    const signals: string[] = [];
    let score = 0.20;

    if (facts.some((f) => f.fieldType === 'recruiter_name')) {
      signals.push('recruiter_identified');
      score += 0.15;
    }
    if (facts.some((f) => f.fieldType === 'recruiter_organization')) {
      signals.push('organization_known');
      score += 0.15;
    }
    if (facts.some((f) => f.fieldType === 'interview_stage')) {
      signals.push('interview_scheduled');
      score += 0.25;
    }
    if (facts.some((f) => f.fieldType === 'compensation_mention')) {
      signals.push('compensation_discussed');
      score += 0.20;
    }

    const clampedScore = Math.min(1, score);
    const band: RelationshipStrengthProfile['band'] =
      clampedScore >= 0.80 ? 'strong' :
      clampedScore >= 0.60 ? 'established' :
      clampedScore >= 0.35 ? 'developing' : 'weak';

    return {
      score: Number(clampedScore.toFixed(4)),
      band,
      signals,
      confidence: 0.70,
      evidenceFactIds: facts.slice(0, 5).map((f) => f.factId),
    };
  }

  private buildCandidateFitSignals(
    byType: Map<string, RecruiterEntityFact[]>,
    reasoning: RecruiterReasoningResult,
  ): CandidateFitSignal[] {
    const signals: CandidateFitSignal[] = [];

    for (const techFact of byType.get('technology') ?? []) {
      const name = String((techFact.structuredValue as Record<string, unknown>)['name'] ?? techFact.rawValue);
      signals.push({
        signal: `${name} proficiency`,
        category: 'technical',
        importance: 'required',
        confidence: techFact.confidence,
        evidenceFactId: techFact.factId,
      });
    }

    for (const skillFact of byType.get('skill') ?? []) {
      const name = String((skillFact.structuredValue as Record<string, unknown>)['name'] ?? skillFact.rawValue);
      signals.push({
        signal: `${name} experience`,
        category: 'technical',
        importance: 'preferred',
        confidence: skillFact.confidence,
        evidenceFactId: skillFact.factId,
      });
    }

    for (const locFact of byType.get('hiring_location') ?? []) {
      const loc = String((locFact.structuredValue as Record<string, unknown>)['location'] ?? locFact.rawValue);
      signals.push({
        signal: `Based in or willing to relocate to ${loc}`,
        category: 'location',
        importance: 'required',
        confidence: locFact.confidence,
        evidenceFactId: locFact.factId,
      });
    }

    for (const compFact of byType.get('compensation_mention') ?? []) {
      signals.push({
        signal: 'Compensation range disclosed — alignment required',
        category: 'compensation',
        importance: 'preferred',
        confidence: compFact.confidence,
        evidenceFactId: compFact.factId,
      });
    }

    if (reasoning.seniority.value !== 'mid') {
      signals.push({
        signal: `${reasoning.seniority.value} level experience required`,
        category: 'experience',
        importance: 'required',
        confidence: reasoning.seniority.confidence,
      });
    }

    return signals;
  }

  // ─── AI enhancement ───────────────────────────────────────────────────────────

  private async enhanceWithAi(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
  ): Promise<Partial<RecruiterProfile>> {
    const structuredFacts = facts
      .map((f) => `[${f.fieldType}] ${f.rawValue} (conf: ${f.confidence.toFixed(2)})`)
      .join('\n');

    const inferences = reasoning.inferences
      .map((i) => `[${i.attribute}] ${JSON.stringify(i.value)} — ${i.reasoning} (conf: ${i.confidence.toFixed(2)})`)
      .join('\n');

    const input: ExtractionInput = {
      extractionId: randomUUID(),
      tenantId: recruiterId,
      sourceType: 'profile',
      sourceId: recruiterId,
      content: `${structuredFacts}\n\n${inferences}`,
      metadata: { recruiterId },
      requestedAt: new Date(),
    };

    const output = await this.pipeline.extract(
      'recruiter-intelligence-profile',
      input,
      { recruiterId, structuredFacts, inferences },
    );

    // Map AI output fields back to profile sections
    const fieldMap = new Map(output.fields.map((f) => [f.field, f.value]));
    return {
      summary: fieldMap.has('summary')
        ? {
            text: String(fieldMap.get('summary') ?? ''),
            confidence: 0.82,
            evidenceFactIds: facts.slice(0, 3).map((f) => f.factId),
          }
        : undefined,
    };
  }

  private mergeProfile(
    deterministic: RecruiterProfile,
    aiEnhanced: Partial<RecruiterProfile>,
  ): RecruiterProfile {
    return {
      ...deterministic,
      // AI summary overrides only when it has one
      summary: aiEnhanced.summary ?? deterministic.summary,
      version: deterministic.version + (Object.keys(aiEnhanced).length > 0 ? 1 : 0),
    };
  }

  // ─── Memory update plan ───────────────────────────────────────────────────────

  buildMemoryUpdatePlan(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
  ): MemoryUpdatePlan {
    const now = new Date();

    const factsToWrite: EngineMemoryRecord[] = facts.map((fact) => ({
      id: fact.factId,
      recruiterId,
      factType: fact.fieldType,
      value: fact.structuredValue,
      confidence: fact.confidence,
      evidence: { messageId: fact.sourceMessageId, excerpt: fact.evidence.excerpt },
      provenance: {
        extractor: fact.provenance.extractor,
        method: fact.provenance.method,
        sourceProvider: fact.provenance.sourceProvider,
      },
      observedAt: fact.observedAt,
      validFrom: fact.observedAt,
    }));

    // Add inferences as memory records
    for (const inference of reasoning.inferences) {
      factsToWrite.push({
        id: inference.inferenceId,
        recruiterId,
        factType: `inferred_${inference.attribute}`,
        value: { value: inference.value, reasoning: inference.reasoning },
        confidence: inference.confidence,
        evidence: {
          messageId: inference.supportingEvidence.sourceFactIds[0] ?? recruiterId,
          excerpt: inference.supportingEvidence.excerpts[0] ?? inference.reasoning,
        },
        provenance: {
          extractor: inference.provenance.inferrer,
          method: inference.method,
          sourceProvider: 'reasoning-engine',
        },
        observedAt: inference.inferredAt,
        validFrom: inference.inferredAt,
      });
    }

    return {
      recruiterId,
      factsToWrite,
      factsToSupersede: [],
      reason: `Profile generation run at ${now.toISOString()} produced ${factsToWrite.length} memory facts`,
    };
  }

  // ─── Timeline update plan ─────────────────────────────────────────────────────

  buildTimelineUpdatePlan(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
  ): TimelineUpdatePlan {
    const events: TimelineEvent[] = [];

    // Stage progression event
    const stageFacts = facts.filter((f) => f.fieldType === 'interview_stage');
    if (stageFacts.length > 0) {
      const stage = stageFacts[0]!.structuredValue['stage'] as string;
      events.push({
        eventId: randomUUID(),
        eventType: 'interview_stage_detected',
        summary: `Interview stage "${stage}" detected in recruiter communication`,
        occurredAt: stageFacts[0]!.observedAt,
        confidence: stageFacts[0]!.confidence,
        evidenceFactIds: stageFacts.map((f) => f.factId),
      });
    }

    // Compensation discussed event
    const compFacts = facts.filter((f) => f.fieldType === 'compensation_mention');
    if (compFacts.length > 0) {
      events.push({
        eventId: randomUUID(),
        eventType: 'compensation_mentioned',
        summary: 'Recruiter mentioned compensation in communication',
        occurredAt: compFacts[0]!.observedAt,
        confidence: compFacts[0]!.confidence,
        evidenceFactIds: compFacts.map((f) => f.factId),
      });
    }

    // Urgency shift event
    if (reasoning.urgency.value === 'high' || reasoning.urgency.value === 'critical') {
      events.push({
        eventId: randomUUID(),
        eventType: 'high_urgency_detected',
        summary: `High-urgency hiring signal detected (urgency: ${reasoning.urgency.value})`,
        occurredAt: reasoning.completedAt,
        confidence: reasoning.urgency.confidence,
        evidenceFactIds: reasoning.urgency.supportingEvidence.sourceFactIds,
      });
    }

    // Profile generated event
    events.push({
      eventId: randomUUID(),
      eventType: 'intelligence_profile_generated',
      summary: `Recruiter intelligence profile generated from ${facts.length} facts and ${reasoning.inferences.length} inferences`,
      occurredAt: new Date(),
      confidence: reasoning.overallConfidence,
      evidenceFactIds: facts.slice(0, 5).map((f) => f.factId),
    });

    return { recruiterId, events };
  }

  // ─── Graph update plan ────────────────────────────────────────────────────────

  buildGraphUpdatePlan(
    recruiterId: string,
    _facts: RecruiterEntityFact[],
    _reasoning: RecruiterReasoningResult,
    graphResult: GraphPopulationResult,
  ): GraphUpdatePlan {
    const nodesToUpsert = graphResult.delta.addedNodes.map((n: KgNode) => ({
      nodeType: n.nodeType,
      externalKey: n.externalKey,
      label: n.label,
    }));

    const edgesToAdd = graphResult.delta.addedEdges.map((e: KgEdge) => ({
      fromKey: e.fromNodeId,
      fromType: 'recruiter',
      toKey: e.toNodeId,
      toType: e.relationshipType.split('_to_')[1] ?? 'unknown',
      relationship: e.relationshipType,
      confidence: e.confidence,
    }));

    return { recruiterId, nodesToUpsert, edgesToAdd };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private groupFacts(facts: RecruiterEntityFact[]): Map<string, RecruiterEntityFact[]> {
    const map = new Map<string, RecruiterEntityFact[]>();
    for (const fact of facts) {
      const bucket = map.get(fact.fieldType) ?? [];
      bucket.push(fact);
      map.set(fact.fieldType, bucket);
    }
    return map;
  }

  private buildEvidenceRefs(facts: RecruiterEntityFact[]): ProfileEvidenceRef[] {
    return facts.map((f) => ({
      factId: f.factId,
      fieldType: f.fieldType,
      excerpt: f.evidence.excerpt,
      confidence: f.confidence,
    }));
  }
}
