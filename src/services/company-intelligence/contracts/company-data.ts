/**
 * Company data contracts.
 *
 * These are the shared, provider-agnostic shapes that flow through the import
 * pipeline: provider → raw record → normalized company → validation →
 * resolution → persistence.
 */

import type { CompanyIdentifierInput } from './identifiers';

export type CompanyStatus =
  | 'active'
  | 'inactive'
  | 'dissolved'
  | 'dormant'
  | 'liquidated'
  | 'unknown';

export interface RawIdentifierInput {
  type: string;
  value: string;
  jurisdiction?: string | null;
  registrar?: string | null;
  issuedAt?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
}

export interface RawAddressInput {
  type?: string;
  addressLines?: string[];
  locality?: string | null;
  region?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  validFrom?: string | null;
  validTo?: string | null;
}

export interface RawWebsiteInput {
  url: string;
  kind?: string;
  isVerified?: boolean;
  validFrom?: string | null;
  validTo?: string | null;
}

export interface RawIndustryClassificationInput {
  system: string;
  code: string;
  label?: string | null;
  isPrimary?: boolean;
  validFrom?: string | null;
  validTo?: string | null;
}

export interface RawExchangeListingInput {
  exchange: string;
  ticker: string;
  currency?: string | null;
  isPrimary?: boolean;
  listingStatus?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
}

/**
 * Provider-mapped company data — the shape a provider emits after mapping its
 * raw payload (API response, JSON file) onto common fields, before the
 * domain normalizer / validator are applied.
 */
export interface CompanyRawData {
  name?: string | null;
  legalName?: string | null;
  jurisdiction?: string | null;
  countryCode?: string | null;
  domain?: string | null;
  website?: string | null;
  aliases?: string[] | null;
  identifiers?: RawIdentifierInput[] | null;
  addresses?: RawAddressInput[] | null;
  websites?: RawWebsiteInput[] | null;
  industryClassifications?: RawIndustryClassificationInput[] | null;
  exchangeListings?: RawExchangeListingInput[] | null;
  status?: string | null;
  foundedDate?: string | null;
  incorporatedDate?: string | null;
  description?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
}

/** Fully normalized company data ready for validation and persistence. */
export interface NormalizedCompanyData {
  providerKey: string;
  providerRecordId: string;
  name: string;
  legalName?: string | null;
  normalizedName: string;
  jurisdiction?: string | null;
  countryCode?: string | null;
  domain?: string | null;
  website?: string | null;
  aliases: string[];
  identifiers: CompanyIdentifierInput[];
  addresses: RawAddressInput[];
  websites: RawWebsiteInput[];
  industryClassifications: RawIndustryClassificationInput[];
  exchangeListings: RawExchangeListingInput[];
  status: CompanyStatus;
  foundedDate?: string | null;
  incorporatedDate?: string | null;
  description?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  fetchedAt: string;
  checksum: string;
  rawReference?: string | null;
}

/** A single raw record produced by a provider (streaming source). */
export interface ProviderCompanyRecord {
  providerKey: string;
  providerRecordId: string;
  fetchedAt: string;
  checksum: string;
  rawReference?: string | null;
  raw: unknown;
  data: CompanyRawData;
}

/** Metadata about a provider company record for provenance. */
export interface ProviderRecordMetadata {
  providerKey: string;
  providerRecordId: string;
  fetchedAt: string;
  checksum: string;
  rawReference?: string | null;
}
