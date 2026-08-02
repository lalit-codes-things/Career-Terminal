/**
 * Company provider interface.
 *
 * Every company data source — SEC, Companies House, India MCA, and any future
 * provider — implements `CompanyProvider`. The import pipeline only depends on
 * this abstraction; it does not care where data originates.
 */

import type { ProviderCompanyRecord } from '../contracts';
import type { CompanyDataCapability } from '../framework/capabilities';

/** Modes an import run can operate in. */
export type ImportType = 'FULL' | 'INCREMENTAL' | 'SCHEDULED' | 'MANUAL';

export const IMPORT_TYPES: readonly ImportType[] = ['FULL', 'INCREMENTAL', 'SCHEDULED', 'MANUAL'];

/** Backends a provider can source data from. */
export type ProviderDataSourceKind = 'http' | 'filesystem' | 's3';

export interface ProviderCapabilities {
  /** Import modes the provider supports. */
  importTypes: ImportType[];
  /** Whether the provider supports incremental (since-cursor) imports. */
  supportsIncremental: boolean;
  /** Whether the provider exposes a streaming API (Companies House SSE). */
  supportsStreaming: boolean;
  /** Backends this provider can read datasets from. */
  dataSourceKinds: ProviderDataSourceKind[];
  /** Data capabilities the provider can source (see framework/capabilities). */
  dataCapabilities: CompanyDataCapability[];
}

export type ProviderHealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface ProviderHealth {
  providerKey: string;
  status: ProviderHealthStatus;
  lastCheckedAt: string;
  message?: string;
  detail?: Record<string, unknown>;
}

/** Configuration check outcome (framework lifecycle). */
export interface ProviderConfigurationIssue {
  severity: 'error' | 'warning';
  field: string;
  message: string;
}

export interface ProviderConfigurationReport {
  valid: boolean;
  issues: ProviderConfigurationIssue[];
}

export interface ProviderFetchOptions {
  /** Incremental cursor — only records changed after this time. */
  since?: string;
  /** Hard cap on the number of records to emit. */
  limit?: number;
  /** Provider-specific: search terms (Companies House). */
  searchTerms?: string[];
  /** Provider-specific: explicit company numbers (Companies House). */
  companyNumbers?: string[];
  /** Provider-specific: cap on total records fetched from a paginated API. */
  maxRecords?: number;
  /** Abort signal for cancellation (future BullMQ cancellation support). */
  signal?: AbortSignal;
}

/**
 * The common contract all company data providers implement.
 */
export interface CompanyProvider {
  /** Stable provider key, e.g. 'sec', 'companies-house', 'india-mca'. */
  readonly key: string;
  /** Human-readable provider name. */
  readonly name: string;
  /** Provider schema version. */
  readonly version: string;
  /** Primary jurisdiction the provider covers (ISO alpha-2), if any. */
  readonly jurisdiction: string | null;
  /** Static capabilities advertised by the provider. */
  readonly capabilities: ProviderCapabilities;
  /** Whether the provider is enabled by configuration. */
  readonly enabled: boolean;

  /**
   * Whether the provider can currently source data (config present, dataset
   * reachable). Providers that are disabled or unconfigured return false and
   * the importer logs a structured message instead of failing.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Stream provider company records. Providers must not perform large imports
   * themselves — this generator is consumed by the import pipeline.
   */
  fetchRecords(options?: ProviderFetchOptions): AsyncGenerator<ProviderCompanyRecord, void, unknown>;

  /**
   * Report provider health (config, reachability, last error).
   */
  health(): Promise<ProviderHealth>;

  /**
   * Validate the provider's configuration (framework lifecycle). Optional —
   * providers without a static config may omit it.
   */
  validateConfiguration?(): Promise<ProviderConfigurationReport> | ProviderConfigurationReport;

  /**
   * One-time startup hook (framework lifecycle). Optional — use for resource
   * setup or reachability probes. Must not throw for unavailable providers;
   * the lifecycle manager records that as a degraded, not failed, provider.
   */
  initialize?(): Promise<void>;

  /**
   * One-time shutdown hook (framework lifecycle). Optional — use for resource
   * release. Failures are logged, never fatal.
   */
  shutdown?(): Promise<void>;
}
