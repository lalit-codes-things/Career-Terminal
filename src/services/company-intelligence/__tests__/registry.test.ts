import type { CompanyProvider } from '../providers';
import { CompanyProviderRegistry } from '../providers';

const fakeProvider = (key: string, enabled = true): CompanyProvider => ({
  key,
  name: `Provider ${key}`,
  version: '1.0.0',
  jurisdiction: 'GB',
  capabilities: {
    importTypes: ['FULL', 'MANUAL'],
    supportsIncremental: false,
    supportsStreaming: false,
    dataSourceKinds: ['http'],
  },
  enabled,
  isAvailable: async () => true,
  fetchRecords: async function* () {},
  health: async () => ({
    providerKey: key,
    status: 'healthy',
    lastCheckedAt: new Date().toISOString(),
  }),
});

describe('CompanyProviderRegistry', () => {
  it('registers, retrieves and lists providers', () => {
    const registry = new CompanyProviderRegistry();
    registry.register(fakeProvider('sec'));
    registry.register(fakeProvider('companies-house'));

    expect(registry.get('sec')?.name).toBe('Provider sec');
    expect(registry.has('sec')).toBe(true);
    expect(registry.all()).toHaveLength(2);
    expect(registry.keys()).toEqual(expect.arrayContaining(['sec', 'companies-house']));
  });

  it('rejects duplicate keys', () => {
    const registry = new CompanyProviderRegistry();
    registry.register(fakeProvider('sec'));
    expect(() => registry.register(fakeProvider('sec'))).toThrow(/already registered/);
  });

  it('filters enabled providers', () => {
    const registry = new CompanyProviderRegistry();
    registry.register(fakeProvider('sec', false));
    registry.register(fakeProvider('companies-house', true));

    expect(registry.enabled()).toHaveLength(1);
    expect(registry.enabled()[0]?.key).toBe('companies-house');
    expect(registry.isEnabled('sec')).toBe(false);
  });
});
