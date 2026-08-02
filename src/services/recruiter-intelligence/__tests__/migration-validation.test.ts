import { validateMigrations, ensureSchemaSynchronization } from '../migration/migration-validator';

describe('migration validation', () => {
  it('skips validation when DATABASE_URL is absent', () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    const result = validateMigrations();

    expect(result.skipped).toBe(true);
    expect(result.ok).toBe(true);

    if (previous) {
      process.env.DATABASE_URL = previous;
    }
  });

  it('reports schema synchronization success when the schema and generated client exist', () => {
    const result = ensureSchemaSynchronization();

    expect(result.ok).toBe(true);
  });
});
