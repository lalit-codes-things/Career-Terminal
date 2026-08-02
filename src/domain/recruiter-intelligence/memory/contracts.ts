import type { EvidenceRef, RecruiterId, TemporalFact } from '../shared-kernel/types';

export interface RecruiterMemoryFact {
  memoryId: string;
  recruiterId: RecruiterId;
  category: 'fact' | 'relationship' | 'observation' | 'preference';
  content: string;
  confidence: number;
  evidence: EvidenceRef[];
  validFrom: string;
  validTo?: string;
}

export interface MemoryService {
  write(fact: RecruiterMemoryFact): Promise<void>;
  read(recruiterId: RecruiterId): Promise<TemporalFact<RecruiterMemoryFact>[]>;
  supersede(memoryId: string, replacement: RecruiterMemoryFact): Promise<void>;
}
