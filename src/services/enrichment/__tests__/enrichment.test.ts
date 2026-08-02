import { EnrichmentProviderRegistry } from '../registry';
import { EnrichmentEngine } from '../engine';
import { EnrichmentRecord } from '../model';
import { CompanyDataStorage } from '../../company-intelligence/storage/storage.types';

describe('Company Enrichment Framework', () => {
  let registry: EnrichmentProviderRegistry;
  let engine: EnrichmentEngine;
  let mockStorage: CompanyDataStorage;
  let mockRedis: any;

  beforeEach(() => {
    registry = new EnrichmentProviderRegistry();
    registry.register({
      id: 'providerA',
      name: 'Provider A',
      description: 'High priority provider',
      priority: 100,
      supportedCategories: ['Revenue']
    });
    registry.register({
      id: 'providerB',
      name: 'Provider B',
      description: 'Low priority provider',
      priority: 10,
      supportedCategories: ['Revenue']
    });

    mockStorage = {
      kind: 'local',
      read: async () => Buffer.from('[]'),
      readText: async () => '[]',
      write: jest.fn(),
      list: async () => [],
      exists: async () => true,
      openStream: async () => ({} as any)
    };

    mockRedis = {
      set: jest.fn()
    };

    engine = new EnrichmentEngine(registry, mockStorage, mockRedis);
  });

  it('validates known provider', () => {
    const rec: EnrichmentRecord = {
      provider: 'providerA', category: 'Revenue', attribute: 'amount', value: 1000,
      confidence: 0.9, version: '1', source: 'api', validFrom: new Date()
    };
    expect(() => engine.validate(rec)).not.toThrow();
  });

  it('resolves conflicts based on priority', () => {
    const recA: EnrichmentRecord = {
      provider: 'providerA', category: 'Revenue', attribute: 'amount', value: 1000,
      confidence: 0.8, version: '1', source: 'api', validFrom: new Date()
    };
    const recB: EnrichmentRecord = {
      provider: 'providerB', category: 'Revenue', attribute: 'amount', value: 2000,
      confidence: 0.95,
      version: '1', source: 'api', validFrom: new Date()
    };
    const resolved = engine.resolveConflict([recB, recA]);
    expect(resolved?.value).toBe(1000);
  });

  it('caches in redis', async () => {
    await engine.cacheEnrichment('company1', []);
    expect(mockRedis.set).toHaveBeenCalled();
  });

  it('stores history via StorageProvider', async () => {
    await engine.storeHistory('company1', []);
    expect(mockStorage.write).toHaveBeenCalled();
  });
});
