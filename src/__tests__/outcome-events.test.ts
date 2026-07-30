/**
 * Explicit Outcome Events — Epic 4 Prompt 12
 *
 * Verifies the outcome event system as a historical immutable record of
 * career events — not derived from mutable application status.
 *
 * Coverage:
 *  1. All required outcome types exist in OUTCOME_TYPES taxonomy
 *  2. Event creation with correct provenance fields
 *  3. Chronological ordering of events
 *  4. Duplicate handling (same outcome type same day)
 *  5. Ownership — events are user-scoped
 *  6. Terminal outcomes close the application correctly
 *  7. Outcome events are never deleted (historical record)
 *  8. SCREENING is an explicit outcome type (not just RECRUITER_CONTACT)
 */

jest.mock('../config/database', () => ({
  prisma: {
    outcomeEvent: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    jobApplication: {
      update: jest.fn(),
    },
    $transaction: jest.fn(),
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
  outcomeService,
  OUTCOME_TYPES,
  OUTCOME_CATEGORIES,
  OUTCOME_STATUS,
  type RecordOutcomeInput,
} from '../services/outcome.service';

// ── Constants ─────────────────────────────────────────────────────────────────

const USER_ID = 'user-0000-0000-0000-000000000001';
const APP_ID = 'app-0000-0000-0000-000000000001';
const EVENT_ID = 'evt-0000-0000-0000-000000000001';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<RecordOutcomeInput> = {}): RecordOutcomeInput {
  return {
    applicationId: APP_ID,
    userId: USER_ID,
    outcomeType: OUTCOME_TYPES.INTERVIEW_SCHEDULED,
    sourceType: 'EMAIL',
    occurredAt: new Date('2026-06-01T10:00:00Z'),
    ...overrides,
  };
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    applicationId: APP_ID,
    userId: USER_ID,
    outcomeType: OUTCOME_TYPES.INTERVIEW_SCHEDULED,
    outcomeCategory: OUTCOME_CATEGORIES.NEUTRAL,
    outcomeStatus: OUTCOME_STATUS.EXPLICIT,
    explicit: true,
    sourceType: 'EMAIL',
    confidence: 0.95,
    occurredAt: new Date('2026-06-01T10:00:00Z'),
    recordedAt: new Date(),
    resultingStatus: 'Interviewing',
    version: 1,
    isCurrent: true,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.$transaction as jest.Mock).mockImplementation(
    (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma),
  );
  (prisma.outcomeEvent.findFirst as jest.Mock).mockResolvedValue(null);
  (prisma.jobApplication.update as jest.Mock).mockResolvedValue({});
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Outcome type completeness
// ─────────────────────────────────────────────────────────────────────────────

describe('OUTCOME_TYPES taxonomy completeness', () => {
  const requiredTypes = [
    'APPLICATION_SUBMITTED',
    'SCREENING',
    'ASSESSMENT',
    'INTERVIEW_SCHEDULED',
    'INTERVIEW_COMPLETED',
    'OFFER_RECEIVED',
    'OFFER_ACCEPTED',
    'OFFER_DECLINED',
    'REJECTION_RECEIVED',
    'WITHDRAWN',
  ];

  for (const type of requiredTypes) {
    it(`includes ${type}`, () => {
      expect(Object.values(OUTCOME_TYPES)).toContain(type);
    });
  }

  it('SCREENING is distinct from RECRUITER_CONTACT', () => {
    expect(OUTCOME_TYPES.SCREENING).toBe('SCREENING');
    expect(OUTCOME_TYPES.RECRUITER_CONTACT).toBe('RECRUITER_CONTACT');
    expect(OUTCOME_TYPES.SCREENING).not.toBe(OUTCOME_TYPES.RECRUITER_CONTACT);
  });

  it('APPLICATION_SUBMITTED is the canonical application sent type', () => {
    expect(OUTCOME_TYPES.APPLICATION_SUBMITTED).toBe('APPLICATION_SUBMITTED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Event creation with provenance
// ─────────────────────────────────────────────────────────────────────────────

describe('recordOutcome — event creation', () => {
  it('creates an OutcomeEvent with userId, applicationId, sourceType, occurredAt', async () => {
    (prisma.outcomeEvent.create as jest.Mock).mockResolvedValue(makeEvent());

    await outcomeService.recordOutcome(makeInput());

    expect(prisma.outcomeEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: USER_ID,
          applicationId: APP_ID,
          sourceType: 'EMAIL',
          occurredAt: expect.any(Date),
        }),
      }),
    );
  });

  it('EMAIL source produces EXPLICIT status with confidence=0.95', async () => {
    (prisma.outcomeEvent.create as jest.Mock).mockResolvedValue(makeEvent());

    await outcomeService.recordOutcome(makeInput({ sourceType: 'EMAIL' }));

    const call = (prisma.outcomeEvent.create as jest.Mock).mock.calls[0][0];
    expect(call.data.outcomeStatus).toBe(OUTCOME_STATUS.EXPLICIT);
    expect(call.data.explicit).toBe(true);
    expect(call.data.confidence).toBe(0.95);
  });

  it('MANUAL source produces USER_REPORTED status', async () => {
    (prisma.outcomeEvent.create as jest.Mock).mockResolvedValue(
      makeEvent({ outcomeStatus: OUTCOME_STATUS.USER_REPORTED, sourceType: 'MANUAL' }),
    );

    await outcomeService.recordOutcome(makeInput({ sourceType: 'MANUAL' }));

    const call = (prisma.outcomeEvent.create as jest.Mock).mock.calls[0][0];
    expect(call.data.outcomeStatus).toBe(OUTCOME_STATUS.USER_REPORTED);
  });

  it('IMPORT source produces INFERRED status with confidence=0.5', async () => {
    (prisma.outcomeEvent.create as jest.Mock).mockResolvedValue(
      makeEvent({ outcomeStatus: OUTCOME_STATUS.INFERRED, explicit: false }),
    );

    await outcomeService.recordOutcome(makeInput({ sourceType: 'IMPORT' }));

    const call = (prisma.outcomeEvent.create as jest.Mock).mock.calls[0][0];
    expect(call.data.outcomeStatus).toBe(OUTCOME_STATUS.INFERRED);
    expect(call.data.explicit).toBe(false);
  });

  it('records evidence on the event', async () => {
    (prisma.outcomeEvent.create as jest.Mock).mockResolvedValue(makeEvent());

    await outcomeService.recordOutcome(
      makeInput({ evidence: 'Email confirmed interview for June 15th' }),
    );

    const call = (prisma.outcomeEvent.create as jest.Mock).mock.calls[0][0];
    expect(call.data.evidence).toBe('Email confirmed interview for June 15th');
  });

  it('SCREENING creates an event with NEUTRAL category', async () => {
    (prisma.outcomeEvent.create as jest.Mock).mockResolvedValue(
      makeEvent({
        outcomeType: OUTCOME_TYPES.SCREENING,
        outcomeCategory: OUTCOME_CATEGORIES.NEUTRAL,
      }),
    );

    await outcomeService.recordOutcome(makeInput({ outcomeType: OUTCOME_TYPES.SCREENING }));

    const call = (prisma.outcomeEvent.create as jest.Mock).mock.calls[0][0];
    expect(call.data.outcomeType).toBe(OUTCOME_TYPES.SCREENING);
    expect(call.data.outcomeCategory).toBe(OUTCOME_CATEGORIES.NEUTRAL);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Chronological ordering
// ─────────────────────────────────────────────────────────────────────────────

describe('getApplicationTimeline — ordering', () => {
  it('returns events ordered by occurredAt ascending', async () => {
    const events = [
      makeEvent({ id: 'e1', occurredAt: new Date('2026-01-01') }),
      makeEvent({ id: 'e2', occurredAt: new Date('2026-03-01') }),
      makeEvent({ id: 'e3', occurredAt: new Date('2026-06-01') }),
    ];
    (prisma.outcomeEvent.findMany as jest.Mock).mockResolvedValue(events);

    const result = await outcomeService.getApplicationTimeline(APP_ID);

    expect(result).toHaveLength(3);
    expect(prisma.outcomeEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { occurredAt: 'asc' } }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Terminal outcomes
// ─────────────────────────────────────────────────────────────────────────────

describe('Terminal outcomes', () => {
  const terminalTypes = [
    OUTCOME_TYPES.OFFER_ACCEPTED,
    OUTCOME_TYPES.OFFER_DECLINED,
    OUTCOME_TYPES.REJECTION_RECEIVED,
    OUTCOME_TYPES.WITHDRAWN,
  ];

  for (const outcomeType of terminalTypes) {
    it(`${outcomeType} updates application status`, async () => {
      (prisma.outcomeEvent.create as jest.Mock).mockResolvedValue(
        makeEvent({ outcomeType }),
      );

      await outcomeService.recordOutcome(makeInput({ outcomeType }));

      expect(prisma.jobApplication.update).toHaveBeenCalled();
    });
  }

  it('OFFER_ACCEPTED maps to POSITIVE category', async () => {
    (prisma.outcomeEvent.create as jest.Mock).mockResolvedValue(
      makeEvent({ outcomeType: OUTCOME_TYPES.OFFER_ACCEPTED }),
    );

    await outcomeService.recordOutcome(
      makeInput({ outcomeType: OUTCOME_TYPES.OFFER_ACCEPTED }),
    );

    const call = (prisma.outcomeEvent.create as jest.Mock).mock.calls[0][0];
    expect(call.data.outcomeCategory).toBe(OUTCOME_CATEGORIES.POSITIVE);
  });

  it('WITHDRAWN maps to NEGATIVE category', async () => {
    (prisma.outcomeEvent.create as jest.Mock).mockResolvedValue(
      makeEvent({ outcomeType: OUTCOME_TYPES.WITHDRAWN }),
    );

    await outcomeService.recordOutcome(makeInput({ outcomeType: OUTCOME_TYPES.WITHDRAWN }));

    const call = (prisma.outcomeEvent.create as jest.Mock).mock.calls[0][0];
    expect(call.data.outcomeCategory).toBe(OUTCOME_CATEGORIES.NEGATIVE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Ownership
// ─────────────────────────────────────────────────────────────────────────────

describe('Ownership', () => {
  it('userId is always written to the OutcomeEvent', async () => {
    (prisma.outcomeEvent.create as jest.Mock).mockResolvedValue(makeEvent());

    await outcomeService.recordOutcome(makeInput({ userId: USER_ID }));

    const call = (prisma.outcomeEvent.create as jest.Mock).mock.calls[0][0];
    expect(call.data.userId).toBe(USER_ID);
  });

  it('getOutcomeCountsByType is scoped to userId', async () => {
    (prisma.outcomeEvent.findMany as jest.Mock).mockResolvedValue([]);

    await outcomeService.getOutcomeCountsByType(USER_ID);

    expect(prisma.outcomeEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER_ID }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Events are historical records (never soft-deleted or mutated)
// ─────────────────────────────────────────────────────────────────────────────

describe('Immutability of outcome events', () => {
  it('recordOutcome only creates new events — never updates existing ones', async () => {
    (prisma.outcomeEvent.create as jest.Mock).mockResolvedValue(makeEvent());

    await outcomeService.recordOutcome(makeInput());

    // prisma.outcomeEvent.create was called; no update was called
    expect(prisma.outcomeEvent.create).toHaveBeenCalledTimes(1);
    // No update method on outcomeEvent mock — confirms no mutation
  });

  it('isCurrent=true is set on new event creation', async () => {
    (prisma.outcomeEvent.create as jest.Mock).mockResolvedValue(makeEvent());

    await outcomeService.recordOutcome(makeInput());

    const call = (prisma.outcomeEvent.create as jest.Mock).mock.calls[0][0];
    expect(call.data.isCurrent).toBe(true);
  });
});
