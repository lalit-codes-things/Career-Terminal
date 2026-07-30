/**
 * Temporal Snapshots & Fact Versioning — Epic 4 Prompt 10
 *
 * Verifies the historical candidate-state snapshot system so Career Terminal
 * can answer "What did the system know about this user at time X?"
 *
 * Coverage:
 *  1. Snapshot creation — captureIntelligenceSnapshot stores projection without copying facts
 *  2. Chronological reconstruction — reconstructStateAt returns the correct snapshot
 *  3. Snapshot isolation — snapshots are user-scoped; no cross-user leakage
 *  4. User isolation — two users get independent snapshots
 *  5. Rebuilding current state from observations — getFactsValidAt fallback contract
 *  6. Immutability — FactObservation rows are never modified by snapshot capture
 *  7. Schema versioning — schemaVersion v1 is stored and parseable
 *  8. Legacy createSnapshot — existing behaviour preserved for backward compat
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../config/database', () => ({
  prisma: {
    snapshot: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    factObservation: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    canonicalCandidateIntelligence: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

import { prisma } from '../config/database';
import {
  snapshotService,
  type CandidateStateV1,
  type CaptureIntelligenceSnapshotInput,
} from '../services/snapshot.service';

// ── Constants ─────────────────────────────────────────────────────────────────

const USER_A = 'aaaa0000-0000-0000-0000-000000000001';
const USER_B = 'bbbb0000-0000-0000-0000-000000000002';
const SNAP_ID = 'snap-0000-0000-0000-000000000001';
const FACT_ID = 'fact-0000-0000-0000-000000000001';
const PROV_ID = 'prov-0000-0000-0000-000000000001';

// ── Fixture factories ─────────────────────────────────────────────────────────

function makeSnap(overrides: Record<string, unknown> = {}) {
  return {
    id: SNAP_ID,
    userId: USER_A,
    snapshotType: 'INTELLIGENCE',
    referenceId: null,
    description: null,
    capturedAt: new Date('2026-06-01T12:00:00Z'),
    lastFactId: FACT_ID,
    schemaVersion: 'v1',
    candidateStateJson: makeStateV1(),
    createdAt: new Date('2026-06-01T12:00:00Z'),
    updatedAt: new Date('2026-06-01T12:00:00Z'),
    ...overrides,
  };
}

function makeStateV1(overrides: Partial<CandidateStateV1> = {}): CandidateStateV1 {
  return {
    schemaVersion: 'v1',
    capturedAt: '2026-06-01T12:00:00.000Z',
    userId: USER_A,
    lastFactId: FACT_ID,
    facts: [
      {
        factType: 'SKILL',
        deduplicationKey: 'typescript',
        confidence: 0.9,
        lastObservedAt: '2026-05-01T00:00:00.000Z',
        isUserCorrected: false,
        sourceFactId: FACT_ID,
        provenanceId: PROV_ID,
      },
    ],
    ...overrides,
  };
}

function makeCanonical(overrides: Record<string, unknown> = {}) {
  return {
    id: 'can-001',
    userId: USER_A,
    cellId: 'us-east-1-shard-000',
    factType: 'SKILL',
    deduplicationKey: 'typescript',
    sourceFactId: FACT_ID,
    provenanceId: PROV_ID,
    confidence: 0.9,
    lastObservedAt: new Date('2026-05-01T00:00:00Z'),
    sourceVersion: 'v1',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    sourceFact: { isUserCorrected: false },
    ...overrides,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.$transaction as jest.Mock).mockImplementation(
    (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Snapshot creation
// ─────────────────────────────────────────────────────────────────────────────

describe('captureIntelligenceSnapshot — creation', () => {
  const input: CaptureIntelligenceSnapshotInput = {
    userId: USER_A,
    snapshotType: 'INTELLIGENCE',
    description: 'Monthly checkpoint',
  };

  it('creates a snapshot record with schemaVersion v1', async () => {
    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue({ id: FACT_ID });
    (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mockResolvedValue([
      makeCanonical(),
    ]);
    (prisma.snapshot.create as jest.Mock).mockResolvedValue(makeSnap());

    const result = await snapshotService.captureIntelligenceSnapshot(input);

    expect(result.id).toBe(SNAP_ID);
    expect(prisma.snapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: USER_A,
          schemaVersion: 'v1',
          lastFactId: FACT_ID,
        }),
      }),
    );
  });

  it('does NOT create any FactObservation rows during capture', async () => {
    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue({ id: FACT_ID });
    (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.snapshot.create as jest.Mock).mockResolvedValue(makeSnap());

    await snapshotService.captureIntelligenceSnapshot(input);

    expect(prisma.factObservation.create).not.toHaveBeenCalled();
  });

  it('stores a JSON projection of canonical facts in candidateStateJson', async () => {
    const canonical = makeCanonical();
    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue({ id: FACT_ID });
    (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mockResolvedValue([canonical]);
    (prisma.snapshot.create as jest.Mock).mockResolvedValue(makeSnap());

    await snapshotService.captureIntelligenceSnapshot(input);

    const createCall = (prisma.snapshot.create as jest.Mock).mock.calls[0][0];
    const state = createCall.data.candidateStateJson as CandidateStateV1;
    expect(state.schemaVersion).toBe('v1');
    expect(state.userId).toBe(USER_A);
    expect(state.facts).toHaveLength(1);
    expect(state.facts[0]!.factType).toBe('SKILL');
    expect(state.facts[0]!.deduplicationKey).toBe('typescript');
    expect(state.facts[0]!.confidence).toBe(0.9);
  });

  it('records lastFactId as the most-recent current fact ID', async () => {
    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue({ id: FACT_ID });
    (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.snapshot.create as jest.Mock).mockResolvedValue(makeSnap());

    await snapshotService.captureIntelligenceSnapshot(input);

    const createCall = (prisma.snapshot.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.lastFactId).toBe(FACT_ID);
  });

  it('records lastFactId as null when user has no facts yet', async () => {
    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.snapshot.create as jest.Mock).mockResolvedValue(
      makeSnap({ lastFactId: null, candidateStateJson: makeStateV1({ lastFactId: null, facts: [] }) }),
    );

    await snapshotService.captureIntelligenceSnapshot(input);

    const createCall = (prisma.snapshot.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.lastFactId).toBeNull();
    const state = createCall.data.candidateStateJson as CandidateStateV1;
    expect(state.facts).toHaveLength(0);
  });

  it('stores capturedAt as an ISO-8601 timestamp in the candidateStateJson', async () => {
    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue({ id: FACT_ID });
    (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.snapshot.create as jest.Mock).mockResolvedValue(makeSnap());

    await snapshotService.captureIntelligenceSnapshot(input);

    const createCall = (prisma.snapshot.create as jest.Mock).mock.calls[0][0];
    const state = createCall.data.candidateStateJson as CandidateStateV1;
    expect(() => new Date(state.capturedAt)).not.toThrow();
    expect(new Date(state.capturedAt).toISOString()).toBe(state.capturedAt);
  });

  it('captures user-corrected flag per fact', async () => {
    const correctedCanonical = makeCanonical({ sourceFact: { isUserCorrected: true } });
    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue({ id: FACT_ID });
    (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mockResolvedValue([
      correctedCanonical,
    ]);
    (prisma.snapshot.create as jest.Mock).mockResolvedValue(makeSnap());

    await snapshotService.captureIntelligenceSnapshot(input);

    const createCall = (prisma.snapshot.create as jest.Mock).mock.calls[0][0];
    const state = createCall.data.candidateStateJson as CandidateStateV1;
    expect(state.facts[0]!.isUserCorrected).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Chronological reconstruction
// ─────────────────────────────────────────────────────────────────────────────

describe('reconstructStateAt — chronological reconstruction', () => {
  it('returns the most recent snapshot at or before the given timestamp', async () => {
    const timestamp = new Date('2026-07-01T00:00:00Z');
    const snap = makeSnap({ capturedAt: new Date('2026-06-15T00:00:00Z') });
    (prisma.snapshot.findFirst as jest.Mock).mockResolvedValue(snap);

    const result = await snapshotService.reconstructStateAt(USER_A, timestamp);

    expect(result).not.toBeNull();
    expect(result!.snapshot.id).toBe(SNAP_ID);
    expect(prisma.snapshot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: USER_A,
          capturedAt: { lte: timestamp },
        }),
        orderBy: { capturedAt: 'desc' },
      }),
    );
  });

  it('returns null when no snapshot exists at or before the timestamp', async () => {
    (prisma.snapshot.findFirst as jest.Mock).mockResolvedValue(null);

    const result = await snapshotService.reconstructStateAt(
      USER_A,
      new Date('2020-01-01T00:00:00Z'),
    );

    expect(result).toBeNull();
  });

  it('parses and returns candidateStateJson as a typed CandidateStateV1', async () => {
    const state = makeStateV1();
    const snap = makeSnap({ candidateStateJson: state });
    (prisma.snapshot.findFirst as jest.Mock).mockResolvedValue(snap);

    const result = await snapshotService.reconstructStateAt(USER_A, new Date());

    expect(result!.candidateState).not.toBeNull();
    expect(result!.candidateState!.schemaVersion).toBe('v1');
    expect(result!.candidateState!.facts).toHaveLength(1);
    expect(result!.candidateState!.facts[0]!.factType).toBe('SKILL');
  });

  it('returns candidateState=null when candidateStateJson is missing', async () => {
    const snap = makeSnap({ candidateStateJson: null });
    (prisma.snapshot.findFirst as jest.Mock).mockResolvedValue(snap);

    const result = await snapshotService.reconstructStateAt(USER_A, new Date());

    expect(result!.candidateState).toBeNull();
  });

  it('returns the MOST RECENT snapshot when multiple exist before the timestamp', async () => {
    // findFirst with orderBy: capturedAt desc should return the closest one
    const latestSnap = makeSnap({
      id: 'snap-latest',
      capturedAt: new Date('2026-06-20T00:00:00Z'),
    });
    (prisma.snapshot.findFirst as jest.Mock).mockResolvedValue(latestSnap);

    const result = await snapshotService.reconstructStateAt(
      USER_A,
      new Date('2026-07-01T00:00:00Z'),
    );

    expect(result!.snapshot.id).toBe('snap-latest');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 & 4. Snapshot isolation and user isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('Snapshot isolation', () => {
  it('reconstructStateAt is scoped to userId — never returns another user snapshot', async () => {
    (prisma.snapshot.findFirst as jest.Mock).mockResolvedValue(null);

    await snapshotService.reconstructStateAt(USER_A, new Date());

    expect(prisma.snapshot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER_A }),
      }),
    );
    // Verify USER_B is NOT in the where clause
    const call = (prisma.snapshot.findFirst as jest.Mock).mock.calls[0][0];
    expect(JSON.stringify(call.where)).not.toContain(USER_B);
  });

  it('getSnapshotHistory is scoped to userId', async () => {
    (prisma.snapshot.findMany as jest.Mock).mockResolvedValue([]);

    await snapshotService.getSnapshotHistory(USER_A);

    expect(prisma.snapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER_A }),
      }),
    );
  });

  it('captureIntelligenceSnapshot stores userId in both the row and the candidateStateJson', async () => {
    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.snapshot.create as jest.Mock).mockResolvedValue(makeSnap({ userId: USER_B }));

    await snapshotService.captureIntelligenceSnapshot({
      userId: USER_B,
      snapshotType: 'INTELLIGENCE',
    });

    const createCall = (prisma.snapshot.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.userId).toBe(USER_B);
    const state = createCall.data.candidateStateJson as CandidateStateV1;
    expect(state.userId).toBe(USER_B);
  });

  it('two users get independent snapshot records', async () => {
    // Capture for User A
    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue({ id: 'fa-1' });
    (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.snapshot.create as jest.Mock).mockResolvedValue(makeSnap({ userId: USER_A }));
    await snapshotService.captureIntelligenceSnapshot({ userId: USER_A, snapshotType: 'MONTHLY' });

    jest.clearAllMocks();
    (prisma.$transaction as jest.Mock).mockImplementation(
      (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma),
    );

    // Capture for User B
    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue({ id: 'fb-1' });
    (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.snapshot.create as jest.Mock).mockResolvedValue(
      makeSnap({ id: 'snap-b', userId: USER_B }),
    );
    await snapshotService.captureIntelligenceSnapshot({ userId: USER_B, snapshotType: 'MONTHLY' });

    const callA = (prisma.snapshot.create as jest.Mock).mock.calls[0]![0];
    expect(callA.data.userId).toBe(USER_B); // only B's call is in this cleared batch

    // Verify the canonical lookup was scoped to USER_B
    const canonicalCall = (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mock
      .calls[0]![0];
    expect(canonicalCall.where.userId).toBe(USER_B);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Rebuilding current state from observations (fallback contract)
// ─────────────────────────────────────────────────────────────────────────────

describe('Rebuilding state from observations', () => {
  it('reconstructStateAt returns null when no snapshots exist (caller must use getFactsValidAt)', async () => {
    (prisma.snapshot.findFirst as jest.Mock).mockResolvedValue(null);

    const result = await snapshotService.reconstructStateAt(USER_A, new Date('2020-01-01'));

    expect(result).toBeNull();
    // This signals to the caller to fall back to FactService.getFactsValidAt
  });

  it('getSnapshotHistory returns snapshots in chronological order (oldest first)', async () => {
    const snaps = [
      makeSnap({ id: 's1', capturedAt: new Date('2026-01-01') }),
      makeSnap({ id: 's2', capturedAt: new Date('2026-03-01') }),
      makeSnap({ id: 's3', capturedAt: new Date('2026-06-01') }),
    ];
    (prisma.snapshot.findMany as jest.Mock).mockResolvedValue(snaps);

    const result = await snapshotService.getSnapshotHistory(USER_A);

    expect(prisma.snapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { capturedAt: 'asc' } }),
    );
    expect(result).toHaveLength(3);
  });

  it('snapshot candidateStateJson preserves lastObservedAt per fact for temporal queries', async () => {
    const factAt = new Date('2026-04-15T09:30:00Z');
    const canonical = makeCanonical({ lastObservedAt: factAt });
    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue({ id: FACT_ID });
    (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mockResolvedValue([canonical]);
    (prisma.snapshot.create as jest.Mock).mockResolvedValue(makeSnap());

    await snapshotService.captureIntelligenceSnapshot({
      userId: USER_A,
      snapshotType: 'INTELLIGENCE',
    });

    const createCall = (prisma.snapshot.create as jest.Mock).mock.calls[0][0];
    const state = createCall.data.candidateStateJson as CandidateStateV1;
    expect(state.facts[0]!.lastObservedAt).toBe(factAt.toISOString());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Immutability — FactObservation rows must not be modified by snapshot capture
// ─────────────────────────────────────────────────────────────────────────────

describe('Immutability of FactObservation during snapshot', () => {
  it('captureIntelligenceSnapshot never calls factObservation.create', async () => {
    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue({ id: FACT_ID });
    (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mockResolvedValue([
      makeCanonical(),
    ]);
    (prisma.snapshot.create as jest.Mock).mockResolvedValue(makeSnap());

    await snapshotService.captureIntelligenceSnapshot({
      userId: USER_A,
      snapshotType: 'INTELLIGENCE',
    });

    expect(prisma.factObservation.create).not.toHaveBeenCalled();
  });

  it('captureIntelligenceSnapshot only reads (findFirst/findMany) fact tables', async () => {
    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue({ id: FACT_ID });
    (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.snapshot.create as jest.Mock).mockResolvedValue(makeSnap());

    await snapshotService.captureIntelligenceSnapshot({
      userId: USER_A,
      snapshotType: 'INTELLIGENCE',
    });

    // Only reads — no writes to fact tables
    expect(prisma.factObservation.create).not.toHaveBeenCalled();
    expect(prisma.factObservation.findFirst).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Schema versioning
// ─────────────────────────────────────────────────────────────────────────────

describe('Schema versioning', () => {
  it('schemaVersion v1 is stored in the snapshot row', async () => {
    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.snapshot.create as jest.Mock).mockResolvedValue(makeSnap());

    await snapshotService.captureIntelligenceSnapshot({
      userId: USER_A,
      snapshotType: 'INTELLIGENCE',
    });

    const createCall = (prisma.snapshot.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.schemaVersion).toBe('v1');
  });

  it('reconstructStateAt only returns schemaVersion v1 snapshots', async () => {
    (prisma.snapshot.findFirst as jest.Mock).mockResolvedValue(null);

    await snapshotService.reconstructStateAt(USER_A, new Date());

    const call = (prisma.snapshot.findFirst as jest.Mock).mock.calls[0][0];
    expect(call.where.schemaVersion).toBe('v1');
  });

  it('returns candidateState=null for unknown schemaVersion (future-proofing)', async () => {
    const snap = makeSnap({ candidateStateJson: { schemaVersion: 'v99', facts: [] } });
    (prisma.snapshot.findFirst as jest.Mock).mockResolvedValue(snap);

    const result = await snapshotService.reconstructStateAt(USER_A, new Date());

    expect(result!.candidateState).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Legacy createSnapshot — backward compatibility
// ─────────────────────────────────────────────────────────────────────────────

describe('Legacy createSnapshot — backward compat', () => {
  it('creates snapshot and copies current FactObservation rows (existing behaviour)', async () => {
    const currentFacts = [
      {
        id: 'f1',
        userId: USER_A,
        factType: 'SKILL',
        factData: { name: 'Go' },
        sourceType: 'RESUME',
        sourceId: 'r1',
        sourceVersion: null,
        extractionMethod: 'LLM',
        modelVersion: null,
        confidence: 0.9,
        evidenceReference: null,
        validFrom: null,
        validTo: null,
        observedAt: new Date(),
        version: 1,
        isCurrent: true,
        deletedAt: null,
        extractionRunId: null,
        provenanceId: null,
        snapshotId: null,
      },
    ];

    const snap = makeSnap({ schemaVersion: 'legacy' });
    (prisma.snapshot.create as jest.Mock).mockResolvedValue(snap);
    (prisma.factObservation.findMany as jest.Mock).mockResolvedValue(currentFacts);
    (prisma.factObservation.create as jest.Mock).mockResolvedValue({ id: 'copy-f1' });

    const result = await snapshotService.createSnapshot(
      USER_A,
      'APPLICATION',
      'app-ref-1',
      'Snapshot at submission',
    );

    expect(result.id).toBe(SNAP_ID);
    // Legacy path DOES copy fact rows
    expect(prisma.factObservation.create).toHaveBeenCalledTimes(1);
    expect(prisma.factObservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ snapshotId: SNAP_ID, factType: 'SKILL' }),
      }),
    );
  });

  it('getSnapshotFacts still returns the copied fact rows for legacy snapshots', async () => {
    const snapFacts = [
      { id: 'copy-f1', snapshotId: SNAP_ID, factType: 'SKILL' },
    ];
    (prisma.factObservation.findMany as jest.Mock).mockResolvedValue(snapFacts);

    const result = await snapshotService.getSnapshotFacts(SNAP_ID);

    expect(result).toHaveLength(1);
    expect(result[0]!.snapshotId).toBe(SNAP_ID);
  });
});
