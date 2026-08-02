/**
 * Identifier type catalogue for company intelligence.
 *
 * The database stores identifiers with a free-form `type` string so new
 * identifier types can be introduced by future providers without a migration.
 * This module is the canonical, provider-agnostic vocabulary plus per-type
 * validation and normalization helpers.
 */

export const IDENTIFIER_TYPES = {
  /** Registrar company number (Companies House, MCA, etc.). */
  COMPANY_NUMBER: 'company_number',
  /** Legal Entity Identifier (GLEIF). */
  LEI: 'lei',
  /** US Employer Identification Number. */
  EIN: 'ein',
  /** Value Added Tax identifier. */
  VAT: 'vat',
  /** SEC Central Index Key (numeric). */
  CIK: 'cik',
  /** Generic national tax identifier. */
  TAX_ID: 'tax_id',
  /** International Securities Identification Number. */
  ISIN: 'isin',
  /** India Corporate Identification Number (CIN). */
  CIN: 'cin',
  /** India Permanent Account Number (PAN). */
  PAN: 'pan',
  /** Dun & Bradstreet D-U-N-S number. */
  DUNS: 'duns',
  /** France SIREN. */
  SIREN: 'siren',
  /** France SIRET. */
  SIRET: 'siret',
} as const;

export type IdentifierType = (typeof IDENTIFIER_TYPES)[keyof typeof IDENTIFIER_TYPES];

export const IDENTIFIER_TYPES_SET: ReadonlySet<string> = new Set(
  Object.values(IDENTIFIER_TYPES),
);

/** True when a type string is a known catalogue type. */
export function isKnownIdentifierType(type: string): boolean {
  return IDENTIFIER_TYPES_SET.has(type);
}

/**
 * Per-jurisdiction required identifier types. A company record coming from a
 * provider whose primary jurisdiction lists a required identifier type must
 * carry at least one identifier of that type to be considered valid.
 */
export const REQUIRED_IDENTIFIERS_BY_JURISDICTION: Readonly<Record<string, readonly string[]>> = {
  US: [IDENTIFIER_TYPES.COMPANY_NUMBER, IDENTIFIER_TYPES.EIN, IDENTIFIER_TYPES.CIK],
  GB: [IDENTIFIER_TYPES.COMPANY_NUMBER],
  IN: [IDENTIFIER_TYPES.CIN],
};

/** Required identifier types for a given provider key (provider-specific). */
export const REQUIRED_IDENTIFIERS_BY_PROVIDER: Readonly<Record<string, readonly string[]>> = {
  sec: [IDENTIFIER_TYPES.CIK],
  'companies-house': [IDENTIFIER_TYPES.COMPANY_NUMBER],
  'india-mca': [IDENTIFIER_TYPES.CIN],
};

/**
 * Normalize an identifier value for canonical comparison.
 *
 * Rule of thumb: identifiers are case-insensitive and whitespace-insensitive.
 * We strip whitespace, convert to uppercase and keep only alphanumeric
 * characters (plus a few structural separators where they are significant).
 * Structural characters are preserved for CIN/ISIN/VAT because they carry
 * semantic meaning in those schemes.
 */
export function normalizeIdentifierValue(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9-]/g, '');
}

const TYPE_VALIDATORS: Readonly<Record<string, (value: string) => boolean>> = {
  [IDENTIFIER_TYPES.CIK]: (v) => /^[0-9]{1,10}$/.test(v),
  [IDENTIFIER_TYPES.LEI]: (v) => /^[A-Z0-9]{20}$/.test(v),
  [IDENTIFIER_TYPES.EIN]: (v) => /^[0-9]{2}-?[0-9]{7}$/.test(v.replace('-', '')),
  [IDENTIFIER_TYPES.ISIN]: (v) => /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(v),
  [IDENTIFIER_TYPES.CIN]: (v) =>
    /^[A-Z]{1}[0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/.test(v),
  [IDENTIFIER_TYPES.PAN]: (v) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v),
  [IDENTIFIER_TYPES.DUNS]: (v) => /^[0-9]{9}$/.test(v),
  [IDENTIFIER_TYPES.SIREN]: (v) => /^[0-9]{9}$/.test(v),
  [IDENTIFIER_TYPES.SIRET]: (v) => /^[0-9]{14}$/.test(v),
};

/**
 * Validate an identifier value against the scheme-specific format rules.
 * Returns true when the type has no specific validator (or the value matches).
 */
export function isValidIdentifierValue(type: string, value: string): boolean {
  const validator = TYPE_VALIDATORS[type];
  if (!validator) {
    return value.trim().length > 0;
  }
  return validator(normalizeIdentifierValue(value));
}
