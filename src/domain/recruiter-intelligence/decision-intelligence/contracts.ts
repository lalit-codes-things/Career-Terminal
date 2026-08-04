import type { EvidenceRef, RecruiterId } from '../shared-kernel/types';

// ─── Decision Prediction Types ────────────────────────────────────────────────

export interface DecisionPrediction {
  predictionId: string;
  dimension: DecisionDimension;
  probability: number;           // 0–1
  confidence: number;            // confidence in the prediction itself
  confidenceBand: 'low' | 'medium' | 'high' | 'critical';
  label: string;
  reasoning: string;
  supportingEvidence: string[];
  sourceFactIds: string[];
  predictedAt: Date;
}

export type DecisionDimension =
  | 'interview_likelihood'
  | 'response_likelihood'
  | 'follow_up_likelihood'
  | 'rejection_probability'
  | 'offer_probability'
  | 'escalation_probability'
  | 'candidate_fit'
  | 'hiring_confidence'
  | 'engagement_probability';

// ─── Decision Profile ─────────────────────────────────────────────────────────

export interface DecisionProfile {
  profileId: string;
  recruiterId: RecruiterId;

  // 9 decision predictions
  interviewLikelihood: DecisionPrediction;
  responseLikelihood: DecisionPrediction;
  followUpLikelihood: DecisionPrediction;
  rejectionProbability: DecisionPrediction;
  offerProbability: DecisionPrediction;
  escalationProbability: DecisionPrediction;
  candidateFit: DecisionPrediction;
  hiringConfidence: DecisionPrediction;
  engagementProbability: DecisionPrediction;

  overallDecisionScore: number;     // weighted composite
  overallConfidence: number;
  decisionStyle: DecisionStyle;
  generatedAt: Date;
  version: number;
  evidenceRefs: EvidenceRef[];
}

export type DecisionStyle =
  | 'fast_mover'
  | 'thorough_evaluator'
  | 'committee_dependent'
  | 'inconsistent'
  | 'deadline_driven'
  | 'unknown';

// ─── Decision Timeline ────────────────────────────────────────────────────────

export interface DecisionTimelineEvent {
  eventId: string;
  recruiterId: RecruiterId;
  dimension: DecisionDimension;
  previousProbability?: number;
  newProbability: number;
  deltaDescription: string;
  trigger: string;               // what caused the change
  occurredAt: Date;
  confidence: number;
  evidenceFactIds: string[];
}

export interface DecisionTimeline {
  recruiterId: RecruiterId;
  events: DecisionTimelineEvent[];
  firstDecisionAt: Date;
  lastUpdatedAt: Date;
}

// ─── Decision Confidence ──────────────────────────────────────────────────────

export interface DecisionConfidence {
  recruiterId: RecruiterId;
  overallConfidence: number;
  dimensionConfidences: Record<DecisionDimension, number>;
  dataQualityScore: number;      // 0–1: how much data was available
  predictionReliabilityNote: string;
}

// ─── Supporting Evidence ──────────────────────────────────────────────────────

export interface DecisionEvidence {
  evidenceId: string;
  dimension: DecisionDimension;
  excerpts: string[];
  sourceFactIds: string[];
  weight: number;             // how much this evidence contributed
  direction: 'positive' | 'negative' | 'neutral';
}

// ─── Prediction Explanation ───────────────────────────────────────────────────

export interface PredictionExplanation {
  recruiterId: RecruiterId;
  dimension: DecisionDimension;
  topFactors: ExplanationFactor[];
  counterFactors: ExplanationFactor[];
  summaryText: string;
  confidenceNote: string;
}

export interface ExplanationFactor {
  factor: string;
  impact: 'low' | 'medium' | 'high';
  direction: 'increases' | 'decreases';
  evidenceExcerpt: string;
}

// ─── Full Decision Intelligence Result ───────────────────────────────────────

export interface DecisionIntelligenceResult {
  resultId: string;
  recruiterId: RecruiterId;
  decisionProfile: DecisionProfile;
  decisionTimeline: DecisionTimeline;
  decisionConfidence: DecisionConfidence;
  supportingEvidence: DecisionEvidence[];
  explanations: PredictionExplanation[];
  generatedAt: Date;
}

// ─── Service Contract ─────────────────────────────────────────────────────────

export interface DecisionIntelligenceService {
  predict(recruiterId: RecruiterId, inputs: DecisionInferenceInput): Promise<DecisionIntelligenceResult>;
  explain(recruiterId: RecruiterId, dimension: DecisionDimension): Promise<PredictionExplanation>;
}

export interface DecisionInferenceInput {
  facts: unknown[];              // RecruiterEntityFact[]
  reasoning: unknown;            // RecruiterReasoningResult
  behaviorProfile?: unknown;     // BehaviorProfile
  trustScore?: unknown;          // TrustScore
  expertiseProfile?: unknown;    // RecruiterExpertiseProfile
  engineResult?: unknown;        // IntelligenceEngineResult
}
