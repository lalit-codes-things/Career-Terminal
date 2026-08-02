import { type CompanyIntelligenceJob, type CompanyIntelligenceWorkerDefinition, type CompanyIntelligenceWorkerRegistry } from './types';

const workerDefinitions: Record<string, CompanyIntelligenceWorkerDefinition> = {
  IMPORT: {
    type: 'IMPORT',
    description: 'Import company data',
    async run(payload) {
      return {
        jobType: 'IMPORT',
        status: 'completed',
        progress: 100,
        result: { companyId: payload.companyId ?? 'unknown' },
      };
    },
  },
  VALIDATION: {
    type: 'VALIDATION',
    description: 'Validate company data',
    async run(payload) {
      return {
        jobType: 'VALIDATION',
        status: 'completed',
        progress: 100,
        result: { companyId: payload.companyId ?? 'unknown' },
      };
    },
  },
};

export function createCompanyIntelligenceWorkerRegistry(): CompanyIntelligenceWorkerRegistry {
  const workers = new Map<string, CompanyIntelligenceWorkerDefinition>(Object.entries(workerDefinitions));

  return {
    register(definition) {
      workers.set(definition.type, definition);
    },
    get(type) {
      return workers.get(type);
    },
    async run(type, payload) {
      const worker = workers.get(type);
      if (!worker) {
        throw new Error(`Unknown company intelligence job type: ${type}`);
      }
      return worker.run(payload as CompanyIntelligenceJob);
    },
    list() {
      return Array.from(workers.values()).map((worker) => ({
        type: worker.type,
        description: worker.description,
      }));
    },
  };
}
