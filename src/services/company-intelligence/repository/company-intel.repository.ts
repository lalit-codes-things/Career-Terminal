/**
 * Company Intelligence repository contract.
 *
 * Defines the persistence + lookup surface the import pipeline and entity
 * resolution depend on. The production implementation persists via Prisma;
 * an in-memory implementation is provided for dry-run mode and unit tests.
 */

import type { NormalizedCompanyData } from '../contracts';
import type { ImportType, ImportRunStatus } from '../importers/importer.types';

export interface CanonicalCompanyRecord {
  id: string;
  name: string;
  normalizedName: string;
  domain: string | null;
  countryCode: string | null;
  jurisdictionCode: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateImportRunInput {
  providerKey: string;
  importType: ImportType;
  since?: string | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ImportRunRecord {
  id: string;
  providerKey: string;
  importType: ImportType;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  recordsFetched: number;
  recordsValidated: number;
  recordsFailedValidation: number;
  companiesCreated: number;
  companiesUpdated: number;
  companiesMatched: number;
  errors: number;
  error: string | null;
}

export interface CompleteImportRunInput {
  status: ImportRunStatus;
  completedAt: Date;
  recordsFetched: number;
  recordsValidated: number;
  recordsFailedValidation: number;
  companiesCreated: number;
  companiesUpdated: number;
  companiesMatched: number;
  errors: number;
  error?: string | null;
}

export interface ProviderRecordInput {
  importRunId: string;
  canonicalCompanyId?: string | null;
  providerKey: string;
  providerRecordId: string;
  fetchedAt: string;
  checksum: string;
  rawReference?: string | null;
  status?: string;
  error?: string | null;
}

export interface ProviderMetadataInput {
  providerKey: string;
  name: string;
  version: string;
  jurisdiction?: string | null;
  enabled: boolean;
  status?: string;
  lastHealthCheckAt?: string | null;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
  lastError?: string | null;
}

export interface AuditLogInput {
  entityType: string;
  entityId: string;
  action: string;
  actor?: string;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

/** Result of entity resolution consumed by persistCompany. */
export interface ResolutionResult {
  canonicalCompanyId: string;
  created: boolean;
  updated: boolean;
  matched: boolean;
  matchedBy: string[];
}

export interface PersistCompanyResult {
  canonicalCompanyId: string;
  created: boolean;
  updated: boolean;
  matched: boolean;
  matchedBy: string[];
}

export interface CompanyIntelRepository {
  // ── Entity resolution lookups ────────────────────────────────────────────
  findCompanyByIdentifier(
    type: string,
    normalizedValue: string,
    jurisdiction?: string | null,
  ): Promise<CanonicalCompanyRecord | null>;

  findCompanyByDomain(normalizedDomain: string): Promise<CanonicalCompanyRecord | null>;

  findCompanyByNameAndJurisdiction(
    normalizedName: string,
    jurisdiction: string,
  ): Promise<CanonicalCompanyRecord | null>;

  findCompanyByWebsite(normalizedUrl: string): Promise<CanonicalCompanyRecord | null>;

  // ── Import run bookkeeping ──────────────────────────────────────────────
  createImportRun(input: CreateImportRunInput): Promise<ImportRunRecord>;
  completeImportRun(runId: string, input: CompleteImportRunInput): Promise<void>;
  upsertProviderMetadata(input: ProviderMetadataInput): Promise<void>;
  recordProviderRecord(input: ProviderRecordInput): Promise<void>;
  appendAuditLog(input: AuditLogInput): Promise<void>;

  // ── Persistence ─────────────────────────────────────────────────────────
  persistCompany(
    data: NormalizedCompanyData,
    resolution: ResolutionResult,
  ): Promise<PersistCompanyResult>;

  /** Release any underlying connections (Prisma disconnect). */
  close?(): Promise<void>;
}
