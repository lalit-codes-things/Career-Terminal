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

export const IDENTIFIER_TYPES_SET: ReadonlySet<string> = new Set(Object.values(IDENTIFIER_TYPES));

export interface IdentifierNormalizationResult {
  type: string;
  originalValue: string;
  normalizedValue: string;
  valid: boolean;
  reason?: string;
}

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

function stripWhitespace(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, '');
}

function alphanumeric(value: string): string {
  return stripWhitespace(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function digits(value: string): string {
  return stripWhitespace(value)
    .replace(/^CIK:?/i, '')
    .replace(/\D/g, '');
}

function cikInputLooksNumeric(value: string): boolean {
  return (
    /^CIK:?\d{1,10}$/i.test(stripWhitespace(value)) || /^\d{1,10}$/.test(stripWhitespace(value))
  );
}

function iso7064Mod97(value: string): boolean {
  const expanded = value
    .toUpperCase()
    .split('')
    .map((char) => (/[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char))
    .join('');

  let remainder = 0;
  for (const char of expanded) {
    remainder = (remainder * 10 + Number(char)) % 97;
  }
  return remainder === 1;
}

function luhn(value: string): boolean {
  let sum = 0;
  let doubleDigit = false;
  for (let i = value.length - 1; i >= 0; i -= 1) {
    let digit = Number(value[i]);
    if (Number.isNaN(digit)) {
      return false;
    }
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

const TYPE_NORMALIZERS: Readonly<Record<string, (value: string) => string>> = {
  [IDENTIFIER_TYPES.CIK]: (v) => digits(v).padStart(10, '0'),
  [IDENTIFIER_TYPES.LEI]: alphanumeric,
  [IDENTIFIER_TYPES.EIN]: (v) => digits(v),
  [IDENTIFIER_TYPES.ISIN]: alphanumeric,
  [IDENTIFIER_TYPES.CIN]: alphanumeric,
  [IDENTIFIER_TYPES.PAN]: alphanumeric,
  [IDENTIFIER_TYPES.DUNS]: digits,
  [IDENTIFIER_TYPES.SIREN]: digits,
  [IDENTIFIER_TYPES.SIRET]: digits,
  [IDENTIFIER_TYPES.COMPANY_NUMBER]: alphanumeric,
};

/** Normalize an identifier value for canonical comparison. */
export function normalizeIdentifierValue(value: string, type?: string): string {
  const normalizer = type ? TYPE_NORMALIZERS[type] : undefined;
  if (normalizer) {
    return normalizer(value);
  }
  return stripWhitespace(value)
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');
}

const TYPE_VALIDATORS: Readonly<Record<string, (value: string) => boolean>> = {
  [IDENTIFIER_TYPES.CIK]: (v) => /^[0-9]{10}$/.test(v),
  [IDENTIFIER_TYPES.LEI]: (v) => /^[A-Z0-9]{18}[0-9]{2}$/.test(v) && iso7064Mod97(v),
  [IDENTIFIER_TYPES.EIN]: (v) => /^[0-9]{9}$/.test(v),
  [IDENTIFIER_TYPES.ISIN]: (v) =>
    /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(v) &&
    luhn(
      v
        .split('')
        .map((char) => (/[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char))
        .join(''),
    ),
  [IDENTIFIER_TYPES.CIN]: (v) => /^[A-Z]{1}[0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/.test(v),
  [IDENTIFIER_TYPES.PAN]: (v) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v),
  [IDENTIFIER_TYPES.DUNS]: (v) => /^[0-9]{9}$/.test(v),
  [IDENTIFIER_TYPES.SIREN]: (v) => /^[0-9]{9}$/.test(v) && luhn(v),
  [IDENTIFIER_TYPES.SIRET]: (v) => /^[0-9]{14}$/.test(v) && luhn(v),
  [IDENTIFIER_TYPES.COMPANY_NUMBER]: (v) => /^[A-Z0-9]{1,32}$/.test(v),
};

/** Validate an identifier value against scheme-specific format rules. */
export function isValidIdentifierValue(type: string, value: string): boolean {
  if (type === IDENTIFIER_TYPES.CIK && !cikInputLooksNumeric(value)) {
    return false;
  }
  const normalized = normalizeIdentifierValue(value, type);
  const validator = TYPE_VALIDATORS[type];
  if (!validator) {
    return normalized.length > 0;
  }
  return validator(normalized);
}

/** Normalize and validate in one pure operation without losing the original. */
export function normalizeIdentifier(type: string, value: string): IdentifierNormalizationResult {
  const normalizedValue = normalizeIdentifierValue(value, type);
  const valid = isValidIdentifierValue(type, value);
  return {
    type,
    originalValue: value,
    normalizedValue,
    valid,
    ...(valid ? {} : { reason: `Invalid ${type} identifier` }),
  };
}
