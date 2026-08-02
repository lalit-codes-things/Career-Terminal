/**
 * Company Intelligence configuration.
 *
 * All values are derived from the centralized application config
 * (src/config/index.ts), which in turn is populated from environment
 * variables validated by env.schema.ts. Credentials are environment-only and
 * never appear in source code.
 *
 * The build functions below are pure so they can be unit-tested with explicit
 * inputs; the exported singletons read the process-wide configuration.
 */

import type { AppConfig } from '../../../config';
import { config } from '../../../config';
import { buildRetryPolicy, type RetryPolicy } from './retry-policy';

export type CompanyIntelStorageBackend = 'local' | 's3';

export interface CompanyIntelConfig {
  storageBackend: CompanyIntelStorageBackend;
  localDataDir: string;
  s3Bucket?: string;
  s3Prefix: string;
  s3Endpoint?: string;
  importBatchSize: number;
  retry: RetryPolicy;
  defaultRateLimitPerSec: number;
  featureFlags: Record<string, boolean>;
}

export interface SecProviderConfig {
  enabled: boolean;
  baseUrl?: string;
  dataDir?: string;
  userAgent: string;
  rateLimitPerSec: number;
  timeoutMs: number;
}

export interface CompaniesHouseProviderConfig {
  enabled: boolean;
  apiKey?: string;
  streamingApiKey?: string;
  baseUrl: string;
  streamingUrl: string;
  rateLimitPerSec: number;
  timeoutMs: number;
}

export interface IndiaMcaProviderConfig {
  enabled: boolean;
  apiKey?: string;
  baseUrl: string;
  resourceId: string;
  rateLimitPerSec: number;
  timeoutMs: number;
}

export interface CompanyIntelSettings {
  storageBackend: CompanyIntelStorageBackend;
  localDataDir: string;
  s3Bucket?: string;
  s3Prefix: string;
  s3Endpoint?: string;
  importBatchSize: number;
  maxRetries: number;
  retryInitialDelayMs: number;
  retryMaxDelayMs: number;
  globalRateLimitPerSec: number;
  featureFlags?: Record<string, boolean>;
}

export function buildCompanyIntelConfig(settings: CompanyIntelSettings): CompanyIntelConfig {
  return {
    storageBackend: settings.storageBackend,
    localDataDir: settings.localDataDir,
    s3Bucket: settings.s3Bucket,
    s3Prefix: settings.s3Prefix,
    s3Endpoint: settings.s3Endpoint,
    importBatchSize: settings.importBatchSize,
    retry: buildRetryPolicy({
      maxRetries: settings.maxRetries,
      initialDelayMs: settings.retryInitialDelayMs,
      maxDelayMs: settings.retryMaxDelayMs,
    }),
    defaultRateLimitPerSec: settings.globalRateLimitPerSec,
    featureFlags: settings.featureFlags ?? {},
  };
}

export function buildSecProviderConfig(sec: AppConfig['companyProviders']['sec']): SecProviderConfig {
  return { ...sec };
}

export function buildCompaniesHouseProviderConfig(
  ch: AppConfig['companyProviders']['companiesHouse'],
): CompaniesHouseProviderConfig {
  return { ...ch };
}

export function buildIndiaMcaProviderConfig(
  mca: AppConfig['companyProviders']['indiaMca'],
): IndiaMcaProviderConfig {
  return { ...mca };
}

/** Singleton — company intelligence pipeline configuration. */
export const companyIntelConfig: CompanyIntelConfig = buildCompanyIntelConfig(
  config.companyIntelligence,
);

export function validateCompanyIntelConfig(settings: Partial<CompanyIntelSettings> & Pick<CompanyIntelSettings, 'storageBackend' | 'localDataDir' | 'importBatchSize'>): {
  valid: boolean;
  issues: Array<{ severity: 'error' | 'warning'; field: string; message: string }>;
  featureFlags: Record<string, boolean>;
} {
  const issues: Array<{ severity: 'error' | 'warning'; field: string; message: string }> = [];

  if (!settings.localDataDir) {
    issues.push({ severity: 'error', field: 'localDataDir', message: 'localDataDir is required' });
  }

  if (settings.storageBackend === 's3' && !settings.s3Bucket) {
    issues.push({ severity: 'error', field: 's3Bucket', message: 's3Bucket is required when storageBackend is s3' });
  }

  if ((settings.importBatchSize ?? 0) <= 0) {
    issues.push({ severity: 'error', field: 'importBatchSize', message: 'importBatchSize must be > 0' });
  }

  return {
    valid: issues.length === 0,
    issues,
    featureFlags: settings.featureFlags ?? {},
  };
}

/** Singleton — SEC provider configuration. */
export const secProviderConfig: SecProviderConfig = buildSecProviderConfig(
  config.companyProviders.sec,
);

/** Singleton — Companies House provider configuration. */
export const companiesHouseProviderConfig: CompaniesHouseProviderConfig =
  buildCompaniesHouseProviderConfig(config.companyProviders.companiesHouse);

/** Singleton — India MCA provider configuration. */
export const indiaMcaProviderConfig: IndiaMcaProviderConfig = buildIndiaMcaProviderConfig(
  config.companyProviders.indiaMca,
);
