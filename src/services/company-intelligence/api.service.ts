export interface ApiResponse<T> {
  data: T;
  metadata: Record<string, any>;
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

export class CompanyIntelligenceApiService {
  private wrapResponse<T>(data: T, provenance: string[] = [], metadata: Record<string, any> = {}): ApiResponse<T> {
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
    const total = Math.max(data instanceof Array ? data.length : 1, 1);
    const totalPages = Math.max(Math.ceil(total / limit), 1);
    return {
      ...this.wrapResponse(data, provenance, {
        page,
        limit,
        sort: options.sort ?? 'relevance:desc',
        filter: options.filter ?? {},
      }),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  async lookup(id: string): Promise<ApiResponse<any>> {
    return this.wrapResponse({ id, name: 'Example Company', normalizedName: 'example company' }, ['internal']);
  }

  async search(_query: string, options: SearchOptions = {}): Promise<ApiResponse<any[]>> {
    const data = [{ id: 'C1', name: 'Example', normalizedName: 'example' }];
    return this.wrapPaginatedResponse(data, ['internal'], options);
  }

  async bulkLookup(ids: string[]): Promise<ApiResponse<any[]>> {
    const data = ids.map((requestedId) => ({ requestedId, found: true, company: { id: requestedId, name: 'Example Company' } }));
    return this.wrapResponse(data, ['bulk-lookup'], { requestId: `bulk-${Date.now()}` });
  }

  async getIdentifiers(_id: string): Promise<ApiResponse<any[]>> {
    return this.wrapResponse([], ['market-identity-framework']);
  }

  async getRelationships(_id: string): Promise<ApiResponse<any[]>> {
    return this.wrapResponse([], ['relationship-framework']);
  }

  async getLocations(_id: string): Promise<ApiResponse<any[]>> {
    return this.wrapResponse([], ['geographic-framework']);
  }

  async getClassification(_id: string): Promise<ApiResponse<any[]>> {
    return this.wrapResponse([], ['classification-framework']);
  }

  async getTimeline(_id: string): Promise<ApiResponse<any[]>> {
    return this.wrapResponse([], ['timeline-framework']);
  }

  async getHealth(_id: string): Promise<ApiResponse<any>> {
    return this.wrapResponse({ score: 0 }, ['health-framework']);
  }

  async getHiring(_id: string): Promise<ApiResponse<any>> {
    return this.wrapResponse({ signals: [] }, ['hiring-framework']);
  }

  async getAuthenticity(_id: string): Promise<ApiResponse<any>> {
    return this.wrapResponse({ trustScore: 0 }, ['authenticity-framework']);
  }

  async getMetadata(): Promise<ApiResponse<any>> {
    return this.wrapResponse({
      apiVersion: 'v1',
      buildDate: new Date().toISOString(),
      registeredProviders: [],
      registeredJobTypes: ['IMPORT', 'VALIDATION'],
      featureFlags: {
        enableBulkLookup: true,
        enableStreamingImports: false,
      },
    }, ['metadata-framework']);
  }
}
