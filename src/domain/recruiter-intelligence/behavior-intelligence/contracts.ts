import type { EvidenceRef, RecruiterId } from '../shared-kernel/types';

// ─── Behavioral Dimension Enums ───────────────────────────────────────────────

export type CommunicationStyle =
  | 'formal' | 'casual' | 'direct' | 'warm' | 'technical' | 'consultative' | 'unknown';

export type ResponsivenessLevel = 'very_slow' | 'slow' | 'moderate' | 'fast' | 'very_fast' | 'unknown';

export type FollowUpBehavior =
  | 'never_follows_up' | 'rarely_follows_up' | 'sometimes_follows_up'
  | 'consistently_follows_up' | 'aggressively_follows_up' | 'unknown';

export type HiringUrgencyLevel = 'exploratory' | 'low' | 'medium' | 'high' | 'critical' | 'unknown';

export type EngagementLevel = 'disengaged' | 'passive' | 'moderate' | 'active' | 'highly_engaged' | 'unknown';

export type PreferredChannel = 'email' | 'linkedin' | 'phone' | 'video' | 'sms' | 'inmail' | 'unknown';

export type SchedulingBehavior =
  | 'delegates_scheduling' | 'self_schedules' | 'uses_scheduling_link'
  | 'informal_scheduling' | 'unknown';

export type ConsistencyLevel = 'inconsistent' | 'somewhat_consistent' | 'consistent' | 'highly_consistent' | 'unknown';

export type ResponseQuality = 'poor' | 'adequate' | 'good' | 'excellent' | 'unknown';

export type DecisionPattern =
  | 'fast_decisive' | 'deliberate' | 'committee_driven' | 'erratic' | 'unknown';

// ─── Behavioral Inference ─────────────────────────────────────────────────────

export interface BehavioralDimension<T = unknown> {
  dimensionId: string;
  dimension: string;
  value: T;
  reasoning: string;
  confidence: number;
  confidenceBand: 'low' | 'medium' | 'high' | 'critical';
  supportingEvidence: string[];
  sourceFactIds: string[];
  inferredAt: Date;
  method: 'deterministic' | 'ai_assisted';
}

// ─── Core Behavior Profile ────────────────────────────────────────────────────

export interface BehaviorProfile {
  profileId: string;
  recruiterId: RecruiterId;

  // 13 behavioral dimensions
  communicationStyle: BehavioralDimension<CommunicationStyle>;
  responsiveness: BehavioralDimension<ResponsivenessLevel>;
  followUpBehavior: BehavioralDimension<FollowUpBehavior>;
  hiringUrgency: BehavioralDimension<HiringUrgencyLevel>;
  recruiterEngagement: BehavioralDimension<EngagementLevel>;
  recruiterPreferences: BehavioralDimension<string[]>;
  preferredCommunicationChannels: BehavioralDimension<PreferredChannel[]>;
  schedulingBehavior: BehavioralDimension<SchedulingBehavior>;
  recruiterConsistency: BehavioralDimension<ConsistencyLevel>;
  activityPatterns: BehavioralDimension<ActivityPattern>;
  responseQuality: BehavioralDimension<ResponseQuality>;
  responsivenessTrends: BehavioralDimension<ResponsivenessTrend>;
  decisionMakingPatterns: BehavioralDimension<DecisionPattern>;

  overallBehaviorScore: number;  // 0–1
  overallConfidence: number;
  generatedAt: Date;
  version: number;
  evidenceRefs: EvidenceRef[];
}

export interface ActivityPattern {
  preferredDays: string[];          // e.g. ['Monday', 'Tuesday']
  preferredTimeOfDay: string;       // e.g. 'morning', 'afternoon', 'evening'
  averageResponseWindowHours: number;
  messagingFrequency: 'sporadic' | 'regular' | 'frequent' | 'unknown';
  peakActivityDescription: string;
}

export interface ResponsivenessTrend {
  direction: 'improving' | 'stable' | 'declining' | 'unknown';
  magnitude: 'negligible' | 'moderate' | 'significant';
  periodDays: number;
  description: string;
}

// ─── Behavior Timeline ────────────────────────────────────────────────────────

export interface BehaviorTimelineEvent {
  eventId: string;
  recruiterId: RecruiterId;
  eventType: BehaviorEventType;
  dimension: string;
  previousValue?: unknown;
  newValue: unknown;
  deltaDescription: string;
  occurredAt: Date;
  confidence: number;
  evidenceFactIds: string[];
}

export type BehaviorEventType =
  | 'behavior_first_observed'
  | 'behavior_updated'
  | 'behavior_trend_changed'
  | 'behavior_anomaly_detected'
  | 'behavior_confirmed';

export interface BehaviorTimeline {
  recruiterId: RecruiterId;
  events: BehaviorTimelineEvent[];
  firstObservedAt: Date;
  lastUpdatedAt: Date;
}

// ─── Behavior Confidence ──────────────────────────────────────────────────────

export interface BehaviorConfidence {
  recruiterId: RecruiterId;
  overallConfidence: number;
  dimensionConfidences: Record<string, number>;
  evidenceCount: number;
  observationSpanDays: number;
  reliabilityNote: string;
}

// ─── Behavior Summary ─────────────────────────────────────────────────────────

export interface BehaviorSummary {
  recruiterId: RecruiterId;
  summaryText: string;
  keyBehavioralTraits: string[];
  engagementRecommendation: string;
  redFlags: string[];
  positiveSignals: string[];
  confidence: number;
  generatedAt: Date;
}

// ─── Behavior Evolution ───────────────────────────────────────────────────────

export interface BehaviorEvolution {
  recruiterId: RecruiterId;
  dimensionEvolutions: DimensionEvolution[];
  overallTrend: 'improving' | 'stable' | 'declining' | 'mixed' | 'insufficient_data';
  evolutionSummary: string;
  confidence: number;
}

export interface DimensionEvolution {
  dimension: string;
  snapshots: Array<{ value: unknown; confidence: number; observedAt: Date }>;
  trend: 'improving' | 'stable' | 'declining' | 'unknown';
  changeDescription: string;
}

// ─── Full Behavioral Result ───────────────────────────────────────────────────

export interface BehavioralIntelligenceResult {
  resultId: string;
  recruiterId: RecruiterId;
  profile: BehaviorProfile;
  timeline: BehaviorTimeline;
  confidence: BehaviorConfidence;
  summary: BehaviorSummary;
  evolution: BehaviorEvolution;
  generatedAt: Date;
}

// ─── Service Contract ─────────────────────────────────────────────────────────

export interface BehaviorIntelligenceService {
  infer(recruiterId: RecruiterId, inputs: BehaviorInferenceInput): Promise<BehavioralIntelligenceResult>;
  update(recruiterId: RecruiterId, newEvidence: BehaviorEvidence[]): Promise<BehaviorEvolution>;
  getTimeline(recruiterId: RecruiterId): Promise<BehaviorTimeline>;
}

export interface BehaviorInferenceInput {
  facts: unknown[];            // RecruiterEntityFact[]
  reasoning: unknown;          // RecruiterReasoningResult
  engineResult?: unknown;      // IntelligenceEngineResult
  priorProfile?: BehaviorProfile;
  messageHistory?: BehaviorEvidence[];
}

export interface BehaviorEvidence {
  evidenceId: string;
  sourceType: 'message' | 'interaction' | 'event';
  sourceId: string;
  observedAt: Date;
  signals: Record<string, unknown>;
}
