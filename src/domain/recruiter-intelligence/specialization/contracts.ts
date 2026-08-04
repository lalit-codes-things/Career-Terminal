import type { EvidenceRef, RecruiterId } from '../shared-kernel/types';

// ─── Specialization Dimensions ────────────────────────────────────────────────

export type HiringDomain =
  | 'engineering' | 'product' | 'design' | 'data_science' | 'devops'
  | 'security' | 'sales' | 'marketing' | 'finance' | 'legal'
  | 'operations' | 'hr' | 'executive' | 'general' | 'unknown';

export type SeniorityFocus =
  | 'intern' | 'junior' | 'mid' | 'senior' | 'staff' | 'principal'
  | 'lead' | 'manager' | 'director' | 'vp' | 'c_level' | 'mixed' | 'unknown';

export type OrganizationFocus =
  | 'startup' | 'scale_up' | 'mid_market' | 'enterprise' | 'public_sector'
  | 'non_profit' | 'mixed' | 'unknown';

export type HiringLevel = 'individual_contributor' | 'manager' | 'director_plus' | 'executive' | 'mixed' | 'unknown';

// ─── Expertise Dimension ──────────────────────────────────────────────────────

export interface ExpertiseDimension<T = unknown> {
  dimensionId: string;
  dimension: string;
  value: T;
  confidence: number;
  confidenceBand: 'low' | 'medium' | 'high' | 'critical';
  reasoning: string;
  evidenceFactIds: string[];
  inferredAt: Date;
}

// ─── Recruiter Expertise Profile ──────────────────────────────────────────────

export interface RecruiterExpertiseProfile {
  profileId: string;
  recruiterId: RecruiterId;

  // 10 specialization dimensions
  hiringDomains: ExpertiseDimension<HiringDomain[]>;
  technicalSpecialization: ExpertiseDimension<string[]>;
  businessSpecialization: ExpertiseDimension<string[]>;
  seniorityFocus: ExpertiseDimension<SeniorityFocus[]>;
  organizationFocus: ExpertiseDimension<OrganizationFocus>;
  geography: ExpertiseDimension<string[]>;
  hiringLevel: ExpertiseDimension<HiringLevel>;
  roleFamilies: ExpertiseDimension<string[]>;
  technologyStacks: ExpertiseDimension<TechnologyStack[]>;
  industryExpertise: ExpertiseDimension<string[]>;

  overallSpecializationScore: number;   // 0–1 (breadth × depth)
  overallConfidence: number;
  generatedAt: Date;
  version: number;
  evidenceRefs: EvidenceRef[];
}

export interface TechnologyStack {
  stackName: string;
  components: string[];
  confidence: number;
}

// ─── Hiring Focus (output) ────────────────────────────────────────────────────

export interface HiringFocusOutput {
  recruiterId: RecruiterId;
  primaryDomains: HiringDomain[];
  secondaryDomains: HiringDomain[];
  roleFamilies: string[];
  seniorities: SeniorityFocus[];
  confidence: number;
  evidenceFactIds: string[];
}

// ─── Technical Focus (output) ─────────────────────────────────────────────────

export interface TechnicalFocusOutput {
  recruiterId: RecruiterId;
  technologies: string[];
  stacks: TechnologyStack[];
  domains: string[];
  specializations: string[];
  confidence: number;
  evidenceFactIds: string[];
}

// ─── Business Focus (output) ──────────────────────────────────────────────────

export interface BusinessFocusOutput {
  recruiterId: RecruiterId;
  industries: string[];
  businessDomains: string[];
  organizationTypes: OrganizationFocus[];
  geographies: string[];
  confidence: number;
  evidenceFactIds: string[];
}

// ─── Historical Expertise ─────────────────────────────────────────────────────

export interface HistoricalExpertise {
  recruiterId: RecruiterId;
  snapshots: ExpertiseSnapshot[];
  dominantDomains: string[];
  consistentSpecializations: string[];
  domainEvolution: string;
}

export interface ExpertiseSnapshot {
  snapshotId: string;
  hiringDomains: string[];
  technologyStacks: string[];
  observedAt: Date;
  confidence: number;
}

// ─── Future Confidence ────────────────────────────────────────────────────────

export interface FutureExpertiseConfidence {
  recruiterId: RecruiterId;
  projectedDomains: string[];
  projectedTechnologies: string[];
  projectionHorizonDays: number;
  projectionConfidence: number;
  basis: string;
}

// ─── Full Specialization Result ───────────────────────────────────────────────

export interface SpecializationIntelligenceResult {
  resultId: string;
  recruiterId: RecruiterId;
  expertiseProfile: RecruiterExpertiseProfile;
  hiringFocus: HiringFocusOutput;
  technicalFocus: TechnicalFocusOutput;
  businessFocus: BusinessFocusOutput;
  historicalExpertise: HistoricalExpertise;
  futureConfidence: FutureExpertiseConfidence;
  generatedAt: Date;
}

// ─── Service Contract ─────────────────────────────────────────────────────────

export interface SpecializationIntelligenceService {
  infer(recruiterId: RecruiterId, inputs: SpecializationInferenceInput): Promise<SpecializationIntelligenceResult>;
  update(recruiterId: RecruiterId, newEvidence: unknown[]): Promise<RecruiterExpertiseProfile>;
}

export interface SpecializationInferenceInput {
  facts: unknown[];           // RecruiterEntityFact[]
  reasoning: unknown;         // RecruiterReasoningResult
  engineResult?: unknown;     // IntelligenceEngineResult
  priorProfile?: RecruiterExpertiseProfile;
}
