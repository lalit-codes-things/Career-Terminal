/**
 * Companies House provider (UK).
 *
 * Sources company data via the Companies House REST API (profile + search
 * endpoints) and the streaming API (incremental). All HTTP traffic goes
 * through `HttpDataSource` so retry policy and rate limiting are applied
 * uniformly. Credentials (REST + streaming API keys) are environment-only.
 */

import { createHash } from 'node:crypto';
import type { CompanyRawData, ProviderCompanyRecord } from '../contracts';
import type { CompaniesHouseProviderConfig } from '../config';
import { HttpDataSource, HttpDataSourceError } from '../storage/http-client';
import type {
  CompanyProvider,
  ProviderCapabilities,
  ProviderConfigurationReport,
  ProviderFetchOptions,
  ProviderHealth,
} from './company-provider.types';
import { buildBasicAuthHeader, buildProviderHealth } from './provider-utils';

const CH_JURISDICTION = 'GB';

interface ChProfile {
  company_number?: string;
  company_name?: string;
  company_status?: string;
  date_of_creation?: string;
  date_of_cessation?: string;
  type?: string;
  jurisdiction?: string;
  registered_office_address?: {
    address_line_1?: string;
    address_line_2?: string;
    locality?: string;
    postal_code?: string;
    country?: string;
  };
  sic_codes?: string[];
}

interface ChSearchResult {
  items?: Array<{
    company_number?: string;
    title?: string;
    company_status?: string;
    date_of_creation?: string;
    address_snippet?: string;
    links?: { self?: string };
  }>;
}

interface ChStreamEvent {
  resource_kind?: string;
  company_number?: string;
  event?: { timepoint?: number };
  data?: ChProfile;
}

export class CompaniesHouseProvider implements CompanyProvider {
  readonly key = 'companies-house';
  readonly name = 'Companies House (UK)';
  readonly version = '1.0.0';
  readonly jurisdiction = CH_JURISDICTION;
  readonly capabilities: ProviderCapabilities = {
    importTypes: ['FULL', 'INCREMENTAL', 'SCHEDULED', 'MANUAL'],
    supportsIncremental: true,
    supportsStreaming: true,
    dataSourceKinds: ['http'],
    dataCapabilities: [
      'company_profile',
      'identifiers',
      'addresses',
      'industry_classifications',
      'officers',
      'filing_history',
      'ownership',
    ],
  };

  private readonly http: HttpDataSource;
  private readonly streamingHttp: HttpDataSource;

  constructor(
    private readonly config: CompaniesHouseProviderConfig,
    http?: HttpDataSource,
    streamingHttp?: HttpDataSource,
  ) {
    this.http =
      http ??
      new HttpDataSource({
        baseUrl: config.baseUrl,
        timeoutMs: config.timeoutMs,
        rateLimitPerSec: config.rateLimitPerSec,
        headers: this.authHeader(config.apiKey),
      });
    this.streamingHttp =
      streamingHttp ??
      new HttpDataSource({
        baseUrl: config.streamingUrl,
        timeoutMs: config.timeoutMs,
        rateLimitPerSec: config.rateLimitPerSec,
        headers: this.authHeader(config.streamingApiKey),
      });
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  async isAvailable(): Promise<boolean> {
    return this.enabled && Boolean(this.config.apiKey || this.config.streamingApiKey);
  }

  async *fetchRecords(options: ProviderFetchOptions = {}): AsyncGenerator<
    ProviderCompanyRecord,
    void,
    unknown
  > {
    if (!(await this.isAvailable())) {
      return;
    }

    // A `since` cursor means an incremental run → consume the streaming API.
    if (options.since) {
      yield* this.streamRecords(options);
      return;
    }

    const numbers = options.companyNumbers ?? [];
    const terms = options.searchTerms ?? [];

    if (numbers.length > 0) {
      for (const companyNumber of numbers) {
        if (options.signal?.aborted) {
          return;
        }
        const profile = await this.fetchProfile(companyNumber);
        if (!profile) {
          continue;
        }
        yield this.toRecord(profile, companyNumber);
      }
      return;
    }

    if (terms.length > 0) {
      for (const term of terms) {
        if (options.signal?.aborted) {
          return;
        }
        const found = await this.searchCompanies(term);
        for (const companyNumber of found) {
          const profile = await this.fetchProfile(companyNumber);
          if (profile) {
            yield this.toRecord(profile, companyNumber);
          }
        }
      }
      return;
    }

    // No explicit numbers/terms and not an incremental run: fall back to the
    // streaming API when available, otherwise emit nothing (the importer logs
    // this as a skipped/empty run rather than failing).
    yield* this.streamRecords(options);
  }

  async health(): Promise<ProviderHealth> {
    if (!this.enabled) {
      return buildProviderHealth(this.key, 'unknown', 'Provider is disabled by configuration');
    }
    if (!this.config.apiKey) {
      return buildProviderHealth(
        this.key,
        'unhealthy',
        'REST API key is not configured (COMPANIES_HOUSE_API_KEY)',
      );
    }
    try {
      await this.http.request('/company/0', { retries: 0 });
      return buildProviderHealth(this.key, 'healthy');
    } catch (err) {
      if (err instanceof HttpDataSourceError) {
        // 404 proves auth + reachability; 401 proves bad credentials.
        if (err.status === 404) {
          return buildProviderHealth(this.key, 'healthy');
        }
        if (err.status === 401 || err.status === 403) {
          return buildProviderHealth(this.key, 'unhealthy', `Authentication failed (HTTP ${err.status})`);
        }
        return buildProviderHealth(this.key, 'degraded', `API returned HTTP ${err.status}`);
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
        message: 'Provider is disabled by configuration (COMPANIES_HOUSE_PROVIDER_ENABLED=false)',
      });
      return { valid: true, issues };
    }

    if (!this.config.apiKey && !this.config.streamingApiKey) {
      issues.push({
        severity: 'error',
        field: 'apiKey',
        message: 'At least one API key is required (COMPANIES_HOUSE_API_KEY or COMPANIES_HOUSE_STREAMING_API_KEY)',
      });
    }
    if (!isHttpUrl(this.config.baseUrl)) {
      issues.push({
        severity: 'error',
        field: 'baseUrl',
        message: `COMPANIES_HOUSE_BASE_URL is not a valid HTTP(S) URL: '${this.config.baseUrl}'`,
      });
    }
    if (!isHttpUrl(this.config.streamingUrl)) {
      issues.push({
        severity: 'error',
        field: 'streamingUrl',
        message: `COMPANIES_HOUSE_STREAMING_URL is not a valid HTTP(S) URL: '${this.config.streamingUrl}'`,
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

  // ── REST ────────────────────────────────────────────────────────────────

  private async fetchProfile(companyNumber: string): Promise<ChProfile | null> {
    try {
      return await this.http.getJson<ChProfile>(`/company/${encodeURIComponent(companyNumber)}`);
    } catch (err) {
      if (err instanceof HttpDataSourceError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  private async searchCompanies(term: string): Promise<string[]> {
    const page = await this.http.getJson<ChSearchResult>('/search/companies', {
      query: { q: term, items_per_page: 20 },
    });
    return (page.items ?? [])
      .map((item) => item.company_number)
      .filter((number): number is string => Boolean(number));
  }

  private toRecord(profile: ChProfile, companyNumber: string): ProviderCompanyRecord {
    const profileJson = profile as unknown as Record<string, unknown>;
    return {
      providerKey: this.key,
      providerRecordId: companyNumber,
      fetchedAt: new Date().toISOString(),
      checksum: this.checksum(profileJson),
      rawReference: `/company/${companyNumber}`,
      raw: profileJson,
      data: this.mapToRawData(profile),
    };
  }

  private mapToRawData(profile: ChProfile): CompanyRawData {
    const identifiers: CompanyRawData['identifiers'] = [];
    if (profile.company_number) {
      identifiers.push({
        type: 'company_number',
        value: profile.company_number,
        jurisdiction: CH_JURISDICTION,
        registrar: 'companies-house',
      });
    }

    const addresses: CompanyRawData['addresses'] = [];
    const address = profile.registered_office_address;
    if (address) {
      addresses.push({
        type: 'registered',
        addressLines: [address.address_line_1, address.address_line_2].filter(
          (line): line is string => Boolean(line),
        ),
        locality: address.locality ?? null,
        postalCode: address.postal_code ?? null,
        countryCode: this.countryCodeOf(address.country) ?? CH_JURISDICTION,
      });
    }

    const industryClassifications: CompanyRawData['industryClassifications'] =
      (profile.sic_codes ?? []).map((code, index) => ({
        system: 'SIC_UK',
        code,
        isPrimary: index === 0,
      }));

    return {
      name: profile.company_name ?? null,
      legalName: profile.company_name ?? null,
      jurisdiction: this.normalizeChJurisdiction(profile.jurisdiction),
      countryCode: CH_JURISDICTION,
      identifiers,
      addresses,
      industryClassifications,
      status: profile.company_status ?? null,
      incorporatedDate: profile.date_of_creation ?? null,
      validFrom: profile.date_of_creation ?? null,
      validTo: profile.date_of_cessation ?? null,
    };
  }

  // ── Streaming ───────────────────────────────────────────────────────────

  private async *streamRecords(options: ProviderFetchOptions): AsyncGenerator<
    ProviderCompanyRecord,
    void,
    unknown
  > {
    if (!this.config.streamingApiKey) {
      return;
    }
    const stream = await this.streamingHttp.getStream('/companies', {
      query: options.since ? { timepoint: this.sinceToTimepoint(options.since) } : {},
      timeoutMs: this.config.timeoutMs * 6,
    });

    const decoder = new TextDecoder();
    const reader = stream.getReader();
    let buffer = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (options.signal?.aborted) {
            return;
          }
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) {
            continue;
          }
          const event = this.parseStreamEvent(trimmed.slice(5).trim());
          if (!event || !event.company_number || !event.data) {
            continue;
          }
          if (event.resource_kind && event.resource_kind !== 'company-profile') {
            continue;
          }
          yield this.toRecord(event.data, event.company_number);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private parseStreamEvent(payload: string): ChStreamEvent | null {
    try {
      return JSON.parse(payload) as ChStreamEvent;
    } catch {
      return null;
    }
  }

  private sinceToTimepoint(since: string): number {
    return Math.floor(new Date(since).getTime() / 1000);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private authHeader(apiKey?: string): Record<string, string> {
    return apiKey ? { Authorization: buildBasicAuthHeader(apiKey) } : {};
  }

  /** CH jurisdiction strings → ISO alpha-2 / subdivision. */
  private normalizeChJurisdiction(value?: string): string {
    if (!value) {
      return CH_JURISDICTION;
    }
    const map: Record<string, string> = {
      'england-wales': 'GB-ENG',
      'england': 'GB-ENG',
      'wales': 'GB-WLS',
      'scotland': 'GB-SCT',
      'scottish': 'GB-SCT',
      'northern-ireland': 'GB-NIR',
    };
    return map[value.toLowerCase()] ?? CH_JURISDICTION;
  }

  private countryCodeOf(country?: string): string | null {
    if (!country) {
      return null;
    }
    const map: Record<string, string> = {
      'united kingdom': 'GB',
      england: 'GB',
      wales: 'GB',
      scotland: 'GB',
      'northern ireland': 'GB',
    };
    return map[country.toLowerCase()] ?? null;
  }

  private checksum(payload: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
