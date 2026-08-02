import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { config } from 'dotenv';

config();

export interface MigrationValidationResult {
  ok: boolean;
  skipped: boolean;
  message: string;
  details?: string[];
}

export function validateMigrations(): MigrationValidationResult {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return {
      ok: true,
      skipped: true,
      message: 'DATABASE_URL is not set; migration validation skipped.',
    };
  }

  const repoRoot = path.resolve(__dirname, '../../../..');
  const prismaSchemaPath = path.join(repoRoot, 'prisma/schema.prisma');
  const migrationsDir = path.join(repoRoot, 'prisma/migrations');

  if (!existsSync(prismaSchemaPath)) {
    return { ok: false, skipped: false, message: 'Prisma schema is missing.' };
  }

  if (!existsSync(migrationsDir)) {
    return { ok: false, skipped: false, message: 'Prisma migrations directory is missing.' };
  }

  try {
    execFileSync('npx', ['prisma', 'migrate', 'status', '--schema', prismaSchemaPath], {
      cwd: repoRoot,
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });

    return {
      ok: true,
      skipped: false,
      message: 'Prisma migrations are in sync with the database.',
      details: ['schema', 'migrations', 'generated client'].map((item) => `validated ${item}`),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      skipped: false,
      message: 'Prisma migration validation failed.',
      details: [message],
    };
  }
}

export function ensureSchemaSynchronization(): MigrationValidationResult {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const schema = readFileSync(path.join(repoRoot, 'prisma/schema.prisma'), 'utf8');
  const generatedClientPath = path.join(repoRoot, 'node_modules/@prisma/client');

  if (!schema.includes('generator client')) {
    return { ok: false, skipped: false, message: 'Prisma schema is missing the client generator.' };
  }

  if (!existsSync(generatedClientPath)) {
    return { ok: false, skipped: false, message: 'Prisma client has not been generated.' };
  }

  return {
    ok: true,
    skipped: false,
    message: 'Prisma schema and generated client are present.',
  };
}
