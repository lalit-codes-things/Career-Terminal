import type { EvidenceRef, OrganizationId, RecruiterId, TemporalFact } from '../shared-kernel/types';

export interface OrganizationSignal {
  recruiterId: RecruiterId;
  organizationId: OrganizationId;
  signalType: 'team' | 'function' | 'location' | 'tenure' | 'leadership';
  value: string;
  observedAt: string;
  confidence: number;
  evidence: EvidenceRef[];
}

export interface OrganizationIntelligenceService {
  ingest(signal: OrganizationSignal): Promise<void>;
  view(recruiterId: RecruiterId): Promise<TemporalFact<OrganizationSignal>[]>;
}
