import { factCorrectionService } from '../services/fact-correction.service';
import { prisma } from '../config/database';

jest.mock('../config/database', () => {
  const prisma = {
    factObservation: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    extractionRun: {
      create: jest.fn(),
    },
    factProvenance: {
      create: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(prisma)),
  };
  return {
    prisma,
  dbRouter: {
    read: jest.fn().mockReturnValue(prisma),
    write: jest.fn().mockReturnValue(prisma),
    withReplicaFallback: jest.fn(),
    getHealth: jest.fn(),
    disconnect: jest.fn(),
  },
  };
});

jest.mock('../services/routing/cell-routing.service', () => ({
  cellRoutingService: {
    resolveUserRouting: jest.fn().mockResolvedValue({ cellId: 'us-east-1-shard-000' }),
  },
}));

describe('FactCorrectionService', () => {
  const userId = 'user-corr-789';
  const adminId = 'admin-456';
  const factId = 'fact-orig-1';
  const newFactId = 'fact-corrected-1';

  beforeEach(() => {
    jest.clearAllMocks();
    // Default stubs for the extraction run chain used by proposeCorrection.
    (prisma.extractionRun.create as jest.Mock).mockResolvedValue({ id: 'run-stub' });
    (prisma.factProvenance.create as jest.Mock).mockResolvedValue({
      id: 'prov-stub',
      extractionRunId: 'run-stub',
    });
  });

  describe('proposeCorrection', () => {
    it('should create a corrected fact with MANUAL source and supersede the original', async () => {
      const originalFact = {
        id: factId,
        userId: 'user-fact-owner',
        factType: 'SKILL',
        factData: { name: 'TypeScript', years: 1 },
        sourceType: 'RESUME',
        sourceId: 'res-1',
        sourceVersion: null,
        extractionMethod: 'LLM',
        modelVersion: 'gpt-4',
        confidence: 0.7,
        evidenceReference: 'Resume line 5',
        validFrom: new Date('2022-01-01Z'),
        validTo: null,
        observedAt: new Date('2023-06-01Z'),
        snapshotId: null,
        version: 1,
        isCurrent: true,
        provenance: { cellId: 'us-east-1-shard-000' },
      };
      const correctedData = { name: 'TypeScript', years: 5 };
      const reason = 'I have 5 years not 1';
      const evidence = 'LinkedIn profile says 5 years';

      (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(originalFact);
      (prisma.factObservation.create as jest.Mock).mockResolvedValue({
        ...originalFact,
        id: newFactId,
        version: 2,
        factData: correctedData,
        sourceType: 'MANUAL',
        sourceId: userId,
        extractionMethod: 'USER_CORRECTION',
        confidence: 1.0,
        evidenceReference: evidence,
        correctedBy: userId,
        correctedAt: new Date(),
        correctionReason: reason,
        isUserCorrected: true,
      });

      const result = await factCorrectionService.proposeCorrection(
        factId,
        correctedData,
        userId,
        reason,
        evidence,
      );

      expect(result.id).toBe(newFactId);
      expect(prisma.factObservation.findUnique).toHaveBeenCalledWith({
        where: { id: factId },
        include: { extractionRun: true, provenance: true },
      });
      expect(prisma.factObservation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: originalFact.userId,
          factType: 'SKILL',
          factData: correctedData,
          sourceType: 'MANUAL',
          sourceId: userId,
          sourceVersion: '1',
          extractionMethod: 'USER_CORRECTION',
          modelVersion: null,
          confidence: 1.0,
          evidenceReference: evidence,
          validFrom: originalFact.validFrom,
          validTo: null,
          snapshotId: null,
          version: 2,
          isCurrent: true,
          correctedBy: userId,
          correctionReason: reason,
          isUserCorrected: true,
        }),
      });
      expect(prisma.factObservation.update).toHaveBeenCalledWith({
        where: { id: factId },
        data: expect.objectContaining({
          isCurrent: false,
          supersededById: newFactId,
        }),
      });
    });

    it('should default evidence to a user-correction message when none provided', async () => {
      const originalFact = {
        id: factId,
        userId: 'u1',
        factType: 'EXPERIENCE',
        factData: { company: 'X' },
        sourceType: 'RESUME',
        sourceId: 'r1',
        sourceVersion: null,
        extractionMethod: 'LLM',
        modelVersion: null,
        confidence: 0.8,
        evidenceReference: null,
        validFrom: null,
        validTo: null,
        observedAt: new Date(),
        snapshotId: null,
        version: 1,
        isCurrent: true,
        provenance: { cellId: 'us-east-1-shard-000' },
      };

      (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(originalFact);
      (prisma.factObservation.create as jest.Mock).mockResolvedValue({ id: 'nf' });

      await factCorrectionService.proposeCorrection(
        factId,
        { company: 'Y' },
        userId,
        'wrong company name',
      );

      expect(prisma.factObservation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          evidenceReference: `Corrected by user ${userId}`,
        }),
      });
    });

    it('should throw an error when the original fact does not exist', async () => {
      (prisma.factObservation.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        factCorrectionService.proposeCorrection('missing-fact', {}, userId, 'reason'),
      ).rejects.toThrow('Fact not found');
    });
  });

  describe('flagForReview', () => {
    it('sets needsReview=true, reviewStatus=pending, and stores reason in reviewNotes', async () => {
      const reason = 'This skill looks wrong — I never worked with this language';
      (prisma.factObservation.update as jest.Mock).mockResolvedValue({ id: factId });

      await factCorrectionService.flagForReview(factId, userId, reason);

      expect(prisma.factObservation.update).toHaveBeenCalledWith({
        where: { id: factId },
        data: {
          needsReview: true,
          reviewStatus: 'pending',
          reviewNotes: reason,
        },
      });
    });
  });

  describe('reviewFact', () => {
    it('approves a fact and clears needsReview, saving notes in reviewNotes', async () => {
      const notes = 'Confirmed against the resume PDF';
      (prisma.factObservation.update as jest.Mock).mockResolvedValue({ id: factId });

      await factCorrectionService.reviewFact(factId, adminId, 'approved', notes);

      expect(prisma.factObservation.update).toHaveBeenCalledWith({
        where: { id: factId },
        data: expect.objectContaining({
          reviewStatus: 'approved',
          reviewedBy: adminId,
          needsReview: false,
          reviewNotes: notes,
        }),
      });
    });

    it('rejects a fact with no notes, preserving reviewNotes as undefined not overwritten', async () => {
      (prisma.factObservation.update as jest.Mock).mockResolvedValue({ id: factId });

      await factCorrectionService.reviewFact(factId, adminId, 'rejected');

      expect(prisma.factObservation.update).toHaveBeenCalledWith({
        where: { id: factId },
        data: expect.objectContaining({
          reviewStatus: 'rejected',
          reviewedBy: adminId,
          needsReview: false,
          reviewNotes: undefined,
        }),
      });
    });
  });

  describe('getPendingReviews', () => {
    it('returns only pending reviews ordered by lowest confidence first', async () => {
      const pendingFacts = [
        {
          id: 'low',
          factType: 'SKILL',
          confidence: 0.3,
          needsReview: true,
          reviewStatus: 'pending',
        },
        {
          id: 'mid',
          factType: 'EXPERIENCE',
          confidence: 0.5,
          needsReview: true,
          reviewStatus: 'pending',
        },
        {
          id: 'high',
          factType: 'EDUCATION',
          confidence: 0.7,
          needsReview: true,
          reviewStatus: 'pending',
        },
      ];
      (prisma.factObservation.findMany as jest.Mock).mockResolvedValue(pendingFacts);

      const result = await factCorrectionService.getPendingReviews(50);

      expect(result).toEqual(pendingFacts);
      expect(prisma.factObservation.findMany).toHaveBeenCalledWith({
        where: {
          needsReview: true,
          reviewStatus: 'pending',
        },
        orderBy: { confidence: 'asc' },
        take: 50,
      });
    });

    it('uses a default limit of 100', async () => {
      (prisma.factObservation.findMany as jest.Mock).mockResolvedValue([]);

      await factCorrectionService.getPendingReviews();

      expect(prisma.factObservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });

  describe('getFactsByReviewStatus', () => {
    it('returns only the specified review status ordered by newest review first', async () => {
      const approved = [
        { id: 'f1', reviewStatus: 'approved', reviewedAt: new Date('2024-02-01Z') },
      ];
      (prisma.factObservation.findMany as jest.Mock).mockResolvedValue(approved);

      const result = await factCorrectionService.getFactsByReviewStatus('approved');

      expect(result).toEqual(approved);
      expect(prisma.factObservation.findMany).toHaveBeenCalledWith({
        where: { reviewStatus: 'approved' },
        orderBy: { reviewedAt: 'desc' },
        take: 100,
      });
    });
  });

  describe('getCorrectionHistory', () => {
    it('walks the supersededById chain to return ordered history', async () => {
      const f1 = { id: 'f1', factType: 'SKILL', version: 1, supersededById: 'f2' };
      const f2 = { id: 'f2', factType: 'SKILL', version: 2, supersededById: 'f3' };
      const f3 = { id: 'f3', factType: 'SKILL', version: 3, supersededById: null };

      (prisma.factObservation.findUnique as jest.Mock)
        .mockResolvedValueOnce(f1)
        .mockResolvedValueOnce(f2)
        .mockResolvedValueOnce(f3);

      const history = await factCorrectionService.getCorrectionHistory('f1');

      expect(history.map((h) => h.id)).toEqual(['f1', 'f2', 'f3']);
      expect(prisma.factObservation.findUnique).toHaveBeenCalledTimes(3);
    });
  });
});
