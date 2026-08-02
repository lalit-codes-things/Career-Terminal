/**
 * SEC EDGAR provider.
 *
 * Sources company data from EDGAR full-text submissions datasets staged on the
 * configured `CompanyDataStorage` backend (local filesystem or S3). Datasets
 * are produced externally and copied under a logical prefix; this provider
 * never performs the download itself.
 *
 * SEC is an optional provider: when disabled or when its datasets are missing,
 * `isAvailable()` returns false and the import pipeline logs a structured
 * message and continues with other providers instead of failing.
 */

import { createHash } from 'node:crypto';
import type { CompanyRawData, ProviderCompanyRecord } from '../contracts';
import type { CompanyDataStorage } from '../storage';
import type {
  CompanyProvider,
  ProviderCapabilities,
  ProviderConfigurationReport,
  ProviderFetchOptions,
  ProviderHealth,
} from './company-provider.types';
import { buildProviderHealth, toIsoTimestamp } from './provider-utils';
import type { SecProviderConfig } from '../config';

interface SecSubmissionFile {
  cik?: string | number;
  name?: string;
  companyName?: string;
  tickers?: string[];
  exchanges?: string[];
  sic?: string | number;
  sicDescription?: string;
  addresses?: {
    business?: {
      street1?: string;
      street2?: string;
      city?: string;
      stateOrProvince?: string;
      zipCode?: string;
      country?: string;
    };
  };
  records?: unknown[];
}

const SEC_JURISDICTION = 'US';
const SEC_DEFAULT_PREFIX = 'sec/full-submissions';

export class SecProvider implements CompanyProvider {
  readonly key = 'sec';
  readonly name = 'US SEC EDGAR';
  readonly version = '1.0.0';
  readonly jurisdiction = SEC_JURISDICTION;
  readonly capabilities: ProviderCapabilities = {
    importTypes: ['FULL', 'SCHEDULED', 'MANUAL'],
    supportsIncremental: false,
    supportsStreaming: false,
    dataSourceKinds: ['filesystem', 's3'],
    dataCapabilities: [
      'company_profile',
      'identifiers',
      'addresses',
      'industry_classifications',
      'exchange_listings',
    ],
  };

  constructor(
    private readonly config: SecProviderConfig,
    private readonly storage: CompanyDataStorage,
  ) {}

  get enabled(): boolean {
    return this.config.enabled;
  }

  private get prefix(): string {
    return (this.config.dataDir || SEC_DEFAULT_PREFIX).replace(/^\/+|\/+$/g, '');
  }

  async isAvailable(): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }
    try {
      await this.storage.list(this.prefix);
      return true;
    } catch {
      return false;
    }
  }

  async *fetchRecords(options: ProviderFetchOptions = {}): AsyncGenerator<
    ProviderCompanyRecord,
    void,
    unknown
  > {
    if (!this.enabled) {
      return;
    }

    let uris: string[];
    try {
      uris = await this.listDatasetUris(options);
    } catch (err) {
      throw new Error(`SEC provider: failed to list datasets under '${this.prefix}': ${message(err)}`);
    }

    let emitted = 0;
    for (const uri of uris) {
      if (options.signal?.aborted) {
        return;
      }
      if (options.limit != null && emitted >= options.limit) {
        return;
      }

      const records = await this.readDataset(uri);
      for (const record of records) {
        if (options.signal?.aborted) {
          return;
        }
        if (options.limit != null && emitted >= options.limit) {
          return;
        }

        const providerRecordId = String(record.cik ?? `${uri}:${emitted}`);
        if (!record.cik && !record.name) {
          continue;
        }

        emitted += 1;
        yield {
          providerKey: this.key,
          providerRecordId,
          fetchedAt: toIsoTimestamp(new Date()),
          checksum: this.checksum(record),
          rawReference: uri,
          raw: record,
          data: this.mapToRawData(record),
        };
      }
    }
  }

  async health(): Promise<ProviderHealth> {
    if (!this.enabled) {
      return buildProviderHealth(this.key, 'unknown', 'Provider is disabled by configuration');
    }
    try {
      const uris = await this.storage.list(this.prefix);
      return buildProviderHealth(
        this.key,
        'healthy',
        uris.length === 0 ? 'Storage reachable; no datasets staged yet' : 'Storage reachable',
        { objects: uris.length },
      );
    } catch (err) {
      return buildProviderHealth(this.key, 'degraded', `Storage unreachable: ${message(err)}`);
    }
  }

  validateConfiguration(): ProviderConfigurationReport {
    const issues: ProviderConfigurationReport['issues'] = [];

    if (!this.enabled) {
      issues.push({
        severity: 'warning',
        field: 'enabled',
        message: 'Provider is disabled by configuration (SEC_PROVIDER_ENABLED=false)',
      });
      return { valid: true, issues };
    }

    if (!this.config.dataDir) {
      issues.push({
        severity: 'error',
        field: 'dataDir',
        message: 'Dataset prefix (SEC_DATA_DIR) is not configured',
      });
    }
    if (this.config.baseUrl && !isHttpUrl(this.config.baseUrl)) {
      issues.push({
        severity: 'error',
        field: 'baseUrl',
        message: `SEC_BASE_URL is not a valid HTTP(S) URL: '${this.config.baseUrl}'`,
      });
    }

    return { valid: issues.every((issue) => issue.severity !== 'error'), issues };
  }

  /**
   * Startup hook — verifies the storage backend is reachable. When storage is
   * not configured (no backend), this reports a degraded provider instead of
   * throwing, so the pipeline continues with other providers.
   */
  async initialize(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    try {
      await this.storage.list(this.prefix);
    } catch {
      // Storage unreachable is a degraded condition, not a fatal one.
    }
  }

  async shutdown(): Promise<void> {
    // SEC is stateless; nothing to release.
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private async listDatasetUris(options: ProviderFetchOptions): Promise<string[]> {
    let uris = await this.storage.list(this.prefix);
    uris = uris.filter((uri) => uri.endsWith('.json')).sort();

    if (options.maxRecords != null) {
      uris = uris.slice(0, options.maxRecords);
    }
    return uris;
  }

  private async readDataset(uri: string): Promise<SecSubmissionFile[]> {
    const text = await this.storage.readText(uri);
    const parsed = JSON.parse(text) as SecSubmissionFile | SecSubmissionFile[];
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (Array.isArray(parsed.records)) {
      return parsed.records as SecSubmissionFile[];
    }
    return [parsed];
  }

  private mapToRawData(record: SecSubmissionFile): CompanyRawData {
    const name = record.name ?? record.companyName ?? null;
    const cik = record.cik != null ? this.normalizeCik(record.cik) : null;

    const identifiers: CompanyRawData['identifiers'] = [];
    if (cik) {
      identifiers.push({ type: 'cik', value: cik, jurisdiction: SEC_JURISDICTION });
    }

    const exchangeListings: CompanyRawData['exchangeListings'] = [];
    if (Array.isArray(record.tickers)) {
      const exchanges = Array.isArray(record.exchanges) ? record.exchanges : [];
      record.tickers.forEach((ticker, index) => {
        exchangeListings.push({
          exchange: exchanges[index] ?? 'US',
          ticker,
          currency: 'USD',
          isPrimary: index === 0,
          listingStatus: 'listed',
        });
      });
    }

    const industryClassifications: CompanyRawData['industryClassifications'] = [];
    if (record.sic) {
      industryClassifications.push({
        system: 'SIC',
        code: String(record.sic),
        label: record.sicDescription ?? null,
        isPrimary: true,
      });
    }

    const addresses: CompanyRawData['addresses'] = [];
    const business = record.addresses?.business;
    if (business) {
      addresses.push({
        type: 'business',
        addressLines: [business.street1, business.street2].filter(
          (line): line is string => !!line,
        ),
        locality: business.city ?? null,
        region: business.stateOrProvince ?? null,
        postalCode: business.zipCode ?? null,
        countryCode: business.country ?? SEC_JURISDICTION,
      });
    }

    return {
      name,
      legalName: name,
      jurisdiction: SEC_JURISDICTION,
      countryCode: SEC_JURISDICTION,
      identifiers,
      addresses,
      exchangeListings,
      industryClassifications,
      status: 'active',
    };
  }

  /** CIK stored with leading zeros → canonical numeric string. */
  private normalizeCik(value: string | number): string {
    const s = String(value).trim();
    return s.replace(/^0+(?=\d)/, '');
  }

  private checksum(record: SecSubmissionFile): string {
    return createHash('sha256').update(JSON.stringify(record)).digest('hex');
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
