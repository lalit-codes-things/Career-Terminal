export type EvaluationDimension =
  | 'accuracy'
  | 'precision'
  | 'recall'
  | 'f1_score'
  | 'hallucination_rate'
  | 'evidence_fidelity'
  | 'provenance_completeness'
  | 'confidence_calibration'
  | 'latency'
  | 'cost_efficiency'
  | 'token_efficiency'
  | 'explainability';

export type EvaluationPhase = 'offline' | 'online' | 'regression' | 'benchmark';

export type PromptExperimentStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';

export type ModelTier = 'fast' | 'balanced' | 'powerful';

export type QualityProviderKind = 'openrouter' | 'vertex' | 'stub';

export interface EvaluationResult {
  evaluationId: string;
  phase: EvaluationPhase;
  dimension: EvaluationDimension;
  score: number;
  confidence: number;
  evidence: string[];
  metadata: Record<string, unknown>;
  recordedAt: Date;
}

export interface PromptVersion {
  versionId: string;
  templateId: string;
  version: string;
  systemPrompt: string;
  userPromptTemplate: string;
  outputSchema: Record<string, unknown>;
  maxTokens: number;
  temperature: number;
  tier: ModelTier;
  changelog: string;
  createdAt: Date;
  createdBy: string;
  isActive: boolean;
}

export interface PromptRegistryEntry {
  templateId: string;
  name: string;
  description: string;
  versions: PromptVersion[];
  activeVersion: string;
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
}

export interface PromptExperiment {
  experimentId: string;
  name: string;
  description: string;
  templateId: string;
  baselineVersion: string;
  candidateVersion: string;
  status: PromptExperimentStatus;
  metrics: ExperimentMetrics;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface ExperimentMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  hallucinationRate: number;
  evidenceFidelity: number;
  confidenceCalibration: number;
  latencyMs: number;
  costUsd: number;
  tokenUsage: { input: number; output: number };
}

export interface ModelEntry {
  modelId: string;
  provider: QualityProviderKind;
  modelName: string;
  tier: ModelTier;
  capabilities: string[];
  maxTokens: number;
  costPerTokenUsd: number;
  latencyMs: number;
  isActive: boolean;
  createdAt: Date;
}

export interface ModelEvaluation {
  evaluationId: string;
  modelId: string;
  templateId: string;
  phase: EvaluationPhase;
  results: Map<EvaluationDimension, EvaluationResult>;
  overallScore: number;
  completedAt: Date;
}

export interface ConfidenceCalibrationResult {
  calibrationId: string;
  modelId: string;
  templateId: string;
  totalPredictions: number;
  correctPredictions: number;
  calibrationError: number;
  ece: number;
  brierScore: number;
  reliabilityDiagram: Array<{ bin: string; accuracy: number; confidence: number; count: number }>;
  completedAt: Date;
}

export interface HallucinationDetectionResult {
  detectionId: string;
  extractionId: string;
  hasHallucination: boolean;
  hallucinatedFields: string[];
  evidenceSupport: Record<string, number>;
  confidence: number;
  explanation: string;
  completedAt: Date;
}

export interface QualityMetrics {
  metricId: string;
  timestamp: Date;
  dimension: EvaluationDimension;
  value: number;
  confidence: number;
  source: string;
  metadata: Record<string, unknown>;
}

export interface CostMetrics {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  averageCostPerCallUsd: number;
  averageLatencyMs: number;
  averageTokensPerCall: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  recordedAt: Date;
}

export interface TraceSpan {
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  startTime: Date;
  endTime: Date;
  durationMs: number;
  attributes: Record<string, unknown>;
  events: TraceEvent[];
  status: 'ok' | 'error' | 'unset';
}

export interface TraceEvent {
  eventId: string;
  name: string;
  timestamp: Date;
  attributes: Record<string, unknown>;
}

export interface InferenceLogEntry {
  logId: string;
  extractionId: string;
  templateId: string;
  provider: QualityProviderKind;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costUsd: number;
  confidence: number;
  requiresReview: boolean;
  timestamp: Date;
}

export interface FeedbackEntry {
  feedbackId: string;
  extractionId: string;
  rating: number;
  comment: string;
  reviewerId: string;
  timestamp: Date;
}

export interface BenchmarkSuite {
  suiteId: string;
  name: string;
  description: string;
  benchmarks: BenchmarkDefinition[];
  createdAt: Date;
  updatedAt: Date;
}

export interface BenchmarkDefinition {
  benchmarkId: string;
  name: string;
  description: string;
  datasetSize: number;
  evaluationDimensions: EvaluationDimension[];
  passThreshold: number;
  isActive: boolean;
}

export interface RegressionTestResult {
  testId: string;
  benchmarkId: string;
  modelId: string;
  templateId: string;
  passed: boolean;
  score: number;
  threshold: number;
  delta: number;
  details: Record<string, number>;
  completedAt: Date;
}

export interface ProviderComparison {
  comparisonId: string;
  providers: QualityProviderKind[];
  models: string[];
  templateId: string;
  results: Map<QualityProviderKind, EvaluationResult[]>;
  winner: QualityProviderKind;
  completedAt: Date;
}

export interface ModelComparison {
  comparisonId: string;
  modelIds: string[];
  templateId: string;
  results: Map<string, EvaluationResult[]>;
  winner: string;
  completedAt: Date;
}

export interface PromptComparison {
  comparisonId: string;
  templateId: string;
  versions: string[];
  results: Map<string, EvaluationResult[]>;
  winner: string;
  completedAt: Date;
}