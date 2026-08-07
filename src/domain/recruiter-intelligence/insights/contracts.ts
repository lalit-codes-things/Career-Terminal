import type { RecruiterId } from '../shared-kernel/types';

// ─── Insight Category Types ───────────────────────────────────────────────────

export type InsightCategory =
  | 'recruiter_summary'
  | 'communication_summary'
  | 'hiring_summary'
  | 'engagement_summary'
  | 'opportunity_summary'
  | 'candidate_recommendation'
  | 'follow_up_recommendation'
  | 'communication_recommendation'
  | 'timing_recommendation'
  | 'relationship_recommendation'
  | 'recruiter_risk_alert'
  | 'opportunity_alert';

export type InsightSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type InsightPriority = 'low' | 'normal' | 'high' | 'urgent';

// ─── Individual Insight ───────────────────────────────────────────────────────

export interface RecruiterInsight {
  insightId: string;
  recruiterId: RecruiterId;
  category: InsightCategory;
  title: string;
  text: string;
  confidence: number;
  severity: InsightSeverity;
  priority: InsightPriority;
  actionable: boolean;
  suggestedAction?: string;
  evidenceFactIds: string[];
  reasoning: string;
  generatedAt: Date;
  expiresAt?: Date;
}

// ─── Summaries ────────────────────────────────────────────────────────────────

export interface RecruiterSummaryInsight {
  recruiterId: RecruiterId;
  overallSummary: string;
  behaviorSummary: string;
  reputationSummary: string;
  specializationSummary: string;
  decisionSummary: string;
  confidence: number;
  evidenceFactIds: string[];
  generatedAt: Date;
}

export interface CommunicationSummaryInsight {
  recruiterId: RecruiterId;
  style: string;
  tone: string;
  preferredChannels: string[];
  responsePattern: string;
  communicationStrengths: string[];
  communicationWeaknesses: string[];
  confidence: number;
  evidenceFactIds: string[];
}

export interface HiringSummaryInsight {
  recruiterId: RecruiterId;
  hiringPace: string;
  activeRoles: string[];
  hiringVelocityNote: string;
  decisionSpeed: string;
  offerConversionRate: string;
  confidence: number;
  evidenceFactIds: string[];
}

export interface EngagementSummaryInsight {
  recruiterId: RecruiterId;
  engagementLevel: string;
  engagementTrend: string;
  keyEngagementSignals: string[];
  riskOfDisengagement: number;  // 0–1
  confidence: number;
  evidenceFactIds: string[];
}

export interface OpportunitySummaryInsight {
  recruiterId: RecruiterId;
  currentOpportunities: OpportunitySignal[];
  opportunityScore: number;     // 0–1: how hot this lead is
  timeToAct: string;
  confidence: number;
  evidenceFactIds: string[];
}

export interface OpportunitySignal {
  signal: string;
  strength: 'weak' | 'moderate' | 'strong';
  evidenceExcerpt: string;
}

// ─── Recommendations ──────────────────────────────────────────────────────────

export interface CandidateRecommendation {
  insightId: string;
  recruiterId: RecruiterId;
  recommendation: string;
  rationale: string;
  priority: InsightPriority;
  confidence: number;
  evidenceFactIds: string[];
}

export interface FollowUpRecommendation {
  insightId: string;
  recruiterId: RecruiterId;
  action: string;
  timing: string;
  channel: string;
  urgency: InsightPriority;
  rationale: string;
  confidence: number;
  evidenceFactIds: string[];
}

export interface CommunicationRecommendation {
  insightId: string;
  recruiterId: RecruiterId;
  recommendedStyle: string;
  recommendedTone: string;
  recommendedChannel: string;
  messagingTips: string[];
  avoidPatterns: string[];
  confidence: number;
  evidenceFactIds: string[];
}

export interface TimingRecommendation {
  insightId: string;
  recruiterId: RecruiterId;
  bestTimeToContact: string;
  bestDaysToContact: string[];
  urgencyWindow: string;
  rationale: string;
  confidence: number;
  evidenceFactIds: string[];
}

export interface RelationshipRecommendation {
  insightId: string;
  recruiterId: RecruiterId;
  relationshipStrategy: string;
  nextSteps: string[];
  longTermStrategy: string;
  riskMitigation: string[];
  confidence: number;
  evidenceFactIds: string[];
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

export interface RecruiterRiskAlert {
  alertId: string;
  recruiterId: RecruiterId;
  alertType: RiskAlertType;
  title: string;
  description: string;
  severity: InsightSeverity;
  probability: number;
  mitigationAdvice: string;
  evidenceFactIds: string[];
  triggeredAt: Date;
}

export type RiskAlertType =
  | 'ghosting_risk'
  | 'inconsistency_detected'
  | 'trust_declining'
  | 'engagement_dropping'
  | 'credibility_concern'
  | 'cancellation_pattern';

export interface OpportunityAlert {
  alertId: string;
  recruiterId: RecruiterId;
  alertType: OpportunityAlertType;
  title: string;
  description: string;
  urgency: InsightPriority;
  opportunityWindow: string;
  suggestedAction: string;
  evidenceFactIds: string[];
  triggeredAt: Date;
}

export type OpportunityAlertType =
  | 'high_urgency_role'
  | 'offer_imminent'
  | 'interview_window_opening'
  | 'recruiter_highly_engaged'
  | 'rare_opportunity';

// ─── Full Insights Result ─────────────────────────────────────────────────────

export interface RecruiterInsightsResult {
  resultId: string;
  recruiterId: RecruiterId;

  // Summaries
  recruiterSummary: RecruiterSummaryInsight;
  communicationSummary: CommunicationSummaryInsight;
  hiringSummary: HiringSummaryInsight;
  engagementSummary: EngagementSummaryInsight;
  opportunitySummary: OpportunitySummaryInsight;

  // Recommendations
  candidateRecommendations: CandidateRecommendation[];
  followUpRecommendations: FollowUpRecommendation[];
  communicationRecommendations: CommunicationRecommendation[];
  timingRecommendations: TimingRecommendation[];
  relationshipRecommendations: RelationshipRecommendation[];

  // Alerts
  riskAlerts: RecruiterRiskAlert[];
  opportunityAlerts: OpportunityAlert[];

  // All insights as flat list for easy traversal
  allInsights: RecruiterInsight[];

  // Reasoning provenance
  reasoningChain: ReasoningStep[];
  overallConfidence: number;
  generatedAt: Date;
}

// ─── Multi-turn Reasoning ─────────────────────────────────────────────────────

export interface ReasoningStep {
  stepId: string;
  stepType: 'memory_recall' | 'timeline_analysis' | 'graph_traversal' | 'inference' | 'synthesis';
  description: string;
  inputSummary: string;
  outputSummary: string;
  confidence: number;
  evidenceFactIds: string[];
}

// ─── Service Contract ─────────────────────────────────────────────────────────

export interface InsightsEngineService {
  generate(recruiterId: RecruiterId, inputs: InsightsEngineInput): Promise<RecruiterInsightsResult>;
  refresh(recruiterId: RecruiterId, newEvidence: unknown[]): Promise<RecruiterInsightsResult>;
}

export interface InsightsEngineInput {
  facts: unknown[];                  // RecruiterEntityFact[]
  reasoning: unknown;                // RecruiterReasoningResult
  engineResult?: unknown;            // IntelligenceEngineResult 
  behavioralResult?: unknown;        // BehavioralIntelligenceResult
  trustResult?: unknown;             // TrustReputationResult
  specializationResult?: unknown;    // SpecializationIntelligenceResult
  decisionResult?: unknown;          // DecisionIntelligenceResult
  memoryContext?: MemoryContext;
  timelineContext?: TimelineContext;
  graphContext?: GraphContext;
}

export interface MemoryContext {
  recentFacts: unknown[];
  memorySpanDays: number;
}

export interface TimelineContext {
  recentEvents: unknown[];
  timelineSpanDays: number;
}

export interface GraphContext {
  relatedNodes: string[];
  relationships: string[];
}
