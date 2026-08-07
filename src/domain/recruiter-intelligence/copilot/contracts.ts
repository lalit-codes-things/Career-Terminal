// AI Recruiter Copilot Contracts
import type { GraphRagContext } from '../graph-rag/contracts';

export type CopilotIntent =
  | 'summarize_recruiter'
  | 'analyze_relationship'
  | 'compare_recruiters'
  | 'extract_insights'
  | 'general_query';

export interface CopilotQueryOptions {
  requireEvidence?: boolean;
  maxTokens?: number;
  prioritizedSources?: Array<'memory' | 'timeline' | 'facts' | 'graph'>;
}

export interface CopilotMessage {
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface CopilotConversation {
  conversationId: string;
  tenantId: string;
  recruiterId?: string; // Optional if querying about multiple recruiters
  messages: CopilotMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Citation {
  citationId: string;
  sourceType: string;
  excerpt: string;
  relevanceScore: number;
}

export interface CopilotResponse {
  responseId: string;
  conversationId: string;
  answerText: string;
  intentDetected: CopilotIntent;
  confidence: number;
  citations: Citation[];
  contextUsed?: GraphRagContext; // Exposed for explainability
  suggestedFollowUps: string[];
  generatedAt: Date;
}
