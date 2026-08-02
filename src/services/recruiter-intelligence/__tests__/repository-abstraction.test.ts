import { RecruiterRepository } from '../repositories/recruiter.repository';

describe('recruiter repository abstraction', () => {
  it('exposes transaction support through the repository contract', async () => {
    const repository = new RecruiterRepository();
    const result = await repository.executeInTransaction(async () => ({ ok: true }));

    expect(result).toEqual({ ok: true });
  });

  it('supports cursor pagination shape through list()', async () => {
    const repository = new RecruiterRepository();
    const result = await repository.list({}, { take: 1, cursor: undefined });

    expect(Array.isArray(result)).toBe(true);
  });
});
