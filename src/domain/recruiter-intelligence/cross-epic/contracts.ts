export type EpicId =
  | 'user-intelligence'
  | 'opportunity-intelligence'
  | 'application-intelligence'
  | 'resume-intelligence'
  | 'company-intelligence'
  | 'recruiter-intelligence'
  | 'skills'
  | 'communication-intelligence';

export type IntelligenceDirection = 'publish' | 'consume' | 'bidirectional';

export type IntelligenceDomain = 'identity' | 'skills' | 'behavior' | 'opportunity' | 'company' | 'application' | 'resume' | 'communication' | 'decision' | 'reputation' | 'technical' | 'market';

export interface CrossEpicIntelligenceLink {
  linkId: string;
  sourceEpic: EpicId;
  targetEpic: EpicId;
  sourceEntityId: string;
  targetEntityId: string;
  domain: IntelligenceDomain;
  direction: IntelligenceDirection;
  intelligenceType: string;
  intelligence: Record<string, unknown>;
  confidence: number;
  evidence: CrossEpicEvidence[];
  provenance: CrossEpicProvenance;
  createdAt: Date;
  updatedAt: Date;
}

export interface CrossEpicEvidence {
  evidenceId: string;
  sourceEpic: EpicId;
  sourceEntityId: string;
  excerpt: string;
  confidence: number;
  provenance: CrossEpicProvenance;
}

export interface CrossEpicProvenance {
  extractor: string;
   method: 'deterministic' | 'ai_assisted' | 'hybrid' | 'graph_traversal' | 'semantic_match' | 'memory_lookup' | 'timeline_lookup';
  sourceProvider: string;
  model?: string;
  templateId?: string;
  templateVersion?: string;
  extractedAt: Date;
  consentState: 'granted' | 'denied' | 'unknown';
}

export interface CrossEpicIntelligenceMessage {
  messageId: string;
  sourceEpic: EpicId;
  sourceEntityId: string;
  targetEpic: EpicId;
  targetEntityId: string;
  domain: IntelligenceDomain;
  intelligence: Record<string, unknown>;
  confidence: number;
  evidence: CrossEpicEvidence[];
  provenance: CrossEpicProvenance;
  timestamp: Date;
  ttlMs?: number;
}

export interface CrossEpicIntelligenceBundle {
  bundleId: string;
  sourceEpic: EpicId;
  sourceEntityId: string;
  links: CrossEpicIntelligenceLink[];
  messages: CrossEpicIntelligenceMessage[];
  overallConfidence: number;
  generatedAt: Date;
}

export interface CrossEpicQuery {
  sourceEpic: EpicId;
  sourceEntityId: string;
  targetEpics?: EpicId[];
  domains?: IntelligenceDomain[];
  minConfidence?: number;
  requireEvidence?: boolean;
  maxResults?: number;
}

export interface CrossEpicQueryResult {
  query: CrossEpicQuery;
  results: CrossEpicIntelligenceLink[];
  messages: CrossEpicIntelligenceMessage[];
  totalConfidence: number;
  evidenceCount: number;
  completedAt: Date;
}

export interface CrossEpicIntegrationConfig {
  enabled: boolean;
  maxLinksPerEntity: number;
  maxMessagesPerEntity: number;
  defaultTtlMs: number;
  confidenceThreshold: number;
  deduplicationEnabled: boolean;
  provenanceTrackingEnabled: boolean;
  explainabilityEnabled: boolean;
}

export interface CrossEpicStats {
  totalLinks: number;
  activeLinks: number;
  linksByDomain: Record<IntelligenceDomain, number>;
  linksBySourceEpic: Record<EpicId, number>;
  linksByTargetEpic: Record<EpicId, number>;
  averageConfidence: number;
  messagesProcessed: number;
  lastUpdatedAt: Date;
}

export type CrossEpicIntelligenceStats = CrossEpicStats;