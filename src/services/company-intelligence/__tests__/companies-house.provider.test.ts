import { CompaniesHouseProvider } from '../providers';
import type { CompaniesHouseProviderConfig } from '../config';
import { HttpDataSource } from '../storage/http-client';

const config = (overrides: Partial<CompaniesHouseProviderConfig> = {}): CompaniesHouseProviderConfig => ({
  enabled: true,
  apiKey: 'test-key',
  streamingApiKey: 'test-stream-key',
  baseUrl: 'https://api.companieshouse.gov.uk',
  streamingUrl: 'https://stream.companieshouse.gov.uk',
  rateLimitPerSec: 100,
  timeoutMs: 5000,
  ...overrides,
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('CompaniesHouseProvider', () => {
  it('is unavailable without credentials', async () => {
    const provider = new CompaniesHouseProvider(
      config({ enabled: true, apiKey: undefined, streamingApiKey: undefined }),
    );
    expect(await provider.isAvailable()).toBe(false);
  });

  it('is unavailable when disabled', async () => {
    const provider = new CompaniesHouseProvider(config({ enabled: false }));
    expect(await provider.isAvailable()).toBe(false);
    expect((await provider.health()).status).toBe('unknown');
  });

  it('maps a company profile into a normalized raw record', async () => {
    const http = new HttpDataSource(
      { baseUrl: config().baseUrl, timeoutMs: 1000, rateLimitPerSec: 1000 },
      {
        fetchImpl: jest.fn().mockResolvedValue(
          jsonResponse(200, {
            company_number: '01234567',
            company_name: 'ACME LIMITED',
            company_status: 'active',
            date_of_creation: '2001-02-03',
            jurisdiction: 'england-wales',
            registered_office_address: {
              address_line_1: '1 Main Street',
              locality: 'London',
              postal_code: 'SW1A 1AA',
              country: 'England',
            },
            sic_codes: ['99999'],
          }),
        ),
        sleep: async () => {},
      },
    );

    const provider = new CompaniesHouseProvider(config(), http);
    const records = [];
    for await (const record of provider.fetchRecords({ companyNumbers: ['01234567'] })) {
      records.push(record);
    }

    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.providerKey).toBe('companies-house');
    expect(record.providerRecordId).toBe('01234567');
    expect(record.data.name).toBe('ACME LIMITED');
    expect(record.data.identifiers?.[0]).toMatchObject({
      type: 'company_number',
      value: '01234567',
      jurisdiction: 'GB',
    });
    expect(record.data.jurisdiction).toBe('GB-ENG');
    expect(record.data.addresses?.[0]?.locality).toBe('London');
    expect(record.data.industryClassifications?.[0]).toMatchObject({ system: 'SIC_UK', code: '99999' });
  });

  it('uses streaming for incremental runs', async () => {
    const streamBody = 'data: {"company_number":"01234567","data":{"company_name":"ACME","company_number":"01234567","company_status":"active"}}\n\n';
    const streamingHttp = new HttpDataSource(
      { baseUrl: config().streamingUrl, timeoutMs: 1000, rateLimitPerSec: 1000 },
      {
        fetchImpl: jest.fn().mockResolvedValue(
          new Response(streamBody, { status: 200 }),
        ),
        sleep: async () => {},
      },
    );

    const provider = new CompaniesHouseProvider(config(), undefined, streamingHttp);
    const records = [];
    for await (const record of provider.fetchRecords({ since: '2024-01-01T00:00:00.000Z' })) {
      records.push(record);
    }

    expect(records).toHaveLength(1);
    expect(records[0]?.data.name).toBe('ACME');
  });

  it('reports unhealthy when the API key is rejected', async () => {
    const http = new HttpDataSource(
      { baseUrl: config().baseUrl, timeoutMs: 1000, rateLimitPerSec: 1000 },
      { fetchImpl: jest.fn().mockResolvedValue(jsonResponse(401, {})), sleep: async () => {} },
    );
    const provider = new CompaniesHouseProvider(config(), http);
    const health = await provider.health();
    expect(health.status).toBe('unhealthy');
  });
});
