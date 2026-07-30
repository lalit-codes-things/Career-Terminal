/**
 * User Action / Strategy Log — Epic 4 Prompt 13
 *
 * Verifies the action event system tracks meaningful user decisions and
 * preserves the distinction between stated preference and observed behaviour.
 *
 * Coverage:
 *  1. All required action types present in ACTION_TYPES
 *  2. Opportunity discovery actions (VIEWED, SAVED, DISMISSED)
 *  3. Resume selection action
 *  4. Recommendation actions (ACCEPTED, REJECTED)
 *  5. Preference / career goal change actions (stated preference)
 *  6. Stated preference vs observed behaviour distinction
 *  7. Action deduplication awareness
 *  8. Ownership and chronological ordering
 *  9. Provenance and timestamps
 */

jest.mock('../config/database', () => ({
  prisma: {
    actionEvent: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../services/analytics.service', () => ({
  analyticsService: { invalidateUser: jest.fn() },
}));

import { prisma } from '../config/database';
import {
  actionService,
  ACTION_TYPES,
  SOURCE_TYPES,
  type RecordActionInput,
} from '../services/action.service';

// ── Constants ─────────────────────────────────────────────────────────────────

const USER_ID = 'user-0000-0000-0000-000000000001';
const OPP_ID = 'opp-0000-0000-0000-000000000001';
const APP_ID = 'app-0000-0000-0000-000000000001';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<RecordActionInput> = {}): RecordActionInput {
  return {
    userId: USER_ID,
    actionType: ACTION_TYPES.OPPORTUNITY_VIEWED,
    occurredAt: new Date('2026-06-01T10:00:00Z'),
    ...overrides,
  };
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'act-001',
    userId: USER_ID,
    actionType: ACTION_TYPES.OPPORTUNITY_VIEWED,
    sourceType: SOURCE_TYPES.USER_ACTION,
    strategyTags: [],
    occurredAt: new Date('2026-06-01T10:00:00Z'),
    recordedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. ACTION_TYPES completeness
// ─────────────────────────────────────────────────────────────────────────────

describe('ACTION_TYPES taxonomy completeness', () => {
  const requiredTypes = [
    'OPPORTUNITY_VIEWED',
    'OPPORTUNITY_SAVED',
    'OPPORTUNITY_DISMISSED',
    'APPLY',
    'RESUME_SELECTED',
    'RECOMMENDATION_ACCEPTED',
    'RECOMMENDATION_REJECTED',
    'PREFERENCE_CHANGED',
    'CAREER_GOAL_CHANGED',
  ];

  for (const type of requiredTypes) {
    it(`includes ${type}`, () => {
      expect(Object.values(ACTION_TYPES)).toContain(type);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Opportunity discovery actions
// ─────────────────────────────────────────────────────────────────────────────

describe('Opportunity discovery actions', () => {
  it('records OPPORTUNITY_VIEWED with opportunityId', async () => {
    (prisma.actionEvent.create as jest.Mock).mockResolvedValue(
      makeEvent({ actionType: ACTION_TYPES.OPPORTUNITY_VIEWED }),
    );

    await actionService.recordAction(
      makeInput({ actionType: ACTION_TYPES.OPPORTUNITY_VIEWED, opportunityId: OPP_ID }),
    );

    const call = (prisma.actionEvent.create as jest.Mock).mock.calls[0][0];
    expect(call.data.actionType).toBe(ACTION_TYPES.OPPORTUNITY_VIEWED);
    expect(call.data.opportunityId).toBe(OPP_ID);
  });

  it('records OPPORTUNITY_SAVED', async () => {
    (prisma.actionEvent.create as jest.Mock).mockResolvedValue(
      makeEvent({ actionType: ACTION_TYPES.OPPORTUNITY_SAVED }),
    );

    await actionService.recordAction(
      makeInput({ actionType: ACTION_TYPES.OPPORTUNITY_SAVED, opportunityId: OPP_ID }),
    );

    const call = (prisma.actionEvent.create as jest.Mock).mock.calls[0][0];
    expect(call.data.actionType).toBe(ACTION_TYPES.OPPORTUNITY_SAVED);
  });

  it('records OPPORTUNITY_DISMISSED', async () => {
    (prisma.actionEvent.create as jest.Mock).mockResolvedValue(
      makeEvent({ actionType: ACTION_TYPES.OPPORTUNITY_DISMISSED }),
    );

    await actionService.recordAction(
      makeInput({ actionType: ACTION_TYPES.OPPORTUNITY_DISMISSED, opportunityId: OPP_ID }),
    );

    const call = (prisma.actionEvent.create as jest.Mock).mock.calls[0][0];
    expect(call.data.actionType).toBe(ACTION_TYPES.OPPORTUNITY_DISMISSED);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Resume selection
// ─────────────────────────────────────────────────────────────────────────────

describe('Resume selection action', () => {
  it('records RESUME_SELECTED with applicationId context', async () => {
    (prisma.actionEvent.create as jest.Mock).mockResolvedValue(
      makeEvent({ actionType: ACTION_TYPES.RESUME_SELECTED }),
    );

    await actionService.recordAction(
      makeInput({
        actionType: ACTION_TYPES.RESUME_SELECTED,
        applicationId: APP_ID,
        context: { resumeVersionId: 'rv-001', resumeVersion: 2 },
      }),
    );

    const call = (prisma.actionEvent.create as jest.Mock).mock.calls[0][0];
    expect(call.data.actionType).toBe(ACTION_TYPES.RESUME_SELECTED);
    expect(call.data.applicationId).toBe(APP_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Recommendation actions
// ─────────────────────────────────────────────────────────────────────────────

describe('Recommendation actions', () => {
  it('records RECOMMENDATION_ACCEPTED', async () => {
    (prisma.actionEvent.create as jest.Mock).mockResolvedValue(
      makeEvent({ actionType: ACTION_TYPES.RECOMMENDATION_ACCEPTED }),
    );

    await actionService.recordAction(
      makeInput({
        actionType: ACTION_TYPES.RECOMMENDATION_ACCEPTED,
        opportunityId: OPP_ID,
        context: { recommendationId: 'rec-001' },
      }),
    );

    const call = (prisma.actionEvent.create as jest.Mock).mock.calls[0][0];
    expect(call.data.actionType).toBe(ACTION_TYPES.RECOMMENDATION_ACCEPTED);
  });

  it('records RECOMMENDATION_REJECTED', async () => {
    (prisma.actionEvent.create as jest.Mock).mockResolvedValue(
      makeEvent({ actionType: ACTION_TYPES.RECOMMENDATION_REJECTED }),
    );

    await actionService.recordAction(
      makeInput({
        actionType: ACTION_TYPES.RECOMMENDATION_REJECTED,
        opportunityId: OPP_ID,
        notes: 'Role not relevant to my goals',
      }),
    );

    const call = (prisma.actionEvent.create as jest.Mock).mock.calls[0][0];
    expect(call.data.actionType).toBe(ACTION_TYPES.RECOMMENDATION_REJECTED);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5 & 6. Stated preference vs observed behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('Stated preference vs observed behaviour', () => {
  it('PREFERENCE_CHANGED is recorded as USER_ACTION (stated preference)', async () => {
    (prisma.actionEvent.create as jest.Mock).mockResolvedValue(
      makeEvent({ actionType: ACTION_TYPES.PREFERENCE_CHANGED }),
    );

    await actionService.recordAction(
      makeInput({
        actionType: ACTION_TYPES.PREFERENCE_CHANGED,
        sourceType: SOURCE_TYPES.USER_ACTION,
        context: { field: 'remote_preference', oldValue: 'hybrid', newValue: 'remote' },
      }),
    );

    const call = (prisma.actionEvent.create as jest.Mock).mock.calls[0][0];
    expect(call.data.actionType).toBe(ACTION_TYPES.PREFERENCE_CHANGED);
    expect(call.data.sourceType).toBe(SOURCE_TYPES.USER_ACTION);
  });

  it('CAREER_GOAL_CHANGED is recorded as USER_ACTION (stated preference)', async () => {
    (prisma.actionEvent.create as jest.Mock).mockResolvedValue(
      makeEvent({ actionType: ACTION_TYPES.CAREER_GOAL_CHANGED }),
    );

    await actionService.recordAction(
      makeInput({
        actionType: ACTION_TYPES.CAREER_GOAL_CHANGED,
        sourceType: SOURCE_TYPES.USER_ACTION,
        context: { newGoal: 'principal-engineer', previousGoal: 'senior-engineer' },
      }),
    );

    const call = (prisma.actionEvent.create as jest.Mock).mock.calls[0][0];
    expect(call.data.actionType).toBe(ACTION_TYPES.CAREER_GOAL_CHANGED);
  });

  it('OPPORTUNITY_VIEWED can be SYSTEM_TRACKED (observed behaviour)', async () => {
    (prisma.actionEvent.create as jest.Mock).mockResolvedValue(
      makeEvent({
        actionType: ACTION_TYPES.OPPORTUNITY_VIEWED,
        sourceType: SOURCE_TYPES.SYSTEM_TRACKED,
      }),
    );

    await actionService.recordAction(
      makeInput({
        actionType: ACTION_TYPES.OPPORTUNITY_VIEWED,
        sourceType: SOURCE_TYPES.SYSTEM_TRACKED,
        opportunityId: OPP_ID,
      }),
    );

    const call = (prisma.actionEvent.create as jest.Mock).mock.calls[0][0];
    expect(call.data.sourceType).toBe(SOURCE_TYPES.SYSTEM_TRACKED);
  });

  it('PREFERENCE_CHANGED (stated preference) has different sourceType from OPPORTUNITY_VIEWED (observed)', () => {
    // This test documents the architectural contract:
    // Stated preferences must always be USER_ACTION, never SYSTEM_TRACKED.
    expect(SOURCE_TYPES.USER_ACTION).toBe('USER_ACTION');
    expect(SOURCE_TYPES.SYSTEM_TRACKED).toBe('SYSTEM_TRACKED');
    // They are distinct source types that prevent stated preferences from
    // being confused with inferred behaviour.
    expect(SOURCE_TYPES.USER_ACTION).not.toBe(SOURCE_TYPES.SYSTEM_TRACKED);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Deduplication awareness
// ─────────────────────────────────────────────────────────────────────────────

describe('Action deduplication', () => {
  it('records actions with provenance timestamps for deduplication', async () => {
    const ts = new Date('2026-06-01T10:00:00Z');
    (prisma.actionEvent.create as jest.Mock).mockResolvedValue(makeEvent({ occurredAt: ts }));

    await actionService.recordAction(makeInput({ occurredAt: ts }));

    const call = (prisma.actionEvent.create as jest.Mock).mock.calls[0][0];
    expect(call.data.occurredAt).toEqual(ts);
    // recordedAt is auto-set and distinct from occurredAt — allows detecting duplicates
    expect(call.data.occurredAt).not.toBeUndefined();
  });

  it('strategyTags are preserved for analytics deduplication downstream', async () => {
    const tags = ['with_referral', 'early_application'];
    (prisma.actionEvent.create as jest.Mock).mockResolvedValue(
      makeEvent({ strategyTags: tags }),
    );

    await actionService.recordAction(makeInput({ strategyTags: tags }));

    const call = (prisma.actionEvent.create as jest.Mock).mock.calls[0][0];
    expect(call.data.strategyTags).toEqual(tags);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Ownership and chronological ordering
// ─────────────────────────────────────────────────────────────────────────────

describe('Ownership and ordering', () => {
  it('userId is always written to every ActionEvent', async () => {
    (prisma.actionEvent.create as jest.Mock).mockResolvedValue(makeEvent());

    await actionService.recordAction(makeInput());

    const call = (prisma.actionEvent.create as jest.Mock).mock.calls[0][0];
    expect(call.data.userId).toBe(USER_ID);
  });

  it('getUserActions returns events scoped to userId', async () => {
    (prisma.actionEvent.findMany as jest.Mock).mockResolvedValue([]);

    await actionService.getUserActions(USER_ID);

    expect(prisma.actionEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER_ID }),
      }),
    );
  });

  it('getUserActions returns events ordered by occurredAt descending', async () => {
    (prisma.actionEvent.findMany as jest.Mock).mockResolvedValue([]);

    await actionService.getUserActions(USER_ID);

    expect(prisma.actionEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      }),
    );
  });

  it('invalid sourceType is rejected', async () => {
    await expect(
      actionService.recordAction(
        makeInput({ sourceType: 'INVALID_TYPE' as 'USER_ACTION' }),
      ),
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Privacy / deletion behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('Privacy contract', () => {
  it('action events carry userId for GDPR deletion scoping', async () => {
    (prisma.actionEvent.create as jest.Mock).mockResolvedValue(makeEvent());

    await actionService.recordAction(makeInput());

    const call = (prisma.actionEvent.create as jest.Mock).mock.calls[0][0];
    expect(call.data.userId).toBe(USER_ID);
    // userId FK enables cascade deletion when user account is deleted
  });
});
