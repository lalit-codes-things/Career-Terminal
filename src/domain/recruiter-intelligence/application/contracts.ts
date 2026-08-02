export interface RecruiterIntelligenceApplicationService {
  resolveIdentity(input: unknown): Promise<unknown>;
  ingestCommunication(input: unknown): Promise<unknown>;
  enrichRecruiterProfile(input: unknown): Promise<unknown>;
}
