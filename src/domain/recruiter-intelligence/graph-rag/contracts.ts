// Prompt 23 — GraphRAG Foundation Contracts
import type { HybridSearchResult } from '../vector-search/contracts';

export interface GraphTraversalConfig {
  maxDepth: number;
  edgeTypes?: string[];
  semanticThreshold?: number; // Only traverse if connected node text matches semantic similarity
}

export interface GraphRagContext {
  semanticResults: HybridSearchResult[];
  subgraph: {
    nodes: Array<{ id: string; label: string; properties: any }>;
    edges: Array<{ sourceId: string; targetId: string; type: string }>;
  };
  structuredFacts: Array<{ factId: string; fieldType: string; rawValue: string }>;
}

export interface GraphRagRequest {
  tenantId: string;
  queryText: string;
  queryVector?: number[];
  traversalConfig: GraphTraversalConfig;
  requireEvidence: boolean;
  structuredFacts: Array<{ factId: string; fieldType: string; rawValue: string }>;
}

export interface GraphRagEvidence {
  sourceId: string; // e.g. a node ID, document ID, or fact ID
  sourceType: 'vector' | 'graph_node' | 'graph_edge' | 'structured_fact';
  excerpt: string;
  relevanceScore: number;
}

export interface GraphRagResponse {
  answerText: string; // The generated answer
  evidence: GraphRagEvidence[]; // Explicit references backing the answer
  confidence: number;
  generatedAt: Date;
  contextUsed: GraphRagContext;
}
