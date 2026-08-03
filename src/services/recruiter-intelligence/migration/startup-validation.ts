import { execFileSync } from 'child_process';
import { validateMigrations, ensureSchemaSynchronization } from './migration-validator';

export function runStartupValidation(exec: typeof execFileSync = execFileSync): void {
  const migrationResult = validateMigrations(exec);
  const syncResult = ensureSchemaSynchronization(exec);

  if (!migrationResult.ok && !migrationResult.skipped) {
    throw new Error(
      `${migrationResult.message} ${migrationResult.details?.join('\n') ?? ''}`.trim(),
    );
  }

  if (!syncResult.ok) {
    throw new Error(`${syncResult.message} ${syncResult.details?.join('\n') ?? ''}`.trim());
  }
}
