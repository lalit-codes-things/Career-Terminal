import { CompanyIntelligenceApiService } from '../api.service';
import { createCompanyIntelligenceWorkerRegistry } from '../workers/registry';
import { validateCompanyIntelConfig } from '../config/company-intel.config';

describe('Company Intelligence platform surface', () => {
  it('wraps search responses with pagination metadata and canonical envelope fields', async () => {
    const service = new CompanyIntelligenceApiService();
    const result = await service.search('acme', {
      page: 2,
      limit: 10,
      sort: 'name:asc',
      filter: { countryCode: 'US' },
    });

    expect(result.data).toBeDefined();
    expect(result.metadata).toMatchObject({
      requestId: expect.any(String),
      page: 2,
      limit: 10,
      sort: 'name:asc',
    });
    expect(result.pagination).toMatchObject({
      page: 2,
      limit: 10,
      total: expect.any(Number),
      totalPages: expect.any(Number),
    });
    expect(result.provenance).toContain('company-intelligence-api');
    expect(result.version).toBe('1.0.0');
  });

  it('supports bulk lookup and metadata endpoints', async () => {
    const service = new CompanyIntelligenceApiService();
    const bulk = await service.bulkLookup(['C1', 'C2']);
    expect(Array.isArray(bulk.data)).toBe(true);
    expect(bulk.data[0]).toMatchObject({ requestedId: 'C1' });
    expect(bulk.metadata).toMatchObject({ requestId: expect.any(String) });

    const metadata = await service.getMetadata();
    expect(metadata.data).toMatchObject({
      apiVersion: 'v1',
      registeredProviders: expect.any(Array),
    });
  });

  it('registers and executes registry-driven company intelligence jobs', async () => {
    const registry = createCompanyIntelligenceWorkerRegistry();
    const result = await registry.run('IMPORT', {
      companyId: 'C1',
      correlationId: 'corr-1',
    });

    expect(result.status).toBe('completed');
    expect(result.jobType).toBe('IMPORT');
    expect(result.progress).toBe(100);
  });

  it('validates configuration and surfaces feature flags', () => {
    const report = validateCompanyIntelConfig({
      storageBackend: 'local',
      localDataDir: '/tmp',
      importBatchSize: 50,
      featureFlags: { enableBulkLookup: true, enableStreamingImports: false },
    });

    expect(report.valid).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.featureFlags.enableBulkLookup).toBe(true);
  });
});
