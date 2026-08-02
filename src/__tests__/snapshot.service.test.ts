import { snapshotService } from '../services/snapshot.service';
import { prisma } from '../config/database';

jest.mock('../config/database', () => ({
  prisma: {
    snapshot: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    factObservation: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(prisma)),
  },
}));

describe('SnapshotService', () => {
  const userId = 'user-456';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createSnapshot', () => {
    it('should create a snapshot record and copy current facts with snapshotId', async () => {
      const snapshotId = 'snap-new-123';
      const snapshotType = 'APPLICATION';
      const referenceId = 'app-789';
      const description = 'Snapshot at application time';

      const currentFacts = [
        {
          id: 'fact-1',
          userId,
          factType: 'SKILL',
          factData: { name: 'Python' },
          sourceType: 'RESUME',
          sourceId: 'res-1',
          sourceVersion: null,
          extractionMethod: 'LLM',
          modelVersion: 'gpt-4',
          confidence: 0.95,
          evidenceReference: null,
          validFrom: new Date('2021-01-01Z'),
          validTo: null,
          observedAt: new Date('2023-01-01Z'),
          version: 2,
          isCurrent: true,
          deletedAt: null,
        },
        {
          id: 'fact-2',
          userId,
          factType: 'EXPERIENCE',
          factData: { company: 'Acme' },
          sourceType: 'RESUME',
          sourceId: 'res-1',
          sourceVersion: null,
          extractionMethod: 'LLM',
          modelVersion: 'gpt-4',
          confidence: 0.9,
          evidenceReference: null,
          validFrom: new Date('2020-06-01Z'),
          validTo: new Date('2023-06-01Z'),
          observedAt: new Date('2023-01-01Z'),
          version: 1,
          isCurrent: true,
          deletedAt: null,
        },
      ];

      (prisma.snapshot.create as jest.Mock).mockResolvedValue({
        id: snapshotId,
        userId,
        snapshotType,
        referenceId,
        description,
        capturedAt: new Date(),
      });
      (prisma.factObservation.findMany as jest.Mock).mockResolvedValue(currentFacts);
      (prisma.factObservation.create as jest.Mock).mockImplementation(({ data }: any) =>
        Promise.resolve({ id: `copy-${data.factType}`, ...data }),
      );

      const result = await snapshotService.createSnapshot(
        userId,
        snapshotType,
        referenceId,
        description,
      );

      expect(result.id).toBe(snapshotId);
      expect(prisma.snapshot.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          snapshotType,
          referenceId,
          description,
        }),
      });
      expect(prisma.factObservation.findMany).toHaveBeenCalledWith({
        where: {
          userId,
          isCurrent: true,
          deletedAt: null,
        },
      });
      expect(prisma.factObservation.create).toHaveBeenCalledTimes(currentFacts.length);
      expect(prisma.factObservation.create).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({
          snapshotId,
          factType: 'SKILL',
          version: 2,
        }),
      });
      expect(prisma.factObservation.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          snapshotId,
          factType: 'EXPERIENCE',
          version: 1,
        }),
      });
    });

    it('should create a snapshot even with zero current facts', async () => {
      const snapshotId = 'snap-empty-000';
      const snapshotType = 'MONTHLY';

      (prisma.snapshot.create as jest.Mock).mockResolvedValue({
        id: snapshotId,
        userId,
        snapshotType,
        referenceId: null,
        description: null,
        capturedAt: new Date(),
      });
      (prisma.factObservation.findMany as jest.Mock).mockResolvedValue([]);

      const result = await snapshotService.createSnapshot(userId, snapshotType);

      expect(result.id).toBe(snapshotId);
      expect(prisma.snapshot.create).toHaveBeenCalled();
      expect(prisma.factObservation.create).not.toHaveBeenCalled();
    });

    it('should preserve temporal fields (validFrom, validTo, observedAt) when copying facts', async () => {
      const snapshotId = 'snap-temporal';
      const validFrom = new Date('2019-03-01Z');
      const validTo = new Date('2022-11-15Z');
      const observedAt = new Date('2023-02-10Z');

      const currentFacts = [
        {
          id: 'fact-t1',
          userId,
          factType: 'EDUCATION',
          factData: { degree: 'BSc' },
          sourceType: 'RESUME',
          sourceId: 'res-1',
          sourceVersion: null,
          extractionMethod: 'LLM',
          modelVersion: null,
          confidence: 0.88,
          evidenceReference: null,
          validFrom,
          validTo,
          observedAt,
          version: 1,
          isCurrent: true,
          deletedAt: null,
        },
      ];

      (prisma.snapshot.create as jest.Mock).mockResolvedValue({
        id: snapshotId,
        userId,
        snapshotType: 'APPLICATION',
      });
      (prisma.factObservation.findMany as jest.Mock).mockResolvedValue(currentFacts);
      (prisma.factObservation.create as jest.Mock).mockResolvedValue({ id: 'copied-fact' });

      await snapshotService.createSnapshot(userId, 'APPLICATION');

      expect(prisma.factObservation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          snapshotId,
          validFrom,
          validTo,
          observedAt,
          factType: 'EDUCATION',
        }),
      });
    });
  });

  describe('getSnapshotFacts', () => {
    it('should return all facts linked to the given snapshotId', async () => {
      const snapshotId = 'snap-get-1';
      const mockFacts = [
        { id: 'f1', factType: 'SKILL', snapshotId },
        { id: 'f2', factType: 'EXPERIENCE', snapshotId },
        { id: 'f3', factType: 'EDUCATION', snapshotId },
      ];
      (prisma.factObservation.findMany as jest.Mock).mockResolvedValue(mockFacts);

      const result = await snapshotService.getSnapshotFacts(snapshotId);

      expect(result).toEqual(mockFacts);
      expect(prisma.factObservation.findMany).toHaveBeenCalledWith({
        where: { snapshotId },
        orderBy: { factType: 'asc' },
      });
    });

    it('should return empty array when snapshot has no facts', async () => {
      const snapshotId = 'snap-empty';
      (prisma.factObservation.findMany as jest.Mock).mockResolvedValue([]);

      const result = await snapshotService.getSnapshotFacts(snapshotId);

      expect(result).toEqual([]);
    });
  });

  describe('getSnapshotForApplication', () => {
    it('should find the APPLICATION snapshot linked to a given applicationId', async () => {
      const applicationId = 'app-linked-123';
      const mockSnapshot = {
        id: 'snap-for-app',
        userId,
        snapshotType: 'APPLICATION',
        referenceId: applicationId,
      };
      (prisma.snapshot.findFirst as jest.Mock).mockResolvedValue(mockSnapshot);

      const result = await snapshotService.getSnapshotForApplication(applicationId);

      expect(result).toEqual(mockSnapshot);
      expect(prisma.snapshot.findFirst).toHaveBeenCalledWith({
        where: {
          referenceId: applicationId,
          snapshotType: 'APPLICATION',
        },
      });
    });

    it('should return null when no APPLICATION snapshot exists for application', async () => {
      const applicationId = 'app-no-snap';
      (prisma.snapshot.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await snapshotService.getSnapshotForApplication(applicationId);

      expect(result).toBeNull();
    });
  });

  describe('getSnapshotsByType', () => {
    it('should return all snapshots of a specific type for a user, newest first', async () => {
      const mockSnapshots = [
        { id: 's1', userId, snapshotType: 'APPLICATION', capturedAt: new Date('2024-01-15Z') },
        { id: 's2', userId, snapshotType: 'APPLICATION', capturedAt: new Date('2024-01-10Z') },
        { id: 's3', userId, snapshotType: 'APPLICATION', capturedAt: new Date('2024-01-05Z') },
      ];
      (prisma.snapshot.findMany as jest.Mock).mockResolvedValue(mockSnapshots);

      const result = await snapshotService.getSnapshotsByType(userId, 'APPLICATION');

      expect(result).toEqual(mockSnapshots);
      expect(prisma.snapshot.findMany).toHaveBeenCalledWith({
        where: { userId, snapshotType: 'APPLICATION' },
        orderBy: { capturedAt: 'desc' },
      });
    });
  });

  describe('getSnapshot', () => {
    it('should return a specific snapshot by its unique ID', async () => {
      const snapshotId = 'snap-by-id-1';
      const mockSnapshot = { id: snapshotId, userId, snapshotType: 'MONTHLY' };
      (prisma.snapshot.findUnique as jest.Mock).mockResolvedValue(mockSnapshot);

      const result = await snapshotService.getSnapshot(snapshotId);

      expect(result).toEqual(mockSnapshot);
      expect(prisma.snapshot.findUnique).toHaveBeenCalledWith({
        where: { id: snapshotId },
      });
    });

    it('should return null when snapshot ID does not exist', async () => {
      (prisma.snapshot.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await snapshotService.getSnapshot('non-existent-id');

      expect(result).toBeNull();
    });
  });
});
