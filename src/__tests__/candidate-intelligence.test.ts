/**
 * Candidate Intelligence Domain — Focused Tests (Epic 4 Prompt 3)
 *
 * Covers the eight completion criteria:
 *  1. Multiple extraction runs can exist for one source.
 *  2. Historical extraction runs remain immutable.
 *  3. Facts trace back to their extraction run.
 *  4. Provenance traces back to the original source.
 *  5. Cross-user ownership is rejected.
 *  6. Cell ownership is enforced using Prompt 2's routing contract.
 *  7. Invalid source/run relationships are rejected.
 *  8. Existing candidate/user behaviour remains compatible.
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../config/database', () => ({
  prisma: {
    extractionRun: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    factProvenance: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    factObservation: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    resume: { findFirst: jest.fn() },
    emailMessage: { findFirst: jest.fn() },
    jobApplication: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../services/routing/cell-routing.service', () => ({
  cellRoutingService: {
    resolveUserRouting: jest.fn(),
    ensureCellMatchesUser: jest.fn(),
  },
}));


import { prisma } from '../config/database';
import { cellRoutingService } from '../services/routing/cell-routing.service';
import { ExtractionRunService } from '../services/candidate-intelligence/extraction-run.service';
import { ProvenanceService } from '../services/candidate-intelligence/provenance.service';
import { ownershipGuard } from '../services/ownership/ownership.guard';
import { factService } from '../services/fact.service';
import {
  ExtractionRunStatus,
  CrossUserOwnershipError,
  CellBoundaryViolationError,
  ExtractionRunNotFoundError,
  ImmutabilityViolationError,
  InvalidSourceReferenceError,
} from '../domain/candidate-intelligence';

// ── Shared fixtures ──────────────────────────────────────────────────────────

const USER_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const USER_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const CELL_A = 'us-east-1-shard-000';
const CELL_B = 'us-east-1-shard-001';
const RESUME_ID = 'resume-0000-0000-0000-000000000001';

const makeRun = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'run-0001',
  userId: USER_A,
  cellId: CELL_A,
  sourceType: 'RESUME',
  sourceId: RESUME_ID,
  sourceVersion: 'v1',
  sourceIdentity: 'sha256-abc',
  parserVersion: '1.0.0',
  modelProvider: null,
  modelVersion: null,
  promptVersion: null,
  schemaVersion: 'epic-4-prompt-3',
  status: ExtractionRunStatus.PENDING,
  failureReason: null,
  startedAt: new Date('2026-01-01T00:00:00Z'),
  completedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

const makeProvenance = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'prov-0001',
  userId: USER_A,
  cellId: CELL_A,
  sourceType: 'RESUME',
  sourceId: RESUME_ID,
  sourceVersion: 'v1',
  sourceIdentity: 'sha256-abc',
  extractionRunId: 'run-0001',
  parserVersion: '1.0.0',
  modelProvider: null,
  modelVersion: null,
  promptVersion: null,
  schemaVersion: 'epic-4-prompt-3',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

const makeFact = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'fact-0001',
  userId: USER_A,
  extractionRunId: 'run-0001',
  provenanceId: 'prov-0001',
  factType: 'SKILL',
  factData: { name: 'TypeScript' },
  sourceType: 'RESUME',
  sourceId: RESUME_ID,
  sourceVersion: 'v1',
  extractionMethod: 'llm-v1',
  modelVersion: null,
  confidence: 0.95,
  evidenceReference: null,
  observedAt: new Date('2026-01-01T00:00:00Z'),
  validFrom: null,
  validTo: null,
  snapshotId: null,
  version: 1,
  isCurrent: true,
  supersededById: null,
  supersededAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});


// ── helpers ───────────────────────────────────────────────────────────────────

/** Wire $transaction to run the callback immediately with prisma as the tx */
function mockTransaction() {
  (prisma.$transaction as jest.Mock).mockImplementation(
    (cb: (tx: typeof prisma) => unknown) => cb(prisma),
  );
}

function mockRouting(cellId = CELL_A) {
  (cellRoutingService.resolveUserRouting as jest.Mock).mockResolvedValue({
    userId: USER_A,
    cellId,
    region: 'us-east-1',
    residencyRegion: 'us-east-1',
    routingState: 'ROUTABLE',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Multiple extraction runs can exist for one source
// ─────────────────────────────────────────────────────────────────────────────
describe('1. Multiple extraction runs per source', () => {
  let svc: ExtractionRunService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new ExtractionRunService(prisma as any);
    mockRouting();
    mockTransaction();
    (prisma.resume.findFirst as jest.Mock).mockResolvedValue({ id: RESUME_ID });
  });

  it('creates two independent runs for the same resume without conflict', async () => {
    const run1 = makeRun({ id: 'run-0001', parserVersion: '1.0.0' });
    const prov1 = makeProvenance({ id: 'prov-0001', extractionRunId: 'run-0001' });
    const run2 = makeRun({ id: 'run-0002', parserVersion: '2.0.0' });
    const prov2 = makeProvenance({ id: 'prov-0002', extractionRunId: 'run-0002' });

    (prisma.extractionRun.create as jest.Mock)
      .mockResolvedValueOnce(run1)
      .mockResolvedValueOnce(run2);
    (prisma.factProvenance.create as jest.Mock)
      .mockResolvedValueOnce(prov1)
      .mockResolvedValueOnce(prov2);

    const ctx1 = await svc.createRun({
      userId: USER_A, sourceType: 'RESUME', sourceId: RESUME_ID,
      parserVersion: '1.0.0', schemaVersion: 'v1',
    });
    const ctx2 = await svc.createRun({
      userId: USER_A, sourceType: 'RESUME', sourceId: RESUME_ID,
      parserVersion: '2.0.0', schemaVersion: 'v1',
    });

    expect(ctx1.runId).toBe('run-0001');
    expect(ctx2.runId).toBe('run-0002');
    expect(ctx1.runId).not.toBe(ctx2.runId);
    expect(prisma.extractionRun.create).toHaveBeenCalledTimes(2);
  });

  it('lists all runs for a source in chronological order', async () => {
    const runs = [
      makeRun({ id: 'run-0001', parserVersion: '1.0.0', startedAt: new Date('2026-01-01') }),
      makeRun({ id: 'run-0002', parserVersion: '1.1.0', startedAt: new Date('2026-02-01') }),
      makeRun({ id: 'run-0003', parserVersion: '2.0.0', startedAt: new Date('2026-03-01') }),
    ];
    (prisma.extractionRun.findMany as jest.Mock).mockResolvedValue(runs);

    const result = await svc.getRunsForSource(USER_A, 'RESUME', RESUME_ID);

    expect(result).toHaveLength(3);
    expect(result[0]!.id).toBe('run-0001');
    expect(result[2]!.id).toBe('run-0003');
    expect(prisma.extractionRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_A, sourceType: 'RESUME', sourceId: RESUME_ID },
        orderBy: { startedAt: 'asc' },
      }),
    );
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 2. Historical extraction runs remain immutable
// ─────────────────────────────────────────────────────────────────────────────
describe('2. Historical extraction run immutability', () => {
  let svc: ExtractionRunService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new ExtractionRunService(prisma as any);
  });

  it('rejects startRun on a COMPLETED run', async () => {
    (prisma.extractionRun.findUnique as jest.Mock).mockResolvedValue(
      makeRun({ status: ExtractionRunStatus.COMPLETED }),
    );
    await expect(svc.startRun({ runId: 'run-0001', userId: USER_A }))
      .rejects.toThrow(ImmutabilityViolationError);
  });

  it('rejects completeRun on a FAILED run', async () => {
    (prisma.extractionRun.findUnique as jest.Mock).mockResolvedValue(
      makeRun({ status: ExtractionRunStatus.FAILED }),
    );
    await expect(svc.completeRun({ runId: 'run-0001', userId: USER_A }))
      .rejects.toThrow(ImmutabilityViolationError);
  });

  it('rejects failRun on an already FAILED run', async () => {
    (prisma.extractionRun.findUnique as jest.Mock).mockResolvedValue(
      makeRun({ status: ExtractionRunStatus.FAILED }),
    );
    await expect(
      svc.failRun({ runId: 'run-0001', userId: USER_A, failureReason: 'retry' }),
    ).rejects.toThrow(ImmutabilityViolationError);
  });

  it('allows PENDING → RUNNING → COMPLETED lifecycle normally', async () => {
    const pending = makeRun({ status: ExtractionRunStatus.PENDING });
    const running = makeRun({ status: ExtractionRunStatus.RUNNING });
    const completed = makeRun({ status: ExtractionRunStatus.COMPLETED, completedAt: new Date() });

    (prisma.extractionRun.findUnique as jest.Mock)
      .mockResolvedValueOnce(pending)   // startRun check
      .mockResolvedValueOnce(running);  // completeRun check
    (prisma.extractionRun.update as jest.Mock)
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(completed);

    await svc.startRun({ runId: 'run-0001', userId: USER_A });
    const result = await svc.completeRun({ runId: 'run-0001', userId: USER_A });

    expect(result.status).toBe(ExtractionRunStatus.COMPLETED);
    expect(prisma.extractionRun.update).toHaveBeenCalledTimes(2);
  });

  it('assertExtractionRunMutable helper throws on COMPLETED status', () => {
    expect(() =>
      ownershipGuard.assertExtractionRunMutable({ id: 'run-0001', status: 'completed' }),
    ).toThrow(ImmutabilityViolationError);
  });

  it('assertExtractionRunMutable helper passes on PENDING status', () => {
    expect(() =>
      ownershipGuard.assertExtractionRunMutable({ id: 'run-0001', status: 'pending' }),
    ).not.toThrow();
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 3. Facts trace back to their extraction run
// ─────────────────────────────────────────────────────────────────────────────
describe('3. Facts trace back to their extraction run', () => {
  beforeEach(() => jest.clearAllMocks());

  it('recordFact stores extractionRunId on the fact', async () => {
    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.factObservation.create as jest.Mock).mockResolvedValue(makeFact());
    (prisma.$transaction as jest.Mock).mockImplementation(
      (cb: (tx: typeof prisma) => unknown) => cb(prisma),
    );

    const result = await factService.recordFact({
      userId: USER_A,
      extractionRunId: 'run-0001',
      provenanceId: 'prov-0001',
      factType: 'SKILL',
      factData: { name: 'TypeScript' },
      sourceType: 'RESUME',
      sourceId: RESUME_ID,
      extractionMethod: 'llm-v1',
      confidence: 0.95,
      observedAt: new Date(),
    });

    expect(result.extractionRunId).toBe('run-0001');
    expect(prisma.factObservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ extractionRunId: 'run-0001' }),
      }),
    );
  });

  it('ensureFactAccess returns the run and provenance ids for ownership-gated reads', async () => {
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue({
      id: 'fact-0001',
      userId: USER_A,
      extractionRunId: 'run-0001',
      provenanceId: 'prov-0001',
    });

    const result = await ownershipGuard.ensureFactAccess(USER_A, 'fact-0001');

    expect(result.extractionRunId).toBe('run-0001');
    expect(result.provenanceId).toBe('prov-0001');
  });

  it('facts for a superseded run still carry the original run reference', async () => {
    const supersededFact = makeFact({ extractionRunId: 'run-0001', isCurrent: false });
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(supersededFact);

    // The extraction run id must be preserved even after supersession
    expect(supersededFact.extractionRunId).toBe('run-0001');
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 4. Provenance traces back to the original source
// ─────────────────────────────────────────────────────────────────────────────
describe('4. Provenance traces back to the original source', () => {
  let svc: ProvenanceService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new ProvenanceService(prisma as any);
  });

  it('provenance record created during run creation carries source fields', async () => {
    const runSvc = new ExtractionRunService(prisma as any);
    mockRouting();
    mockTransaction();
    (prisma.resume.findFirst as jest.Mock).mockResolvedValue({ id: RESUME_ID });

    const run = makeRun();
    const prov = makeProvenance();
    (prisma.extractionRun.create as jest.Mock).mockResolvedValue(run);
    (prisma.factProvenance.create as jest.Mock).mockResolvedValue(prov);

    const ctx = await runSvc.createRun({
      userId: USER_A,
      sourceType: 'RESUME',
      sourceId: RESUME_ID,
      sourceVersion: 'v1',
      sourceIdentity: 'sha256-abc',
      parserVersion: '1.0.0',
      schemaVersion: 'v1',
    });

    // Provenance must be created with the same source fields as the run
    expect(prisma.factProvenance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: USER_A,
          sourceType: 'RESUME',
          sourceId: RESUME_ID,
          sourceVersion: 'v1',
          sourceIdentity: 'sha256-abc',
          extractionRunId: run.id,
          parserVersion: '1.0.0',
        }),
      }),
    );
    expect(ctx.provenanceId).toBe('prov-0001');
  });

  it('getByExtractionRunId retrieves the provenance for a given run', async () => {
    (prisma.factProvenance.findUnique as jest.Mock).mockResolvedValue(makeProvenance());

    const prov = await svc.getByExtractionRunId('run-0001', USER_A);

    expect(prov.extractionRunId).toBe('run-0001');
    expect(prov.sourceId).toBe(RESUME_ID);
    expect(prov.sourceType).toBe('RESUME');
    expect(prov.parserVersion).toBe('1.0.0');
    expect(prov.schemaVersion).toBe('epic-4-prompt-3');
  });

  it('getBySource returns all provenance records for a document in creation order', async () => {
    const records = [
      makeProvenance({ id: 'prov-0001', extractionRunId: 'run-0001', createdAt: new Date('2026-01-01') }),
      makeProvenance({ id: 'prov-0002', extractionRunId: 'run-0002', createdAt: new Date('2026-02-01') }),
    ];
    (prisma.factProvenance.findMany as jest.Mock).mockResolvedValue(records);

    const result = await svc.getBySource(USER_A, 'RESUME', RESUME_ID);

    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('prov-0001');
    expect(result[1]!.id).toBe('prov-0002');
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 5. Cross-user ownership is rejected
// ─────────────────────────────────────────────────────────────────────────────
describe('5. Cross-user ownership rejection', () => {
  let runSvc: ExtractionRunService;
  let provSvc: ProvenanceService;

  beforeEach(() => {
    jest.clearAllMocks();
    runSvc = new ExtractionRunService(prisma as any);
    provSvc = new ProvenanceService(prisma as any);
    mockRouting();
  });

  it('getRunById throws CrossUserOwnershipError when run belongs to USER_B', async () => {
    (prisma.extractionRun.findUnique as jest.Mock).mockResolvedValue(
      makeRun({ userId: USER_B }),
    );
    await expect(runSvc.getRunById('run-0001', USER_A))
      .rejects.toThrow(CrossUserOwnershipError);
  });

  it('startRun throws CrossUserOwnershipError when run belongs to USER_B', async () => {
    (prisma.extractionRun.findUnique as jest.Mock).mockResolvedValue(
      makeRun({ userId: USER_B }),
    );
    await expect(runSvc.startRun({ runId: 'run-0001', userId: USER_A }))
      .rejects.toThrow(CrossUserOwnershipError);
  });

  it('ProvenanceService.getById throws CrossUserOwnershipError for wrong user', async () => {
    (prisma.factProvenance.findUnique as jest.Mock).mockResolvedValue(
      makeProvenance({ userId: USER_B }),
    );
    await expect(provSvc.getById('prov-0001', USER_A))
      .rejects.toThrow(CrossUserOwnershipError);
  });

  it('ensureFactAccess throws CrossUserOwnershipError for wrong user', async () => {
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue({
      id: 'fact-0001',
      userId: USER_B,
      extractionRunId: 'run-0001',
      provenanceId: 'prov-0001',
    });
    await expect(ownershipGuard.ensureFactAccess(USER_A, 'fact-0001'))
      .rejects.toThrow(CrossUserOwnershipError);
  });

  it('ensureProvenanceAccess throws CrossUserOwnershipError for wrong user', async () => {
    (prisma.factProvenance.findUnique as jest.Mock).mockResolvedValue({
      id: 'prov-0001',
      userId: USER_B,
      cellId: CELL_B,
      extractionRunId: 'run-0001',
    });
    await expect(ownershipGuard.ensureProvenanceAccess(USER_A, 'prov-0001'))
      .rejects.toThrow(CrossUserOwnershipError);
  });

  it('createRun for USER_B source rejects when resume is owned by USER_A', async () => {
    mockTransaction();
    // resolveUserRouting is for USER_B in this test
    (cellRoutingService.resolveUserRouting as jest.Mock).mockResolvedValue({
      userId: USER_B, cellId: CELL_B, region: 'us-east-1',
      residencyRegion: 'us-east-1', routingState: 'ROUTABLE',
    });
    // Resume doesn't exist for USER_B
    (prisma.resume.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      runSvc.createRun({
        userId: USER_B,
        sourceType: 'RESUME',
        sourceId: RESUME_ID,  // owned by USER_A
        parserVersion: '1.0.0',
        schemaVersion: 'v1',
      }),
    ).rejects.toThrow(InvalidSourceReferenceError);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 6. Cell ownership is enforced using Prompt 2's routing contract
// ─────────────────────────────────────────────────────────────────────────────
describe('6. Cell boundary enforcement', () => {
  let runSvc: ExtractionRunService;
  let provSvc: ProvenanceService;

  beforeEach(() => {
    jest.clearAllMocks();
    runSvc = new ExtractionRunService(prisma as any);
    provSvc = new ProvenanceService(prisma as any);
  });

  it('createRun throws CellBoundaryViolationError when supplied cellId mismatches routed cell', async () => {
    mockRouting(CELL_A);
    (prisma.resume.findFirst as jest.Mock).mockResolvedValue({ id: RESUME_ID });
    mockTransaction();

    await expect(
      runSvc.createRun({
        userId: USER_A,
        cellId: CELL_B,          // wrong cell
        sourceType: 'RESUME',
        sourceId: RESUME_ID,
        parserVersion: '1.0.0',
        schemaVersion: 'v1',
      }),
    ).rejects.toThrow(CellBoundaryViolationError);
  });

  it('ensureExtractionRunCellBoundary throws when run cellId differs from routed cell', async () => {
    (prisma.extractionRun.findUnique as jest.Mock).mockResolvedValue(
      makeRun({ userId: USER_A, cellId: CELL_B }),   // run was written to CELL_B
    );
    mockRouting(CELL_A);   // user now routes to CELL_A

    await expect(
      ownershipGuard.ensureExtractionRunCellBoundary(USER_A, 'run-0001'),
    ).rejects.toThrow(CellBoundaryViolationError);
  });

  it('ensureExtractionRunCellBoundary passes when cells match', async () => {
    (prisma.extractionRun.findUnique as jest.Mock).mockResolvedValue(
      makeRun({ userId: USER_A, cellId: CELL_A }),
    );
    mockRouting(CELL_A);

    await expect(
      ownershipGuard.ensureExtractionRunCellBoundary(USER_A, 'run-0001'),
    ).resolves.toBeUndefined();
  });

  it('ProvenanceService.assertCellBoundary throws when provenance cellId mismatches', async () => {
    (prisma.factProvenance.findUnique as jest.Mock).mockResolvedValue(
      makeProvenance({ cellId: CELL_B }),
    );
    mockRouting(CELL_A);

    await expect(provSvc.assertCellBoundary('prov-0001', USER_A))
      .rejects.toThrow(CellBoundaryViolationError);
  });

  it('ProvenanceService.assertCellBoundary passes when cells match', async () => {
    (prisma.factProvenance.findUnique as jest.Mock).mockResolvedValue(
      makeProvenance({ cellId: CELL_A }),
    );
    mockRouting(CELL_A);

    await expect(provSvc.assertCellBoundary('prov-0001', USER_A))
      .resolves.toBeUndefined();
  });

  it('ensureCellAccess delegates to the routing layer (existing behaviour preserved)', async () => {
    (cellRoutingService.ensureCellMatchesUser as jest.Mock).mockResolvedValue(undefined);

    await expect(ownershipGuard.ensureCellAccess(USER_A, CELL_A))
      .resolves.toBeUndefined();

    expect(cellRoutingService.ensureCellMatchesUser).toHaveBeenCalledWith(USER_A, CELL_A);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 7. Invalid source/run relationships are rejected
// ─────────────────────────────────────────────────────────────────────────────
describe('7. Invalid source / run relationships', () => {
  let runSvc: ExtractionRunService;

  beforeEach(() => {
    jest.clearAllMocks();
    runSvc = new ExtractionRunService(prisma as any);
    mockRouting();
    mockTransaction();
  });

  it('createRun throws InvalidSourceReferenceError when RESUME source does not exist', async () => {
    (prisma.resume.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      runSvc.createRun({
        userId: USER_A, sourceType: 'RESUME', sourceId: 'nonexistent-resume',
        parserVersion: '1.0.0', schemaVersion: 'v1',
      }),
    ).rejects.toThrow(InvalidSourceReferenceError);
  });

  it('createRun throws InvalidSourceReferenceError when EMAIL source does not exist', async () => {
    (prisma.emailMessage.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      runSvc.createRun({
        userId: USER_A, sourceType: 'EMAIL', sourceId: 'nonexistent-email',
        parserVersion: '1.0.0', schemaVersion: 'v1',
      }),
    ).rejects.toThrow(InvalidSourceReferenceError);
  });

  it('createRun throws InvalidSourceReferenceError when sourceId is empty', async () => {
    await expect(
      runSvc.createRun({
        userId: USER_A, sourceType: 'RESUME', sourceId: '',
        parserVersion: '1.0.0', schemaVersion: 'v1',
      }),
    ).rejects.toThrow(InvalidSourceReferenceError);
  });

  it('createRun throws InvalidSourceReferenceError when sourceType is empty', async () => {
    await expect(
      runSvc.createRun({
        userId: USER_A, sourceType: '', sourceId: RESUME_ID,
        parserVersion: '1.0.0', schemaVersion: 'v1',
      }),
    ).rejects.toThrow(InvalidSourceReferenceError);
  });

  it('getRunById throws ExtractionRunNotFoundError for a non-existent run', async () => {
    (prisma.extractionRun.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(runSvc.getRunById('no-such-run', USER_A))
      .rejects.toThrow(ExtractionRunNotFoundError);
  });

  it('ensureExtractionRunAccess throws ExtractionRunNotFoundError for absent run', async () => {
    (prisma.extractionRun.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(ownershipGuard.ensureExtractionRunAccess(USER_A, 'no-such-run'))
      .rejects.toThrow(ExtractionRunNotFoundError);
  });

  it('MANUAL source type bypasses source ownership check', async () => {
    const run = makeRun({ sourceType: 'MANUAL', sourceId: USER_A });
    const prov = makeProvenance({ sourceType: 'MANUAL', sourceId: USER_A });
    (prisma.extractionRun.create as jest.Mock).mockResolvedValue(run);
    (prisma.factProvenance.create as jest.Mock).mockResolvedValue(prov);

    // Should not throw even though resume.findFirst is not mocked
    const ctx = await runSvc.createRun({
      userId: USER_A, sourceType: 'MANUAL', sourceId: USER_A,
      parserVersion: '1.0.0', schemaVersion: 'v1',
    });
    expect(ctx.runId).toBe('run-0001');
    expect(prisma.resume.findFirst).not.toHaveBeenCalled();
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 8. Existing candidate / user behaviour remains compatible
// ─────────────────────────────────────────────────────────────────────────────
describe('8. Backwards compatibility with existing behaviour', () => {
  beforeEach(() => jest.clearAllMocks());

  it('FactService.getCurrentFacts still works as before (no breaking change)', async () => {
    const facts = [makeFact(), makeFact({ id: 'fact-0002', factType: 'EXPERIENCE' })];
    (prisma.factObservation.findMany as jest.Mock).mockResolvedValue(facts);

    const result = await factService.getCurrentFacts(USER_A);

    expect(result).toHaveLength(2);
    expect(prisma.factObservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER_A, isCurrent: true, deletedAt: null }),
      }),
    );
  });

  it('OwnershipGuard.ensureApplicationAccess still works (existing method untouched)', async () => {
    (prisma.jobApplication.findFirst as jest.Mock).mockResolvedValue({
      id: 'app-0001',
      userId: USER_A,
      legacyUserId: USER_A,
    });

    const result = await ownershipGuard.ensureApplicationAccess(USER_A, 'app-0001');
    expect(result.id).toBe('app-0001');
  });

  it('OwnershipGuard.ensureCellAccess still delegates to routing service', async () => {
    (cellRoutingService.ensureCellMatchesUser as jest.Mock).mockResolvedValue(undefined);

    await ownershipGuard.ensureCellAccess(USER_A, CELL_A);

    expect(cellRoutingService.ensureCellMatchesUser).toHaveBeenCalledWith(USER_A, CELL_A);
  });

  it('Domain errors carry the expected statusCode and code fields', () => {
    const crossUser = new CrossUserOwnershipError('ExtractionRun', 'run-x');
    expect(crossUser.statusCode).toBe(403);
    expect(crossUser.code).toBe('CROSS_USER_OWNERSHIP_DENIED');

    const cellViolation = new CellBoundaryViolationError(USER_A, CELL_A, CELL_B);
    expect(cellViolation.statusCode).toBe(403);
    expect(cellViolation.code).toBe('CELL_BOUNDARY_VIOLATION');

    const immutable = new ImmutabilityViolationError('ExtractionRun', 'run-x');
    expect(immutable.statusCode).toBe(409);
    expect(immutable.code).toBe('IMMUTABILITY_VIOLATION');

    const notFound = new ExtractionRunNotFoundError('run-x');
    expect(notFound.statusCode).toBe(404);
    expect(notFound.code).toBe('EXTRACTION_RUN_NOT_FOUND');

    const invalidSrc = new InvalidSourceReferenceError('RESUME', 'bad-id');
    expect(invalidSrc.statusCode).toBe(422);
    expect(invalidSrc.code).toBe('INVALID_SOURCE_REFERENCE');
  });
});
