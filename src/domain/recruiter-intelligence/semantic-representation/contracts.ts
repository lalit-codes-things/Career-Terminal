// Prompt 21 — Embedding & Semantic Representation Contracts

export type EmbeddingDimensions = 384 | 768 | 1024 | 1536 | 3072;
export type EntityType =
  | 'recruiter_profile'
  | 'communication'
  | 'conversation'
  | 'company'
  | 'opportunity'
  | 'resume'
  | 'skill'
  | 'technology'
  | 'knowledge_node'
  | 'knowledge_edge'
  | 'structured_fact'
  | 'observation'
  | 'memory';

export interface EmbeddingMetadata {
  entityType: EntityType;
  entityId: string;
  tenantId: string;
  sourceTextLength: number;
  modelVersion: string;
  createdAt: Date;
  expiresAt?: Date; // For invalidation
}

export interface Embedding {
  embeddingId: string;
  vector: number[];
  dimensions: EmbeddingDimensions;
  text: string;
  metadata: EmbeddingMetadata;
}

export interface EmbeddingProvider {
  providerId: string;
  modelName: string;
  dimensions: EmbeddingDimensions;
  maxTokens: number;
  embedContext(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export interface BatchEmbeddingResult {
  successful: number;
  failed: number;
  embeddings: Embedding[];
  errors: Array<{ index: number; reason: string }>;
}
