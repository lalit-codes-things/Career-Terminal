import type { ConfidenceBand, EvidenceRef, RecruiterId } from '../shared-kernel/types';

export type ProviderKind = 'openai' | 'anthropic' | 'vertex' | 'custom';

export interface LlmRequest {
  tenantId: RecruiterId;
  prompt: string;
  context?: Record<string, unknown>;
  modelHint?: string;
}

export interface ExtractionResult<T> {
  value: T;
  confidence: number;
  confidenceBand: ConfidenceBand;
  evidence: EvidenceRef[];
}

export interface LlmGateway {
  generate(request: LlmRequest): Promise<string>;
  extract<T>(request: LlmRequest): Promise<ExtractionResult<T>>;
}

export interface EmbeddingService {
  embed(input: string): Promise<number[]>;
}

export interface InferenceService {
  classify(input: string): Promise<ExtractionResult<Record<string, unknown>>>;
}

export interface AiProviderAdapter {
  provider: ProviderKind;
  generate(request: LlmRequest): Promise<string>;
  embed(input: string): Promise<number[]>;
}
