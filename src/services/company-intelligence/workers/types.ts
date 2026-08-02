export type CompanyIntelligenceJobType = 'REGISTER' | 'IMPORT' | 'VALIDATION' | 'NORMALIZATION' | 'ENTITY_RESOLUTION' | 'ENRICHMENT' | 'HEALTH_CALCULATION' | 'TIMELINE_UPDATE' | 'FUTURE';

export interface CompanyIntelligenceJob {
  companyId?: string;
  providerKey?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export interface CompanyIntelligenceJobResult {
  jobType: CompanyIntelligenceJobType;
  status: 'completed' | 'failed' | 'skipped';
  progress: number;
  result?: Record<string, unknown>;
  error?: string;
}

export interface CompanyIntelligenceWorkerDefinition {
  type: CompanyIntelligenceJobType;
  description: string;
  run(payload: CompanyIntelligenceJob): Promise<CompanyIntelligenceJobResult>;
}

export interface CompanyIntelligenceWorkerRegistry {
  register(definition: CompanyIntelligenceWorkerDefinition): void;
  get(type: CompanyIntelligenceJobType): CompanyIntelligenceWorkerDefinition | undefined;
  run(type: CompanyIntelligenceJobType, payload: CompanyIntelligenceJob): Promise<CompanyIntelligenceJobResult>;
  list(): Array<{ type: CompanyIntelligenceJobType; description: string }>;
}
