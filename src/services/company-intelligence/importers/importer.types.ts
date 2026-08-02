/**
 * Import pipeline types — the ingestion framework contract.
 */

import type { ImportType } from '../providers/company-provider.types';

export type ImportRunStatus = 'success' | 'partial' | 'failed' | 'skipped' | 'running';

export type { ImportType } from '../providers/company-provider.types';

export interface ImportRunOptions {
  providerKey: string;
  importType?: ImportType;
  /** Incremental cursor (ISO timestamp). */
  since?: string;
  /** Hard cap on records processed in this run. */
  limit?: number;
  /** Validate + resolve but do not persist. */
  dryRun?: boolean;
  /** Provider-specific search terms. */
  searchTerms?: string[];
  /** Provider-specific company numbers. */
  companyNumbers?: string[];
  /** Provider-specific cap on total API records fetched. */
  maxRecords?: number;
  correlationId?: string;
}

export interface ImportRunCounts {
  fetched: number;
  validated: number;
  failedValidation: number;
  created: number;
  updated: number;
  matched: number;
  errors: number;
}

export interface ImportRunResult {
  providerKey: string;
  importType: ImportType;
  runId: string;
  startedAt: string;
  completedAt: string;
  status: ImportRunStatus;
  counts: ImportRunCounts;
  error?: string;
  durationMs: number;
}

/**
 * Payload contract for future BullMQ-backed imports. The importer exposes
 * `executeImportJob` that accepts this shape so a queue worker can be wired
 * later with no changes to the pipeline.
 */
export interface ImportJobPayload {
  providerKey: string;
  importType: ImportType;
  since?: string;
  limit?: number;
  dryRun?: boolean;
  searchTerms?: string[];
  companyNumbers?: string[];
  maxRecords?: number;
  correlationId?: string;
}

export interface ImportPlan {
  providerKey: string;
  importType: ImportType;
  since?: string;
  reason: string;
  scheduled?: boolean;
  nextRunAt?: string;
}
