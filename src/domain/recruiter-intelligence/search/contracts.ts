import type { RecruiterId } from '../shared-kernel/types';

export interface SearchQuery {
  tenantId: RecruiterId;
  text?: string;
  filters?: Record<string, unknown>;
  limit?: number;
}

export interface SearchResult {
  resultId: string;
  rank: number;
  score: number;
  payload: Record<string, unknown>;
}

export interface SearchService {
  execute(query: SearchQuery): Promise<SearchResult[]>;
}

export interface SemanticRetrievalService {
  retrieve(tenantId: RecruiterId, query: string): Promise<SearchResult[]>;
}
