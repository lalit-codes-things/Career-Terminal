import { ensureSchemaSynchronization } from './migration-validator';

const result = ensureSchemaSynchronization();
if (!result.ok) {
  throw new Error(`${result.message} ${result.details?.join('\n') ?? ''}`.trim());
}
console.log(result.message);
