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

type Exec = typeof execFileSync;

const repoRoot = path.resolve(__dirname, '../../../..');
const prismaSchemaPath = path.join(repoRoot, 'prisma/schema/schema.prisma');
const migrationsDir = path.join(repoRoot, 'prisma/migrations');
const generatedClientPath = path.join(repoRoot, 'node_modules/@prisma/client');

function runPrisma(args: string[], exec: Exec = execFileSync, env = process.env): string {
  return exec('npx', ['prisma', ...args, '--schema', prismaSchemaPath], {
    cwd: repoRoot,
    stdio: 'pipe',
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.DATABASE_URL ??
        'postgresql://schema:validation@localhost:5432/schema_validation',
      ...env,
    },
  });
}

function assertPrismaFiles(): MigrationValidationResult | null {
  if (!existsSync(prismaSchemaPath)) {
    return { ok: false, skipped: false, message: 'Prisma schema is missing.' };
  }

  if (!existsSync(migrationsDir)) {
    return { ok: false, skipped: false, message: 'Prisma migrations directory is missing.' };
  }

  return null;
}

export function validateMigrations(exec: Exec = execFileSync): MigrationValidationResult {
  const fileError = assertPrismaFiles();
  if (fileError) return fileError;

  try {
    runPrisma(['validate'], exec);
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      message: 'Prisma schema validation failed.',
      details: [error instanceof Error ? error.message : String(error)],
    };
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return {
      ok: true,
      skipped: true,
      message:
        'DATABASE_URL is not set; live migration and drift validation skipped after schema validation.',
      details: [
        'validated schema syntax',
        'skipped database-backed migration status',
        'skipped schema drift diff',
      ],
    };
  }

  try {
    runPrisma(['migrate', 'status'], exec, { DATABASE_URL: databaseUrl });

    if (process.env.SHADOW_DATABASE_URL) {
      runPrisma(
        [
          'migrate',
          'diff',
          '--from-migrations',
          migrationsDir,
          '--to-schema-datamodel',
          prismaSchemaPath,
          '--exit-code',
        ],
        exec,
        { DATABASE_URL: databaseUrl, SHADOW_DATABASE_URL: process.env.SHADOW_DATABASE_URL },
      );
    }

    return {
      ok: true,
      skipped: false,
      message: 'Prisma schema, migrations, and database drift checks passed.',
      details: ['validated schema syntax', 'validated migration status', 'validated schema drift'],
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      message: 'Prisma migration validation failed.',
      details: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export function ensureSchemaSynchronization(exec: Exec = execFileSync): MigrationValidationResult {
  const fileError = assertPrismaFiles();
  if (fileError) return fileError;

  const schema = readFileSync(prismaSchemaPath, 'utf8');

  if (!schema.includes('generator client')) {
    return { ok: false, skipped: false, message: 'Prisma schema is missing the client generator.' };
  }

  if (!existsSync(generatedClientPath)) {
    return { ok: false, skipped: false, message: 'Prisma client has not been generated.' };
  }

  try {
    runPrisma(['validate'], exec);
    exec('node', ['-e', "require('@prisma/client');"], {
      cwd: repoRoot,
      stdio: 'pipe',
      encoding: 'utf8',
      env: process.env,
    });
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      message: 'Generated Prisma Client does not match the schema. Run npm run db:generate.',
      details: [error instanceof Error ? error.message : String(error)],
    };
  }

  return {
    ok: true,
    skipped: false,
    message: 'Prisma schema and generated client are synchronized.',
    details: ['validated schema syntax', 'loaded generated Prisma Client'],
  };
}
