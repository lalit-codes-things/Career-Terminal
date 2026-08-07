import { factService } from '../services/fact.service';
import { prisma } from '../config/database';

jest.mock('../config/database', () => {
  const prisma = {
    factObservation: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
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

describe('FactService', () => {
  const userId = 'user-123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should record a new fact correctly', async () => {
    const input = {
      userId,
      factType: 'SKILL',
      factData: { name: 'TypeScript' },
      sourceType: 'RESUME',
      sourceId: 'res-1',
      extractionMethod: 'LLM',
      confidence: 0.95,
      observedAt: new Date(),
      extractionRunId: 'run-1',
      provenanceId: 'prov-1',
    };

    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.factObservation.create as jest.Mock).mockResolvedValue({
      id: 'fact-1',
      ...input,
      version: 1,
    });

    const result = await factService.recordFact(input);

    expect(result.id).toBe('fact-1');
    expect(prisma.factObservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId,
        factType: 'SKILL',
        version: 1,
        isCurrent: true,
      }),
    });
  });

  it('should record a fact with temporal fields (validFrom, validTo, observedAt)', async () => {
    const validFrom = new Date('2020-01-01T00:00:00Z');
    const validTo = new Date('2023-06-15T00:00:00Z');
    const observedAt = new Date('2023-07-01T00:00:00Z');

    const input = {
      userId,
      factType: 'EXPERIENCE',
      factData: { company: 'example-organization', title: 'Senior Engineer' },
      sourceType: 'RESUME',
      sourceId: 'res-1',
      extractionMethod: 'LLM',
      confidence: 0.92,
      observedAt,
      validFrom,
      validTo,
      extractionRunId: 'run-1',
      provenanceId: 'prov-1',
    };

    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.factObservation.create as jest.Mock).mockResolvedValue({
      id: 'fact-temporal-1',
      ...input,
      version: 1,
    });

    const result = await factService.recordFact(input);

    expect(result.id).toBe('fact-temporal-1');
    expect(prisma.factObservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId,
        factType: 'EXPERIENCE',
        observedAt,
        validFrom,
        validTo,
        version: 1,
        isCurrent: true,
      }),
    });
  });

  it('should record a fact linked to a snapshotId', async () => {
    const snapshotId = 'snap-abc123';
    const observedAt = new Date();

    const input = {
      userId,
      factType: 'SKILL',
      factData: { name: 'Node.js', years: 5 },
      sourceType: 'RESUME',
      sourceId: 'res-1',
      extractionMethod: 'LLM',
      confidence: 0.98,
      observedAt,
      snapshotId,
      extractionRunId: 'run-1',
      provenanceId: 'prov-1',
    };

    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.factObservation.create as jest.Mock).mockResolvedValue({
      id: 'fact-snap-1',
      ...input,
      version: 1,
    });

    const result = await factService.recordFact(input);

    expect(result.id).toBe('fact-snap-1');
    expect(prisma.factObservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        snapshotId,
        observedAt,
        version: 1,
      }),
    });
  });

  it('should supersede existing fact when recording new version', async () => {
    const input = {
      userId,
      factType: 'SKILL',
      factData: { name: 'TypeScript' },
      sourceType: 'RESUME',
      sourceId: 'res-2',
      extractionMethod: 'LLM',
      confidence: 0.99,
      observedAt: new Date(),
      extractionRunId: 'run-2',
      provenanceId: 'prov-2',
    };

    const existing = { id: 'fact-1', userId, factType: 'SKILL', version: 1 };
    (prisma.factObservation.findFirst as jest.Mock).mockResolvedValue(existing);
    (prisma.factObservation.create as jest.Mock).mockResolvedValue({
      id: 'fact-2',
      ...input,
      version: 2,
    });

    await factService.recordFact(input);

    expect(prisma.factObservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: 2 }),
      }),
    );
    expect(prisma.factObservation.update).toHaveBeenCalledWith({
      where: { id: 'fact-1' },
      data: expect.objectContaining({
        isCurrent: false,
        supersededById: 'fact-2',
      }),
    });
  });

  it('should return only current facts', async () => {
    (prisma.factObservation.findMany as jest.Mock).mockResolvedValue([{ id: 'fact-1' }]);

    const result = await factService.getCurrentFacts(userId, 'SKILL');

    expect(result).toHaveLength(1);
    expect(prisma.factObservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId,
          factType: 'SKILL',
          isCurrent: true,
        }),
      }),
    );
  });

  it('should get facts valid at a specific timestamp', async () => {
    const timestamp = new Date('2022-06-01T00:00:00Z');
    const mockFacts = [{ id: 'fact-valid-1' }, { id: 'fact-valid-2' }];
    (prisma.factObservation.findMany as jest.Mock).mockResolvedValue(mockFacts);

    const result = await factService.getFactsValidAt(userId, timestamp, 'EXPERIENCE');

    expect(result).toEqual(mockFacts);
    expect(prisma.factObservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId,
          factType: 'EXPERIENCE',
          isCurrent: true,
          deletedAt: null,
          OR: expect.arrayContaining([
            expect.objectContaining({
              validFrom: { lte: timestamp },
              validTo: null,
            }),
            expect.objectContaining({
              validFrom: { lte: timestamp },
              validTo: { gte: timestamp },
            }),
          ]),
        }),
      }),
    );
  });

  it('should get facts for a specific snapshotId', async () => {
    const snapshotId = 'snap-xyz789';
    const mockFacts = [
      { id: 'sf-1', factType: 'SKILL' },
      { id: 'sf-2', factType: 'EXPERIENCE' },
    ];
    (prisma.factObservation.findMany as jest.Mock).mockResolvedValue(mockFacts);

    const result = await factService.getSnapshotFacts(snapshotId);

    expect(result).toEqual(mockFacts);
    expect(prisma.factObservation.findMany).toHaveBeenCalledWith({
      where: { snapshotId },
      orderBy: { factType: 'asc' },
    });
  });
});
