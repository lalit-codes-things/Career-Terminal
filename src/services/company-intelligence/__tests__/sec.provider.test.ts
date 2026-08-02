import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalFilesystemStorage } from '../storage';
import { SecProvider } from '../providers';
import type { SecProviderConfig } from '../config';

const config = (overrides: Partial<SecProviderConfig> = {}): SecProviderConfig => ({
  enabled: true,
  userAgent: 'test',
  rateLimitPerSec: 10,
  timeoutMs: 5000,
  ...overrides,
});

describe('SecProvider', () => {
  let dir: string;
  let storage: LocalFilesystemStorage;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'sec-provider-test-'));
    storage = new LocalFilesystemStorage(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reports availability based on config and storage', async () => {
    const provider = new SecProvider(config({ enabled: false }), storage);
    expect(await provider.isAvailable()).toBe(false);
    expect((await provider.health()).status).toBe('unknown');
  });

  it('streams records from staged submissions datasets', async () => {
    await storage.write('sec/full-submissions/2024/0000320193.json', JSON.stringify({
      cik: '0000320193',
      name: 'Apple Inc',
      tickers: ['AAPL'],
      exchanges: ['Nasdaq'],
      sic: '3571',
      addresses: {
        business: {
          street1: 'One Apple Park Way',
          city: 'Cupertino',
          stateOrProvince: 'CA',
          zipCode: '95014',
          country: 'US',
        },
      },
    }));
    await storage.write('sec/full-submissions/2024/0000789019.json', JSON.stringify({
      cik: '0000789019',
      name: 'Microsoft Corp',
    }));

    const provider = new SecProvider(config(), storage);
    expect(await provider.isAvailable()).toBe(true);

    const records = [];
    for await (const record of provider.fetchRecords()) {
      records.push(record);
    }

    expect(records).toHaveLength(2);
    expect(records[0]?.providerKey).toBe('sec');
    expect(records[0]?.data.identifiers?.[0]).toMatchObject({ type: 'cik', value: '320193' });
    expect(records[0]?.data.exchangeListings?.[0]?.ticker).toBe('AAPL');
    expect(records[0]?.data.addresses?.[0]?.locality).toBe('Cupertino');
    expect(records[0]?.data.industryClassifications?.[0]?.code).toBe('3571');
  });

  it('respects the limit option', async () => {
    for (let i = 1; i <= 3; i++) {
      await storage.write(`sec/full-submissions/2024/${i}.json`, JSON.stringify({ cik: i, name: `C${i}` }));
    }
    const provider = new SecProvider(config(), storage);
    const records = [];
    for await (const record of provider.fetchRecords({ limit: 2 })) {
      records.push(record);
    }
    expect(records).toHaveLength(2);
  });

  it('is unavailable when no datasets are staged', async () => {
    const provider = new SecProvider(config(), storage);
    expect(await provider.isAvailable()).toBe(false);
    const health = await provider.health();
    expect(health.status).toBe('degraded');
  });
});
