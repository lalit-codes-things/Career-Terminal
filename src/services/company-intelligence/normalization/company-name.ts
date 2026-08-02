/**
 * Company name normalization utilities.
 *
 * These functions are provider-agnostic: SEC, Companies House and India MCA
 * raw company names all flow through the same normalizer so a canonical
 * display name and a deterministic comparison key are produced identically.
 */

import { stripLegalSuffixes } from './legal-suffix';

const NON_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu;

/**
 * Normalize a company name to a comparable form:
 * lowercase, legal suffixes and punctuation removed, whitespace collapsed.
 */
export function normalizeCompanyName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(NON_ALPHANUMERIC, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize a company name for display: strip legal suffixes and title-case
 * the remaining words.
 */
export function normalizeDisplayName(value: string): string {
  const stripped = stripLegalSuffixes(value);
  if (!stripped) {
    return titleCase(value);
  }
  return titleCase(stripped);
}

/** Title-case a name (each word capitalized, remainder lowercased). */
export function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

/** Build the canonical comparison key used by entity resolution. */
export function canonicalNameKey(value: string): string {
  return normalizeCompanyName(stripLegalSuffixes(value));
}

/** True when a name is empty after normalization. */
export function isEmptyName(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}
