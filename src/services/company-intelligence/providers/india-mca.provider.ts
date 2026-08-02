/**
 * India MCA provider.
 *
 * Sources Indian company data via the data.gov.in open-data API for the
 * Ministry of Corporate Affairs company-master dataset. The API key and
 * resource id are environment-only. Pagination is handled here; the import
 * pipeline consumes records via the shared generator contract.
 */

import { createHash } from 'node:crypto';
import type { CompanyRawData, ProviderCompanyRecord } from '../contracts';
import type { IndiaMcaProviderConfig } from '../config';
import { HttpDataSource, HttpDataSourceError } from '../storage/http-client';
import type {
  CompanyProvider,
  ProviderCapabilities,
  ProviderConfigurationReport,
  ProviderFetchOptions,
  ProviderHealth,
} from './company-provider.types';
import { buildProviderHealth, isHttpUrl } from './provider-utils';

const IN_JURISDICTION = 'IN';
const PAGE_SIZE = 100;

interface McaApiResponse {
  total?: number;
  count?: number;
  limit?: number;
  offset?: number;
  records?: Array<Record<string, unknown>>;
}

export class IndiaMcaProvider implements CompanyProvider {
  readonly key = 'india-mca';
  readonly name = 'India Ministry of Corporate Affairs';
  readonly version = '1.0.0';
  readonly jurisdiction = IN_JURISDICTION;
  readonly capabilities: ProviderCapabilities = {
    importTypes: ['FULL', 'SCHEDULED', 'MANUAL'],
    supportsIncremental: false,
    supportsStreaming: false,
    dataSourceKinds: ['http'],
    dataCapabilities: [
      'company_profile',
      'identifiers',
      'addresses',
      'industry_classifications',
      'filing_history',
    ],
  };

  private readonly http: HttpDataSource;

  constructor(
    private readonly config: IndiaMcaProviderConfig,
    http?: HttpDataSource,
  ) {
    this.http =
      http ??
      new HttpDataSource({
        baseUrl: config.baseUrl,
        timeoutMs: config.timeoutMs,
        rateLimitPerSec: config.rateLimitPerSec,
      });
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  async isAvailable(): Promise<boolean> {
    return this.enabled && Boolean(this.config.apiKey && this.config.resourceId);
  }

  async *fetchRecords(
    options: ProviderFetchOptions = {},
  ): AsyncGenerator<ProviderCompanyRecord, void, unknown> {
    if (!(await this.isAvailable())) {
      return;
    }

    let offset = 0;
    let emitted = 0;

    for (;;) {
      if (options.signal?.aborted) {
        return;
      }
      if (options.limit != null && emitted >= options.limit) {
        return;
      }
      if (options.maxRecords != null && emitted >= options.maxRecords) {
        return;
      }

      const pageSize = Math.min(
        PAGE_SIZE,
        options.maxRecords != null ? options.maxRecords - emitted : PAGE_SIZE,
      );
      if (pageSize <= 0) {
        return;
      }

      const page = await this.fetchPage(offset, pageSize);
      const records = page.records ?? [];
      if (records.length === 0) {
        return;
      }

      for (const record of records) {
        if (options.signal?.aborted) {
          return;
        }
        if (options.limit != null && emitted >= options.limit) {
          return;
        }
        if (options.maxRecords != null && emitted >= options.maxRecords) {
          return;
        }

        emitted += 1;
        yield this.toRecord(record);
      }

      const total = page.total ?? 0;
      offset += records.length;
      if (records.length < pageSize || (total > 0 && offset >= total)) {
        return;
      }
    }
  }

  async health(): Promise<ProviderHealth> {
    if (!this.enabled) {
      return buildProviderHealth(this.key, 'unknown', 'Provider is disabled by configuration');
    }
    if (!this.config.apiKey || !this.config.resourceId) {
      return buildProviderHealth(
        this.key,
        'unhealthy',
        'Missing configuration (INDIA_MCA_API_KEY / INDIA_MCA_RESOURCE_ID)',
      );
    }
    try {
      const page = await this.http.getJson<McaApiResponse>(this.resourcePath(), {
        query: { limit: 1, offset: 0 },
        retries: 1,
      });
      if (Array.isArray(page.records)) {
        return buildProviderHealth(this.key, 'healthy', undefined, { total: page.total ?? 0 });
      }
      return buildProviderHealth(this.key, 'degraded', 'Unexpected API response shape');
    } catch (err) {
      if (err instanceof HttpDataSourceError && (err.status === 401 || err.status === 403)) {
        return buildProviderHealth(
          this.key,
          'unhealthy',
          `API authentication failed (HTTP ${err.status})`,
        );
      }
      return buildProviderHealth(this.key, 'degraded', `API unreachable: ${message(err)}`);
    }
  }

  validateConfiguration(): ProviderConfigurationReport {
    const issues: ProviderConfigurationReport['issues'] = [];

    if (!this.enabled) {
      issues.push({
        severity: 'warning',
        field: 'enabled',
        message: 'Provider is disabled by configuration (INDIA_MCA_PROVIDER_ENABLED=false)',
      });
      return { valid: true, issues };
    }

    if (!this.config.apiKey) {
      issues.push({
        severity: 'error',
        field: 'apiKey',
        message: 'data.gov.in API key is not configured (INDIA_MCA_API_KEY)',
      });
    }
    if (!this.config.resourceId) {
      issues.push({
        severity: 'error',
        field: 'resourceId',
        message: 'MCA dataset resource id is not configured (INDIA_MCA_RESOURCE_ID)',
      });
    }
    if (!isHttpUrl(this.config.baseUrl)) {
      issues.push({
        severity: 'error',
        field: 'baseUrl',
        message: `INDIA_MCA_BASE_URL is not a valid HTTP(S) URL: '${this.config.baseUrl}'`,
      });
    }

    return { valid: issues.every((issue) => issue.severity !== 'error'), issues };
  }

  async initialize(): Promise<void> {
    // Stateless HTTP client; nothing to set up at startup.
  }

  async shutdown(): Promise<void> {
    // Stateless HTTP client; nothing to release.
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private async fetchPage(offset: number, limit: number): Promise<McaApiResponse> {
    return this.http.getJson<McaApiResponse>(this.resourcePath(), {
      query: {
        'api-key': this.config.apiKey ?? '',
        format: 'json',
        limit,
        offset,
      },
      retries: 2,
    });
  }

  private resourcePath(): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    return `${base}/${encodeURIComponent(this.config.resourceId)}`;
  }

  private toRecord(record: Record<string, unknown>): ProviderCompanyRecord {
    const name = field(record, 'company_name', 'companyname', 'name');
    const cin = field(record, 'cin');
    const incorporatedDate = field(record, 'date_of_incorporation', 'dateofincorporation');
    const registeredAddress = field(record, 'registered_address', 'registeredaddress', 'address');
    const companyNumber = field(record, 'company_number', 'registration_number', 'reg_no');

    const identifiers: CompanyRawData['identifiers'] = [];
    if (cin) {
      identifiers.push({ type: 'cin', value: cin, jurisdiction: IN_JURISDICTION });
    }
    if (companyNumber) {
      identifiers.push({
        type: 'company_number',
        value: companyNumber,
        jurisdiction: IN_JURISDICTION,
      });
    }

    const addresses: CompanyRawData['addresses'] = [];
    if (registeredAddress) {
      const [street, ...rest] = registeredAddress
        .split(',')
        .map((part: string) => part.trim())
        .filter(Boolean);
      addresses.push({
        type: 'registered',
        addressLines: [street].filter((line): line is string => Boolean(line)),
        locality: rest.length > 0 ? (rest[rest.length - 1] ?? null) : null,
        countryCode: IN_JURISDICTION,
      });
    }

    return {
      providerKey: this.key,
      providerRecordId: cin ?? companyNumber ?? `mca:${this.checksum(record)}`,
      fetchedAt: new Date().toISOString(),
      checksum: this.checksum(record),
      rawReference: `mca:${this.config.resourceId}`,
      raw: record,
      data: {
        name: name ?? null,
        legalName: name ?? null,
        jurisdiction: IN_JURISDICTION,
        countryCode: IN_JURISDICTION,
        identifiers,
        addresses,
        status: field(record, 'company_status', 'companystatus') ?? null,
        incorporatedDate: incorporatedDate ?? null,
        validFrom: incorporatedDate ?? null,
      },
    };
  }

  private checksum(record: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(record)).digest('hex');
  }
}

/** Case-insensitive field accessor for data.gov.in record keys. */
function field(record: Record<string, unknown>, ...keys: string[]): string | null {
  const lower = new Map(
    Object.entries(record).map(([key, value]) => [key.toLowerCase().trim(), value]),
  );
  for (const key of keys) {
    const value = lower.get(key.toLowerCase());
    const text = asString(value);
    if (text) {
      return text;
    }
  }
  return null;
}

/** Coerce a primitive to a trimmed string; null for objects/arrays. */
function asString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
