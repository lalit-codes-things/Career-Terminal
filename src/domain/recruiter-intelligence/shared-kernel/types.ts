export type RecruiterId = string;
export type OrganizationId = string;
export type PersonId = string;
export type EvidenceId = string;
export type EventId = string;
export type CorrelationId = string;
export type RegionCode = string;

export type ConsentState = 'granted' | 'denied' | 'unknown';
export type ConfidenceBand = 'low' | 'medium' | 'high' | 'critical';

export interface Provenance {
  source: string;
  sourceId?: string;
  collector?: string;
  collectedAt: string;
  region?: RegionCode;
  consentState: ConsentState;
}

export interface EvidenceRef {
  evidenceId: EvidenceId;
  confidence: number;
  provenance: Provenance;
}

export interface TemporalFact<T> {
  factId: string;
  subjectId: RecruiterId;
  validFrom: string;
  validTo?: string;
  observedAt: string;
  value: T;
  confidence: number;
  version: number;
  evidence: EvidenceRef[];
  supersededBy?: string;
}

export interface RecruiterSnapshot {
  recruiterId: RecruiterId;
  canonicalName?: string;
  organizationIds: OrganizationId[];
  activeSince?: string;
  lastObservedAt: string;
  confidence: number;
}
