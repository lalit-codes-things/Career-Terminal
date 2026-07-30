import { prisma } from '../config/database';
import { OutcomeEvent } from '@prisma/client';
import { logger } from '../lib/logger';
import { analyticsService } from './analytics.service';
import { ApplicationStatus } from '../domain/application-status';

export interface RecordOutcomeInput {
  applicationId: string;
  userId: string;
  outcomeType: string;
  sourceType: 'EMAIL' | 'MANUAL' | 'IMPORT';
  sourceId?: string;
  sourceData?: any;
  evidence?: string;
  confidence?: number;
  occurredAt: Date;
}

/**
 * Outcome type taxonomy — Epic 4 Prompt 12
 *
 * Every outcome event must be representable as one of these explicit types.
 * Outcome events are historical records and must never be deleted or mutated.
 * Success is never derived solely from a mutable application status field.
 *
 * Types and their semantics:
 *   APPLICATION_SUBMITTED — candidate submitted the application (canonical name for APPLICATION_SENT)
 *   APPLICATION_SENT      — alias kept for backward compatibility
 *   SCREENING             — initial screening / phone screen stage
 *   RECRUITER_CONTACT     — general recruiter outreach (may precede screening)
 *   ASSESSMENT            — take-home assessment or coding challenge
 *   INTERVIEW_SCHEDULED   — interview confirmed
 *   INTERVIEW_COMPLETED   — interview round completed
 *   OFFER_RECEIVED        — written or verbal offer extended
 *   OFFER_ACCEPTED        — candidate formally accepted the offer
 *   OFFER_DECLINED        — candidate declined the offer
 *   REJECTION_RECEIVED    — candidate rejected at any stage
 *   WITHDRAWN             — candidate withdrew their application
 *   NO_RESPONSE           — no response within expected window
 */
export const OUTCOME_TYPES = {
  APPLICATION_SUBMITTED: 'APPLICATION_SUBMITTED',
  APPLICATION_SENT: 'APPLICATION_SENT',        // backward-compat alias
  SCREENING: 'SCREENING',
  RECRUITER_CONTACT: 'RECRUITER_CONTACT',
  ASSESSMENT: 'ASSESSMENT',
  INTERVIEW_SCHEDULED: 'INTERVIEW_SCHEDULED',
  INTERVIEW_COMPLETED: 'INTERVIEW_COMPLETED',
  OFFER_RECEIVED: 'OFFER_RECEIVED',
  OFFER_ACCEPTED: 'OFFER_ACCEPTED',
  OFFER_DECLINED: 'OFFER_DECLINED',
  REJECTION_RECEIVED: 'REJECTION_RECEIVED',
  WITHDRAWN: 'WITHDRAWN',
  NO_RESPONSE: 'NO_RESPONSE',
} as const;

export const OUTCOME_CATEGORIES = {
  POSITIVE: 'POSITIVE',
  NEGATIVE: 'NEGATIVE',
  NEUTRAL: 'NEUTRAL',
  TERMINAL: 'TERMINAL',
} as const;

export const OUTCOME_STATUS = {
  EXPLICIT: 'EXPLICIT',
  INFERRED: 'INFERRED',
  USER_REPORTED: 'USER_REPORTED',
} as const;

// Mapping of outcome types to categories
const OUTCOME_TYPE_TO_CATEGORY: Record<string, string> = {
  [OUTCOME_TYPES.APPLICATION_SUBMITTED]: OUTCOME_CATEGORIES.NEUTRAL,
  [OUTCOME_TYPES.APPLICATION_SENT]: OUTCOME_CATEGORIES.NEUTRAL,
  [OUTCOME_TYPES.SCREENING]: OUTCOME_CATEGORIES.NEUTRAL,
  [OUTCOME_TYPES.RECRUITER_CONTACT]: OUTCOME_CATEGORIES.NEUTRAL,
  [OUTCOME_TYPES.ASSESSMENT]: OUTCOME_CATEGORIES.NEUTRAL,
  [OUTCOME_TYPES.INTERVIEW_SCHEDULED]: OUTCOME_CATEGORIES.NEUTRAL,
  [OUTCOME_TYPES.INTERVIEW_COMPLETED]: OUTCOME_CATEGORIES.NEUTRAL,
  [OUTCOME_TYPES.OFFER_RECEIVED]: OUTCOME_CATEGORIES.POSITIVE,
  [OUTCOME_TYPES.OFFER_ACCEPTED]: OUTCOME_CATEGORIES.POSITIVE,
  [OUTCOME_TYPES.OFFER_DECLINED]: OUTCOME_CATEGORIES.NEGATIVE,
  [OUTCOME_TYPES.REJECTION_RECEIVED]: OUTCOME_CATEGORIES.NEGATIVE,
  [OUTCOME_TYPES.WITHDRAWN]: OUTCOME_CATEGORIES.NEGATIVE,
  [OUTCOME_TYPES.NO_RESPONSE]: OUTCOME_CATEGORIES.NEGATIVE,
};

// Terminal outcomes — once reached the application is closed
const TERMINAL_OUTCOMES = new Set([
  OUTCOME_TYPES.OFFER_ACCEPTED,
  OUTCOME_TYPES.OFFER_DECLINED,
  OUTCOME_TYPES.REJECTION_RECEIVED,
  OUTCOME_TYPES.WITHDRAWN,
]);

// Mapping of outcome types to application statuses
const OUTCOME_TYPE_TO_STATUS: Record<string, string> = {
  [OUTCOME_TYPES.APPLICATION_SUBMITTED]: 'Applied',
  [OUTCOME_TYPES.APPLICATION_SENT]: 'Applied',
  [OUTCOME_TYPES.SCREENING]: 'Screening',
  [OUTCOME_TYPES.RECRUITER_CONTACT]: 'Recruiter Contact',
  [OUTCOME_TYPES.ASSESSMENT]: 'Assessment',
  [OUTCOME_TYPES.INTERVIEW_SCHEDULED]: 'Interviewing',
  [OUTCOME_TYPES.INTERVIEW_COMPLETED]: 'Interviewing',
  [OUTCOME_TYPES.OFFER_RECEIVED]: 'Offer',
  [OUTCOME_TYPES.OFFER_ACCEPTED]: 'Accepted',
  [OUTCOME_TYPES.OFFER_DECLINED]: 'Declined',
  [OUTCOME_TYPES.REJECTION_RECEIVED]: 'Rejected',
  [OUTCOME_TYPES.WITHDRAWN]: 'Withdrawn',
  [OUTCOME_TYPES.NO_RESPONSE]: 'No Response',
};

export class OutcomeService {
  /**
   * Record a new outcome event for an application.
   */
  async recordOutcome(input: RecordOutcomeInput): Promise<OutcomeEvent> {
    return prisma.$transaction(async (tx) => {
      // 1. Determine the outcomeCategory based on outcomeType
      const outcomeCategory = OUTCOME_TYPE_TO_CATEGORY[input.outcomeType] || OUTCOME_CATEGORIES.NEUTRAL;

      // 2. Determine if explicit or inferred
      const outcomeStatus =
        input.sourceType === 'EMAIL'
          ? OUTCOME_STATUS.EXPLICIT
          : input.sourceType === 'MANUAL'
            ? OUTCOME_STATUS.USER_REPORTED
            : OUTCOME_STATUS.INFERRED;

      const explicit =
        input.sourceType === 'EMAIL' || input.sourceType === 'MANUAL';

      // 3. Determine the resultingStatus based on outcomeType
      const resultingStatus = OUTCOME_TYPE_TO_STATUS[input.outcomeType] || 'Unknown';

      // 4. Create the OutcomeEvent
      const event = await tx.outcomeEvent.create({
        data: {
          applicationId: input.applicationId,
          userId: input.userId,
          outcomeType: input.outcomeType,
          outcomeCategory,
          outcomeStatus,
          explicit,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceData: input.sourceData,
          evidence: input.evidence,
          confidence: input.confidence ?? (explicit ? 0.95 : 0.5),
          occurredAt: input.occurredAt,
          resultingStatus,
          isCurrent: true,
        },
      });

      // 5. Update the application's current status if this is a terminal outcome or more recent
      const lastOutcome = await tx.outcomeEvent.findFirst({
        where: {
          applicationId: input.applicationId,
          isCurrent: true,
          id: { not: event.id },
        },
        orderBy: { occurredAt: 'desc' },
      });

      const shouldUpdateAppStatus =
        !lastOutcome ||
        event.occurredAt > lastOutcome.occurredAt ||
        (TERMINAL_OUTCOMES as Set<string>).has(input.outcomeType);

      if (shouldUpdateAppStatus) {
        await tx.jobApplication.update({
          where: { id: input.applicationId },
          data: {
            status: resultingStatus as ApplicationStatus,
            updatedAt: new Date(),
          },
        });
      }

      logger.info('[OutcomeService] Recorded outcome event', {
        applicationId: input.applicationId,
        userId: input.userId,
        outcomeType: input.outcomeType,
        outcomeId: event.id,
      });

      analyticsService.invalidateUser(input.userId);

      return event;
    });
  }

  /**
   * Get all outcome events for an application in chronological order.
   */
  async getApplicationTimeline(applicationId: string): Promise<OutcomeEvent[]> {
    return prisma.outcomeEvent.findMany({
      where: { applicationId, isCurrent: true },
      orderBy: { occurredAt: 'asc' },
    });
  }

  /**
   * Get the last outcome event for an application (current state).
   */
  async getCurrentStatus(applicationId: string): Promise<OutcomeEvent | null> {
    return prisma.outcomeEvent.findFirst({
      where: { applicationId, isCurrent: true },
      orderBy: { occurredAt: 'desc' },
    });
  }

  /**
   * Get outcomes by type and time range for analytics.
   */
  async getOutcomesByTypeAndRange(
    userId: string,
    outcomeTypes: string[],
    startDate: Date,
    endDate: Date,
  ): Promise<OutcomeEvent[]> {
    return prisma.outcomeEvent.findMany({
      where: {
        userId,
        outcomeType: { in: outcomeTypes },
        occurredAt: { gte: startDate, lte: endDate },
        isCurrent: true,
      },
      orderBy: { occurredAt: 'desc' },
    });
  }

  /**
   * Get all outcomes for a user
   */
  async getUserOutcomes(userId: string, limit: number = 100): Promise<OutcomeEvent[]> {
    return prisma.outcomeEvent.findMany({
      where: { userId, isCurrent: true },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Get outcome events by category
   */
  async getOutcomesByCategory(
    userId: string,
    category: string,
    limit: number = 100,
  ): Promise<OutcomeEvent[]> {
    return prisma.outcomeEvent.findMany({
      where: { userId, outcomeCategory: category, isCurrent: true },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Get terminal outcomes (final states)
   */
  async getTerminalOutcomes(userId: string, limit: number = 100): Promise<OutcomeEvent[]> {
    return prisma.outcomeEvent.findMany({
      where: {
        userId,
        outcomeCategory: OUTCOME_CATEGORIES.TERMINAL,
        isCurrent: true,
      },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Count outcomes by type for a user
   */
  async countOutcomesByType(userId: string): Promise<Record<string, number>> {
    const outcomes = await prisma.outcomeEvent.findMany({
      where: { userId, isCurrent: true },
      select: { outcomeType: true },
    });

    const counts: Record<string, number> = {};
    for (const outcome of outcomes) {
      counts[outcome.outcomeType] = (counts[outcome.outcomeType] || 0) + 1;
    }
    return counts;
  }
}

export const outcomeService = new OutcomeService();
