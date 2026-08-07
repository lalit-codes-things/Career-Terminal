import { dbRouter } from '../config/database';
import { ActionEvent, Prisma } from '@prisma/client';
import { logger } from '../lib/logger';
import { analyticsService } from './analytics.service';

export interface RecordActionInput {
  userId: string;
  actionType: string;
  applicationId?: string;
  opportunityId?: string;
  actionSubtype?: string;
  strategyTags?: string[];
  context?: unknown;
  sourceType?: 'USER_ACTION' | 'SYSTEM_TRACKED' | 'IMPORTED';
  sourceId?: string;
  occurredAt?: Date;
  notes?: string;
  confidence?: number;
}

export interface GetUserActionsFilters {
  actionType?: string;
  applicationId?: string;
  opportunityId?: string;
  startDate?: Date;
  endDate?: Date;
}

/**
 * User action taxonomy — Epic 4 Prompt 13
 *
 * Tracks meaningful user decisions for recommendation/prediction systems.
 *
 * Distinction: STATED_PREFERENCE (explicit user settings) vs OBSERVED_BEHAVIOUR
 * (inferred from actions).  This distinction is encoded in sourceType:
 *   USER_ACTION    = direct user gesture (observed behaviour)
 *   SYSTEM_TRACKED = platform-inferred event (observed behaviour)
 *   IMPORTED       = external data import
 *
 * Stated preferences live in CandidateProfile.preferences and must never be
 * overwritten by inferred behaviour.
 */
export const ACTION_TYPES = {
  // ── Application actions ────────────────────────────────────────────────────
  APPLY: 'APPLY',
  FOLLOW_UP: 'FOLLOW_UP',
  WITHDRAW: 'WITHDRAW',
  OFFER_NEGOTIATION: 'OFFER_NEGOTIATION',
  // ── Opportunity discovery actions ──────────────────────────────────────────
  OPPORTUNITY_VIEWED: 'OPPORTUNITY_VIEWED',
  OPPORTUNITY_SAVED: 'OPPORTUNITY_SAVED',
  OPPORTUNITY_DISMISSED: 'OPPORTUNITY_DISMISSED',
  SAVE_JOB: 'SAVE_JOB', // backward-compat alias for OPPORTUNITY_SAVED
  // ── Resume actions ─────────────────────────────────────────────────────────
  RESUME_SELECTED: 'RESUME_SELECTED', // user chose a resume version for an application
  RESUME_UPDATE: 'RESUME_UPDATE', // user uploaded/edited a resume
  // ── Recommendation actions ─────────────────────────────────────────────────
  RECOMMENDATION_ACCEPTED: 'RECOMMENDATION_ACCEPTED',
  RECOMMENDATION_REJECTED: 'RECOMMENDATION_REJECTED',
  // ── Preference / goal changes ─────────────────────────────────────────────
  PREFERENCE_CHANGED: 'PREFERENCE_CHANGED', // explicit stated preference update
  CAREER_GOAL_CHANGED: 'CAREER_GOAL_CHANGED', // explicit career goal update
  // ── Network & research ────────────────────────────────────────────────────
  REFERRAL: 'REFERRAL',
  NETWORKING: 'NETWORKING',
  RESEARCH: 'RESEARCH',
  INTERVIEW_PREP: 'INTERVIEW_PREP',
} as const;

export const ACTION_SUBTYPES = {
  EMAIL: 'EMAIL',
  LINKEDIN: 'LINKEDIN',
  PHONE: 'PHONE',
  LINK: 'LINK',
  FORM: 'FORM',
  IN_APP: 'IN_APP',
  COMPANY_WEBSITE: 'COMPANY_WEBSITE',
  ATS: 'ATS',
} as const;

export const SOURCE_TYPES = {
  USER_ACTION: 'USER_ACTION',
  SYSTEM_TRACKED: 'SYSTEM_TRACKED',
  IMPORTED: 'IMPORTED',
} as const;

export function buildResumeVersionTag(version: number): string {
  return `resume_v${version}`;
}

export const STRATEGY_TAG_BUILDERS = {
  resume_v: buildResumeVersionTag,
  targeted: (segment: string) => `targeted_${segment.toLowerCase().replace(/\s+/g, '_')}`,
  early_application: () => 'early_application',
  with_referral: () => 'with_referral',
  tailored_resume: () => 'tailored_resume',
  followed_up: () => 'followed_up',
  applied_via: (channel: string) => `applied_via_${channel.toLowerCase().replace(/\s+/g, '_')}`,
} as const;

const KNOWN_ACTION_TYPES: ReadonlySet<string> = new Set(Object.values(ACTION_TYPES));
const KNOWN_SOURCE_TYPES: ReadonlySet<string> = new Set(Object.values(SOURCE_TYPES));

export class ActionService {
  public async recordAction(input: RecordActionInput): Promise<ActionEvent> {
    if (!input.userId) {
      throw new TypeError('ActionService.recordAction: userId is required');
    }
    if (!input.actionType) {
      throw new TypeError('ActionService.recordAction: actionType is required');
    }

    const actionType = input.actionType.toUpperCase();
    if (KNOWN_ACTION_TYPES.size > 0 && !KNOWN_ACTION_TYPES.has(actionType)) {
      logger.warn(
        '[ActionService] Unknown actionType recorded — will still persist for extensibility',
        {
          userId: input.userId,
          actionType,
        },
      );
    }

    const sourceType = (input.sourceType ?? SOURCE_TYPES.USER_ACTION).toUpperCase();
    if (!KNOWN_SOURCE_TYPES.has(sourceType)) {
      throw new TypeError(
        `ActionService.recordAction: invalid sourceType "${input.sourceType ?? ''}". Valid values: ${Array.from(KNOWN_SOURCE_TYPES).join(', ')}`,
      );
    }

    const occurredAt = input.occurredAt ?? new Date();

    let contextJson: Prisma.InputJsonValue | undefined;
    if (input.context !== undefined) {
      contextJson = input.context as Prisma.InputJsonValue;
    }

    const data: Prisma.ActionEventUncheckedCreateInput = {
      userId: input.userId,
      applicationId: input.applicationId,
      opportunityId: input.opportunityId,
      actionType,
      actionSubtype: input.actionSubtype,
      strategyTags: input.strategyTags ?? [],
      context: contextJson,
      sourceType,
      sourceId: input.sourceId,
      occurredAt,
      notes: input.notes,
      confidence: input.confidence,
    };

    const event = await dbRouter.write().actionEvent.create({ data });

    logger.info('[ActionService] Recorded user action', {
      actionEventId: event.id,
      userId: input.userId,
      actionType,
      applicationId: input.applicationId ?? null,
      opportunityId: input.opportunityId ?? null,
      strategyTagCount: (input.strategyTags ?? []).length,
      sourceType,
    });

    analyticsService.invalidateUser(input.userId);

    return event;
  }

  public async getUserActions(
    userId: string,
    filters: GetUserActionsFilters = {},
  ): Promise<ActionEvent[]> {
    if (!userId) {
      throw new TypeError('ActionService.getUserActions: userId is required');
    }

    const where: Prisma.ActionEventWhereInput = { userId };

    if (filters.actionType) {
      where.actionType = filters.actionType.toUpperCase();
    }
    if (filters.applicationId) {
      where.applicationId = filters.applicationId;
    }
    if (filters.opportunityId) {
      where.opportunityId = filters.opportunityId;
    }

    if (filters.startDate || filters.endDate) {
      where.occurredAt = {};
      if (filters.startDate) {
        (where.occurredAt as Prisma.DateTimeFilter).gte = filters.startDate;
      }
      if (filters.endDate) {
        (where.occurredAt as Prisma.DateTimeFilter).lte = filters.endDate;
      }
    }

    return dbRouter.read().actionEvent.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  public async getApplicationActions(applicationId: string): Promise<ActionEvent[]> {
    if (!applicationId) {
      throw new TypeError('ActionService.getApplicationActions: applicationId is required');
    }
    return dbRouter.read().actionEvent.findMany({
      where: { applicationId },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
    });
  }

  public async getActionsByTag(userId: string, tag: string): Promise<ActionEvent[]> {
    if (!userId) {
      throw new TypeError('ActionService.getActionsByTag: userId is required');
    }
    if (!tag) {
      throw new TypeError('ActionService.getActionsByTag: tag is required');
    }
    return dbRouter.read().actionEvent.findMany({
      where: {
        userId,
        strategyTags: { has: tag },
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  public async getOpportunityActions(opportunityId: string): Promise<ActionEvent[]> {
    if (!opportunityId) {
      throw new TypeError('ActionService.getOpportunityActions: opportunityId is required');
    }
    return dbRouter.read().actionEvent.findMany({
      where: { opportunityId },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
    });
  }

  public async addStrategyTag(actionEventId: string, tag: string): Promise<ActionEvent> {
    if (!actionEventId) throw new TypeError('addStrategyTag: actionEventId required');
    if (!tag) throw new TypeError('addStrategyTag: tag required');

    const existing = await dbRouter.read().actionEvent.findUnique({
      where: { id: actionEventId },
      select: { strategyTags: true },
    });
    if (!existing) {
      throw new Error(`ActionEvent not found: ${actionEventId}`);
    }
    if (existing.strategyTags.includes(tag)) {
      return dbRouter.read().actionEvent.findUnique({
        where: { id: actionEventId },
      }) as Promise<ActionEvent>;
    }

    return dbRouter.write().actionEvent.update({
      where: { id: actionEventId },
      data: {
        strategyTags: { push: tag },
      },
    });
  }

  public async countActionsByType(userId: string): Promise<Record<string, number>> {
    if (!userId) throw new TypeError('countActionsByType: userId required');
    const rows = await dbRouter.read().actionEvent.findMany({
      where: { userId },
      select: { actionType: true },
    });
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.actionType] = (counts[row.actionType] || 0) + 1;
    }
    return counts;
  }
}

export const actionService = new ActionService();
