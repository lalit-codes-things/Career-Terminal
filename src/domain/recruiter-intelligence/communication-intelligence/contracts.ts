import type { EvidenceRef, RecruiterId, TemporalFact } from '../shared-kernel/types';

export interface CommunicationSignal {
  signalId: string;
  recruiterId: RecruiterId;
  channel: 'email' | 'chat' | 'calendar' | 'meeting' | 'social';
  contentHash: string;
  observedAt: string;
  confidence: number;
  evidence: EvidenceRef[];
}

export interface CommunicationIntelligenceService {
  ingest(signal: CommunicationSignal): Promise<void>;
  summarize(recruiterId: RecruiterId): Promise<TemporalFact<string>[]>;
}
