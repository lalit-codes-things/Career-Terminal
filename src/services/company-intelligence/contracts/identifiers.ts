/**
 * Identifier contract shared across providers, normalization and persistence.
 */

export const IDENTIFIER_TYPES = {
  COMPANY_NUMBER: 'company_number',
  LEI: 'lei',
  EIN: 'ein',
  VAT: 'vat',
  CIK: 'cik',
  TAX_ID: 'tax_id',
  ISIN: 'isin',
  CIN: 'cin',
  PAN: 'pan',
  DUNS: 'duns',
  SIREN: 'siren',
  SIRET: 'siret',
} as const;

export type IdentifierType = (typeof IDENTIFIER_TYPES)[keyof typeof IDENTIFIER_TYPES];

export interface CompanyIdentifierInput {
  type: string;
  value: string;
  normalizedValue: string;
  jurisdiction?: string | null;
  registrar?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
}
