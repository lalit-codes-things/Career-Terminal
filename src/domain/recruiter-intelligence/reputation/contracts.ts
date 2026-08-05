import type { RecruiterId, TemporalFact } from '../shared-kernel/types';

// ─── Trust & Reputation Scoring ───────────────────────────────────────────────

export type TrustBand = 'very_low' | 'low' | 'moderate' | 'high' | 'very_high';
export type ReputationBand = 'poor' | 'below_average' | 'average' | 'good' | 'excellent';
export type GhostingRisk = 'very_low' | 'low' | 'moderate' | 'high' | 'very_high';

// ─── 10 Trust Signal Dimensions ───────────────────────────────────────────────

export interface TrustSignal {
  signalId: string;
  dimension: TrustDimension;
  score: number;           // 0–1
  label: string;
  reasoning: string;
  confidence: number;
  evidenceFactIds: string[];
  observedAt: Date;
}

export type TrustDimension =
  | 'response_reliability'
  | 'communication_professionalism'
  | 'hiring_consistency'
  | 'ghosting_probability'       // inverted: low ghosting = high trust
  | 'follow_up_reliability'
  | 'interview_reliability'
  | 'offer_reliability'
  | 'cancellation_behavior'      // inverted
  | 'candidate_experience'
  | 'recruiter_credibility';

// ─── Trust Score ──────────────────────────────────────────────────────────────

export interface TrustScore {
  scoreId: string;
  recruiterId: RecruiterId;
  score: number;                    // 0–1 weighted aggregate
  band: TrustBand;
  ghostingProbability: number;      // 0–1
  ghostingRisk: GhostingRisk;
  signalCount: number;
  confidence: number;
  computedAt: Date;
  evidenceFactIds: string[];
}

// ─── Reputation Score ─────────────────────────────────────────────────────────

export interface ReputationScore {
  scoreId: string;
  recruiterId: RecruiterId;
  score: number;                    // 0–1 weighted aggregate
  band: ReputationBand;
  historicalConsistency: number;    // 0–1
  recencyWeight: number;            // weight applied to recent observations
  confidence: number;
  computedAt: Date;
  evidenceFactIds: string[];
}

// ─── Reliability Summary ──────────────────────────────────────────────────────

export interface ReliabilitySummary {
  recruiterId: RecruiterId;
  summaryText: string;
  overallReliability: 'unreliable' | 'unreliable_but_improving' | 'moderately_reliable' | 'reliable' | 'highly_reliable';
  responseReliabilityNote: string;
  followUpReliabilityNote: string;
  offerReliabilityNote: string;
  confidence: number;
  generatedAt: Date;
}

// ─── Risk Factors ─────────────────────────────────────────────────────────────

export interface RiskFactor {
  riskId: string;
  category: 'ghosting' | 'cancellation' | 'inconsistency' | 'communication' | 'offer' | 'credibility';
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  probability: number;
  mitigationSuggestion: string;
  evidenceFactIds: string[];
}

// ─── Positive / Negative Indicators ──────────────────────────────────────────

export interface TrustIndicator {
  indicatorId: string;
  type: 'positive' | 'negative';
  dimension: TrustDimension;
  description: string;
  strength: 'weak' | 'moderate' | 'strong';
  confidence: number;
  evidenceFactIds: string[];
}

// ─── Full Trust & Reputation Result ──────────────────────────────────────────

export interface TrustReputationResult {
  resultId: string;
  recruiterId: RecruiterId;
  trustScore: TrustScore;
  reputationScore: ReputationScore;
  reliabilitySummary: ReliabilitySummary;
  riskFactors: RiskFactor[];
  positiveIndicators: TrustIndicator[];
  negativeIndicators: TrustIndicator[];
  signals: TrustSignal[];
  overallExplanation: string;
  generatedAt: Date;
}

// ─── Service Contract ─────────────────────────────────────────────────────────

export interface ReputationTrustService {
  score(recruiterId: RecruiterId, inputs: TrustInferenceInput): Promise<TrustReputationResult>;
  getHistory(recruiterId: RecruiterId): Promise<TemporalFact<TrustScore>[]>;
}

export interface TrustInferenceInput {
  facts: unknown[];           // RecruiterEntityFact[]
  reasoning: unknown;         // RecruiterReasoningResult
  behaviorProfile?: unknown;  // BehaviorProfile
  engineResult?: unknown;     // IntelligenceEngineResult
  interactionHistory?: TrustInteractionRecord[];
}

export interface TrustInteractionRecord {
  recordId: string;
  type: 'response' | 'follow_up' | 'interview' | 'offer' | 'cancellation' | 'ghosting';
  outcome: 'completed' | 'missed' | 'cancelled' | 'delayed' | 'unknown';
  observedAt: Date;
  latencyHours?: number;
  notes?: string;
}
