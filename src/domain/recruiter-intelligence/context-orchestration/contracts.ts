// Prompt 24 — Context Orchestration Engine Contracts

export type ContextSourceType =
  | 'memory'
  | 'timeline'
  | 'conversation'
  | 'structured_fact'
  | 'observation'
  | 'evidence'
  | 'company_intelligence'
  | 'opportunity_intelligence'
  | 'application'
  | 'resume'
  | 'graph_traversal'
  | 'semantic_retrieval';

export interface ContextItem {
  itemId: string;
  sourceType: ContextSourceType;
  content: string; // The text content to be injected into prompt
  relevanceScore: number; // 0.0 - 1.0
  tokenCount: number;
  timestamp?: Date;
  metadata?: Record<string, any>;
}

export interface ContextOrchestrationRequest {
  tenantId: string;
  query: string;
  maxTokens: number;
  minRelevanceScore?: number;
  prioritizedSources?: ContextSourceType[];
}

export interface OrchestratedContext {
  orchestrationId: string;
  assembledPromptText: string;
  itemsIncluded: ContextItem[];
  itemsExcluded: ContextItem[]; // Items dropped due to token limits or low relevance
  totalTokens: number;
  compressionRatio: number; // Original context size vs assembled size
  generatedAt: Date;
}
