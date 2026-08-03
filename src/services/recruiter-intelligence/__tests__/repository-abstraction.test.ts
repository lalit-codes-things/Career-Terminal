import { RecruiterRepository } from '../repositories/recruiter.repository';
import type { RecruiterRepositoryContract } from '../repositories/recruiter.repository';

const now = new Date('2026-08-03T00:00:00.000Z');

function createMockDb() {
  const tx = {
    recruiter: {
      upsert: jest.fn().mockResolvedValue({}),
    },
  };

  return {
    $transaction: jest.fn(async (work) => work(tx)),
    recruiter: {
      create: jest.fn().mockResolvedValue({
        id: 'rec-1',
        companyId: 'company-1',
        name: 'Ada',
        email: 'ada@example.com',
        title: 'Recruiter',
        createdAt: now,
        updatedAt: now,
      }),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue({
        id: 'rec-1',
        companyId: 'company-1',
        name: 'Ada Updated',
        email: 'ada@example.com',
        title: 'Lead Recruiter',
        createdAt: now,
        updatedAt: new Date('2026-08-03T00:01:00.000Z'),
      }),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    tx,
  };
}

describe('recruiter repository abstraction', () => {
  it('is consumed through the repository interface without Prisma in the contract', async () => {
    const mockDb = createMockDb();
    const repository: RecruiterRepositoryContract = new RecruiterRepository(mockDb as never);

    const result = await repository.executeInTransaction(async (tx) => ({ kind: tx.kind }));

    expect(result).toEqual({ kind: 'write-transaction' });
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
  });

  it('preserves cursor pagination shape through list()', async () => {
    const mockDb = createMockDb();
    const repository = new RecruiterRepository(mockDb as never);

    await repository.list({}, { take: 10, cursor: 'cursor-1', orderBy: { createdAt: 'asc' } });

    expect(mockDb.recruiter.findMany).toHaveBeenCalledWith({
      where: {},
      cursor: { id: 'cursor-1' },
      skip: 1,
      take: 10,
      orderBy: { createdAt: 'asc' },
    });
  });

  it('preserves transaction integrity for bulk idempotent upserts', async () => {
    const mockDb = createMockDb();
    const repository = new RecruiterRepository(mockDb as never);

    await repository.bulkUpsert([{ id: 'rec-1', canonicalName: 'Ada', source: 'test' }]);

    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.tx.recruiter.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rec-1' },
        update: { name: 'Ada' },
      }),
    );
  });

  it('preserves optimistic locking on updates', async () => {
    const mockDb = createMockDb();
    const repository = new RecruiterRepository(mockDb as never);

    await repository.update('rec-1', { title: 'Lead Recruiter', expectedUpdatedAt: now });

    expect(mockDb.recruiter.updateMany).toHaveBeenCalledWith({
      where: { id: 'rec-1', updatedAt: now },
      data: { name: undefined, companyId: undefined, email: undefined, title: 'Lead Recruiter' },
    });
  });

  it('raises an optimistic locking error when the expected version is stale', async () => {
    const mockDb = createMockDb();
    mockDb.recruiter.updateMany.mockResolvedValue({ count: 0 });
    const repository = new RecruiterRepository(mockDb as never);

    await expect(repository.update('rec-1', { expectedUpdatedAt: now })).rejects.toThrow(
      'Optimistic lock conflict',
    );
  });
});
