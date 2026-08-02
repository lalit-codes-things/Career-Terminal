import { IndiaMcaProvider } from '../providers';
import type { IndiaMcaProviderConfig } from '../config';
import { HttpDataSource } from '../storage/http-client';

const config = (overrides: Partial<IndiaMcaProviderConfig> = {}): IndiaMcaProviderConfig => ({
  enabled: true,
  apiKey: 'test-key',
  baseUrl: 'https://api.data.gov.in/resource',
  resourceId: '9ef84268-d588-465a-a308-a864a43d0070',
  rateLimitPerSec: 100,
  timeoutMs: 5000,
  ...overrides,
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('IndiaMcaProvider', () => {
  it('is unavailable without an API key or resource id', async () => {
    expect(await new IndiaMcaProvider(config({ apiKey: undefined })).isAvailable()).toBe(false);
    expect(await new IndiaMcaProvider(config({ resourceId: '' })).isAvailable()).toBe(false);
  });

  it('is unavailable when disabled', async () => {
    const provider = new IndiaMcaProvider(config({ enabled: false }));
    expect(await provider.isAvailable()).toBe(false);
    expect((await provider.health()).status).toBe('unknown');
  });

  it('maps MCA records and paginates to completion', async () => {
    const pageOne = Array.from({ length: 100 }, (_, i) => ({
      CIN: `U00000IN2019PTC${String(i).padStart(6, '0')}`,
      COMPANY_NAME: `Company ${i}`,
      COMPANY_STATUS: 'Active',
    }));
    const pageTwo = Array.from({ length: 50 }, (_, i) => ({
      CIN: `U00000IN2020PTC${String(i).padStart(6, '0')}`,
      COMPANY_NAME: `Company page2 ${i}`,
      COMPANY_STATUS: 'Active',
    }));

    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { total: 150, count: 100, limit: 100, offset: 0, records: pageOne }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { total: 150, count: 50, limit: 100, offset: 100, records: pageTwo }),
      );

    const http = new HttpDataSource(
      { baseUrl: config().baseUrl, timeoutMs: 1000, rateLimitPerSec: 1000 },
      { fetchImpl, sleep: async () => {} },
    );

    const provider = new IndiaMcaProvider(config(), http);
    const records = [];
    for await (const record of provider.fetchRecords()) {
      records.push(record);
    }

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(records).toHaveLength(150);

    const first = records[0]!;
    expect(first.providerKey).toBe('india-mca');
    expect(first.providerRecordId).toBe('U00000IN2019PTC000000');
    expect(first.data.name).toBe('Company 0');
    expect(first.data.identifiers?.[0]).toMatchObject({ type: 'cin', value: 'U00000IN2019PTC000000' });
  });

  it('respects maxRecords', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        total: 10,
        count: 100,
        limit: 100,
        offset: 0,
        records: Array.from({ length: 5 }, (_, i) => ({ CIN: `U00000IN2020PTC00000${i}`, COMPANY_NAME: `C${i}` })),
      }),
    );
    const http = new HttpDataSource(
      { baseUrl: config().baseUrl, timeoutMs: 1000, rateLimitPerSec: 1000 },
      { fetchImpl, sleep: async () => {} },
    );

    const provider = new IndiaMcaProvider(config(), http);
    const records = [];
    for await (const record of provider.fetchRecords({ maxRecords: 3 })) {
      records.push(record);
    }
    expect(records).toHaveLength(3);
  });

  it('reports unhealthy on auth failure', async () => {
    const http = new HttpDataSource(
      { baseUrl: config().baseUrl, timeoutMs: 1000, rateLimitPerSec: 1000 },
      { fetchImpl: jest.fn().mockResolvedValue(jsonResponse(401, {})), sleep: async () => {} },
    );
    const provider = new IndiaMcaProvider(config(), http);
    expect((await provider.health()).status).toBe('unhealthy');
  });
});
