import type { EvidenceRef, RecruiterId, TemporalFact } from '../shared-kernel/types';

export interface BehavioralProfile {
  recruiterId: RecruiterId;
  pattern: string;
  score: number;
  observedAt: string;
  confidence: number;
  evidence: EvidenceRef[];
}

export interface BehaviorIntelligenceService {
  infer(profile: BehavioralProfile): Promise<void>;
  timeline(recruiterId: RecruiterId): Promise<TemporalFact<BehavioralProfile>[]>;
}
