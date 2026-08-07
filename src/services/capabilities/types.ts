/**
 * Shared types for the capability framework.
 *
 * Every capability module has the same call shape:
 *   input → CapabilityResult (output + persisted Prediction + optional RecruiterFact rows)
 *
 * Capabilities are stateless functions that:
 *   1. Call ExtractionPipeline for AI work
 *   2. Write output to RecruiterFact (recruiter domain) or FactObservation (candidate domain)
 *   3. Log every call to Prediction with latency/cost/confidence
 */

export type CapabilityName =
  | 'understand'
  | 'extract'
  | 'infer'
  | 'predict'
  | 'recommend'
  | 'verify'
  | 'economic-extract'
  | 'interview-extract';

export interface CapabilityInput {
  /** User who owns this inference */
  userId: string;
  /** The entity being analysed (recruiter, opportunity, resume, company…) */
  entityId: string;
  entityType: 'recruiter' | 'opportunity' | 'resume' | 'application' | 'company' | 'candidate' | 'economicDocument' | 'interviewSession';
  /** Raw text or structured content to analyse */
  content: string;
  /** Extra k/v context forwarded to the prompt template */
  context?: Record<string, string>;
  /** Override which ExtractionPipeline template to use */
  templateId?: string;
  /** Planner decision context for audit trail */
  plannerContext?: Record<string, unknown>;
}

export interface CapabilityField {
  name: string;
  value: unknown;
  confidence: number;
  evidence: string;
}

export interface CapabilityResult {
  /** Prisma Prediction.id — created inside the capability call */
  predictionId: string;
  /** Capability that produced this */
  capability: CapabilityName;
  /** Key extracted fields */
  fields: CapabilityField[];
  /** Overall confidence across all fields */
  confidence: number;
  confidenceBand: 'low' | 'medium' | 'high' | 'critical';
  /** IDs of RecruiterFact rows written (when entityType === 'recruiter') */
  recruiterFactIds: string[];
  /** Latency from first token request to last write */
  latencyMs: number;
  /** Token accounting */
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  completedAt: Date;
}
