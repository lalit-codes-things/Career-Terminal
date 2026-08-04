// Prompt 22 — Vector Search & Hybrid Retrieval Contracts
import type { EntityType } from '../semantic-representation/contracts';

export interface VectorQuery {
  vector: number[];
  topK: number;
  minSimilarity?: number; // e.g. 0.7
  metadataFilters?: Record<string, string | number | boolean | string[]>;
  temporalFilters?: {
    since?: Date;
    until?: Date;
  };
}

export interface VectorSearchResult {
  entityId: string;
  entityType: EntityType;
  score: number;
  text: string;
  metadata: Record<string, unknown>;
}

export interface HybridQuery {
  textQuery?: string;
  vectorQuery?: VectorQuery;
  weights?: { text: number; vector: number }; // default 0.3 / 0.7
  alpha?: number; // balance parameter for reciprocal rank fusion
}

export interface HybridSearchResult extends VectorSearchResult {
  vectorScore: number;
  textScore: number;
  hybridScore: number;
}

export interface VectorStore {
  store(embeddings: import('../semantic-representation/contracts').Embedding[]): Promise<void>;
  search(query: VectorQuery): Promise<VectorSearchResult[]>;
  deleteByEntityId(entityId: string): Promise<void>;
  deleteByTenantId(tenantId: string): Promise<void>;
}
