export * from './shared-kernel/types';
export * from './events/domain-events';
export * from './identity-resolution/contracts';
export * from './knowledge-graph/contracts';
export * from './communication-intelligence/contracts';
export * from './relationship-intelligence/contracts';
export * from './behavior-intelligence/contracts';
export * from './organization-intelligence/contracts';
export * from './timeline/contracts';
export * from './memory/contracts';
export * from './search/contracts';
export * from './ai/contracts';
export * from './application/contracts';

// Batch 4 — Behavioral & Decision Intelligence
export * from './reputation/contracts';
export * from './specialization/contracts';
export * from './decision-intelligence/contracts';
export * from './insights/contracts';

// Batch 5 — Semantic & GraphRAG Foundation
export * from './semantic-representation/contracts';
export * from './vector-search/contracts';
export * from './graph-rag/contracts';
export * from './context-orchestration/contracts';
export * from './reasoning-orchestrator/contracts';

// Batch 6 — Autonomous & Copilot
export * from './copilot/contracts';
export * from './autonomous-intelligence/contracts';

export const recruiterIntelligenceBoundedContexts = [
  'identity-resolution',
  'knowledge-graph',
  'communication-intelligence',
  'relationship-intelligence',
  'behavior-intelligence',
  'organization-intelligence',
  'timeline',
  'memory',
  'search',
  'ai',
  // Batch 4
  'reputation',
  'specialization',
  'decision-intelligence',
  'insights',
  // Batch 5
  'semantic-representation',
  'vector-search',
  'graph-rag',
  'context-orchestration',
  'reasoning-orchestrator',
  // Batch 6
  'copilot',
  'autonomous-intelligence',
] as const;
