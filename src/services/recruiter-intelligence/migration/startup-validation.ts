import { validateMigrations, ensureSchemaSynchronization } from './migration-validator';

export function runStartupValidation(): void {
  const migrationResult = validateMigrations();
  const syncResult = ensureSchemaSynchronization();

  if (!migrationResult.ok && !migrationResult.skipped) {
    throw new Error(migrationResult.message);
  }

  if (!syncResult.ok) {
    throw new Error(syncResult.message);
  }
}
