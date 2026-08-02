/**
 * Prisma-backed implementation of CompanyIntelRepository.
 *
 * Uses the app's configured Prisma client (via DatabaseRouter) for read/write
 * splitting. All persistence of a single company happens inside one
 * transaction so partial imports never leave dangling sub-records.
 *
 * The import pipeline depends only on the `CompanyIntelRepository` interface;
 * swap in `InMemoryCompanyIntelRepository` for dry-run and tests.
 */

import {
  CompanyImportRunStatus,
  CompanyLifecycleStatus,
  Prisma,
  type PrismaClient,
} from '@prisma/client';
import type { DatabaseRouter } from '../../../db/database-router';
import { logger } from '../../../lib/logger';
import type { NormalizedCompanyData, CompanyStatus } from '../contracts';
import type { ImportRunStatus } from '../importers/importer.types';
import { normalizeCompanyName } from '../normalization';
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

// ── Enum mappings ─────────────────────────────────────────────────────────

const LIFECYCLE_STATUS_TO_ENUM: Record<CompanyStatus, CompanyLifecycleStatus> = {
  active: CompanyLifecycleStatus.ACTIVE,
  inactive: CompanyLifecycleStatus.INACTIVE,
  dissolved: CompanyLifecycleStatus.DISSOLVED,
  dormant: CompanyLifecycleStatus.DORMANT,
  liquidated: CompanyLifecycleStatus.LIQUIDATED,
  unknown: CompanyLifecycleStatus.UNKNOWN,
};

const RUN_STATUS_TO_ENUM: Record<ImportRunStatus, CompanyImportRunStatus> = {
  success: CompanyImportRunStatus.SUCCESS,
  partial: CompanyImportRunStatus.PARTIAL,
  failed: CompanyImportRunStatus.FAILED,
  skipped: CompanyImportRunStatus.SKIPPED,
  running: CompanyImportRunStatus.RUNNING,
};

// ── Repository ────────────────────────────────────────────────────────────

export class PrismaCompanyIntelRepository implements CompanyIntelRepository {
  private readonly master: PrismaClient;
  private readonly reader: PrismaClient;

  constructor(router: Pick<DatabaseRouter, 'read' | 'write'>, options?: { readWrite?: boolean }) {
    this.master = router.write();
    this.reader = options?.readWrite === false ? router.write() : router.read();
  }

  // ── Lookups ─────────────────────────────────────────────────────────────

  async findCompanyByIdentifier(
    type: string,
    normalizedValue: string,
    jurisdiction?: string | null,
  ): Promise<CanonicalCompanyRecord | null> {
    const identifier = await this.reader.companyIdentifier.findFirst({
      where: {
        type,
        normalizedValue,
        jurisdictionCode: jurisdiction ?? null,
      },
      include: { canonicalCompany: true },
    });
    return identifier ? this.toRecord(identifier.canonicalCompany) : null;
  }

  async findCompanyByDomain(normalizedDomain: string): Promise<CanonicalCompanyRecord | null> {
    const company = await this.reader.canonicalCompany.findFirst({
      where: { domain: normalizedDomain },
    });
    return company ? this.toRecord(company) : null;
  }

  async findCompanyByNameAndJurisdiction(
    normalizedName: string,
    jurisdiction: string,
  ): Promise<CanonicalCompanyRecord | null> {
    const company = await this.reader.canonicalCompany.findFirst({
      where: { normalizedName, jurisdictionCode: jurisdiction },
    });
    return company ? this.toRecord(company) : null;
  }

  async findCompanyByWebsite(normalizedUrl: string): Promise<CanonicalCompanyRecord | null> {
    const website = await this.reader.companyWebsite.findFirst({
      where: { normalizedUrl },
      include: { canonicalCompany: true },
    });
    return website ? this.toRecord(website.canonicalCompany) : null;
  }

  // ── Import run bookkeeping ──────────────────────────────────────────────

  async createImportRun(input: CreateImportRunInput): Promise<ImportRunRecord> {
    const provider = await this.upsertProvider({
      providerKey: input.providerKey,
      name: input.providerKey,
      version: '1.0.0',
      enabled: true,
    });

    const run = await this.master.companyImportRun.create({
      data: {
        providerId: provider.id,
        providerKey: input.providerKey,
        importType: input.importType,
        status: CompanyImportRunStatus.RUNNING,
        startedAt: new Date(),
        since: input.since ? new Date(input.since) : null,
        correlationId: input.correlationId ?? null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    return {
      id: run.id,
      providerKey: run.providerKey,
      importType: run.importType,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      recordsFetched: run.recordsFetched,
      recordsValidated: run.recordsValidated,
      recordsFailedValidation: run.recordsFailedValidation,
      companiesCreated: run.companiesCreated,
      companiesUpdated: run.companiesUpdated,
      companiesMatched: run.companiesMatched,
      errors: run.errors,
      error: run.error,
    };
  }

  async completeImportRun(runId: string, input: CompleteImportRunInput): Promise<void> {
    await this.master.companyImportRun.update({
      where: { id: runId },
      data: {
        status: RUN_STATUS_TO_ENUM[input.status],
        completedAt: input.completedAt,
        recordsFetched: input.recordsFetched,
        recordsValidated: input.recordsValidated,
        recordsFailedValidation: input.recordsFailedValidation,
        companiesCreated: input.companiesCreated,
        companiesUpdated: input.companiesUpdated,
        companiesMatched: input.companiesMatched,
        errors: input.errors,
        error: input.error ?? null,
      },
    });
  }

  async upsertProviderMetadata(input: ProviderMetadataInput): Promise<void> {
    await this.upsertProvider(input);
  }

  async recordProviderRecord(input: ProviderRecordInput): Promise<void> {
    await this.master.companyProviderRecord.upsert({
      where: {
        company_provider_record_unique: {
          providerKey: input.providerKey,
          providerRecordId: input.providerRecordId,
        },
      },
      create: {
        importRunId: input.importRunId,
        canonicalCompanyId: input.canonicalCompanyId ?? null,
        providerKey: input.providerKey,
        providerRecordId: input.providerRecordId,
        fetchedAt: new Date(input.fetchedAt),
        checksum: input.checksum,
        rawReference: input.rawReference ?? null,
        status: input.status ?? 'processed',
        error: input.error ?? null,
      },
      update: {
        canonicalCompanyId: input.canonicalCompanyId ?? null,
        status: input.status ?? 'processed',
        error: input.error ?? null,
      },
    });
  }

  async appendAuditLog(input: AuditLogInput): Promise<void> {
    await this.master.companyAuditLog.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        actor: input.actor ?? 'system',
        beforeData: (input.beforeData ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        afterData: (input.afterData ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  // ── Persistence ─────────────────────────────────────────────────────────

  async persistCompany(
    data: NormalizedCompanyData,
    resolution: ResolutionResult,
  ): Promise<PersistCompanyResult> {
    await this.master.$transaction(async (tx) => {
      const companyId = resolution.canonicalCompanyId;
      const lifecycleStatus = LIFECYCLE_STATUS_TO_ENUM[data.status] ?? CompanyLifecycleStatus.UNKNOWN;

      if (resolution.created) {
        await tx.canonicalCompany.create({
          data: {
            id: companyId,
            name: data.name,
            legalName: data.legalName ?? null,
            normalizedName: data.normalizedName,
            domain: data.domain ?? null,
            countryCode: data.countryCode ?? null,
            jurisdictionCode: data.jurisdiction ?? null,
            status: lifecycleStatus,
            foundedDate: this.toDate(data.foundedDate),
            incorporatedDate: this.toDate(data.incorporatedDate),
            description: data.description ?? null,
            validFrom: this.toDate(data.validFrom),
            validTo: this.toDate(data.validTo),
          },
        });
      } else {
        await tx.canonicalCompany.update({
          where: { id: companyId },
          data: {
            name: data.name,
            legalName: data.legalName ?? null,
            normalizedName: data.normalizedName,
            domain: data.domain ?? null,
            countryCode: data.countryCode ?? null,
            jurisdictionCode: data.jurisdiction ?? null,
            status: lifecycleStatus,
            foundedDate: this.toDate(data.foundedDate),
            incorporatedDate: this.toDate(data.incorporatedDate),
            description: data.description ?? null,
            validFrom: this.toDate(data.validFrom),
            validTo: this.toDate(data.validTo),
          },
        });
      }

      await this.persistAliases(tx, companyId, data.aliases);
      await this.persistIdentifiers(tx, companyId, data);
      await this.persistWebsites(tx, companyId, data);
      await this.persistAddresses(tx, companyId, data.addresses);
      await this.persistClassifications(tx, companyId, data);
      await this.persistListings(tx, companyId, data);
    });

    logger.debug('[CompanyIntel] persisted company', {
      companyId: resolution.canonicalCompanyId,
      created: resolution.created,
      providerKey: data.providerKey,
      providerRecordId: data.providerRecordId,
    });

    return {
      canonicalCompanyId: resolution.canonicalCompanyId,
      created: resolution.created,
      updated: resolution.updated,
      matched: resolution.matched,
      matchedBy: resolution.matchedBy,
    };
  }

  async close(): Promise<void> {
    // The shared Prisma clients are owned by the app (see src/config/database.ts)
    // and must not be disconnected here.
  }

  // ── Sub-record persistence (called inside a transaction) ────────────────

  private async persistAliases(
    tx: Prisma.TransactionClient,
    companyId: string,
    aliases: string[],
  ): Promise<void> {
    for (const alias of aliases) {
      const normalizedValue = normalizeCompanyName(alias) ?? alias;
      await tx.canonicalCompanyAlias.upsert({
        where: {
          canonical_company_alias_company_value_unique: {
            canonicalCompanyId: companyId,
            normalizedValue,
          },
        },
        create: { canonicalCompanyId: companyId, value: alias, normalizedValue },
        update: { value: alias },
      });
    }
  }

  private async persistIdentifiers(
    tx: Prisma.TransactionClient,
    companyId: string,
    data: NormalizedCompanyData,
  ): Promise<void> {
    for (const identifier of data.identifiers) {
      // The unique key includes a nullable jurisdictionCode, which Prisma does
      // not accept in `upsert.where`. Resolve via findFirst to stay type-safe.
      const where = {
        canonicalCompanyId: companyId,
        type: identifier.type,
        normalizedValue: identifier.normalizedValue,
        jurisdictionCode: identifier.jurisdiction ?? data.jurisdiction ?? null,
      };
      const existing = await tx.companyIdentifier.findFirst({ where });

      const values = {
        value: identifier.value,
        normalizedValue: identifier.normalizedValue,
        jurisdictionCode: identifier.jurisdiction ?? data.jurisdiction ?? null,
        registrar: identifier.registrar ?? null,
        validFrom: this.toDate(identifier.validFrom),
        validTo: this.toDate(identifier.validTo),
      };

      if (existing) {
        await tx.companyIdentifier.update({
          where: { id: existing.id },
          data: {
            value: values.value,
            registrar: values.registrar,
            validFrom: values.validFrom,
            validTo: values.validTo,
          },
        });
      } else {
        await tx.companyIdentifier.create({
          data: { canonicalCompanyId: companyId, type: identifier.type, ...values },
        });
      }
    }
  }

  private async persistWebsites(
    tx: Prisma.TransactionClient,
    companyId: string,
    data: NormalizedCompanyData,
  ): Promise<void> {
    const seen = new Map<string, NormalizedCompanyData['websites'][number]>();
    if (data.website) {
      seen.set(data.website, { url: data.website, kind: 'primary' });
    }
    for (const website of data.websites) {
      seen.set(website.url, website);
    }

    for (const website of seen.values()) {
      const normalizedUrl = this.normalizeWebsiteUrl(website.url) ?? website.url;
      await tx.companyWebsite.upsert({
        where: {
          company_website_company_url_unique: {
            canonicalCompanyId: companyId,
            normalizedUrl,
          },
        },
        create: {
          canonicalCompanyId: companyId,
          url: website.url,
          normalizedUrl,
          kind: website.kind ?? 'primary',
          isVerified: website.isVerified ?? false,
          validFrom: this.toDate(website.validFrom),
          validTo: this.toDate(website.validTo),
        },
        update: {
          url: website.url,
          kind: website.kind ?? 'primary',
          isVerified: website.isVerified ?? false,
        },
      });
    }
  }

  private async persistAddresses(
    tx: Prisma.TransactionClient,
    companyId: string,
    addresses: NormalizedCompanyData['addresses'],
  ): Promise<void> {
    if (addresses.length === 0) {
      return;
    }
    await tx.companyAddress.deleteMany({ where: { canonicalCompanyId: companyId } });
    await tx.companyAddress.createMany({
      data: addresses.map((address) => ({
        canonicalCompanyId: companyId,
        addressType: address.type ?? 'registered',
        addressLines: address.addressLines ?? [],
        locality: address.locality ?? null,
        region: address.region ?? null,
        postalCode: address.postalCode ?? null,
        countryCode: address.countryCode ?? null,
        latitude: address.latitude != null ? new Prisma.Decimal(String(address.latitude)) : null,
        longitude: address.longitude != null ? new Prisma.Decimal(String(address.longitude)) : null,
        validFrom: this.toDate(address.validFrom),
        validTo: this.toDate(address.validTo),
      })),
    });
  }

  private async persistClassifications(
    tx: Prisma.TransactionClient,
    companyId: string,
    data: NormalizedCompanyData,
  ): Promise<void> {
    for (const classification of data.industryClassifications) {
      await tx.companyIndustryClassification.upsert({
        where: {
          company_industry_unique: {
            canonicalCompanyId: companyId,
            classificationSystem: classification.system,
            code: classification.code,
          },
        },
        create: {
          canonicalCompanyId: companyId,
          classificationSystem: classification.system,
          code: classification.code,
          label: classification.label ?? null,
          isPrimary: classification.isPrimary ?? false,
          validFrom: this.toDate(classification.validFrom),
          validTo: this.toDate(classification.validTo),
        },
        update: {
          label: classification.label ?? null,
          isPrimary: classification.isPrimary ?? false,
        },
      });
    }
  }

  private async persistListings(
    tx: Prisma.TransactionClient,
    companyId: string,
    data: NormalizedCompanyData,
  ): Promise<void> {
    for (const listing of data.exchangeListings) {
      await tx.companyExchangeListing.upsert({
        where: {
          company_listing_unique: {
            canonicalCompanyId: companyId,
            exchange: listing.exchange,
            ticker: listing.ticker,
          },
        },
        create: {
          canonicalCompanyId: companyId,
          exchange: listing.exchange,
          ticker: listing.ticker,
          currency: listing.currency ?? null,
          isPrimary: listing.isPrimary ?? false,
          listingStatus: listing.listingStatus ?? 'listed',
          validFrom: this.toDate(listing.validFrom),
          validTo: this.toDate(listing.validTo),
        },
        update: {
          currency: listing.currency ?? null,
          isPrimary: listing.isPrimary ?? false,
          listingStatus: listing.listingStatus ?? 'listed',
        },
      });
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private async upsertProvider(input: ProviderMetadataInput) {
    return this.master.companyProvider.upsert({
      where: { providerKey: input.providerKey },
      create: {
        providerKey: input.providerKey,
        name: input.name,
        version: input.version,
        jurisdiction: input.jurisdiction ?? null,
        enabled: input.enabled,
        status: input.status ?? 'unknown',
        lastHealthCheckAt: input.lastHealthCheckAt ? new Date(input.lastHealthCheckAt) : null,
        lastRunAt: input.lastRunAt ? new Date(input.lastRunAt) : null,
        lastRunStatus: input.lastRunStatus ?? null,
        lastError: input.lastError ?? null,
      },
      update: {
        name: input.name,
        version: input.version,
        jurisdiction: input.jurisdiction ?? null,
        enabled: input.enabled,
        status: input.status ?? 'unknown',
        lastHealthCheckAt: input.lastHealthCheckAt ? new Date(input.lastHealthCheckAt) : null,
        lastRunAt: input.lastRunAt ? new Date(input.lastRunAt) : null,
        lastRunStatus: input.lastRunStatus ?? null,
        lastError: input.lastError ?? null,
      },
    });
  }

  private toRecord(
    company: {
      id: string;
      name: string;
      normalizedName: string;
      domain: string | null;
      countryCode: string | null;
      jurisdictionCode: string | null;
      status: string;
      createdAt: Date;
      updatedAt: Date;
    },
  ): CanonicalCompanyRecord {
    return {
      id: company.id,
      name: company.name,
      normalizedName: company.normalizedName,
      domain: company.domain,
      countryCode: company.countryCode,
      jurisdictionCode: company.jurisdictionCode,
      status: company.status,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
    };
  }

  private toDate(value?: string | null): Date | null {
    if (!value) {
      return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private normalizeWebsiteUrl(value: string): string | null {
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol)) {
        return null;
      }
      url.hash = '';
      url.search = '';
      url.pathname = url.pathname.replace(/\/+$/, '');
      url.pathname = url.pathname.toLowerCase();
      return url.toString();
    } catch {
      return null;
    }
  }
}

/** Builds a repository from the app's DatabaseRouter. */
export const createCompanyIntelRepository = (router: DatabaseRouter): PrismaCompanyIntelRepository =>
  new PrismaCompanyIntelRepository(router);
