/**
 * Record normalizer — converts provider-mapped `CompanyRawData` into the fully
 * normalized `NormalizedCompanyData` shape the validator and pipeline consume.
 *
 * Every provider feeds through this same normalizer so that domain derivation,
 * name/status/identifier normalization and checksums are applied identically
 * regardless of source.
 */

import { createHash } from 'node:crypto';
import type { CompanyRawData, CompanyStatus, NormalizedCompanyData } from '../contracts';
import { normalizeIdentifierValue } from '../identifiers';
import { canonicalNameKey, normalizeCompanyName, normalizeDomain, parseJurisdiction } from '.';

export interface NormalizeRecordOptions {
  providerKey: string;
  providerRecordId: string;
  fetchedAt?: string;
  checksum?: string;
  rawReference?: string | null;
  /** Explicit jurisdiction override (alpha-2 / subdivision), if any. */
  jurisdiction?: string | null;
  /** Explicit country code override (ISO 3166-1 alpha-2). */
  countryCode?: string | null;
}

const STATUS_ALIASES: Readonly<Record<string, CompanyStatus>> = {
  active: 'active',
  registered: 'active',
  incorporated: 'active',
  live: 'active',
  current: 'active',
  'in registration': 'inactive',
  inactive: 'inactive',
  ceased: 'inactive',
  'converted-closed': 'inactive',
  dissolved: 'dissolved',
  'struck off': 'dissolved',
  'struck-off': 'dissolved',
  'in liquidation': 'liquidated',
  liquidation: 'liquidated',
  liquidated: 'liquidated',
  dormant: 'dormant',
};

export function mapCompanyStatus(value: string | null | undefined): CompanyStatus {
  if (!value) {
    return 'unknown';
  }
  const key = value.trim().toLowerCase();
  return STATUS_ALIASES[key] ?? 'unknown';
}

export class CompanyRecordNormalizer {
  normalize(data: CompanyRawData, options: NormalizeRecordOptions): NormalizedCompanyData {
    const name = data.name ?? data.legalName ?? '';
    const normalizedName = canonicalNameKey(name);

    const jurisdiction = options.jurisdiction ?? data.jurisdiction ?? null;
    const parsedJurisdiction = jurisdiction ? parseJurisdiction(jurisdiction) : null;
    const normalizedJurisdiction = parsedJurisdiction?.code ?? null;
    const countryCode =
      options.countryCode ?? data.countryCode ?? parsedJurisdiction?.countryCode ?? null;

    const domain =
      (data.domain ? normalizeDomain(data.domain) : null) ??
      (data.website ? this.deriveDomain(data.website) : null) ??
      null;

    const fetchedAt = options.fetchedAt ?? new Date().toISOString();
    const checksum =
      options.checksum ??
      this.computeChecksum({ name, jurisdiction: normalizedJurisdiction, ...data });

    return {
      providerKey: options.providerKey,
      providerRecordId: options.providerRecordId,
      name: name.trim(),
      legalName: data.legalName ?? null,
      normalizedName: normalizedName || normalizeCompanyName(name),
      jurisdiction: normalizedJurisdiction,
      countryCode,
      domain,
      website: data.website ?? null,
      aliases: (data.aliases ?? []).map((alias) => alias.trim()).filter(Boolean),
      identifiers: (data.identifiers ?? []).map((identifier) => ({
        type: identifier.type,
        value: identifier.value,
        normalizedValue: normalizeIdentifierValue(identifier.value, identifier.type),
        jurisdiction: identifier.jurisdiction ?? normalizedJurisdiction ?? null,
        registrar: identifier.registrar ?? null,
        validFrom: identifier.validFrom ?? null,
        validTo: identifier.validTo ?? null,
      })),
      addresses: (data.addresses ?? []).map((address) => ({
        ...address,
        addressLines: address.addressLines ?? [],
      })),
      websites: data.websites ?? [],
      industryClassifications: data.industryClassifications ?? [],
      exchangeListings: data.exchangeListings ?? [],
      status: mapCompanyStatus(data.status),
      foundedDate: data.foundedDate ?? null,
      incorporatedDate: data.incorporatedDate ?? null,
      description: data.description ?? null,
      validFrom: data.validFrom ?? null,
      validTo: data.validTo ?? null,
      fetchedAt,
      checksum,
      rawReference: options.rawReference ?? null,
    };
  }

  computeChecksum(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private deriveDomain(website: string): string | null {
    try {
      const url = new URL(website);
      const hostname = url.hostname.toLowerCase();
      if (!hostname || !hostname.includes('.')) {
        return null;
      }
      return normalizeDomain(hostname);
    } catch {
      return null;
    }
  }
}

export const companyRecordNormalizer = new CompanyRecordNormalizer();
