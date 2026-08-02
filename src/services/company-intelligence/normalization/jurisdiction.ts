/**
 * Jurisdiction normalization.
 *
 * A jurisdiction is either a bare ISO 3166-1 alpha-2 country code ("GB") or a
 * country code with an ISO 3166-2 subdivision suffix ("US-DE", "GB-ENG").
 */

import { isCountryAlpha2, normalizeCountryCode } from './country';

export interface ParsedJurisdiction {
  /** Full jurisdiction code, e.g. "US-DE". */
  code: string;
  /** ISO 3166-1 alpha-2 country component. */
  countryCode: string;
  /** ISO 3166-2 subdivision (optional), e.g. "DE". */
  subdivision: string | null;
}

/**
 * Parse a jurisdiction code into its components.
 * Returns null when the value is not a recognizable jurisdiction.
 */
export function parseJurisdiction(value: string): ParsedJurisdiction | null {
  const cleaned = value.trim().toUpperCase();
  if (!cleaned) {
    return null;
  }

  const parts = cleaned.split('-');
  const countryPart = parts[0] ?? '';

  if (parts.length === 1) {
    const country = normalizeCountryCode(countryPart);
    if (!country) {
      return null;
    }
    return { code: country, countryCode: country, subdivision: null };
  }

  const country = normalizeCountryCode(countryPart);
  if (!country) {
    return null;
  }

  const subdivision = parts.slice(1).join('-');
  if (!subdivision) {
    return { code: country, countryCode: country, subdivision: null };
  }

  return { code: `${country}-${subdivision}`, countryCode: country, subdivision };
}

/**
 * Normalize a jurisdiction string to a canonical code (uppercase).
 * Returns null when unparseable.
 */
export function normalizeJurisdiction(value: string): string | null {
  const parsed = parseJurisdiction(value);
  return parsed?.code ?? null;
}

/** Validate that a jurisdiction code is well-formed. */
export function isValidJurisdiction(value: string): boolean {
  if (!value || value.length > 10) {
    return false;
  }
  const parsed = parseJurisdiction(value);
  return parsed !== null && isCountryAlpha2(parsed.countryCode);
}
