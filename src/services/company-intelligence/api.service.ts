import { prisma } from '../../config/database';
import { Prisma } from '@prisma/client';
import { companyIntelligenceService } from './company-intelligence.service';

export interface ApiResponse<T> {
  data: T;
  metadata: Record<string, unknown>;
  provenance: string[];
  version: string;
  timestamp: Date;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export interface SearchFilters {
  countryCode?: string;
  jurisdictionCode?: string;
  status?: string;
}

export interface SearchOptions {
  page?: number;
  limit?: number;
  sort?: string;
  filter?: SearchFilters;
}

const SYSTEM_USER_ID = 'system';

export class CompanyIntelligenceApiService {
  private wrapResponse<T>(data: T, provenance: string[] = [], metadata: Record<string, unknown> = {}): ApiResponse<T> {
    return {
      data,
      metadata: {
        requestId: `req-${Date.now()}`,
        ...metadata,
      },
      provenance: [...new Set(['company-intelligence-api', ...provenance])],
      version: '1.0.0',
      timestamp: new Date(),
    };
  }

  private wrapPaginatedResponse<T>(data: T, provenance: string[] = [], options: SearchOptions = {}): ApiResponse<T> {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.max(1, options.limit ?? 20);
    const count = data instanceof Array ? data.length : 1;
    const totalPages = Math.max(Math.ceil(count / limit), 1);
    return {
      ...this.wrapResponse(data, provenance, {
        page,
        sort: options.sort ?? 'relevance:desc',
        filter: options.filter ?? {},
      }),
      pagination: {
        page,
        limit,
        total: count,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  async lookup(id: string): Promise<ApiResponse<unknown>> {
    const company = await prisma.company.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        domain: true,
        industry: true,
        headquarters: true,
        website: true,
      },
    });

    if (!company) {
      return this.wrapResponse({ id, found: false }, ['not-found']);
    }

    return this.wrapResponse({
      id: company.id,
      name: company.name,
      normalizedName: company.name.toLowerCase(),
      domain: company.domain,
      industry: company.industry,
      headquarters: company.headquarters,
      website: company.website,
    }, ['database']);
  }

  async search(query: string, options: SearchOptions = {}): Promise<ApiResponse<unknown[]>> {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.max(1, options.limit ?? 20);
    const skip = (page - 1) * limit;

    const where: Prisma.CompanyWhereInput = query
      ? { OR: [{ name: { contains: query, mode: 'insensitive' } }, { domain: { contains: query, mode: 'insensitive' } }] }
      : {};

    const rows = await prisma.company.findMany({ where, skip, take: limit, select: { id: true, name: true, domain: true } });

    const data = rows.map((row) => ({
      id: row.id,
      name: row.name,
      normalizedName: row.name.toLowerCase(),
      domain: row.domain,
    }));

    return this.wrapPaginatedResponse(data, ['database'], { ...options, page, limit });
  }

  async bulkLookup(ids: string[]): Promise<ApiResponse<unknown[]>> {
    const rows = ids.length
      ? await prisma.company.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, domain: true },
        })
      : [];

    const byId = new Map(rows.map((r) => [r.id, r]));
    const data = ids.map((requestedId) => ({
      requestedId,
      found: byId.has(requestedId),
      company: byId.has(requestedId)
        ? { id: requestedId, name: byId.get(requestedId)!.name, domain: byId.get(requestedId)!.domain }
        : null,
    }));

    return this.wrapResponse(data, ['bulk-lookup'], { requestId: `bulk-${Date.now()}` });
  }

  async getIdentifiers(id: string): Promise<ApiResponse<unknown[]>> {
    const canonical = await prisma.canonicalCompany.findUnique({
      where: { companyId: id },
      select: { id: true },
    });
    if (!canonical) return this.wrapResponse([], ['not-found']);

    const identifiers = await prisma.companyIdentifier.findMany({
      where: { canonicalCompanyId: canonical.id },
      select: { id: true, type: true, value: true, normalizedValue: true, jurisdictionCode: true, registrar: true },
    });

    return this.wrapResponse(identifiers, ['database']);
  }

  async getRelationships(_id: string): Promise<ApiResponse<unknown[]>> {
    return this.wrapResponse([], ['no-relationships']);
  }

  async getLocations(id: string): Promise<ApiResponse<unknown[]>> {
    const canonical = await prisma.canonicalCompany.findUnique({
      where: { companyId: id },
      select: { id: true },
    });
    if (!canonical) return this.wrapResponse([], ['not-found']);

    const addresses = await prisma.companyAddress.findMany({
      where: { canonicalCompanyId: canonical.id },
      select: { id: true, addressType: true, addressLines: true, locality: true, region: true, postalCode: true, countryCode: true, latitude: true, longitude: true },
    });

    return this.wrapResponse(addresses, ['database']);
  }

  async getClassification(id: string): Promise<ApiResponse<unknown[]>> {
    const canonical = await prisma.canonicalCompany.findUnique({
      where: { companyId: id },
      select: { id: true, industryClassifications: true },
    });

    if (!canonical) return this.wrapResponse([], ['not-found']);

    return this.wrapResponse(canonical.industryClassifications, ['database']);
  }

  async getTimeline(id: string): Promise<ApiResponse<unknown[]>> {
    const signals = await prisma.companySignal.findMany({
      where: { companyId: id },
      orderBy: { discoveryTime: 'desc' },
      select: { id: true, signalType: true, headline: true, description: true, sourceUrl: true, sourceName: true, discoveryTime: true, confidence: true },
    });

    return this.wrapResponse(signals, ['database']);
  }

  async getHealth(id: string): Promise<ApiResponse<unknown>> {
    const stabilityResult = await companyIntelligenceService.scoreStability(id, SYSTEM_USER_ID).catch(() => null);
    const hiringResult = await companyIntelligenceService.scoreHiringSignals(id, SYSTEM_USER_ID).catch(() => null);
    return this.wrapResponse({
      score: stabilityResult?.score ?? 0,
      confidence: stabilityResult?.confidence ?? 0,
      stabilitySignals: stabilityResult?.signals ?? [],
      hiringScore: hiringResult?.score ?? 0,
      activeHiringSignals: hiringResult?.activeSignals ?? [],
      planId: stabilityResult?.planId,
    }, ['health-framework', 'ai-capability']);
  }

  async getHiring(id: string): Promise<ApiResponse<unknown>> {
    const result = await companyIntelligenceService.scoreHiringSignals(id, SYSTEM_USER_ID).catch(() => null);
    return this.wrapResponse({
      signals: result?.activeSignals ?? [],
      score: result?.score ?? 0,
      confidence: result?.confidence ?? 0,
      planId: result?.planId,
    }, ['hiring-framework', 'ai-capability']);
  }

  async getAuthenticity(id: string): Promise<ApiResponse<unknown>> {
    const result = await companyIntelligenceService.scoreAuthenticity(id, SYSTEM_USER_ID).catch(() => null);
    return this.wrapResponse({
      trustScore: result?.score ?? 0,
      confidence: result?.confidence ?? 0,
      signals: result?.signals ?? [],
      planId: result?.planId,
    }, ['authenticity-framework', 'ai-capability']);
  }

  async getMetadata(): Promise<ApiResponse<unknown>> {
    return this.wrapResponse({
      apiVersion: 'v1',
      buildDate: new Date().toISOString(),
      registeredProviders: [],
      registeredJobTypes: [],
      featureFlags: {
        enableBulkLookup: true,
        enableStreamingImports: false,
      },
    }, ['metadata-framework']);
  }
}
