import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { NotFoundError } from '../../errors/app-errors';
import { ownershipGuard } from '../ownership/ownership.guard';
import { resolvePagination, type PaginationInput } from '../../domain/pagination';
import { userOwnershipFilter } from '../../utils/user-ownership';
import { withRlsTransaction } from '../../middleware/rls';

type DbClient = PrismaClient | Prisma.TransactionClient;

type CompanyRecord = {
  id: string;
  name: string;
  domain: string;
  careersUrl: string | null;
  website: string | null;
  logoUrl: string | null;
  industry: string | null;
  headquarters: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type CompanyWithRelations = CompanyRecord & {
  aliases: Array<{
    id: string;
    value: string;
    normalizedValue: string;
  }>;
  applications: Array<{
    id: string;
    userId: string;
    appliedDate: Date;
    status: string;
    roleTitle: string;
    companyName: string;
    recruiterName: string;
    recruiterEmail: string;
  }>;
  recruiters: Array<{
    id: string;
  }>;
};

export interface CompanyResolveInput {
  readonly name: string;
  readonly domain: string;
  readonly careersUrl?: string | null;
  readonly website?: string | null;
  readonly logoUrl?: string | null;
  readonly industry?: string | null;
  readonly headquarters?: string | null;
  readonly aliases?: readonly string[];
}

export interface CompanyListFilters {
  readonly name?: string;
  readonly domain?: string;
  readonly industry?: string;
}

export interface CompanyListItem {
  readonly id: string;
  readonly name: string;
  readonly domain: string;
  readonly careersUrl: string | null;
  readonly website: string | null;
  readonly logoUrl: string | null;
  readonly industry: string | null;
  readonly headquarters: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly applicationCount: number;
  readonly recruiterCount: number;
  readonly lastApplicationAt: string | null;
}

export interface CompanyDetails extends CompanyListItem {
  readonly aliases: readonly string[];
}

export interface CompanyApplicationListItem {
  readonly id: string;
  readonly userId: string;
  readonly appliedDate: string;
  readonly status: string;
  readonly roleTitle: string | null;
  readonly companyName: string | null;
  readonly recruiterName: string;
  readonly recruiterEmail: string;
}

const LEGAL_SUFFIXES = [
  'inc',
  'incorporated',
  'llc',
  'l.l.c',
  'ltd',
  'limited',
  'corp',
  'corporation',
  'co',
  'company',
  'plc',
  'gmbh',
  'sarl',
  'pte',
  'sa',
  'ag',
  'bv',
];

const CANONICAL_ALIAS_OVERRIDES: Record<string, string> = {
  facebook: 'Meta',
  'facebook.com': 'Meta',
  'facebook inc': 'Meta',
  'facebook llc': 'Meta',
  fb: 'Meta',
  'meta platforms': 'Meta',
  'meta platforms inc': 'Meta',
  'google llc': 'Google',
  'google inc': 'Google',
  'google incorporated': 'Google',
};

export class CompanyService {
  public async resolveCompany(
    input: CompanyResolveInput,
    db: DbClient = prisma,
  ): Promise<CompanyRecord> {
    const canonicalName = this.resolveCanonicalName(input.name, input.domain);
    const aliasValues = this.buildAliasValues(
      input.name,
      input.domain,
      canonicalName,
      input.aliases,
    );
    const normalizedAliases = aliasValues
      .map((value) => this.normalizeAlias(value))
      .filter(Boolean);

    const aliasMatch =
      normalizedAliases.length > 0
        ? await db.companyAlias.findFirst({
            where: {
              normalizedValue: { in: normalizedAliases },
            },
            include: { company: true },
          })
        : null;

    const domainMatch = await db.company.findUnique({
      where: { domain: input.domain },
    });

    const existingCompany = aliasMatch?.company ?? domainMatch ?? null;

    if (existingCompany) {
      const updated = await db.company.update({
        where: { id: existingCompany.id },
        data: {
          name: canonicalName || existingCompany.name,
          careersUrl: input.careersUrl ?? undefined,
          website: input.website ?? undefined,
          logoUrl: input.logoUrl ?? undefined,
          industry: input.industry ?? undefined,
          headquarters: input.headquarters ?? undefined,
        },
      });

      await this.upsertAliases(updated.id, aliasValues, db);
      return updated;
    }

    const created = await db.company.create({
      data: {
        name: canonicalName,
        domain: input.domain,
        careersUrl: input.careersUrl ?? null,
        website: input.website ?? null,
        logoUrl: input.logoUrl ?? null,
        industry: input.industry ?? null,
        headquarters: input.headquarters ?? null,
      },
    });

    await this.upsertAliases(created.id, aliasValues, db);
    return created;
  }

  public async listCompanies(
    userId: string,
    filters: CompanyListFilters = {},
    pagination?: PaginationInput,
  ): Promise<readonly CompanyListItem[]> {
    const paging = resolvePagination(pagination);
    const companies = (await withRlsTransaction(prisma, userId, async (tx) => {
      return tx.company.findMany({
        where: {
          ...(filters.name
            ? { name: { contains: filters.name, mode: Prisma.QueryMode.insensitive } }
            : {}),
          ...(filters.domain
            ? { domain: { contains: filters.domain, mode: Prisma.QueryMode.insensitive } }
            : {}),
          ...(filters.industry
            ? { industry: { contains: filters.industry, mode: Prisma.QueryMode.insensitive } }
            : {}),
          applications: {
            some: userOwnershipFilter(userId),
          },
        },
        include: {
          applications: {
            where: userOwnershipFilter(userId),
            select: {
              id: true,
              appliedDate: true,
            },
          },
          recruiters: {
            where: {
              applications: {
                some: userOwnershipFilter(userId),
              },
            },
            select: { id: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
        ...(paging ? { skip: paging.skip, take: paging.take } : {}),
      });
    })) as CompanyWithRelations[];

    return companies.map((company) => this.mapListItem(company));
  }

  public async getCompany(userId: string, companyId: string): Promise<CompanyDetails> {
    const company = await withRlsTransaction(prisma, userId, async (tx) => {
      await ownershipGuard.ensureCompanyAccess(userId, companyId, tx);

      return tx.company.findFirst({
        where: {
          id: companyId,
        },
        include: {
          aliases: true,
          applications: {
            where: userOwnershipFilter(userId),
            select: {
              id: true,
              appliedDate: true,
            },
          },
          recruiters: {
            where: {
              applications: {
                some: userOwnershipFilter(userId),
              },
            },
            select: { id: true },
          },
        },
      });
    });

    const wrappedCompany = company as CompanyWithRelations | null;
    if (!wrappedCompany) {
      throw new NotFoundError('Company', companyId);
    }

    const base = this.mapListItem(wrappedCompany);
    return {
      ...base,
      aliases: wrappedCompany.aliases.map((alias) => alias.value),
    };
  }

  public async getCompanyApplications(
    userId: string,
    companyId: string,
    pagination?: PaginationInput,
  ): Promise<readonly CompanyApplicationListItem[]> {
    const paging = resolvePagination(pagination);

    const applications = await withRlsTransaction(prisma, userId, async (tx) => {
      await ownershipGuard.ensureCompanyAccess(userId, companyId, tx);
      return tx.jobApplication.findMany({
        where: {
          ...userOwnershipFilter(userId),
          companyId,
        },
        orderBy: { appliedDate: 'desc' },
        ...(paging ? { skip: paging.skip, take: paging.take } : {}),
        select: {
          id: true,
          userId: true,
          legacyUserId: true,
          appliedDate: true,
          status: true,
          roleTitle: true,
          companyName: true,
          recruiterName: true,
          recruiterEmail: true,
        },
      });
    });

    return applications.map((application) => ({
      id: application.id,
      userId: application.userId ?? application.legacyUserId,
      appliedDate: application.appliedDate?.toISOString() ?? '',
      status: application.status,
      roleTitle: application.roleTitle,
      companyName: application.companyName ?? '',
      recruiterName: application.recruiterName ?? '',
      recruiterEmail: application.recruiterEmail ?? '',
    }));
  }

  public async linkApplicationToCompany(
    applicationId: string,
    companyInput: CompanyResolveInput,
    db: DbClient = prisma,
    userId?: string,
  ): Promise<CompanyRecord> {
    if (userId) {
      await ownershipGuard.ensureApplicationAccess(userId, applicationId, db);
    }

    const company = await this.resolveCompany(companyInput, db);
    await db.jobApplication.update({
      where: { id: applicationId },
      data: {
        companyId: company.id,
        companyName: company.name,
        companyDomain: company.domain,
      },
    });

    return company;
  }

  private async upsertAliases(
    companyId: string,
    aliasValues: readonly string[],
    db: DbClient,
  ): Promise<void> {
    const uniqueValues = new Map<string, string>();

    for (const value of aliasValues) {
      const normalized = this.normalizeAlias(value);
      if (!normalized) {
        continue;
      }
      if (!uniqueValues.has(normalized)) {
        uniqueValues.set(normalized, value.trim());
      }
    }

    for (const [normalizedValue, value] of uniqueValues.entries()) {
      await db.companyAlias.upsert({
        where: { normalizedValue },
        create: {
          companyId,
          value,
          normalizedValue,
        },
        update: {
          companyId,
          value,
        },
      });
    }
  }

  private mapListItem(company: CompanyWithRelations): CompanyListItem {
    return {
      id: company.id,
      name: company.name,
      domain: company.domain,
      careersUrl: company.careersUrl,
      website: company.website,
      logoUrl: company.logoUrl,
      industry: company.industry,
      headquarters: company.headquarters,
      createdAt: company.createdAt.toISOString(),
      updatedAt: company.updatedAt.toISOString(),
      applicationCount: company.applications.length,
      recruiterCount: company.recruiters.length,
      lastApplicationAt:
        company.applications.length > 0
          ? new Date(
              Math.max(
                ...company.applications.map((application) => application.appliedDate.getTime()),
              ),
            ).toISOString()
          : null,
    };
  }

  private buildAliasValues(
    name: string,
    domain: string,
    canonicalName: string,
    aliases?: readonly string[],
  ): string[] {
    const domainLabel = this.extractDomainLabel(domain);
    return [
      name,
      canonicalName,
      domain,
      domainLabel,
      ...(aliases ?? []),
      ...this.lookupCanonicalAliasVariants(canonicalName),
    ].filter((value): value is string => Boolean(value && value.trim().length > 0));
  }

  private lookupCanonicalAliasVariants(canonicalName: string): string[] {
    const normalizedCanonical = this.normalizeAlias(canonicalName);
    const variants = Object.entries(CANONICAL_ALIAS_OVERRIDES)
      .filter(([, canonical]) => this.normalizeAlias(canonical) === normalizedCanonical)
      .map(([alias]) => alias);

    return variants;
  }

  private resolveCanonicalName(name: string, domain: string): string {
    const normalizedName = this.normalizeAlias(name);
    const normalizedDomain = this.normalizeAlias(domain);
    const domainLabel = this.normalizeAlias(this.extractDomainLabel(domain));
    const override =
      CANONICAL_ALIAS_OVERRIDES[normalizedName] ??
      CANONICAL_ALIAS_OVERRIDES[normalizedDomain] ??
      (domainLabel ? CANONICAL_ALIAS_OVERRIDES[domainLabel] : undefined);

    if (override) {
      return override;
    }

    return this.titleCase(this.stripLegalSuffixes(name) || this.extractDomainLabel(domain) || name);
  }

  private stripLegalSuffixes(value: string): string {
    const parts = value.trim().split(/\s+/).filter(Boolean);

    while (parts.length > 0) {
      const last = this.normalizeCompanyToken(parts[parts.length - 1] ?? '');
      if (!LEGAL_SUFFIXES.includes(last)) {
        break;
      }
      parts.pop();
    }

    return parts.join(' ').trim();
  }

  private extractDomainLabel(domain: string): string {
    const parts = domain.toLowerCase().split('.').filter(Boolean);
    if (parts.length < 2) {
      return domain;
    }

    return parts[parts.length - 2] ?? domain;
  }

  private normalizeAlias(value: string): string {
    return value
      .toLowerCase()
      .replace(/https?:\/\//g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(
        /\b(incorporated|inc|llc|ltd|limited|corp|corporation|company|co|plc|gmbh|sarl|pte|sa|ag|bv)\b/g,
        ' ',
      )
      .replace(/\s+/g, ' ')
      .trim();
  }

  private titleCase(value: string): string {
    return value
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  }

  private normalizeCompanyToken(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, '')
      .replace(/\./g, '');
  }
}

export const companyService = new CompanyService();
