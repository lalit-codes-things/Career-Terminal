import type { EvidenceRef, RecruiterId, TemporalFact } from '../shared-kernel/types';

export interface RelationshipStrength {
  recruiterId: RecruiterId;
  counterpartId: string;
  strength: number;
  relationshipType: 'colleague' | 'mentor' | 'peer' | 'candidate' | 'partner';
  inferredAt: string;
  confidence: number;
  evidence: EvidenceRef[];
}

export interface RelationshipIntelligenceService {
  score(relationship: RelationshipStrength): Promise<void>;
  history(recruiterId: RecruiterId): Promise<TemporalFact<RelationshipStrength>[]>;
}
