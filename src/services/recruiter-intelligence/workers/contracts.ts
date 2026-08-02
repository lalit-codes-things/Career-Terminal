export type RecruiterIntelligenceWorkerName =
  | 'identity-resolution'
  | 'communication-ingestion'
  | 'relationship-scoring'
  | 'memory-refresh'
  | 'graph-reindex'
  | 'embedding-generation';

export interface RecruiterIntelligenceWorkerEnvelope {
  jobName: RecruiterIntelligenceWorkerName;
  correlationId?: string;
  payload: Record<string, unknown>;
}

export interface RecruiterIntelligenceWorker {
  execute(envelope: RecruiterIntelligenceWorkerEnvelope): Promise<void>;
}
