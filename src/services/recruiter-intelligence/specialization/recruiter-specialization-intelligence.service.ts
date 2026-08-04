import { randomUUID } from 'crypto';
import type { ExtractionInput } from '../ai/types';
import { ExtractionPipeline } from '../ai/extraction-pipeline';
import type { RecruiterEntityFact } from '../extraction/recruiter-entity-extraction.service';
import type { RecruiterReasoningResult } from '../reasoning/recruiter-reasoning-enrichment.service';
import type { IntelligenceEngineResult } from '../engine/recruiter-intelligence-engine.service';
import type {
  BusinessFocusOutput,
  ExpertiseDimension,
  ExpertiseSnapshot,
  FutureExpertiseConfidence,
  HiringDomain,
  HiringFocusOutput,
  HiringLevel,
  HistoricalExpertise,
  OrganizationFocus,
  RecruiterExpertiseProfile,
  SeniorityFocus,
  SpecializationIntelligenceResult,
  TechnicalFocusOutput,
  TechnologyStack,
} from '../../../domain/recruiter-intelligence/specialization/contracts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDim<T>(
  dimension: string,
  value: T,
  confidence: number,
  reasoning: string,
  factIds: string[],
  method: 'deterministic' | 'ai_assisted' = 'deterministic',
): ExpertiseDimension<T> {
  const confidenceBand: ExpertiseDimension<T>['confidenceBand'] =
    confidence >= 0.85 ? 'critical'
      : confidence >= 0.70 ? 'high'
        : confidence >= 0.50 ? 'medium'
          : 'low';

  return {
    dimensionId: randomUUID(),
    dimension,
    value,
    confidence,
    confidenceBand,
    reasoning,
    evidenceFactIds: factIds,
    inferredAt: new Date(),
  };
}

// Domain keyword → HiringDomain mapping
const DOMAIN_KEYWORDS: Array<[string[], HiringDomain]> = [
  [['engineer', 'developer', 'software', 'backend', 'frontend', 'fullstack', 'typescript', 'python', 'java', 'node'], 'engineering'],
  [['product', 'pm', 'product manager'], 'product'],
  [['design', 'ux', 'ui', 'designer'], 'design'],
  [['data', 'ml', 'machine learning', 'ai', 'analytics', 'scientist'], 'data_science'],
  [['devops', 'sre', 'infrastructure', 'platform', 'cloud'], 'devops'],
  [['security', 'infosec', 'appsec', 'pentest'], 'security'],
  [['sales', 'account', 'revenue', 'business development'], 'sales'],
  [['marketing', 'growth', 'demand gen'], 'marketing'],
  [['finance', 'accounting', 'cfo', 'controller'], 'finance'],
  [['legal', 'counsel', 'compliance'], 'legal'],
  [['operations', 'ops', 'supply chain'], 'operations'],
  [['hr', 'people ops', 'talent', 'recruiting'], 'hr'],
  [['ceo', 'cto', 'coo', 'chief', 'president'], 'executive'],
];

function inferDomains(text: string): HiringDomain[] {
  const lower = text.toLowerCase();
  const domains: HiringDomain[] = [];
  for (const [keywords, domain] of DOMAIN_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k))) {
      domains.push(domain);
    }
  }
  return domains.length > 0 ? [...new Set(domains)] : ['general'];
}

const SENIORITY_KEYWORDS: Array<[string[], SeniorityFocus]> = [
  [['intern', 'graduate', 'entry level'], 'intern'],
  [['junior', 'associate', 'jr'], 'junior'],
  [['mid', 'intermediate'], 'mid'],
  [['senior', 'sr'], 'senior'],
  [['staff'], 'staff'],
  [['principal', 'distinguished'], 'principal'],
  [['lead', 'tech lead'], 'lead'],
  [['manager', 'em', 'engineering manager'], 'manager'],
  [['director'], 'director'],
  [['vp', 'vice president'], 'vp'],
  [['cto', 'ceo', 'coo', 'chief'], 'c_level'],
];

function inferSeniority(text: string): SeniorityFocus[] {
  const lower = text.toLowerCase();
  const seniorities: SeniorityFocus[] = [];
  for (const [keywords, level] of SENIORITY_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k))) seniorities.push(level);
  }
  return seniorities.length > 0 ? [...new Set(seniorities)] : ['mixed'];
}

/**
 * RecruiterSpecializationIntelligenceService — Prompt 18 implementation.
 *
 * Infers recruiter expertise across 10 dimensions:
 *   hiringDomains, technicalSpecialization, businessSpecialization,
 *   seniorityFocus, organizationFocus, geography, hiringLevel,
 *   roleFamilies, technologyStacks, industryExpertise.
 *
 * Continuous update: merges new evidence into existing profile.
 */
export class RecruiterSpecializationIntelligenceService {
  constructor(private readonly pipeline: ExtractionPipeline) {}

  async infer(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
    engineResult?: IntelligenceEngineResult,
    priorProfile?: RecruiterExpertiseProfile,
  ): Promise<SpecializationIntelligenceResult> {
    const resultId = randomUUID();

    // Step 1: deterministic inference from structured facts
    const deterministicProfile = this.inferDeterministic(recruiterId, facts, reasoning, engineResult);

    // Step 2: AI enrichment
    let aiProfile: Partial<RecruiterExpertiseProfile> = {};
    try {
      aiProfile = await this.inferWithAi(recruiterId, facts, reasoning);
    } catch {
      // non-fatal
    }

    // Step 3: merge (AI wins on same dimension if higher confidence)
    const expertiseProfile = this.mergeProfiles(
      recruiterId, deterministicProfile, aiProfile, facts, priorProfile,
    );

    // Step 4: build outputs
    const hiringFocus = this.buildHiringFocus(recruiterId, expertiseProfile);
    const technicalFocus = this.buildTechnicalFocus(recruiterId, expertiseProfile);
    const businessFocus = this.buildBusinessFocus(recruiterId, expertiseProfile);
    const historicalExpertise = this.buildHistoricalExpertise(recruiterId, expertiseProfile, priorProfile);
    const futureConfidence = this.buildFutureConfidence(recruiterId, expertiseProfile);

    return {
      resultId,
      recruiterId,
      expertiseProfile,
      hiringFocus,
      technicalFocus,
      businessFocus,
      historicalExpertise,
      futureConfidence,
      generatedAt: new Date(),
    };
  }

  // ─── Deterministic inference ────────────────────────────────────────────────

  private inferDeterministic(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
    engineResult?: IntelligenceEngineResult,
  ): RecruiterExpertiseProfile {
    const allFactIds = facts.map((f) => f.factId);

    // Aggregate text from facts for keyword inference
    const allText = facts.map((f) => f.rawValue).join(' ') + ' ' +
      reasoning.hiringFocus.value.join(' ') + ' ' +
      reasoning.technicalDomains.value.join(' ');

    // ─ Hiring domains ─
    const domains = inferDomains(allText);
    const hiringDomains = makeDim<HiringDomain[]>(
      'hiringDomains', domains, 0.72,
      `Inferred from keywords: ${domains.join(', ')}.`,
      allFactIds.slice(0, 3),
    );

    // ─ Technical specialization ─
    const techFacts = facts.filter((f) => f.fieldType === 'technology');
    const technologies = techFacts.map((f) => f.normalizedValue);
    const technicalSpecialization = makeDim<string[]>(
      'technicalSpecialization',
      [...new Set([...technologies, ...reasoning.technicalDomains.value])],
      techFacts.length > 0 ? 0.82 : 0.55,
      `${techFacts.length} technology facts extracted. AI reasoning added: ${reasoning.technicalDomains.value.join(', ')}.`,
      techFacts.map((f) => f.factId),
    );

    // ─ Business specialization ─
    const businessSpecialization = makeDim<string[]>(
      'businessSpecialization', reasoning.businessDomains.value,
      reasoning.businessDomains.confidence,
      `Business domains from AI reasoning: ${reasoning.businessDomains.value.join(', ')}.`,
      allFactIds.slice(0, 2),
    );

    // ─ Seniority focus ─
    const titleFacts = facts.filter((f) => f.fieldType === 'recruiter_title' || f.fieldType === 'hiring_domain');
    const seniorities = inferSeniority(allText);
    const seniorityFocus = makeDim<SeniorityFocus[]>(
      'seniorityFocus', seniorities,
      titleFacts.length > 0 ? 0.75 : 0.55,
      `Seniority inferred from: ${seniorities.join(', ')}.`,
      titleFacts.map((f) => f.factId),
    );

    // ─ Organization focus ─
    const orgFocus: OrganizationFocus = 'mixed'; // requires multi-interaction history
    const organizationFocus = makeDim<OrganizationFocus>(
      'organizationFocus', orgFocus, 0.40,
      'Organization focus requires multi-interaction history; defaulting to mixed.',
      allFactIds.slice(0, 1),
    );

    // ─ Geography ─
    const locFacts = facts.filter((f) => f.fieldType === 'hiring_location' || f.fieldType === 'recruiter_office');
    const geos = locFacts.map((f) => f.normalizedValue).filter(Boolean);
    const geography = makeDim<string[]>(
      'geography', geos.length > 0 ? geos : ['unknown'],
      locFacts.length > 0 ? 0.78 : 0.40,
      `${locFacts.length} location facts extracted: ${geos.join(', ') || 'none'}.`,
      locFacts.map((f) => f.factId),
    );

    // ─ Hiring level ─
    const levelText = allText.toLowerCase();
    let hiringLevelValue: HiringLevel = 'mixed';
    if (levelText.includes('manager') || levelText.includes('director')) hiringLevelValue = 'manager';
    else if (seniorities.includes('c_level') || seniorities.includes('vp')) hiringLevelValue = 'executive';
    else if (seniorities.some((s) => ['junior', 'mid', 'senior', 'staff', 'principal', 'lead'].includes(s))) {
      hiringLevelValue = 'individual_contributor';
    }
    const hiringLevel = makeDim<HiringLevel>(
      'hiringLevel', hiringLevelValue, 0.65,
      `Hiring level inferred as ${hiringLevelValue} from seniority signals.`,
      allFactIds.slice(0, 2),
    );

    // ─ Role families ─
    const roleFamilies = makeDim<string[]>(
      'roleFamilies', reasoning.hiringFocus.value,
      reasoning.hiringFocus.confidence,
      `Role families from AI reasoning: ${reasoning.hiringFocus.value.join(', ')}.`,
      allFactIds.slice(0, 3),
    );

    // ─ Technology stacks ─
    const stacks: TechnologyStack[] = [];
    if (technologies.length > 0) {
      stacks.push({
        stackName: 'Inferred Stack',
        components: technologies,
        confidence: technicalSpecialization.confidence,
      });
    }
    const technologyStacks = makeDim<TechnologyStack[]>(
      'technologyStacks', stacks,
      stacks.length > 0 ? 0.72 : 0.40,
      `${stacks.length} technology stack(s) inferred from ${technologies.length} technology facts.`,
      techFacts.map((f) => f.factId),
    );

    // ─ Industry expertise ─
    const industryText = [
      ...reasoning.businessDomains.value,
      ...domains.map(String),
    ].join(' ');
    const industries = inferDomains(industryText).map(String);
    const industryExpertise = makeDim<string[]>(
      'industryExpertise',
      industries.length > 0 ? industries : ['Technology'],
      0.60,
      `Industry expertise inferred from domain signals: ${industries.join(', ')}.`,
      allFactIds.slice(0, 2),
    );

    const allDims = [
      hiringDomains, technicalSpecialization, businessSpecialization,
      seniorityFocus, organizationFocus, geography, hiringLevel,
      roleFamilies, technologyStacks, industryExpertise,
    ];
    const overallConfidence = allDims.reduce((s, d) => s + d.confidence, 0) / allDims.length;

    return {
      profileId: randomUUID(),
      recruiterId,
      hiringDomains,
      technicalSpecialization,
      businessSpecialization,
      seniorityFocus,
      organizationFocus,
      geography,
      hiringLevel,
      roleFamilies,
      technologyStacks,
      industryExpertise,
      overallSpecializationScore: Math.min(1, overallConfidence * 1.05),
      overallConfidence,
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

  // ─── AI enrichment ──────────────────────────────────────────────────────────

  private async inferWithAi(
    recruiterId: string,
    facts: RecruiterEntityFact[],
    reasoning: RecruiterReasoningResult,
  ): Promise<Partial<RecruiterExpertiseProfile>> {
    const input: ExtractionInput = {
      extractionId: randomUUID(),
      tenantId: recruiterId,
      sourceType: 'profile',
      sourceId: recruiterId,
      content: JSON.stringify({
        recruiterId,
        technologies: facts.filter((f) => f.fieldType === 'technology').map((f) => f.rawValue),
        domains: reasoning.technicalDomains.value,
        businessDomains: reasoning.businessDomains.value,
        hiringFocus: reasoning.hiringFocus.value,
        specialization: reasoning.specialization.value,
      }),
      metadata: { templateId: 'recruiter-specialization-intelligence' },
      requestedAt: new Date(),
    };

    const output = await this.pipeline.extract(input, 'recruiter-specialization-intelligence');
    const result: Partial<RecruiterExpertiseProfile> = {};

    for (const f of output.fields) {
      const factIds = [randomUUID()];
      const excerpts = f.evidence.map((e) => e.excerpt);
      if (f.field === 'hiringDomains' && Array.isArray(f.value)) {
        result.hiringDomains = makeDim<HiringDomain[]>(
          'hiringDomains', f.value as HiringDomain[],
          f.confidence, excerpts[0] ?? 'AI-inferred domains.', factIds, 'ai_assisted',
        );
      }
      if (f.field === 'technologyStacks' && Array.isArray(f.value)) {
        result.technologyStacks = makeDim<TechnologyStack[]>(
          'technologyStacks', f.value as TechnologyStack[],
          f.confidence, excerpts[0] ?? 'AI-inferred stacks.', factIds, 'ai_assisted',
        );
      }
    }

    return result;
  }

  // ─── Merge ──────────────────────────────────────────────────────────────────

  private mergeProfiles(
    recruiterId: string,
    deterministic: RecruiterExpertiseProfile,
    ai: Partial<RecruiterExpertiseProfile>,
    facts: RecruiterEntityFact[],
    prior?: RecruiterExpertiseProfile,
  ): RecruiterExpertiseProfile {
    const pick = <T>(
      key: keyof RecruiterExpertiseProfile,
    ): ExpertiseDimension<T> => {
      const det = deterministic[key] as ExpertiseDimension<T>;
      const aiVal = ai[key] as ExpertiseDimension<T> | undefined;
      if (!aiVal) return det;
      return aiVal.confidence > det.confidence ? aiVal : det;
    };

    const merged: RecruiterExpertiseProfile = {
      ...deterministic,
      hiringDomains: pick<HiringDomain[]>('hiringDomains'),
      technologyStacks: pick<TechnologyStack[]>('technologyStacks'),
      version: prior ? prior.version + 1 : 1,
    };

    return merged;
  }

  // ─── Focus outputs ──────────────────────────────────────────────────────────

  private buildHiringFocus(recruiterId: string, profile: RecruiterExpertiseProfile): HiringFocusOutput {
    return {
      recruiterId,
      primaryDomains: profile.hiringDomains.value.slice(0, 2),
      secondaryDomains: profile.hiringDomains.value.slice(2),
      roleFamilies: profile.roleFamilies.value,
      seniorities: profile.seniorityFocus.value,
      confidence: profile.hiringDomains.confidence,
      evidenceFactIds: profile.hiringDomains.evidenceFactIds,
    };
  }

  private buildTechnicalFocus(recruiterId: string, profile: RecruiterExpertiseProfile): TechnicalFocusOutput {
    return {
      recruiterId,
      technologies: profile.technicalSpecialization.value,
      stacks: profile.technologyStacks.value,
      domains: profile.technicalSpecialization.value,
      specializations: profile.technicalSpecialization.value.slice(0, 3),
      confidence: profile.technicalSpecialization.confidence,
      evidenceFactIds: profile.technicalSpecialization.evidenceFactIds,
    };
  }

  private buildBusinessFocus(recruiterId: string, profile: RecruiterExpertiseProfile): BusinessFocusOutput {
    return {
      recruiterId,
      industries: profile.industryExpertise.value,
      businessDomains: profile.businessSpecialization.value,
      organizationTypes: [profile.organizationFocus.value],
      geographies: profile.geography.value,
      confidence: profile.businessSpecialization.confidence,
      evidenceFactIds: profile.businessSpecialization.evidenceFactIds,
    };
  }

  private buildHistoricalExpertise(
    recruiterId: string,
    profile: RecruiterExpertiseProfile,
    prior?: RecruiterExpertiseProfile,
  ): HistoricalExpertise {
    const snapshots: ExpertiseSnapshot[] = [];

    if (prior) {
      snapshots.push({
        snapshotId: randomUUID(),
        hiringDomains: prior.hiringDomains.value.map(String),
        technologyStacks: prior.technologyStacks.value.map((s) => s.stackName),
        observedAt: prior.generatedAt,
        confidence: prior.overallConfidence,
      });
    }

    snapshots.push({
      snapshotId: randomUUID(),
      hiringDomains: profile.hiringDomains.value.map(String),
      technologyStacks: profile.technologyStacks.value.map((s) => s.stackName),
      observedAt: profile.generatedAt,
      confidence: profile.overallConfidence,
    });

    const allDomains = snapshots.flatMap((s) => s.hiringDomains);
    const domainCount = new Map<string, number>();
    for (const d of allDomains) domainCount.set(d, (domainCount.get(d) ?? 0) + 1);
    const dominant = [...domainCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([d]) => d);

    return {
      recruiterId,
      snapshots,
      dominantDomains: dominant,
      consistentSpecializations: profile.technicalSpecialization.value.slice(0, 3),
      domainEvolution: prior
        ? `Expertise tracked across ${snapshots.length} observations.`
        : 'First observation — evolution tracking begins.',
    };
  }

  private buildFutureConfidence(
    recruiterId: string,
    profile: RecruiterExpertiseProfile,
  ): FutureExpertiseConfidence {
    return {
      recruiterId,
      projectedDomains: profile.hiringDomains.value.map(String).slice(0, 3),
      projectedTechnologies: profile.technicalSpecialization.value.slice(0, 5),
      projectionHorizonDays: 90,
      projectionConfidence: profile.overallConfidence * 0.75,
      basis: `Projected from ${profile.evidenceRefs.length} evidence references and ${profile.technologyStacks.value.length} technology stack(s).`,
    };
  }
}
