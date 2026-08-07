/**
 * Integration hooks for application creation with Prompts 10, 11, and 12.
 * These functions are called after an application is created to:
 * - Create a snapshot of user facts ()
 * - Record an initial outcome event ()
 */

import { snapshotService } from '../snapshot.service';
import { outcomeService, OUTCOME_TYPES } from '../outcome.service';
import {
  actionService,
  ACTION_TYPES,
  SOURCE_TYPES,
  STRATEGY_TAG_BUILDERS,
  buildResumeVersionTag,
} from '../action.service';
import { logger } from '../../lib/logger';

export async function recordApplyAction(
  userId: string,
  applicationId: string,
  appliedDate: Date,
  options: {
    opportunityId?: string;
    sourceEmailId?: string;
    applicationChannel?: string;
    resumeVersionId?: string;
    resumeVersion?: number;
    referralUsed?: boolean;
    tailoredResume?: boolean;
    appliedWithin24hOfPosting?: boolean;
    notes?: string;
  } = {},
): Promise<void> {
  try {
    const tags: string[] = [];

    if (typeof options.resumeVersion === 'number') {
      tags.push(buildResumeVersionTag(options.resumeVersion));
    }
    if (options.referralUsed) {
      tags.push(STRATEGY_TAG_BUILDERS.with_referral());
    }
    if (options.tailoredResume) {
      tags.push(STRATEGY_TAG_BUILDERS.tailored_resume());
    }
    if (options.appliedWithin24hOfPosting) {
      tags.push(STRATEGY_TAG_BUILDERS.early_application());
    }
    if (options.applicationChannel) {
      tags.push(STRATEGY_TAG_BUILDERS.applied_via(options.applicationChannel));
    }

    const context: Record<string, unknown> = {};
    if (options.resumeVersionId) context.resumeVersionId = options.resumeVersionId;
    if (options.sourceEmailId) context.sourceEmailId = options.sourceEmailId;
    if (options.applicationChannel) context.applicationChannel = options.applicationChannel;

    await actionService.recordAction({
      userId,
      actionType: ACTION_TYPES.APPLY,
      applicationId,
      opportunityId: options.opportunityId,
      actionSubtype: options.sourceEmailId ? 'EMAIL' : (options.applicationChannel ?? 'FORM'),
      strategyTags: tags,
      context: Object.keys(context).length > 0 ? context : undefined,
      sourceType: options.sourceEmailId ? SOURCE_TYPES.SYSTEM_TRACKED : SOURCE_TYPES.USER_ACTION,
      sourceId: options.sourceEmailId ?? undefined,
      occurredAt: appliedDate,
      notes: options.notes,
      confidence: options.sourceEmailId ? 0.95 : 1.0,
    });

    logger.info('[ApplicationIntegration] Recorded APPLY action for application', {
      userId,
      applicationId,
      strategyTags: tags,
    });
  } catch (error) {
    logger.warn('[ApplicationIntegration] Failed to record APPLY action', {
      userId,
      applicationId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function createApplicationSnapshot(
  userId: string,
  applicationId: string,
  companyName: string,
  roleTitle: string,
): Promise<string | null> {
  try {
    const snapshot = await snapshotService.createSnapshot(
      userId,
      'APPLICATION',
      applicationId,
      `Snapshot at application time for ${companyName} - ${roleTitle}`,
    );

    logger.info('[ApplicationIntegration] Created snapshot for application', {
      applicationId,
      userId,
      snapshotId: snapshot.id,
    });

    return snapshot.id;
  } catch (error) {
    logger.warn('[ApplicationIntegration] Failed to create snapshot', {
      applicationId,
      userId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

export async function recordApplicationSentOutcome(
  applicationId: string,
  userId: string,
  appliedDate: Date,
  sourceEmailId?: string,
  evidence?: string,
): Promise<void> {
  try {
    await outcomeService.recordOutcome({
      applicationId,
      userId,
      outcomeType: OUTCOME_TYPES.APPLICATION_SENT,
      sourceType: sourceEmailId ? 'EMAIL' : 'MANUAL',
      sourceId: sourceEmailId,
      evidence,
      confidence: sourceEmailId ? 0.95 : 1.0,
      occurredAt: appliedDate,
    });

    logger.info('[ApplicationIntegration] Recorded APPLICATION_SENT outcome', {
      applicationId,
      userId,
    });
  } catch (error) {
    logger.warn('[ApplicationIntegration] Failed to record outcome', {
      applicationId,
      userId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
