// Prompt 25 — AI Reasoning Orchestrator Contracts

export type ReasoningStrategy =
  | 'single_step'
  | 'multi_step'
  | 'iterative'
  | 'self_consistency';

export interface ReasoningStepConfig {
  stepId: string;
  description: string;
  providerId?: string; // Optional specific provider
  modelName?: string; // Optional specific model
  fallbackModel?: string;
  expectedOutputSchema?: any; // JSON schema for structured output
  maxRetries?: number;
}

export interface ReasoningWorkflow {
  workflowId: string;
  strategy: ReasoningStrategy;
  steps: ReasoningStepConfig[];
  timeoutMs: number;
}

export interface IterativeReasoningStepResult {
  stepId: string;
  output: any; // Structured output from this step
  confidence: number;
  latencyMs: number;
  costEstimateTokens: number;
  evidenceUsed: string[];
}

export interface ReasoningResult<T = any> {
  resultId: string;
  finalOutput: T; // The structured final output
  overallConfidence: number;
  stepResults: IterativeReasoningStepResult[];
  totalLatencyMs: number;
  totalTokensUsed: number;
  completedAt: Date;
}
