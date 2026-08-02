import type { CompanyProvider } from '../providers';
import { buildImportPlan } from '../importers';

const provider = (overrides: Partial<CompanyProvider> = {}): CompanyProvider => ({
  key: 'companies-house',
  name: 'Companies House',
  version: '1.0.0',
  jurisdiction: 'GB',
  capabilities: {
    importTypes: ['FULL', 'INCREMENTAL', 'MANUAL'],
    supportsIncremental: true,
    supportsStreaming: true,
    dataSourceKinds: ['http'],
  },
  enabled: true,
  isAvailable: async () => true,
  fetchRecords: async function* () {},
  health: async () => ({
    providerKey: 'companies-house',
    status: 'healthy',
    lastCheckedAt: new Date().toISOString(),
  }),
  ...overrides,
});

describe('buildImportPlan', () => {
  const options = { providerKey: 'companies-house' };

  it('plans an ok run for an available, enabled provider', () => {
    const plan = buildImportPlan(options, { provider: provider(), available: true });
    expect(plan.reason).toBe('ok');
    expect(plan.scheduled).toBe(true);
    expect(plan.nextRunAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('plans a skip when the provider is not registered', () => {
    const plan = buildImportPlan(options, { provider: null, available: false });
    expect(plan.reason).toBe('provider-not-found');
    expect(plan.scheduled).toBe(false);
  });

  it('plans a skip when the provider is disabled', () => {
    const plan = buildImportPlan(
      options,
      { provider: provider({ enabled: false }), available: true },
    );
    expect(plan.reason).toBe('provider-disabled');
  });

  it('plans a skip when the provider is unavailable', () => {
    const plan = buildImportPlan(
      options,
      { provider: provider(), available: false },
    );
    expect(plan.reason).toBe('provider-unavailable');
  });

  it('plans a skip when the import mode is unsupported', () => {
    const fullOnly = provider({
      capabilities: {
        importTypes: ['FULL'],
        supportsIncremental: false,
        supportsStreaming: false,
        dataSourceKinds: ['http'],
      },
    });
    const plan = buildImportPlan(
      { providerKey: 'companies-house', importType: 'INCREMENTAL' },
      { provider: fullOnly, available: true },
    );
    expect(plan.reason).toBe('mode-unsupported');
  });
});
