import type { EvidenceRef, RecruiterId, TemporalFact } from '../shared-kernel/types';

export interface RecruiterIdentityProfile {
  recruiterId: RecruiterId;
  canonicalName?: string;
  aliases: string[];
  primaryEmail?: string;
  primaryPhone?: string;
  organizationIds: string[];
  confidence: number;
  evidence: EvidenceRef[];
}

export interface IdentityResolutionCommand {
  sourceId: string;
  sourceType: 'email' | 'phone' | 'linkedin' | 'crm' | 'event';
  inputValue: string;
  observedAt: string;
  correlationId?: string;
}

export interface IdentityResolutionResult {
  profile: RecruiterIdentityProfile;
  matchedIdentifiers: string[];
  conflicts: string[];
  temporalFacts: TemporalFact<RecruiterIdentityProfile>[];
}

export interface IdentityResolutionService {
  resolve(command: IdentityResolutionCommand): Promise<IdentityResolutionResult>;
}

export interface IdentityResolutionRepository {
  save(profile: RecruiterIdentityProfile): Promise<void>;
  findByIdentifier(identifier: string): Promise<RecruiterIdentityProfile | null>;
}
