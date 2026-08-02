/**
 * In-memory implementation of CompanyIntelRepository.
 *
 * Used by the importer's dry-run mode and by unit tests. Persists nothing
 * durable — entity resolution and per-record bookkeeping behave identically
 * to the Prisma implementation so dry runs produce realistic counts.
 */

import crypto from 'node:crypto';
import type { NormalizedCompanyData } from '../contracts';
import type {
  AuditLogInput,
  CanonicalCompanyRecord,
  CompanyIntelRepository,
  CompleteImportRunInput,
  CreateImportRunInput,
  ImportRunRecord,
  PersistCompanyResult,
  ProviderMetadataInput,
  ProviderRecordInput,
  ResolutionResult,
} from './company-intel.repository';

interface StoredIdentifier {
  type: string;
  normalizedValue: string;
  jurisdiction: string | null;
  companyId: string;
}

interface StoredWebsite {
  normalizedUrl: string;
  companyId: string;
}

interface StoredAlias {
  normalizedValue: string;
  companyId: string;
}

export class InMemoryCompanyIntelRepository implements CompanyIntelRepository {
  readonly companies = new Map<string, CanonicalCompanyRecord>();
  private readonly identifiers = new Map<string, StoredIdentifier>();
  private readonly websites = new Map<string, StoredWebsite>();
  private readonly aliases = new Map<string, StoredAlias>();
  private readonly runs = new Map<string, ImportRunRecord>();
  private readonly providerRecords: ProviderRecordInput[] = [];
  private readonly auditLogs: AuditLogInput[] = [];
  private readonly providerMetadata = new Map<string, ProviderMetadataInput>();

  // ── Lookups ─────────────────────────────────────────────────────────────

  async findCompanyByIdentifier(
    type: string,
    normalizedValue: string,
    jurisdiction?: string | null,
  ): Promise<CanonicalCompanyRecord | null> {
    for (const entry of this.identifiers.values()) {
      if (
        entry.type === type &&
        entry.normalizedValue === normalizedValue &&
        (entry.jurisdiction ?? null) === (jurisdiction ?? null)
      ) {
        return this.companies.get(entry.companyId) ?? null;
      }
    }
    return null;
  }

  async findCompanyByDomain(normalizedDomain: string): Promise<CanonicalCompanyRecord | null> {
    for (const company of this.companies.values()) {
      if (company.domain === normalizedDomain) {
        return company;
      }
    }
    return null;
  }

  async findCompanyByNameAndJurisdiction(
    normalizedName: string,
    jurisdiction: string,
  ): Promise<CanonicalCompanyRecord | null> {
    for (const company of this.companies.values()) {
      if (
        company.normalizedName === normalizedName &&
        (company.jurisdictionCode ?? null) === jurisdiction
      ) {
        return company;
      }
    }
    return null;
  }

  async findCompanyByWebsite(normalizedUrl: string): Promise<CanonicalCompanyRecord | null> {
    const entry = this.websites.get(normalizedUrl);
    if (!entry) {
      return null;
    }
    return this.companies.get(entry.companyId) ?? null;
  }

  // ── Import run bookkeeping ──────────────────────────────────────────────

  async createImportRun(input: CreateImportRunInput): Promise<ImportRunRecord> {
    const record: ImportRunRecord = {
      id: crypto.randomUUID(),
      providerKey: input.providerKey,
      importType: input.importType,
      status: 'RUNNING',
      startedAt: new Date(),
      completedAt: null,
      recordsFetched: 0,
      recordsValidated: 0,
      recordsFailedValidation: 0,
      companiesCreated: 0,
      companiesUpdated: 0,
      companiesMatched: 0,
      errors: 0,
      error: null,
    };
    this.runs.set(record.id, record);
    return record;
  }

  async completeImportRun(runId: string, input: CompleteImportRunInput): Promise<void> {
    const record = this.runs.get(runId);
    if (!record) {
      throw new Error(`InMemoryCompanyIntelRepository: unknown import run ${runId}`);
    }
    Object.assign(record, {
      status: input.status.toUpperCase(),
      completedAt: input.completedAt,
      recordsFetched: input.recordsFetched,
      recordsValidated: input.recordsValidated,
      recordsFailedValidation: input.recordsFailedValidation,
      companiesCreated: input.companiesCreated,
      companiesUpdated: input.companiesUpdated,
      companiesMatched: input.companiesMatched,
      errors: input.errors,
      error: input.error ?? null,
    });
  }

  async upsertProviderMetadata(input: ProviderMetadataInput): Promise<void> {
    this.providerMetadata.set(input.providerKey, input);
  }

  async recordProviderRecord(input: ProviderRecordInput): Promise<void> {
    this.providerRecords.push(input);
  }

  async appendAuditLog(input: AuditLogInput): Promise<void> {
    this.auditLogs.push(input);
  }

  // ── Persistence ─────────────────────────────────────────────────────────

  async persistCompany(
    data: NormalizedCompanyData,
    resolution: ResolutionResult,
  ): Promise<PersistCompanyResult> {
    let existing = this.companies.get(resolution.canonicalCompanyId);
    const now = new Date();

    if (!existing) {
      existing = {
        id: resolution.canonicalCompanyId,
        name: data.name,
        normalizedName: data.normalizedName,
        domain: data.domain ?? null,
        countryCode: data.countryCode ?? null,
        jurisdictionCode: data.jurisdiction ?? null,
        status: data.status,
        createdAt: now,
        updatedAt: now,
      };
      this.companies.set(existing.id, existing);
    } else {
      existing.name = data.name;
      existing.normalizedName = data.normalizedName;
      existing.domain = data.domain ?? null;
      existing.countryCode = data.countryCode ?? null;
      existing.jurisdictionCode = data.jurisdiction ?? null;
      existing.status = data.status;
      existing.updatedAt = now;
    }

    for (const identifier of data.identifiers) {
      const jurisdiction = identifier.jurisdiction ?? data.jurisdiction ?? null;
      const key = `${identifier.type}:${identifier.normalizedValue}:${jurisdiction ?? ''}`;
      this.identifiers.set(key, {
        type: identifier.type,
        normalizedValue: identifier.normalizedValue,
        jurisdiction,
        companyId: existing.id,
      });
    }

    if (data.domain) {
      this.websites.set(data.domain, { normalizedUrl: data.domain, companyId: existing.id });
    }
    if (data.website) {
      this.websites.set(data.website, { normalizedUrl: data.website, companyId: existing.id });
    }

    for (const alias of data.aliases) {
      this.aliases.set(alias, { normalizedValue: alias, companyId: existing.id });
    }

    return {
      canonicalCompanyId: existing.id,
      created: resolution.created,
      updated: resolution.updated,
      matched: resolution.matched,
      matchedBy: resolution.matchedBy,
    };
  }

  // ── Test/dev helpers ────────────────────────────────────────────────────

  getProviderRecords(): readonly ProviderRecordInput[] {
    return this.providerRecords;
  }

  getAuditLogs(): readonly AuditLogInput[] {
    return this.auditLogs;
  }

  getImportRuns(): readonly ImportRunRecord[] {
    return [...this.runs.values()];
  }

  getProviderMetadata(): readonly ProviderMetadataInput[] {
    return [...this.providerMetadata.values()];
  }

  reset(): void {
    this.companies.clear();
    this.identifiers.clear();
    this.websites.clear();
    this.aliases.clear();
    this.runs.clear();
    this.providerRecords.length = 0;
    this.auditLogs.length = 0;
    this.providerMetadata.clear();
  }
}
