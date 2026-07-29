/**
 * Canonical Candidate Intelligence — Focused Tests (Epic 4 Prompt 4)
 *
 * Covers every completion criterion:
 *  1. Valid extracted facts can materialise into canonical intelligence.
 *  2. Historical extraction runs remain unchanged.
 *  3. Provenance remains traceable.
 *  4. Older extraction results cannot silently overwrite newer canonical data.
 *  5. Duplicate processing does not create uncontrolled duplicates.
 *  6. Conflicting facts follow deterministic rules.
 *  7. Cross-user access is rejected.
 *  8. Cross-cell access is rejected.
 *  9. Candidate intelligence queries do not expose raw extraction data by default.
 * 10. Existing Epic 0–3 tests remain compatible.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../config/database', () => ({
  prisma: {
    canonicalCandidateIntelligence: {
      findUnique: jest.fn(),
      findMany:   jest.fn(),
      upsert:     jest.fn(),
      update:     jest.fn(),
    },
    factObservation: {
      findUnique: jest.fn(),
      findMany:   jest.fn(),
      findFirst:  jest.fn(),
      create:     jest.fn(),
      update:     jest.fn(),
    },
    factProvenance:  { findUnique: jest.fn(), findMany: jest.fn() },
    extractionRun:   { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    jobApplication:  { findFirst: jest.fn() },
    resume:          { findFirst: jest.fn() },
    emailMessage:    { findFirst: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../services/routing/cell-routing.service', () => ({
  cellRoutingService: {
    resolveUserRouting:   jest.fn(),
    ensureCellMatchesUser: jest.fn(),
  },
}));


import { prisma }             from '../config/database';
import { cellRoutingService } from '../services/routing/cell-routing.service';
import { CanonicalIntelligenceService, computeDeduplicationKey }
                              from '../services/candidate-intelligence/canonical-intelligence.service';
import { ownershipGuard }     from '../services/ownership/ownership.guard';
import { factService }        from '../services/fact.service';
import {
  CrossUserOwnershipError,
  CellBoundaryViolationError,
  MaterialisationOwnershipError,
  FactNotEligibleError,
  CanonicalIntelligenceNotFoundError,
} from '../domain/candidate-intelligence';

// ── Constants ─────────────────────────────────────────────────────────────────

const USER_A   = 'aaaaaaaa-0000-0000-0000-000000000001';
const USER_B   = 'bbbbbbbb-0000-0000-0000-000000000002';
const CELL_A   = 'us-east-1-shard-000';
const CELL_B   = 'us-east-1-shard-001';
const FACT_ID  = 'fact-0000-0000-0000-000000000001';
const PROV_ID  = 'prov-0000-0000-0000-000000000001';
const RUN_ID   = 'run-0000-0000-0000-000000000001';
const CAN_ID   = 'can-0000-0000-0000-000000000001';

// ── Fixture factories ─────────────────────────────────────────────────────────

const makeFact = (o: Record<string, unknown> = {}) => ({
  id:               FACT_ID,
  userId:           USER_A,
  factType:         'SKILL',
  factData:         { name: 'TypeScript' },
  confidence:       0.9,
  observedAt:       new Date('2026-03-01T00:00:00Z'),
  isCurrent:        true,
  deletedAt:        null,
  needsReview:      false,
  isUserCorrected:  false,
  sourceVersion:    'v1',
  provenanceId:     PROV_ID,
  ...o,
});

const makeCanonical = (o: Record<string, unknown> = {}) => ({
  id:               CAN_ID,
  userId:           USER_A,
  cellId:           CELL_A,
  factType:         'SKILL',
  deduplicationKey: 'typescript',
  sourceFactId:     FACT_ID,
  provenanceId:     PROV_ID,
  confidence:       0.9,
  lastObservedAt:   new Date('2026-03-01T00:00:00Z'),
  sourceVersion:    'v1',
  isActive:         true,
  createdAt:        new Date('2026-03-01T00:00:00Z'),
  updatedAt:        new Date('2026-03-01T00:00:00Z'),
  sourceFact:       { isUserCorrected: false },
  provenance:       makeProvenance(),
  ...o,
});

const makeProvenance = (o: Record<string, unknown> = {}) => ({
  id:              PROV_ID,
  userId:          USER_A,
  cellId:          CELL_A,
  sourceType:      'RESUME',
  sourceId:        'res-001',
  sourceVersion:   'v1',
  sourceIdentity:  'sha256-abc',
  extractionRunId: RUN_ID,
  parserVersion:   '1.0.0',
  modelProvider:   null,
  modelVersion:    null,
  promptVersion:   null,
  schemaVersion:   'v1',
  createdAt:       new Date('2026-03-01T00:00:00Z'),
  ...o,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockRouting(cellId = CELL_A) {
  (cellRoutingService.resolveUserRouting as jest.Mock).mockResolvedValue({
    userId: USER_A, cellId, region: 'us-east-1',
    residencyRegion: 'us-east-1', routingState: 'ROUTABLE',
  });
}

function mockTransaction() {
  (prisma.$transaction as jest.Mock).mockImplementation(
    (cb: (tx: typeof prisma) => unknown) => cb(prisma),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Valid extracted facts materialise into canonical intelligence
// ─────────────────────────────────────────────────────────────────────────────
describe('1. Valid facts materialise into canonical intelligence', () => {
  let svc: CanonicalIntelligenceService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new CanonicalIntelligenceService(prisma);
    mockRouting();
    mockTransaction();
  });

  it('creates a new canonical record for a first-time eligible fact', async () => {
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(makeFact());
    (prisma.canonicalCandidateIntelligence.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.canonicalCandidateIntelligence.upsert as jest.Mock).mockResolvedValue({ id: CAN_ID });

    const result = await svc.materialise({
      userId:      USER_A,
      sourceFactId: FACT_ID,
      provenanceId: PROV_ID,
      factType:    'SKILL',
      confidence:  0.9,
      observedAt:  new Date('2026-03-01T00:00:00Z'),
    });

    expect(result.promoted).toBe(true);
    expect(result.canonicalId).toBe(CAN_ID);
    expect(result.winningFactId).toBe(FACT_ID);
    expect(prisma.canonicalCandidateIntelligence.upsert).toHaveBeenCalledTimes(1);
  });

  it('sets deduplicationKey from factData when not explicitly supplied', async () => {
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(
      makeFact({ factData: { name: '  Python  ' } }),
    );
    (prisma.canonicalCandidateIntelligence.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.canonicalCandidateIntelligence.upsert as jest.Mock).mockResolvedValue({ id: CAN_ID });

    await svc.materialise({
      userId: USER_A, sourceFactId: FACT_ID, provenanceId: PROV_ID,
      factType: 'SKILL', confidence: 0.8, observedAt: new Date(),
    });

    expect(prisma.canonicalCandidateIntelligence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ deduplicationKey: 'python' }),
      }),
    );
  });

  it('rejects a fact with deletedAt set (FactNotEligibleError)', async () => {
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(
      makeFact({ deletedAt: new Date() }),
    );
    await expect(
      svc.materialise({ userId: USER_A, sourceFactId: FACT_ID, provenanceId: PROV_ID,
        factType: 'SKILL', confidence: 0.9, observedAt: new Date() }),
    ).rejects.toThrow(FactNotEligibleError);
  });

  it('rejects a superseded fact (isCurrent=false)', async () => {
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(
      makeFact({ isCurrent: false }),
    );
    await expect(
      svc.materialise({ userId: USER_A, sourceFactId: FACT_ID, provenanceId: PROV_ID,
        factType: 'SKILL', confidence: 0.9, observedAt: new Date() }),
    ).rejects.toThrow(FactNotEligibleError);
  });

  it('rejects a fact with needsReview=true and no user correction', async () => {
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(
      makeFact({ needsReview: true, isUserCorrected: false }),
    );
    await expect(
      svc.materialise({ userId: USER_A, sourceFactId: FACT_ID, provenanceId: PROV_ID,
        factType: 'SKILL', confidence: 0.9, observedAt: new Date() }),
    ).rejects.toThrow(FactNotEligibleError);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 2. Historical extraction runs remain unchanged
// ─────────────────────────────────────────────────────────────────────────────
describe('2. Historical extraction runs remain unchanged', () => {
  let svc: CanonicalIntelligenceService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new CanonicalIntelligenceService(prisma);
    mockRouting();
    mockTransaction();
  });

  it('materialise() never calls update on fact_observations', async () => {
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(makeFact());
    (prisma.canonicalCandidateIntelligence.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.canonicalCandidateIntelligence.upsert as jest.Mock).mockResolvedValue({ id: CAN_ID });

    await svc.materialise({
      userId: USER_A, sourceFactId: FACT_ID, provenanceId: PROV_ID,
      factType: 'SKILL', confidence: 0.9, observedAt: new Date(),
    });

    expect(prisma.factObservation.update).not.toHaveBeenCalled();
    expect(prisma.factObservation.create).not.toHaveBeenCalled();
  });

  it('retire() only updates canonical_candidate_intelligence, never fact_observations', async () => {
    (prisma.canonicalCandidateIntelligence.findUnique as jest.Mock).mockResolvedValue(
      makeCanonical(),
    );
    (prisma.canonicalCandidateIntelligence.update as jest.Mock).mockResolvedValue({});

    await svc.retire(CAN_ID, USER_A);

    expect(prisma.canonicalCandidateIntelligence.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }),
    );
    expect(prisma.factObservation.update).not.toHaveBeenCalled();
  });

  it('a lower-precedence materialise does not touch the existing canonical row', async () => {
    const olderDate = new Date('2026-01-01T00:00:00Z');
    // Existing canonical: confidence 0.9, observed 2026-03-01
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(
      makeFact({ confidence: 0.5, observedAt: olderDate }),
    );
    (prisma.canonicalCandidateIntelligence.findUnique as jest.Mock).mockResolvedValue(
      makeCanonical({ confidence: 0.9 }),
    );

    const result = await svc.materialise({
      userId: USER_A, sourceFactId: FACT_ID, provenanceId: PROV_ID,
      factType: 'SKILL', confidence: 0.5, observedAt: olderDate,
    });

    expect(result.promoted).toBe(false);
    expect(prisma.canonicalCandidateIntelligence.upsert).not.toHaveBeenCalled();
    expect(prisma.factObservation.update).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Provenance remains traceable
// ─────────────────────────────────────────────────────────────────────────────
describe('3. Provenance remains traceable', () => {
  let svc: CanonicalIntelligenceService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new CanonicalIntelligenceService(prisma);
  });

  it('canonical record carries provenanceId pointing to the winning extraction run', async () => {
    mockRouting();
    mockTransaction();
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(makeFact());
    (prisma.canonicalCandidateIntelligence.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.canonicalCandidateIntelligence.upsert as jest.Mock).mockResolvedValue({ id: CAN_ID });

    const result = await svc.materialise({
      userId: USER_A, sourceFactId: FACT_ID, provenanceId: PROV_ID,
      factType: 'SKILL', confidence: 0.9, observedAt: new Date(),
    });

    expect(result.winningProvenanceId).toBe(PROV_ID);
    expect(prisma.canonicalCandidateIntelligence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ provenanceId: PROV_ID }),
      }),
    );
  });

  it('getProvenanceForCanonical returns the full provenance record', async () => {
    (prisma.canonicalCandidateIntelligence.findUnique as jest.Mock).mockResolvedValue(
      makeCanonical({ provenance: makeProvenance() }),
    );

    const prov = await svc.getProvenanceForCanonical(CAN_ID, USER_A);

    expect(prov.id).toBe(PROV_ID);
    expect(prov.extractionRunId).toBe(RUN_ID);
    expect(prov.sourceType).toBe('RESUME');
    expect(prov.parserVersion).toBe('1.0.0');
  });

  it('getForUser with includeProvenance=true returns provenance on each record', async () => {
    (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mockResolvedValue([
      makeCanonical({ provenance: makeProvenance() }),
    ]);

    const results = await svc.getForUser({
      userId: USER_A, includeProvenance: true,
    });

    expect(results[0]!.provenance).toBeDefined();
    expect(results[0]!.provenance!.id).toBe(PROV_ID);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 4. Older extraction results cannot silently overwrite newer canonical data
// ─────────────────────────────────────────────────────────────────────────────
describe('4. Older extraction cannot silently overwrite newer canonical data', () => {
  let svc: CanonicalIntelligenceService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new CanonicalIntelligenceService(prisma);
    mockRouting();
    mockTransaction();
  });

  it('lower confidence does not promote (Rule 1)', async () => {
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(
      makeFact({ confidence: 0.5 }),
    );
    (prisma.canonicalCandidateIntelligence.findUnique as jest.Mock).mockResolvedValue(
      makeCanonical({ confidence: 0.9, lastObservedAt: new Date('2026-03-01') }),
    );

    const result = await svc.materialise({
      userId: USER_A, sourceFactId: FACT_ID, provenanceId: PROV_ID,
      factType: 'SKILL', confidence: 0.5, observedAt: new Date('2026-03-01'),
    });

    expect(result.promoted).toBe(false);
    expect(prisma.canonicalCandidateIntelligence.upsert).not.toHaveBeenCalled();
  });

  it('equal confidence but older observedAt does not promote (Rule 2)', async () => {
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(
      makeFact({ confidence: 0.9, observedAt: new Date('2026-01-01') }),
    );
    (prisma.canonicalCandidateIntelligence.findUnique as jest.Mock).mockResolvedValue(
      makeCanonical({ confidence: 0.9, lastObservedAt: new Date('2026-03-01') }),
    );

    const result = await svc.materialise({
      userId: USER_A, sourceFactId: FACT_ID, provenanceId: PROV_ID,
      factType: 'SKILL', confidence: 0.9, observedAt: new Date('2026-01-01'),
    });

    expect(result.promoted).toBe(false);
    expect(prisma.canonicalCandidateIntelligence.upsert).not.toHaveBeenCalled();
  });

  it('equal confidence but newer observedAt DOES promote (Rule 2 tie-break)', async () => {
    const newerDate = new Date('2026-06-01');
    const FACT_ID_NEW = 'fact-new-0000-0000-0000-000000000001';
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(
      makeFact({ id: FACT_ID_NEW, confidence: 0.9, observedAt: newerDate }),
    );
    (prisma.canonicalCandidateIntelligence.findUnique as jest.Mock).mockResolvedValue(
      makeCanonical({ sourceFactId: FACT_ID, confidence: 0.9, lastObservedAt: new Date('2026-03-01') }),
    );
    (prisma.canonicalCandidateIntelligence.upsert as jest.Mock).mockResolvedValue({ id: CAN_ID });

    const result = await svc.materialise({
      userId: USER_A, sourceFactId: FACT_ID_NEW, provenanceId: PROV_ID,
      factType: 'SKILL', confidence: 0.9, observedAt: newerDate,
    });

    expect(result.promoted).toBe(true);
    expect(prisma.canonicalCandidateIntelligence.upsert).toHaveBeenCalledTimes(1);
  });

  it('higher confidence always promotes regardless of observedAt (Rule 1)', async () => {
    // Incoming is older but higher confidence.
    const olderDate = new Date('2025-01-01');
    const FACT_ID_HIGH = 'fact-high-0000-0000-0000-000000000001';
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(
      makeFact({ id: FACT_ID_HIGH, confidence: 0.99, observedAt: olderDate }),
    );
    (prisma.canonicalCandidateIntelligence.findUnique as jest.Mock).mockResolvedValue(
      makeCanonical({ sourceFactId: FACT_ID, confidence: 0.7, lastObservedAt: new Date('2026-03-01') }),
    );
    (prisma.canonicalCandidateIntelligence.upsert as jest.Mock).mockResolvedValue({ id: CAN_ID });

    const result = await svc.materialise({
      userId: USER_A, sourceFactId: FACT_ID_HIGH, provenanceId: PROV_ID,
      factType: 'SKILL', confidence: 0.99, observedAt: olderDate,
    });

    expect(result.promoted).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Duplicate processing does not create uncontrolled duplicates
// ─────────────────────────────────────────────────────────────────────────────
describe('5. Duplicate processing is idempotent', () => {
  let svc: CanonicalIntelligenceService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new CanonicalIntelligenceService(prisma);
    mockRouting();
    mockTransaction();
  });

  it('second call with same sourceFactId returns existing canonical id, no upsert', async () => {
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(makeFact());
    // Existing canonical already points to the same sourceFactId
    (prisma.canonicalCandidateIntelligence.findUnique as jest.Mock).mockResolvedValue(
      makeCanonical({ sourceFactId: FACT_ID }),
    );

    const first = await svc.materialise({
      userId: USER_A, sourceFactId: FACT_ID, provenanceId: PROV_ID,
      factType: 'SKILL', confidence: 0.9, observedAt: new Date(),
    });
    const second = await svc.materialise({
      userId: USER_A, sourceFactId: FACT_ID, provenanceId: PROV_ID,
      factType: 'SKILL', confidence: 0.9, observedAt: new Date(),
    });

    expect(first.canonicalId).toBe(second.canonicalId);
    expect(first.promoted).toBe(false);   // idempotent path
    expect(second.promoted).toBe(false);
    expect(prisma.canonicalCandidateIntelligence.upsert).not.toHaveBeenCalled();
  });

  it('upsert targets the unique constraint so concurrent retries cannot create two rows', async () => {
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(makeFact());
    (prisma.canonicalCandidateIntelligence.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.canonicalCandidateIntelligence.upsert as jest.Mock).mockResolvedValue({ id: CAN_ID });

    await svc.materialise({
      userId: USER_A, sourceFactId: FACT_ID, provenanceId: PROV_ID,
      factType: 'SKILL', confidence: 0.9, observedAt: new Date(),
    });

    const upsertCall = (prisma.canonicalCandidateIntelligence.upsert as jest.Mock).mock.calls[0][0];
    expect(upsertCall.where.unique_canonical_per_user_type_key).toBeDefined();
    expect(upsertCall.where.unique_canonical_per_user_type_key.userId).toBe(USER_A);
    expect(upsertCall.where.unique_canonical_per_user_type_key.factType).toBe('SKILL');
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 6. Conflicting facts follow deterministic rules
// ─────────────────────────────────────────────────────────────────────────────
describe('6. Conflict resolution is deterministic', () => {
  let svc: CanonicalIntelligenceService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new CanonicalIntelligenceService(prisma);
    mockRouting();
    mockTransaction();
  });

  it('user-corrected fact beats machine fact with higher confidence (Rule 4)', async () => {
    const FACT_ID_CORRECTED = 'fact-corrected-0000-0000-0000-000000000001';
    const userCorrectedFact = makeFact({ id: FACT_ID_CORRECTED, isUserCorrected: true, confidence: 0.5 });
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(userCorrectedFact);
    // Existing canonical is machine-extracted with higher confidence and different factId
    (prisma.canonicalCandidateIntelligence.findUnique as jest.Mock).mockResolvedValue(
      makeCanonical({ sourceFactId: FACT_ID, confidence: 0.99, sourceFact: { isUserCorrected: false } }),
    );
    (prisma.canonicalCandidateIntelligence.upsert as jest.Mock).mockResolvedValue({ id: CAN_ID });

    const result = await svc.materialise({
      userId: USER_A, sourceFactId: FACT_ID_CORRECTED, provenanceId: PROV_ID,
      factType: 'SKILL', confidence: 0.5, observedAt: new Date(),
    });

    expect(result.promoted).toBe(true);
  });

  it('machine fact does not replace an existing user-corrected fact (Rule 4)', async () => {
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(
      makeFact({ isUserCorrected: false, confidence: 0.99 }),
    );
    // Existing is user-corrected
    (prisma.canonicalCandidateIntelligence.findUnique as jest.Mock).mockResolvedValue(
      makeCanonical({ confidence: 0.5, sourceFact: { isUserCorrected: true } }),
    );

    const result = await svc.materialise({
      userId: USER_A, sourceFactId: FACT_ID, provenanceId: PROV_ID,
      factType: 'SKILL', confidence: 0.99, observedAt: new Date(),
    });

    expect(result.promoted).toBe(false);
    expect(prisma.canonicalCandidateIntelligence.upsert).not.toHaveBeenCalled();
  });

  it('computeDeduplicationKey is stable for the same inputs', () => {
    const k1 = computeDeduplicationKey('SKILL', { name: '  Python  ' });
    const k2 = computeDeduplicationKey('SKILL', { name: 'python' });
    expect(k1).toBe(k2);
  });

  it('computeDeduplicationKey differs for different values within the same factType', () => {
    const pyKey = computeDeduplicationKey('SKILL', { name: 'Python' });
    const jsKey = computeDeduplicationKey('SKILL', { name: 'JavaScript' });
    expect(pyKey).not.toBe(jsKey);
  });

  it('computeDeduplicationKey is consistent regardless of factType for same name (uniqueness is on userId+factType+key)', () => {
    // The table's uniqueness constraint is (userId, factType, deduplicationKey) —
    // so a SKILL "python" and a CERTIFICATION "python" are separate rows.
    // The key itself is just the normalised name, not type-prefixed.
    const skill = computeDeduplicationKey('SKILL', { name: 'Python' });
    const cert  = computeDeduplicationKey('CERTIFICATION', { name: 'Python' });
    expect(skill).toBe('python');
    expect(cert).toBe('python');
    // They are equal here — but they occupy different (factType) slots in the table.
  });

  it('EXPERIENCE dedup key uses company + role normalised', () => {
    const k = computeDeduplicationKey('EXPERIENCE', { company: 'Acme', role: 'Engineer' });
    expect(k).toBe('acme|engineer');
  });

  it('EDUCATION dedup key uses institution + degree normalised', () => {
    const k = computeDeduplicationKey('EDUCATION', { institution: 'MIT', degree: 'B.S.' });
    expect(k).toBe('mit|b.s.');
  });

  it('SUMMARY always returns the literal "summary" key', () => {
    const k = computeDeduplicationKey('SUMMARY', { text: 'anything' });
    expect(k).toBe('summary');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Cross-user access is rejected
// ─────────────────────────────────────────────────────────────────────────────
describe('7. Cross-user access is rejected', () => {
  let svc: CanonicalIntelligenceService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new CanonicalIntelligenceService(prisma);
    mockRouting();
    mockTransaction();
  });

  it('materialise rejects when fact belongs to USER_B not USER_A', async () => {
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(
      makeFact({ userId: USER_B }),
    );

    await expect(
      svc.materialise({ userId: USER_A, sourceFactId: FACT_ID, provenanceId: PROV_ID,
        factType: 'SKILL', confidence: 0.9, observedAt: new Date() }),
    ).rejects.toThrow(MaterialisationOwnershipError);
    expect(prisma.canonicalCandidateIntelligence.upsert).not.toHaveBeenCalled();
  });

  it('getById rejects when canonical record belongs to USER_B', async () => {
    (prisma.canonicalCandidateIntelligence.findUnique as jest.Mock).mockResolvedValue(
      makeCanonical({ userId: USER_B }),
    );

    await expect(svc.getById(CAN_ID, USER_A))
      .rejects.toThrow(CrossUserOwnershipError);
  });

  it('retire rejects when canonical record belongs to USER_B', async () => {
    (prisma.canonicalCandidateIntelligence.findUnique as jest.Mock).mockResolvedValue(
      makeCanonical({ userId: USER_B }),
    );

    await expect(svc.retire(CAN_ID, USER_A))
      .rejects.toThrow(CrossUserOwnershipError);
    expect(prisma.canonicalCandidateIntelligence.update).not.toHaveBeenCalled();
  });

  it('ensureCanonicalIntelligenceAccess throws CrossUserOwnershipError for wrong user', async () => {
    (prisma.canonicalCandidateIntelligence.findUnique as jest.Mock).mockResolvedValue(
      makeCanonical({ userId: USER_B }),
    );

    await expect(ownershipGuard.ensureCanonicalIntelligenceAccess(USER_A, CAN_ID))
      .rejects.toThrow(CrossUserOwnershipError);
  });

  it('getProvenanceForCanonical rejects when canonical belongs to USER_B', async () => {
    (prisma.canonicalCandidateIntelligence.findUnique as jest.Mock).mockResolvedValue(
      makeCanonical({ userId: USER_B, provenance: makeProvenance({ userId: USER_B }) }),
    );

    await expect(svc.getProvenanceForCanonical(CAN_ID, USER_A))
      .rejects.toThrow(CrossUserOwnershipError);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 8. Cross-cell access is rejected
// ─────────────────────────────────────────────────────────────────────────────
describe('8. Cross-cell access is rejected', () => {
  let svc: CanonicalIntelligenceService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new CanonicalIntelligenceService(prisma);
    mockTransaction();
  });

  it('materialise rejects when supplied cellId mismatches routed cell', async () => {
    mockRouting(CELL_A);  // user routes to CELL_A
    (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(makeFact());

    await expect(
      svc.materialise({ userId: USER_A, cellId: CELL_B,  // caller supplies wrong cell
        sourceFactId: FACT_ID, provenanceId: PROV_ID,
        factType: 'SKILL', confidence: 0.9, observedAt: new Date() }),
    ).rejects.toThrow(CellBoundaryViolationError);
    expect(prisma.canonicalCandidateIntelligence.upsert).not.toHaveBeenCalled();
  });

  it('assertCellBoundary throws when canonical record cellId differs from routed cell', async () => {
    mockRouting(CELL_A);
    (prisma.canonicalCandidateIntelligence.findUnique as jest.Mock).mockResolvedValue(
      makeCanonical({ cellId: CELL_B }),   // record was written to CELL_B
    );

    await expect(svc.assertCellBoundary(CAN_ID, USER_A))
      .rejects.toThrow(CellBoundaryViolationError);
  });

  it('assertCellBoundary passes when cells match', async () => {
    mockRouting(CELL_A);
    (prisma.canonicalCandidateIntelligence.findUnique as jest.Mock).mockResolvedValue(
      makeCanonical({ cellId: CELL_A }),
    );

    await expect(svc.assertCellBoundary(CAN_ID, USER_A))
      .resolves.toBeUndefined();
  });

  it('assertCellBoundary throws CrossUserOwnershipError when record belongs to USER_B', async () => {
    mockRouting(CELL_A);
    (prisma.canonicalCandidateIntelligence.findUnique as jest.Mock).mockResolvedValue(
      makeCanonical({ userId: USER_B, cellId: CELL_A }),
    );

    await expect(svc.assertCellBoundary(CAN_ID, USER_A))
      .rejects.toThrow(CrossUserOwnershipError);
  });

  it('absent canonical record throws CanonicalIntelligenceNotFoundError in assertCellBoundary', async () => {
    mockRouting(CELL_A);
    (prisma.canonicalCandidateIntelligence.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(svc.assertCellBoundary(CAN_ID, USER_A))
      .rejects.toThrow(CanonicalIntelligenceNotFoundError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Queries do not expose raw extraction data by default
// ─────────────────────────────────────────────────────────────────────────────
describe('9. Read model does not expose raw extraction data by default', () => {
  let svc: CanonicalIntelligenceService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new CanonicalIntelligenceService(prisma);
  });

  it('getForUser without includeFactData returns no factData property', async () => {
    (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mockResolvedValue([
      makeCanonical({ sourceFact: null }),   // sourceFact not included
    ]);

    const results = await svc.getForUser({ userId: USER_A });

    expect(results).toHaveLength(1);
    expect(results[0]!.factData).toBeUndefined();
    expect(results[0]!.provenance).toBeUndefined();
  });

  it('getForUser without includeProvenance returns no provenance property', async () => {
    (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mockResolvedValue([
      makeCanonical({ provenance: undefined }),
    ]);

    const results = await svc.getForUser({ userId: USER_A });

    expect(results[0]!.provenance).toBeUndefined();
  });

  it('getForUser with includeFactData=true returns factData', async () => {
    (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mockResolvedValue([
      makeCanonical({ sourceFact: { factData: { name: 'TypeScript' } } }),
    ]);

    const results = await svc.getForUser({ userId: USER_A, includeFactData: true });

    expect(results[0]!.factData).toEqual({ name: 'TypeScript' });
  });

  it('getForUser scopes query strictly to the requesting userId', async () => {
    (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mockResolvedValue([]);

    await svc.getForUser({ userId: USER_A, factType: 'SKILL' });

    expect(prisma.canonicalCandidateIntelligence.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER_A, isActive: true }),
      }),
    );
  });

  it('getForUser with factType filter only queries that type', async () => {
    (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mockResolvedValue([]);

    await svc.getForUser({ userId: USER_A, factType: 'EDUCATION' });

    expect(prisma.canonicalCandidateIntelligence.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ factType: 'EDUCATION' }),
      }),
    );
  });

  it('getForUser includeInactive=false excludes retired records by default', async () => {
    (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mockResolvedValue([]);

    await svc.getForUser({ userId: USER_A });

    const callArg = (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mock.calls[0][0];
    expect(callArg.where.isActive).toBe(true);
  });

  it('getForUser includeInactive=true does not filter on isActive', async () => {
    (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mockResolvedValue([]);

    await svc.getForUser({ userId: USER_A, includeInactive: true });

    const callArg = (prisma.canonicalCandidateIntelligence.findMany as jest.Mock).mock.calls[0][0];
    expect(callArg.where.isActive).toBeUndefined();
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 10. Existing Epic 0–3 behaviour remains compatible
// ─────────────────────────────────────────────────────────────────────────────
describe('10. Existing Epic 0-3 compatibility', () => {
  beforeEach(() => jest.clearAllMocks());

  it('FactService.getCurrentFacts still works (unchanged API)', async () => {
    (prisma.factObservation.findMany as jest.Mock).mockResolvedValue([
      { id: 'f1', factType: 'SKILL', isCurrent: true },
    ]);

    const facts = await factService.getCurrentFacts(USER_A, 'SKILL');

    expect(facts).toHaveLength(1);
    expect(prisma.factObservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER_A, isCurrent: true, deletedAt: null }),
      }),
    );
  });

  it('OwnershipGuard.ensureApplicationAccess still works (unchanged)', async () => {
    (prisma.jobApplication.findFirst as jest.Mock).mockResolvedValue({
      id: 'app-1', userId: USER_A, legacyUserId: USER_A,
    });

    const r = await ownershipGuard.ensureApplicationAccess(USER_A, 'app-1');
    expect(r.id).toBe('app-1');
  });

  it('ensureCanonicalIntelligenceAccess returns projection on valid access', async () => {
    (prisma.canonicalCandidateIntelligence.findUnique as jest.Mock).mockResolvedValue(
      makeCanonical(),
    );

    const r = await ownershipGuard.ensureCanonicalIntelligenceAccess(USER_A, CAN_ID);

    expect(r.id).toBe(CAN_ID);
    expect(r.factType).toBe('SKILL');
    expect(r.deduplicationKey).toBe('typescript');
    expect(r.isActive).toBe(true);
  });

  it('domain error classes carry expected statusCode and code', () => {
    const mo = new MaterialisationOwnershipError(FACT_ID);
    expect(mo.statusCode).toBe(403);
    expect(mo.code).toBe('MATERIALISATION_OWNERSHIP_DENIED');

    const fne = new FactNotEligibleError(FACT_ID, 'deleted');
    expect(fne.statusCode).toBe(422);
    expect(fne.code).toBe('FACT_NOT_ELIGIBLE');

    const cnf = new CanonicalIntelligenceNotFoundError(CAN_ID);
    expect(cnf.statusCode).toBe(404);
    expect(cnf.code).toBe('CANONICAL_INTELLIGENCE_NOT_FOUND');
  });

  it('FactService.getFactHistory still walks the version chain (unchanged)', async () => {
    (prisma.factObservation.findUnique as jest.Mock)
      .mockResolvedValueOnce({ id: 'f1', supersededById: 'f2' })
      .mockResolvedValueOnce({ id: 'f2', supersededById: null });

    const history = await factService.getFactHistory('f1');

    expect(history.map((h) => h.id)).toEqual(['f1', 'f2']);
  });
});
