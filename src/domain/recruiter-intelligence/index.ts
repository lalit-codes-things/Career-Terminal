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
] as const;
