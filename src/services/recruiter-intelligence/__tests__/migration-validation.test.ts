import { validateMigrations, ensureSchemaSynchronization } from '../migration/migration-validator';
import { runStartupValidation } from '../migration/startup-validation';

const execOk = jest.fn(() => 'ok') as never;

describe('migration validation', () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousShadowDatabaseUrl = process.env.SHADOW_DATABASE_URL;

  afterEach(() => {
    jest.clearAllMocks();
    process.env.DATABASE_URL = previousDatabaseUrl;
    process.env.SHADOW_DATABASE_URL = previousShadowDatabaseUrl;
  });

  it('skips live validation when DATABASE_URL is absent while still validating schema', () => {
    delete process.env.DATABASE_URL;

    const result = validateMigrations(execOk);

    expect(result.skipped).toBe(true);
    expect(result.ok).toBe(true);
    expect(execOk).toHaveBeenCalledWith(
      'npx',
      expect.arrayContaining(['prisma', 'validate']),
      expect.any(Object),
    );
  });

  it('detects migration drift when Prisma migrate status fails', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/app';
    const exec = jest.fn((_cmd, args) => {
      if (args.includes('status')) throw new Error('migration drift');
      return 'ok';
    }) as never;

    const result = validateMigrations(exec);

    expect(result.ok).toBe(false);
    expect(result.message).toBe('Prisma migration validation failed.');
  });

  it('detects schema drift when shadow database diff fails', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/app';
    process.env.SHADOW_DATABASE_URL = 'postgresql://user:pass@localhost:5432/shadow';
    const exec = jest.fn((_cmd, args) => {
      if (args.includes('diff')) throw new Error('schema drift');
      return 'ok';
    }) as never;

    const result = validateMigrations(exec);

    expect(result.ok).toBe(false);
    expect(result.details?.[0]).toContain('schema drift');
  });

  it('verifies generated Prisma Client can be loaded', () => {
    const result = ensureSchemaSynchronization(execOk);

    expect(result.ok).toBe(true);
    expect(execOk).toHaveBeenCalledWith(
      'node',
      ['-e', "require('@prisma/client');"],
      expect.any(Object),
    );
  });

  it('supports startup validation', () => {
    delete process.env.DATABASE_URL;

    expect(() => runStartupValidation(execOk)).not.toThrow();
  });
});
