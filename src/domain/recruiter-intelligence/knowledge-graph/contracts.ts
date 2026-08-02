import type { EvidenceRef, RecruiterId, TemporalFact } from '../shared-kernel/types';

export type RecruiterGraphNodeType = 'recruiter' | 'organization' | 'person' | 'communication' | 'opportunity' | 'signal';
export type RecruiterGraphEdgeType =
  | 'works_for'
  | 'reports_to'
  | 'collaborates_with'
  | 'mentions'
  | 'engages_with'
  | 'belongs_to'
  | 'follows';

export interface RecruiterGraphNode {
  nodeId: string;
  nodeType: RecruiterGraphNodeType;
  label: string;
  recruiterId?: RecruiterId;
  metadata: Record<string, unknown>;
}

export interface RecruiterGraphEdge {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  edgeType: RecruiterGraphEdgeType;
  confidence: number;
  evidence: EvidenceRef[];
  validFrom: string;
  validTo?: string;
}

export interface KnowledgeGraphService {
  ingestEdge(edge: RecruiterGraphEdge): Promise<void>;
  query(tenantId: RecruiterId, query: string): Promise<RecruiterGraphEdge[]>;
}

export interface KnowledgeGraphRepository {
  saveEdge(edge: RecruiterGraphEdge): Promise<void>;
  listForRecruiter(recruiterId: RecruiterId): Promise<RecruiterGraphEdge[]>;
  snapshot(recruiterId: RecruiterId): Promise<TemporalFact<RecruiterGraphEdge[]>>;
}
