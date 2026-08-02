import type { RecruiterId } from '../../../domain/recruiter-intelligence/shared-kernel/types';

export interface RecruiterIntelligenceHttpApi {
  resolveIdentity(input: unknown): Promise<unknown>;
  ingestCommunication(input: unknown): Promise<unknown>;
  searchRecruiter(input: unknown): Promise<unknown>;
  getRecruiterTimeline(recruiterId: RecruiterId): Promise<unknown>;
}

export interface RecruiterIntelligenceAdminApi {
  configurePolicies(input: unknown): Promise<unknown>;
  reviewEvidence(input: unknown): Promise<unknown>;
}
