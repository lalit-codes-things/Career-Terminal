/**
 * Career event taxonomy — immutable lifecycle events for the intelligence pipeline.
 *
 * Section 15 of the architecture directive requires an immutable career-event
 * layer for important lifecycle changes.  These types provide the canonical
 * vocabulary while preserving backward compatibility with the existing
 * resume-oriented event handling.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Resume lifecycle events (existing)
// ─────────────────────────────────────────────────────────────────────────────

export const RESUME_EVENTS = {
  RESUME_UPLOADED: 'RESUME_UPLOADED',
  RESUME_CLEANED: 'RESUME_CLEANED',
  RESUME_PARSED: 'RESUME_PARSED',
} as const;

export type ResumeEventType = (typeof RESUME_EVENTS)[keyof typeof RESUME_EVENTS];

// ─────────────────────────────────────────────────────────────────────────────
// Application lifecycle events
// ─────────────────────────────────────────────────────────────────────────────

export const APPLICATION_EVENTS = {
  APPLICATION_CREATED: 'APPLICATION_CREATED',
  APPLICATION_SUBMITTED: 'APPLICATION_SUBMITTED',
  APPLICATION_STATUS_CHANGED: 'APPLICATION_STATUS_CHANGED',
  APPLICATION_TIMELINE_EVENT_ADDED: 'APPLICATION_TIMELINE_EVENT_ADDED',
} as const;

export type ApplicationEventType = (typeof APPLICATION_EVENTS)[keyof typeof APPLICATION_EVENTS];

// ─────────────────────────────────────────────────────────────────────────────
// Outcome events
// ─────────────────────────────────────────────────────────────────────────────

export const OUTCOME_EVENTS = {
  OUTCOME_RECORDED: 'OUTCOME_RECORDED',
  OFFER_RECEIVED: 'OFFER_RECEIVED',
  OFFER_ACCEPTED: 'OFFER_ACCEPTED',
  OFFER_DECLINED: 'OFFER_DECLINED',
  REJECTION_RECEIVED: 'REJECTION_RECEIVED',
  WITHDRAWN: 'WITHDRAWN',
  NO_RESPONSE: 'NO_RESPONSE',
} as const;

export type OutcomeEventType = (typeof OUTCOME_EVENTS)[keyof typeof OUTCOME_EVENTS];

// ─────────────────────────────────────────────────────────────────────────────
// Action events
// ─────────────────────────────────────────────────────────────────────────────

export const ACTION_EVENTS = {
  ACTION_RECORDED: 'ACTION_RECORDED',
  OPPORTUNITY_SAVED: 'OPPORTUNITY_SAVED',
  OPPORTUNITY_APPLIED: 'OPPORTUNITY_APPLIED',
  OPPORTUNITY_DISMISSED: 'OPPORTUNITY_DISMISSED',
} as const;

export type ActionEventType = (typeof ACTION_EVENTS)[keyof typeof ACTION_EVENTS];

// ─────────────────────────────────────────────────────────────────────────────
// Opportunity events
// ─────────────────────────────────────────────────────────────────────────────

export const OPPORTUNITY_EVENTS = {
  OPPORTUNITY_RESOLVED: 'OPPORTUNITY_RESOLVED',
  OPPORTUNITY_OBSERVED: 'OPPORTUNITY_OBSERVED',
  OPPORTUNITY_CLOSED: 'OPPORTUNITY_CLOSED',
} as const;

export type OpportunityEventType = (typeof OPPORTUNITY_EVENTS)[keyof typeof OPPORTUNITY_EVENTS];

// ─────────────────────────────────────────────────────────────────────────────
// Skill events
// ─────────────────────────────────────────────────────────────────────────────

export const SKILL_EVENTS = {
  SKILL_OBSERVED: 'SKILL_OBSERVED',
  SKILL_CORRECTED: 'SKILL_CORRECTED',
  SKILL_VERIFIED: 'SKILL_VERIFIED',
} as const;

export type SkillEventType = (typeof SKILL_EVENTS)[keyof typeof SKILL_EVENTS];

// ─────────────────────────────────────────────────────────────────────────────
// Prediction events
// ─────────────────────────────────────────────────────────────────────────────

export const PREDICTION_EVENTS = {
  PREDICTION_GENERATED: 'PREDICTION_GENERATED',
  PREDICTION_EVALUATED: 'PREDICTION_EVALUATED',
} as const;

export type PredictionEventType = (typeof PREDICTION_EVENTS)[keyof typeof PREDICTION_EVENTS];

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate union
// ─────────────────────────────────────────────────────────────────────────────

export const EVENT_TYPES = {
  ...RESUME_EVENTS,
  ...APPLICATION_EVENTS,
  ...OUTCOME_EVENTS,
  ...ACTION_EVENTS,
  ...OPPORTUNITY_EVENTS,
  ...SKILL_EVENTS,
  ...PREDICTION_EVENTS,
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate types (string literals)
// ─────────────────────────────────────────────────────────────────────────────

export const AGGREGATE_TYPES = {
  USER: 'USER',
  APPLICATION: 'APPLICATION',
  OPPORTUNITY: 'OPPORTUNITY',
  COMPANY: 'COMPANY',
  SKILL: 'SKILL',
  RESUME: 'RESUME',
  PREDICTION: 'PREDICTION',
  USER_RESUME: 'UserResume',
} as const;

export type AggregateType = (typeof AGGREGATE_TYPES)[keyof typeof AGGREGATE_TYPES];

// ─────────────────────────────────────────────────────────────────────────────
// Input contract
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateEventInput {
  eventType: EventType;
  aggregateId: string;
  aggregateType: AggregateType;
  userId: string;
  cellId: string;
  payload: Record<string, unknown>;
  correlationId?: string;
}
