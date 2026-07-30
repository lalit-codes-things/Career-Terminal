/**
 * Provenance Pipeline — Epic 4 Prompt 9
 *
 * Verifies the authoritative provenance pipeline:
 *   Source → ExtractionRun → FactObservation → FactProvenance → CanonicalIntelligence
 *
 * Coverage:
 *  1. Provenance linkage — every fact carries extractionRunId + provenanceId
 *  2. Versioning — new facts supersede old ones; history is preserved
 *  3. User correction — machine observation is preserved; correction is additive
 *  4. Duplicate processing — same source processed twice → two separate runs
 *  5. Ownership — facts belong to the user who owns the source document
 *  6. Missing / legacy provenance — facts with null provenanceId are handled gracefully
 *  7. Resume source and Gmail (EMAIL) source both honour the same contract
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../config/database', () => ({
  prisma: {
    extractionRun: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    factProvenance: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    factObservation: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../services/routing/cell-routing.service', () => ({
  cellRoutingService: {
    resolveUserRouting: jest.fn().mockResolvedValue({ cellId: 'us-east-1-shard-000' }),
  },
}));

import { prisma } from '../config/database';
import { factService, type RecordFactInput, type CreateExtractionRunInput } from '../services/fact.service';
import { factCorrectionService } from '../services/fact-correction.service';

// ── Constants ─────────────────────────────────────────────────────────────────

const USER_A = 'aaaa0000-0000-0000-0000-000000000001';
const USER_B = 'bbbb0000-0000-0000-0000-000000000002';
const CELL_A = 'us-east-1-shard-000';
const RUN_ID = 'run-0000-0000-0000-000000000001';
const PROV_ID = 'prov-0000-0000-0000-000000000001';
const FACT_ID = 'fact-0000-0000-0000-000000000001';
const SOURCE_ID = 'resume-0000-0000-0000-000000000001';

// ── Fixture factories ─────────────────────────────────────────────────────────

function makeRunInput(overrides: Partial<CreateExtractionRunInput> = {}): CreateExtractionRunInput {
  return {
    userId: USER_A,
    sourceType: 'RESUME',
    sourceId: SOURCE_ID,
    parserVersion: 'test-parser-v1',
    schemaVersion: 'epic-4-prompt-9',
    modelProvider: 'local',
    modelVersion: '1.0',
    ...overrides,
  };
}

function makeFactInput(overrides: Partial<RecordFactInput> = {}): RecordFactInput {
  return {
    userId: USER_A,
    extractionRunId: RUN_ID,
    provenanceId: PROV_ID,
    factType: 'SKILL',
    factData: { name: 'TypeScript', source: 'resume_parser' },
    sourceType: 'RESUME',
    sourceId: SOURCE_ID,
    extractionMethod: 'KEYWORD_MATCH',
    confidence: 0.85,
    observedAt: new Date('2026-01-15T10:00:00Z'),
    ...overrides,
  };
}

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    userId: USER_A,
    cellId: CELL_A,
    sourceType: 'RESUME',
    sourceId: SOURCE_ID,
    status: 'completed',
    completedAt: new Date(),
    ...overrides,
  };
}

function makeProvenance(overrides: Record<string, unknown> = {}) {
  return {
    id: PROV_ID,
    userId: USER_A,
    cellId: CELL_A,
    sourceType: 'RESUME',
    sourceId: SOURCE_ID,
    extractionRunId: RUN_ID,
    parserVersion: 'test-parser-v1',
    schemaVersion: 'epic-4-prompt-9',
    createdAt: new Date(),
    ...overrides,
  };
}

function makeFact(overrides: Record<string, unknown> = {}) {
  return {
    id: FACT_ID,
    userId: USER_A,
    extractionRunId: RUN_ID,
    provenanceId: PROV_ID,
    factType: 'SKILL',
    factData: { name: 'TypeScript' },
    sourceType: 'RESUME',
    sourceId: SOURCE_ID,
    confidence: 0.85,
    observedAt: new Date('2026-01-15T10:00:00Z'),
    version: 1,
    isCurrent: true,
    supersededById: null,
    isUserCorrected: false,
    deletedAt: null,
    ...overrides,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();

  // Default: $transaction executes its callback synchronously with prisma
  (prisma.$transaction as jest.Mock).mockImplementation((cb: (tx: typeof prisma) => Promise<unknown>) =>
    cb(prisma),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Provenance linkage
// ─────────────────────────────────────────────────────────────────────────────

describe('Provenance linkage', () => {
  it('createExtractionRun creates ExtractionRun and FactProvenance atomically', async () => {
    const run = makeRun();
    const prov = makeProvenance();
    (prisma.extractionRun.create as jest.Mock).mockResolvedValue(run);
    (prisma.factProvenance.create as jest.Mock).mockResolvedValue(prov);

    const ctx = await factService.createExtractionRun(makeRunInput());

    expect(ctx.runId).toBe(RUN_ID);
    expect(ctx.provenanceId).toBe(PROV_ID);

    // Both must be written in the same transaction
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.extractionRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: USER_A, sourceType: 'RESUME', sourceId: SOURCE_ID }),
      }),
    );
    expect(prisma.factProvenance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: USER_A,
          extractionRunId: RUN_ID,
          sourceType: 'RESUME',
          sourceId: SOURCE_ID,
        }),
      }),
    );
  });

  it('FactProvenance carries extractionRunId linking it back to the run', async () => {
    const run = makeRun();
    const prov = makeProvenance({ extractionRunId: run.id });
    (prisma.extractionRun.create as jest.Mock).mockResolvedValue(run);
    (prisma.factProvenance.create as jest.Mock).mockResolvedValue(prov);

    const ctx = await factService.createExtractionRun(makeRunInput());

    const provenanceCall = (prisma.factProvenance.create as jest.Mock).mock.calls[0][0];
    expect(provenanceCall.data.extractionRunId).toBe(run.id);
    expect(ctx.runId).toBe(ctx.runId); // runId === extractionRun.id
  });

  it('recordFact embeds extractionRunId and provenanceId on every fact', async () => {
    const fact = makeFact();
    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.factObservation.create as jest.Mock).mockResolvedValue(fact);

    await factService.recordFact(makeFactInput());

    expect(prisma.factObservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          extractionRunId: RUN_ID,
          provenanceId: PROV_ID,
          userId: USER_A,
          sourceType: 'RESUME',
          sourceId: SOURCE_ID,
        }),
      }),
    );
  });

  it('FactProvenance carries parserVersion and schemaVersion for full auditability', async () => {
    const run = makeRun();
    const prov = makeProvenance({ parserVersion: 'resume-matcher-v2', schemaVersion: 'v2.0' });
    (prisma.extractionRun.create as jest.Mock).mockResolvedValue(run);
    (prisma.factProvenance.create as jest.Mock).mockResolvedValue(prov);

    await factService.createExtractionRun(
      makeRunInput({ parserVersion: 'resume-matcher-v2', schemaVersion: 'v2.0' }),
    );

    const provCall = (prisma.factProvenance.create as jest.Mock).mock.calls[0][0];
    expect(provCall.data.parserVersion).toBe('resume-matcher-v2');
    expect(provCall.data.schemaVersion).toBe('v2.0');
  });

  it('FactProvenance carries modelProvider and modelVersion', async () => {
    (prisma.extractionRun.create as jest.Mock).mockResolvedValue(makeRun());
    (prisma.factProvenance.create as jest.Mock).mockResolvedValue(makeProvenance());

    await factService.createExtractionRun(
      makeRunInput({ modelProvider: 'openai', modelVersion: 'gpt-4o' }),
    );

    const provCall = (prisma.factProvenance.create as jest.Mock).mock.calls[0][0];
    expect(provCall.data.modelProvider).toBe('openai');
    expect(provCall.data.modelVersion).toBe('gpt-4o');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Versioning
// ─────────────────────────────────────────────────────────────────────────────

describe('Fact versioning', () => {
  it('first fact for a type starts at version 1', async () => {
    const fact = makeFact({ version: 1 });
    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.factObservation.create as jest.Mock).mockResolvedValue(fact);

    const result = await factService.recordFact(makeFactInput());

    expect(prisma.factObservation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 1, isCurrent: true }) }),
    );
    expect(result.id).toBe(FACT_ID);
  });

  it('subsequent fact increments version and supersedes the previous one', async () => {
    const existing = makeFact({ id: 'fact-old', version: 2 });
    const newFact = makeFact({ id: 'fact-new', version: 3 });
    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue(existing);
    (prisma.factObservation.create as jest.Mock).mockResolvedValue(newFact);
    (prisma.factObservation.update as jest.Mock).mockResolvedValue(existing);

    await factService.recordFact(makeFactInput());

    expect(prisma.factObservation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 3, isCurrent: true }) }),
    );
    expect(prisma.factObservation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fact-old' },
        data: expect.objectContaining({ isCurrent: false, supersededById: 'fact-new' }),
      }),
    );
  });

  it('supersededAt is set on the superseded fact', async () => {
    const existing = makeFact({ id: 'fact-old', version: 1 });
    const newFact = makeFact({ id: 'fact-new', version: 2 });
    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue(existing);
    (prisma.factObservation.create as jest.Mock).mockResolvedValue(newFact);
    (prisma.factObservation.update as jest.Mock).mockResolvedValue(existing);

    await factService.recordFact(makeFactInput());

    const updateCall = (prisma.factObservation.update as jest.Mock).mock.calls[0][0];
    expect(updateCall.data.supersededAt).toBeInstanceOf(Date);
  });

  it('historical facts (isCurrent=false) are retained and not destroyed', async () => {
    // Record v1 and v2; v1 must remain in DB (just isCurrent=false)
    const v1 = makeFact({ id: 'fact-v1', version: 1, isCurrent: true });
    const v2 = makeFact({ id: 'fact-v2', version: 2, isCurrent: true });

    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue(v1);
    (prisma.factObservation.create as jest.Mock).mockResolvedValue(v2);
    (prisma.factObservation.update as jest.Mock).mockResolvedValue({ ...v1, isCurrent: false });

    await factService.recordFact(makeFactInput());

    // Only update (not delete) was called on v1
    expect(prisma.factObservation.update).toHaveBeenCalledTimes(1);
    const updateCall = (prisma.factObservation.update as jest.Mock).mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty('deletedAt');
    expect(updateCall.data.isCurrent).toBe(false);
  });

  it('getFactHistory walks the supersededById chain correctly', async () => {
    const v1 = makeFact({ id: 'fact-v1', supersededById: 'fact-v2' });
    const v2 = makeFact({ id: 'fact-v2', supersededById: 'fact-v3' });
    const v3 = makeFact({ id: 'fact-v3', supersededById: null });

    (prisma.factObservation.findUnique as jest.Mock)
      .mockResolvedValueOnce(v1)
      .mockResolvedValueOnce(v2)
      .mockResolvedValueOnce(v3);

    const history = await factService.getFactHistory('fact-v1');

    expect(history).toHaveLength(3);
    expect(history[0]!.id).toBe('fact-v1');
    expect(history[1]!.id).toBe('fact-v2');
    expect(history[2]!.id).toBe('fact-v3');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. User correction
// ─────────────────────────────────────────────────────────────────────────────

describe('User correction', () => {
  it('proposeCorrection creates a new USER_CORRECTION fact with confidence=1.0', async () => {
    const originalFact = {
      ...makeFact({ id: 'fact-orig' }),
      extractionRun: makeRun(),
      provenance: makeProvenance(),
    };
    const correctedFact = makeFact({
      id: 'fact-corrected',
      version: 2,
      isUserCorrected: true,
      sourceType: 'MANUAL',
      extractionMethod: 'USER_CORRECTION',
      confidence: 1.0,
    });

    // createExtractionRun stubs
    (prisma.extractionRun.create as jest.Mock).mockResolvedValue(makeRun({ id: 'run-manual' }));
    (prisma.factProvenance.create as jest.Mock).mockResolvedValue(
      makeProvenance({ id: 'prov-manual', extractionRunId: 'run-manual' }),
    );
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(originalFact);
    (prisma.factObservation.create as jest.Mock).mockResolvedValue(correctedFact);
    (prisma.factObservation.update as jest.Mock).mockResolvedValue({
      ...originalFact,
      isCurrent: false,
      supersededById: 'fact-corrected',
    });

    const result = await factCorrectionService.proposeCorrection(
      'fact-orig',
      { name: 'TypeScript', years: 5 },
      USER_A,
      'I have 5 years, not 1',
      'LinkedIn profile confirms',
    );

    expect(result.id).toBe('fact-corrected');
    expect(result.isUserCorrected).toBe(true);
    expect(result.confidence).toBe(1.0);
  });

  it('original machine observation is preserved (not deleted) after correction', async () => {
    const originalFact = {
      ...makeFact({ id: 'fact-orig', isUserCorrected: false }),
      extractionRun: makeRun(),
      provenance: makeProvenance(),
    };
    const correctedFact = makeFact({ id: 'fact-corrected', version: 2, isUserCorrected: true });

    (prisma.extractionRun.create as jest.Mock).mockResolvedValue(makeRun({ id: 'run-manual' }));
    (prisma.factProvenance.create as jest.Mock).mockResolvedValue(
      makeProvenance({ id: 'prov-manual', extractionRunId: 'run-manual' }),
    );
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(originalFact);
    (prisma.factObservation.create as jest.Mock).mockResolvedValue(correctedFact);
    (prisma.factObservation.update as jest.Mock).mockResolvedValue({});

    await factCorrectionService.proposeCorrection(
      'fact-orig',
      { name: 'TypeScript', years: 5 },
      USER_A,
      'Correction reason',
    );

    // update (not delete) was called on the original
    expect(prisma.factObservation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fact-orig' },
        data: expect.objectContaining({
          isCurrent: false,
          supersededById: 'fact-corrected',
        }),
      }),
    );
    // deletedAt must NOT be set on the original
    const updateCall = (prisma.factObservation.update as jest.Mock).mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty('deletedAt');
  });

  it('corrected fact carries correction metadata', async () => {
    const originalFact = {
      ...makeFact({ id: 'fact-orig' }),
      provenance: makeProvenance(),
    };
    const correctedFact = makeFact({
      id: 'fact-corrected',
      version: 2,
      isUserCorrected: true,
      correctedBy: USER_A,
      correctionReason: 'Better data from LinkedIn',
    });

    (prisma.extractionRun.create as jest.Mock).mockResolvedValue(makeRun({ id: 'run-m' }));
    (prisma.factProvenance.create as jest.Mock).mockResolvedValue(
      makeProvenance({ id: 'prov-m', extractionRunId: 'run-m' }),
    );
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(originalFact);
    (prisma.factObservation.create as jest.Mock).mockResolvedValue(correctedFact);
    (prisma.factObservation.update as jest.Mock).mockResolvedValue({});

    await factCorrectionService.proposeCorrection(
      'fact-orig',
      { name: 'TypeScript', years: 5 },
      USER_A,
      'Better data from LinkedIn',
      'evidence text',
    );

    const createCall = (prisma.factObservation.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.isUserCorrected).toBe(true);
    expect(createCall.data.correctedBy).toBe(USER_A);
    expect(createCall.data.correctionReason).toBe('Better data from LinkedIn');
    expect(createCall.data.evidenceReference).toBe('evidence text');
    expect(createCall.data.sourceType).toBe('MANUAL');
    expect(createCall.data.extractionMethod).toBe('USER_CORRECTION');
  });

  it('correction creates a new provenance record with MANUAL source type', async () => {
    const originalFact = {
      ...makeFact({ id: 'fact-orig' }),
      provenance: makeProvenance(),
    };

    (prisma.extractionRun.create as jest.Mock).mockResolvedValue(makeRun({ id: 'run-manual' }));
    (prisma.factProvenance.create as jest.Mock).mockResolvedValue(
      makeProvenance({ id: 'prov-manual', sourceType: 'MANUAL', extractionRunId: 'run-manual' }),
    );
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(originalFact);
    (prisma.factObservation.create as jest.Mock).mockResolvedValue(makeFact({ id: 'fact-c' }));
    (prisma.factObservation.update as jest.Mock).mockResolvedValue({});

    await factCorrectionService.proposeCorrection(
      'fact-orig',
      { name: 'Go', years: 3 },
      USER_A,
      'reason',
    );

    const runCall = (prisma.extractionRun.create as jest.Mock).mock.calls[0][0];
    expect(runCall.data.sourceType).toBe('MANUAL');
    expect(runCall.data.parserVersion).toBe('manual-correction');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Duplicate processing (same source, multiple runs)
// ─────────────────────────────────────────────────────────────────────────────

describe('Duplicate processing', () => {
  it('the same source can be processed twice, producing two separate runs', async () => {
    const run1 = makeRun({ id: 'run-001' });
    const run2 = makeRun({ id: 'run-002' });
    const prov1 = makeProvenance({ id: 'prov-001', extractionRunId: 'run-001' });
    const prov2 = makeProvenance({ id: 'prov-002', extractionRunId: 'run-002' });

    (prisma.extractionRun.create as jest.Mock)
      .mockResolvedValueOnce(run1)
      .mockResolvedValueOnce(run2);
    (prisma.factProvenance.create as jest.Mock)
      .mockResolvedValueOnce(prov1)
      .mockResolvedValueOnce(prov2);

    const ctx1 = await factService.createExtractionRun(makeRunInput());
    const ctx2 = await factService.createExtractionRun(makeRunInput());

    // Two distinct runs, two distinct provenance records
    expect(ctx1.runId).toBe('run-001');
    expect(ctx2.runId).toBe('run-002');
    expect(ctx1.provenanceId).toBe('prov-001');
    expect(ctx2.provenanceId).toBe('prov-002');
    expect(prisma.extractionRun.create).toHaveBeenCalledTimes(2);
    expect(prisma.factProvenance.create).toHaveBeenCalledTimes(2);
  });

  it('facts from two runs for the same source carry different provenance IDs', async () => {
    const prov1 = makeProvenance({ id: 'prov-001', extractionRunId: 'run-001' });
    const prov2 = makeProvenance({ id: 'prov-002', extractionRunId: 'run-002' });

    // First run produces a fact
    (prisma.extractionRun.create as jest.Mock).mockResolvedValueOnce(makeRun({ id: 'run-001' }));
    (prisma.factProvenance.create as jest.Mock).mockResolvedValueOnce(prov1);
    const ctx1 = await factService.createExtractionRun(makeRunInput());

    // Second run (re-run after parser upgrade) produces a fact
    (prisma.extractionRun.create as jest.Mock).mockResolvedValueOnce(makeRun({ id: 'run-002' }));
    (prisma.factProvenance.create as jest.Mock).mockResolvedValueOnce(prov2);
    const ctx2 = await factService.createExtractionRun(
      makeRunInput({ parserVersion: 'resume-matcher-v2' }),
    );

    expect(ctx1.provenanceId).not.toBe(ctx2.provenanceId);
    expect(ctx1.runId).not.toBe(ctx2.runId);
  });

  it('re-runs for different sourceIdentities are treated as distinct runs', async () => {
    (prisma.extractionRun.create as jest.Mock).mockResolvedValue(makeRun());
    (prisma.factProvenance.create as jest.Mock).mockResolvedValue(makeProvenance());

    await factService.createExtractionRun(
      makeRunInput({ sourceIdentity: 'sha256:aaa', parserVersion: 'v1' }),
    );
    await factService.createExtractionRun(
      makeRunInput({ sourceIdentity: 'sha256:bbb', parserVersion: 'v2' }),
    );

    // Both create their own run + provenance
    expect(prisma.extractionRun.create).toHaveBeenCalledTimes(2);
    const call1 = (prisma.extractionRun.create as jest.Mock).mock.calls[0][0];
    const call2 = (prisma.extractionRun.create as jest.Mock).mock.calls[1][0];
    expect(call1.data.sourceIdentity).toBe('sha256:aaa');
    expect(call2.data.sourceIdentity).toBe('sha256:bbb');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Ownership
// ─────────────────────────────────────────────────────────────────────────────

describe('Ownership', () => {
  it('userId is written to every ExtractionRun', async () => {
    (prisma.extractionRun.create as jest.Mock).mockResolvedValue(makeRun());
    (prisma.factProvenance.create as jest.Mock).mockResolvedValue(makeProvenance());

    await factService.createExtractionRun(makeRunInput({ userId: USER_A }));

    const runCall = (prisma.extractionRun.create as jest.Mock).mock.calls[0][0];
    expect(runCall.data.userId).toBe(USER_A);
  });

  it('userId is written to every FactProvenance', async () => {
    (prisma.extractionRun.create as jest.Mock).mockResolvedValue(makeRun());
    (prisma.factProvenance.create as jest.Mock).mockResolvedValue(makeProvenance());

    await factService.createExtractionRun(makeRunInput({ userId: USER_A }));

    const provCall = (prisma.factProvenance.create as jest.Mock).mock.calls[0][0];
    expect(provCall.data.userId).toBe(USER_A);
  });

  it('userId is written to every FactObservation', async () => {
    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.factObservation.create as jest.Mock).mockResolvedValue(makeFact());

    await factService.recordFact(makeFactInput({ userId: USER_A }));

    const factCall = (prisma.factObservation.create as jest.Mock).mock.calls[0][0];
    expect(factCall.data.userId).toBe(USER_A);
  });

  it('two users with the same source type produce isolated provenance records', async () => {
    // User A run
    (prisma.extractionRun.create as jest.Mock).mockResolvedValueOnce(makeRun({ userId: USER_A }));
    (prisma.factProvenance.create as jest.Mock).mockResolvedValueOnce(
      makeProvenance({ userId: USER_A }),
    );
    const ctxA = await factService.createExtractionRun(makeRunInput({ userId: USER_A }));

    // User B run for the same source type (different sourceId in practice, but userId must differ)
    (prisma.extractionRun.create as jest.Mock).mockResolvedValueOnce(makeRun({ userId: USER_B }));
    (prisma.factProvenance.create as jest.Mock).mockResolvedValueOnce(
      makeProvenance({ id: 'prov-b', userId: USER_B, extractionRunId: 'run-b' }),
    );
    const ctxB = await factService.createExtractionRun(makeRunInput({ userId: USER_B }));

    expect(ctxA.provenanceId).not.toBe(ctxB.provenanceId);

    const provCallA = (prisma.factProvenance.create as jest.Mock).mock.calls[0][0];
    const provCallB = (prisma.factProvenance.create as jest.Mock).mock.calls[1][0];
    expect(provCallA.data.userId).toBe(USER_A);
    expect(provCallB.data.userId).toBe(USER_B);
  });

  it('proposeCorrection rejects when original fact is not found', async () => {
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      factCorrectionService.proposeCorrection('nonexistent-fact', { name: 'Go' }, USER_A, 'reason'),
    ).rejects.toThrow('Fact not found: nonexistent-fact');
  });

  it('proposeCorrection rejects when original fact has no provenance', async () => {
    const factWithoutProvenance = {
      ...makeFact(),
      provenance: null,
      extractionRun: null,
    };
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(factWithoutProvenance);

    await expect(
      factCorrectionService.proposeCorrection(FACT_ID, { name: 'Go' }, USER_A, 'reason'),
    ).rejects.toThrow(`Fact provenance not found: ${FACT_ID}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Missing / legacy provenance
// ─────────────────────────────────────────────────────────────────────────────

describe('Missing / legacy provenance', () => {
  it('getCurrentFacts returns facts even when provenanceId is null (legacy rows)', async () => {
    const legacyFact = makeFact({ provenanceId: null, extractionRunId: null });
    (prisma.factObservation.findMany as jest.Mock).mockResolvedValue([legacyFact]);

    const facts = await factService.getCurrentFacts(USER_A);

    expect(facts).toHaveLength(1);
    expect(facts[0]!.provenanceId).toBeNull();
  });

  it('getFactHistory handles facts with null supersededById correctly', async () => {
    const singleFact = makeFact({ supersededById: null });
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(singleFact);

    const history = await factService.getFactHistory(FACT_ID);

    expect(history).toHaveLength(1);
    expect(history[0]!.id).toBe(FACT_ID);
  });

  it('proposeCorrection throws when the original fact has no provenance (guards against legacy data)', async () => {
    const legacyFact = {
      ...makeFact({ id: 'legacy-fact' }),
      provenance: null,
      extractionRun: null,
    };
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(legacyFact);

    await expect(
      factCorrectionService.proposeCorrection('legacy-fact', { name: 'Rust' }, USER_A, 'reason'),
    ).rejects.toThrow('Fact provenance not found: legacy-fact');
  });

  it('getFactsValidAt returns facts with validFrom only (open-ended temporal range)', async () => {
    const openFact = makeFact({ validFrom: new Date('2022-01-01'), validTo: null });
    (prisma.factObservation.findMany as jest.Mock).mockResolvedValue([openFact]);
    const ts = new Date('2024-06-01');

    const facts = await factService.getFactsValidAt(USER_A, ts, 'SKILL');

    expect(facts).toHaveLength(1);
    expect(prisma.factObservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ validFrom: { lte: ts }, validTo: null }),
          ]),
        }),
      }),
    );
  });

  it('getFactsValidAt supports bounded temporal range (validFrom + validTo)', async () => {
    const boundedFact = makeFact({
      validFrom: new Date('2020-01-01'),
      validTo: new Date('2023-12-31'),
    });
    (prisma.factObservation.findMany as jest.Mock).mockResolvedValue([boundedFact]);
    const ts = new Date('2021-06-15');

    const facts = await factService.getFactsValidAt(USER_A, ts, 'EXPERIENCE');

    expect(facts).toHaveLength(1);
    expect(prisma.factObservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              validFrom: { lte: ts },
              validTo: { gte: ts },
            }),
          ]),
        }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Source parity — RESUME and EMAIL both honour the same provenance contract
// ─────────────────────────────────────────────────────────────────────────────

describe('Source parity (RESUME vs EMAIL)', () => {
  const EMAIL_SOURCE_ID = 'email-0000-0000-0000-000000000001';

  it('EMAIL source produces the same provenance structure as RESUME', async () => {
    const emailRun = makeRun({ sourceType: 'EMAIL', sourceId: EMAIL_SOURCE_ID });
    const emailProv = makeProvenance({ sourceType: 'EMAIL', sourceId: EMAIL_SOURCE_ID });
    (prisma.extractionRun.create as jest.Mock).mockResolvedValue(emailRun);
    (prisma.factProvenance.create as jest.Mock).mockResolvedValue(emailProv);

    const ctx = await factService.createExtractionRun(
      makeRunInput({ sourceType: 'EMAIL', sourceId: EMAIL_SOURCE_ID }),
    );

    expect(ctx.runId).toBeDefined();
    expect(ctx.provenanceId).toBeDefined();

    const runCall = (prisma.extractionRun.create as jest.Mock).mock.calls[0][0];
    const provCall = (prisma.factProvenance.create as jest.Mock).mock.calls[0][0];
    expect(runCall.data.sourceType).toBe('EMAIL');
    expect(provCall.data.sourceType).toBe('EMAIL');
  });

  it('facts extracted from EMAIL carry the email sourceId and sourceType', async () => {
    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.factObservation.create as jest.Mock).mockResolvedValue(
      makeFact({ sourceType: 'EMAIL', sourceId: EMAIL_SOURCE_ID }),
    );

    await factService.recordFact(
      makeFactInput({
        sourceType: 'EMAIL',
        sourceId: EMAIL_SOURCE_ID,
        extractionMethod: 'LLM',
        factType: 'SKILL',
      }),
    );

    const factCall = (prisma.factObservation.create as jest.Mock).mock.calls[0][0];
    expect(factCall.data.sourceType).toBe('EMAIL');
    expect(factCall.data.sourceId).toBe(EMAIL_SOURCE_ID);
  });

  it('RESUME and EMAIL facts have identical provenance field set', async () => {
    // RESUME run
    (prisma.extractionRun.create as jest.Mock).mockResolvedValue(makeRun({ sourceType: 'RESUME' }));
    (prisma.factProvenance.create as jest.Mock).mockResolvedValue(
      makeProvenance({ sourceType: 'RESUME' }),
    );
    await factService.createExtractionRun(makeRunInput({ sourceType: 'RESUME' }));
    const resumeProvCall = (prisma.factProvenance.create as jest.Mock).mock.calls[0][0];

    jest.clearAllMocks();
    (prisma.$transaction as jest.Mock).mockImplementation(
      (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma),
    );

    // EMAIL run
    (prisma.extractionRun.create as jest.Mock).mockResolvedValue(makeRun({ sourceType: 'EMAIL' }));
    (prisma.factProvenance.create as jest.Mock).mockResolvedValue(
      makeProvenance({ sourceType: 'EMAIL' }),
    );
    await factService.createExtractionRun(
      makeRunInput({ sourceType: 'EMAIL', sourceId: EMAIL_SOURCE_ID }),
    );
    const emailProvCall = (prisma.factProvenance.create as jest.Mock).mock.calls[0][0];

    // Both provenance records have the same field shape
    const resumeFields = Object.keys(resumeProvCall.data).sort();
    const emailFields = Object.keys(emailProvCall.data).sort();
    expect(resumeFields).toEqual(emailFields);
  });
});
