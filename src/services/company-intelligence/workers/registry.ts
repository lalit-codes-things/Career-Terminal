import { type CompanyIntelligenceJob, type CompanyIntelligenceWorkerDefinition, type CompanyIntelligenceWorkerRegistry } from './types';

function buildValidationIssues(payload: CompanyIntelligenceJob): string[] {
  const issues: string[] = [];
  const rawData = payload.metadata?.rawData as Record<string, unknown> | undefined;

  if (!rawData || typeof rawData !== 'object') {
    issues.push('missing rawData payload');
    return issues;
  }

  const name = typeof rawData.name === 'string' ? rawData.name.trim() : '';
  if (!name) {
    issues.push('missing company name');
  }

  const identifiers = Array.isArray(rawData.identifiers) ? rawData.identifiers : [];
  if (identifiers.length === 0) {
    issues.push('missing identifiers');
  }

  const invalidIdentifier = identifiers.find((item) => {
    if (!item || typeof item !== 'object') {
      return true;
    }
    const candidate = item as Record<string, unknown>;
    return typeof candidate.type !== 'string' || typeof candidate.value !== 'string' || !candidate.value.trim();
  });

  if (invalidIdentifier) {
    issues.push('invalid identifier payload');
  }

  return issues;
}

const workerDefinitions: Record<string, CompanyIntelligenceWorkerDefinition> = {
  IMPORT: {
    type: 'IMPORT',
    description: 'Import company data',
    async run(payload) {
      const companyId = payload.companyId ?? payload.metadata?.companyId ?? 'pending';
      return {
        jobType: 'IMPORT',
        status: 'completed',
        progress: 100,
        result: {
          companyId,
          correlationId: payload.correlationId ?? null,
          imported: true,
        },
      };
    },
  },
  VALIDATION: {
    type: 'VALIDATION',
    description: 'Validate company data',
    async run(payload) {
      const issues = buildValidationIssues(payload);
      if (issues.length > 0) {
        return {
          jobType: 'VALIDATION',
          status: 'failed',
          progress: 40,
          result: { correlationId: payload.correlationId ?? null },
          error: `validation failed: ${issues.join(', ')}`,
        };
      }

      return {
        jobType: 'VALIDATION',
        status: 'completed',
        progress: 100,
        result: {
          companyId: payload.companyId ?? null,
          correlationId: payload.correlationId ?? null,
          validated: true,
        },
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
