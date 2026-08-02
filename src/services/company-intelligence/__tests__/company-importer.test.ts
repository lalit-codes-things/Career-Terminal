import type { ProviderCompanyRecord } from '../contracts';
import type { CompanyProvider } from '../providers';
import { CompanyImporter } from '../importers';
import { InMemoryCompanyIntelRepository } from '../repository';
import { CompanyProviderRegistry } from '../providers';

const baseRecord = (providerRecordId: string, overrides: Record<string, unknown> = {}): ProviderCompanyRecord => ({
  providerKey: 'fake',
  providerRecordId,
  fetchedAt: '2024-01-01T00:00:00.000Z',
  checksum: `sha-${providerRecordId}`,
  raw: overrides,
  data: {
    name: `Company ${providerRecordId}`,
    jurisdiction: 'GB',
    countryCode: 'GB',
    identifiers: [
      { type: 'company_number', value: `0000000${providerRecordId}`, jurisdiction: 'GB' },
    ],
    status: 'active',
    ...overrides,
  },
});

const fakeProvider = (records: ProviderCompanyRecord[]): CompanyProvider => ({
  key: 'fake',
  name: 'Fake Provider',
  version: '1.0.0',
  jurisdiction: 'GB',
  capabilities: {
    importTypes: ['FULL', 'INCREMENTAL', 'MANUAL'],
    supportsIncremental: false,
    supportsStreaming: false,
    dataSourceKinds: ['http'],
  },
  enabled: true,
  isAvailable: async () => true,
  fetchRecords: async function* () {
    for (const record of records) {
      yield record;
    }
  },
  health: async () => ({
    providerKey: 'fake',
    status: 'healthy',
    lastCheckedAt: new Date().toISOString(),
  }),
});

const disabledProvider = (records: ProviderCompanyRecord[]): CompanyProvider => {
  const base = fakeProvider(records);
  return { ...base, enabled: false, isAvailable: async () => false };
};

function buildImporter(provider: CompanyProvider) {
  const registry = new CompanyProviderRegistry();
  registry.register(provider);
  const repository = new InMemoryCompanyIntelRepository();
  return {
    repository,
    importer: new CompanyImporter({ registry, repository, logger: silentLogger }),
  };
}

const silentLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

describe('CompanyImporter', () => {
  it('imports valid records and reports counts', async () => {
    const records = [baseRecord('1'), baseRecord('2')];
    const { repository, importer } = buildImporter(fakeProvider(records));

    const result = await importer.runImport({ providerKey: 'fake' });

    expect(result.status).toBe('success');
    expect(result.counts.fetched).toBe(2);
    expect(result.counts.validated).toBe(2);
    expect(result.counts.failedValidation).toBe(0);
    expect(result.counts.created).toBe(2);
    expect(result.counts.matched).toBe(0);

    expect(repository.companies.size).toBe(2);
    expect(repository.getProviderRecords()).toHaveLength(2);
    expect(repository.getAuditLogs().some((log) => log.action === 'import.created')).toBe(true);
  });

  it('skips records that fail validation', async () => {
    const bad = baseRecord('1', { name: null });
    const good = baseRecord('2');
    const { repository, importer } = buildImporter(fakeProvider([bad, good]));

    const result = await importer.runImport({ providerKey: 'fake' });

    expect(result.status).toBe('success');
    expect(result.counts.fetched).toBe(2);
    expect(result.counts.failedValidation).toBe(1);
    expect(result.counts.validated).toBe(1);
    expect(result.counts.created).toBe(1);
    expect(
      repository.getProviderRecords().some((record) => record.status === 'validation_failed'),
    ).toBe(true);
  });

  it('marks the run partial when a record errors', async () => {
    const conflictingA = baseRecord('1');
    const conflictingB = baseRecord('2');
    const sameNumbers = [
      baseRecord('3', {
        identifiers: [
          { type: 'company_number', value: '00000001', jurisdiction: 'GB' },
          { type: 'company_number', value: '00000002', jurisdiction: 'GB' },
        ],
      }),
    ];
    const { importer } = buildImporter(
      fakeProvider([conflictingA, conflictingB, ...sameNumbers]),
    );

    const result = await importer.runImport({ providerKey: 'fake' });

    // Records 1 and 2 create companies; record 3 matches both → conflict.
    expect(result.status).toBe('partial');
    expect(result.counts.errors).toBe(1);
    expect(result.counts.created).toBe(2);
  });

  it('returns a skipped run when the provider is disabled', async () => {
    const { importer } = buildImporter(disabledProvider([]));
    const result = await importer.runImport({ providerKey: 'fake' });
    expect(result.status).toBe('skipped');
    expect(result.counts.fetched).toBe(0);
  });

  it('supports dry runs without persisting', async () => {
    const records = [baseRecord('1'), baseRecord('2')];
    const { repository, importer } = buildImporter(fakeProvider(records));

    const result = await importer.runImport({ providerKey: 'fake', dryRun: true });

    expect(result.status).toBe('success');
    expect(result.counts.validated).toBe(2);
    expect(repository.companies.size).toBe(0);
    expect(repository.getProviderRecords()).toHaveLength(0);
  });

  it('throws for an unknown provider', async () => {
    const { importer } = buildImporter(fakeProvider([]));
    await expect(importer.runImport({ providerKey: 'nope' })).rejects.toThrow(/no provider/);
  });
});
