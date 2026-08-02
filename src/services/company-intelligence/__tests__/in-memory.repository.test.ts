import type { NormalizedCompanyData } from '../contracts';
import { InMemoryCompanyIntelRepository } from '../repository';

const record = (overrides: Partial<NormalizedCompanyData> = {}): NormalizedCompanyData => ({
  providerKey: 'companies-house',
  providerRecordId: '01234567',
  name: 'Acme Ltd',
  normalizedName: 'acme',
  jurisdiction: 'GB',
  countryCode: 'GB',
  aliases: ['Acme Trading'],
  identifiers: [{ type: 'company_number', value: '01234567', normalizedValue: '01234567' }],
  addresses: [],
  websites: [],
  industryClassifications: [],
  exchangeListings: [],
  status: 'active',
  fetchedAt: '2024-01-01T00:00:00.000Z',
  checksum: 'abc',
  ...overrides,
});

describe('InMemoryCompanyIntelRepository', () => {
  it('persists companies and resolves them by identifier, domain, website and name', async () => {
    const repo = new InMemoryCompanyIntelRepository();
    const resolution = {
      canonicalCompanyId: 'company-1',
      created: true,
      updated: false,
      matched: false,
      matchedBy: [] as string[],
    };

    await repo.persistCompany(record(), resolution);

    expect(repo.companies.size).toBe(1);
    const byIdentifier = await repo.findCompanyByIdentifier('company_number', '01234567', 'GB');
    expect(byIdentifier?.id).toBe('company-1');

    const byDomain = await repo.findCompanyByDomain('acme.example');
    expect(byDomain).toBeNull();

    await repo.persistCompany(
      record({ domain: 'acme.example', website: 'https://www.acme.example' }),
      { ...resolution, canonicalCompanyId: 'company-1', updated: true, matched: true, matchedBy: ['domain'] },
    );

    expect((await repo.findCompanyByDomain('acme.example'))?.id).toBe('company-1');
    expect((await repo.findCompanyByWebsite('https://www.acme.example'))?.id).toBe('company-1');
    expect((await repo.findCompanyByNameAndJurisdiction('acme', 'GB'))?.id).toBe('company-1');
  });

  it('tracks import runs, provider records and audit logs', async () => {
    const repo = new InMemoryCompanyIntelRepository();
    const run = await repo.createImportRun({ providerKey: 'sec', importType: 'FULL' });

    await repo.recordProviderRecord({
      importRunId: run.id,
      providerKey: 'sec',
      providerRecordId: '1234',
      fetchedAt: '2024-01-01T00:00:00.000Z',
      checksum: 'x',
      status: 'processed',
    });
    await repo.appendAuditLog({
      entityType: 'canonical_company',
      entityId: 'c1',
      action: 'import.created',
    });

    await repo.completeImportRun(run.id, {
      status: 'success',
      completedAt: new Date(),
      recordsFetched: 1,
      recordsValidated: 1,
      recordsFailedValidation: 0,
      companiesCreated: 1,
      companiesUpdated: 0,
      companiesMatched: 0,
      errors: 0,
    });

    const runs = repo.getImportRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('SUCCESS');
    expect(runs[0]?.recordsFetched).toBe(1);
    expect(repo.getProviderRecords()).toHaveLength(1);
    expect(repo.getAuditLogs()).toHaveLength(1);
  });

  it('resets state', async () => {
    const repo = new InMemoryCompanyIntelRepository();
    const resolution = {
      canonicalCompanyId: 'company-1',
      created: true,
      updated: false,
      matched: false,
      matchedBy: [] as string[],
    };
    await repo.persistCompany(record(), resolution);
    await repo.createImportRun({ providerKey: 'sec', importType: 'FULL' });

    repo.reset();
    expect(repo.companies.size).toBe(0);
    expect(repo.getImportRuns()).toHaveLength(0);
    expect(repo.getProviderRecords()).toHaveLength(0);
  });
});
