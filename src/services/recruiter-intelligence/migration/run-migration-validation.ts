import { validateMigrations } from './migration-validator';

const result = validateMigrations();
if (!result.ok) {
  throw new Error(result.message);
}
console.log(result.message);
