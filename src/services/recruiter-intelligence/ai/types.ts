import type { ConfidenceBand, EvidenceRef, Provenance } from '../../../domain/recruiter-intelligence/shared-kernel/types';

// ─── Provider ────────────────────────────────────────────────────────────────

export type AiProviderKind = 'deepseek' | 'openrouter' | 'stub';

export type AiModelTier = 'fast' | 'balanced' | 'powerful';

// ─── Prompt Management ────────────────────────────────────────────────────────

export interface PromptTemplate {
  templateId: string;
  name: string;
  version: string;
  tier: AiModelTier;
  systemPrompt: string;
  userPromptTemplate: string;
  outputSchema: Record<string, unknown>;
  maxTokens: number;
  temperature: number;
  createdAt: Date;
}

export interface RenderedPrompt {
  templateId: string;
  templateVersion: string;
  systemPrompt: string;
  userPrompt: string;
  estimatedInputTokens: number;
}

// ─── Model Usage / Cost ───────────────────────────────────────────────────────

export interface ModelUsageRecord {
  usageId: string;
  provider: AiProviderKind;
  model: string;
  templateId: string;
  tenantId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  success: boolean;
  error?: string;
  recordedAt: Date;
}

export interface CostBudget {
  maxUsdPerCall: number;
  maxTokensPerCall: number;
  maxCallsPerMinute: number;
}

// ─── Rate Limiting ────────────────────────────────────────────────────────────

export interface RateLimitState {
  windowStartMs: number;
  callsInWindow: number;
  tokensInWindow: number;
}

export interface RateLimiter {
  acquire(tokens: number): Promise<void>;
  isAllowed(tokens: number): boolean;
  reset(): void;
}

// ─── Extraction Pipeline I/O ──────────────────────────────────────────────────

export interface ExtractionInput {
  extractionId: string;
  tenantId: string;
  sourceType: 'email' | 'thread' | 'document' | 'profile';
  sourceId: string;
  content: string;
  metadata: Record<string, unknown>;
  requestedAt: Date;
}

export interface ExtractionEvidence {
  sourceId: string;
  excerpt: string;
  startOffset?: number;
  endOffset?: number;
  confidence: number;
}

export interface ExtractedField<T = unknown> {
  field: string;
  value: T;
  rawValue: string;
  confidence: number;
  confidenceBand: ConfidenceBand;
  evidence: ExtractionEvidence[];
  provenance: Provenance;
  normalizedValue?: T;
  reasoning?: string;
}

export interface ExtractionOutput {
  extractionId: string;
  templateId: string;
  templateVersion: string;
  provider: AiProviderKind;
  model: string;
  fields: ExtractedField[];
  overallConfidence: number;
  confidenceBand: ConfidenceBand;
  evidence: EvidenceRef[];
  provenance: Provenance;
  usage: Omit<ModelUsageRecord, 'usageId' | 'recordedAt'>;
  completedAt: Date;
  requiresHumanReview: boolean;
  reviewReason?: string;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'critical';
}

export interface ValidationWarning {
  field: string;
  message: string;
}

// ─── Retry ────────────────────────────────────────────────────────────────────

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

export interface RetryContext {
  attempt: number;
  lastError?: string;
  totalDelayMs: number;
}

// ─── Batch ────────────────────────────────────────────────────────────────────

export interface BatchExtractionRequest {
  batchId: string;
  tenantId: string;
  items: ExtractionInput[];
  concurrency: number;
  priority: 'low' | 'normal' | 'high';
}

export interface BatchExtractionResult {
  batchId: string;
  totalItems: number;
  succeeded: number;
  failed: number;
  results: Array<{ extractionId: string; output?: ExtractionOutput; error?: string }>;
  completedAt: Date;
  totalUsage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number };
}

// ─── Streaming ────────────────────────────────────────────────────────────────

export interface StreamChunk {
  chunkIndex: number;
  delta: string;
  finished: boolean;
}

export type StreamHandler = (chunk: StreamChunk) => void;

// ─── Human Review ─────────────────────────────────────────────────────────────

export interface HumanReviewRequest {
  reviewId: string;
  extractionId: string;
  reason: string;
  flaggedFields: string[];
  extractedData: Record<string, unknown>;
  confidence: number;
  queuedAt: Date;
}

export interface HumanReviewHook {
  queue(request: HumanReviewRequest): Promise<void>;
  isReviewRequired(output: ExtractionOutput): boolean;
}

// ─── Provider Adapter ─────────────────────────────────────────────────────────

export interface AiAdapterRequest {
  provider: AiProviderKind;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  temperature: number;
  stream?: boolean;
  onChunk?: StreamHandler;
}

export interface AiAdapterResponse {
  rawText: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  finishReason: 'stop' | 'length' | 'error';
  latencyMs: number;
}

export interface AiModelAdapter {
  readonly provider: AiProviderKind;
  readonly supportedModels: string[];
  complete(request: AiAdapterRequest): Promise<AiAdapterResponse>;
}
