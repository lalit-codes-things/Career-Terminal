/**
 * Recommendation domain contracts — Section 17 of the architecture directive.
 *
 * Recommendations must be structured, versioned, explainable, and measurable.
 */

export interface RecommendationInput {
  readonly userId: string;
  readonly recommendationType: string;
  readonly targetType: string;
  readonly targetId?: string;
  readonly overallScore?: number;
  readonly scoreBreakdown?: Record<string, unknown>;
  readonly explanation?: string;
  readonly confidence?: number;
  readonly modelVersion?: string;
  readonly rankingPosition?: number;
  readonly feedback?: Record<string, unknown>;
  readonly eventualOutcome?: Record<string, unknown>;
}

export interface RecommendationRecord {
  readonly id: string;
  readonly userId: string;
  readonly recommendationType: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly overallScore: number | null;
  readonly scoreBreakdown: Record<string, unknown>;
  readonly explanation: string | null;
  readonly confidence: number | null;
  readonly modelVersion: string | null;
  readonly rankingPosition: number | null;
  readonly feedback: Record<string, unknown>;
  readonly eventualOutcome: Record<string, unknown>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const RECOMMENDATION_TYPES = {
  OPPORTUNITY: 'OPPORTUNITY',
  SKILL: 'SKILL',
  ROLE: 'ROLE',
  COMPANY: 'COMPANY',
  ACTION: 'ACTION',
} as const;

export type RecommendationType = (typeof RECOMMENDATION_TYPES)[keyof typeof RECOMMENDATION_TYPES];

export const RECOMMENDATION_TARGET_TYPES = {
  OPPORTUNITY: 'OPPORTUNITY',
  SKILL: 'SKILL',
  ROLE: 'ROLE',
  COMPANY: 'COMPANY',
  ACTION: 'ACTION',
} as const;

export type RecommendationTargetType = (typeof RECOMMENDATION_TARGET_TYPES)[keyof typeof RECOMMENDATION_TARGET_TYPES];
