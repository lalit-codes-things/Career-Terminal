/**
 * Domain normalization utilities.
 *
 * Domains arrive from providers in many shapes (with protocol, trailing
 * slash, uppercase, www prefix, IDN). These helpers normalize them to a
 * canonical comparable form.
 */

import { domainToASCII } from 'node:url';

/** Common multi-part public suffixes used when the full PSL is unavailable. */
const MULTI_PART_SUFFIXES: readonly string[] = [
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'com.br',
  'com.mx',
  'co.in',
  'firm.in',
  'org.in',
  'gen.in',
  'co.jp',
  'or.jp',
  'com.cn',
  'com.sg',
  'co.za',
  'com.hk',
];

/** Strip scheme, www, port, path and query from a domain-ish string. */
export function cleanDomain(value: string): string {
  let cleaned = value.trim().toLowerCase();

  // Strip scheme
  cleaned = cleaned.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  // Strip protocol-relative //
  cleaned = cleaned.replace(/^\/\//, '');
  // Strip path / query / fragment
  cleaned = cleaned.split(/[/?#]/)[0] ?? cleaned;
  // Strip trailing dot
  cleaned = cleaned.replace(/\.+$/, '');
  // Strip leading @ (email-ish input)
  cleaned = cleaned.replace(/^@+/, '');

  return cleaned.trim();
}

/**
 * Normalize a domain to a canonical comparable form.
 * Returns null when the input is empty or not a plausible domain.
 */
export function normalizeDomain(value: string): string | null {
  const cleaned = cleanDomain(value);
  if (!cleaned) {
    return null;
  }

  // Reject input that is clearly not a hostname (has spaces).
  if (/\s/.test(cleaned)) {
    return null;
  }

  let host = cleaned;
  if (host.startsWith('www.')) {
    host = host.slice(4);
  }

  // Convert IDN to ASCII (punycode) — no-op for ASCII input.
  try {
    host = domainToASCII(host);
  } catch {
    return null;
  }

  // Basic hostname sanity: at least one dot and valid label characters.
  if (!host.includes('.') || !/^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/i.test(host)) {
    return null;
  }

  return host.toLowerCase();
}

/**
 * Extract the registrable ("root") domain using a small built-in suffix list.
 * Returns the raw cleaned input when it cannot be decomposed.
 */
export function extractRootDomain(value: string): string {
  const cleaned = cleanDomain(value);
  const labels = cleaned.split('.');
  if (labels.length < 2) {
    return cleaned;
  }

  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_PART_SUFFIXES.includes(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join('.');
  }

  return lastTwo;
}

/** Extract the second-level label (the part before the TLD). */
export function extractDomainLabel(value: string): string {
  const cleaned = cleanDomain(value);
  const labels = cleaned.split('.');
  if (labels.length < 2) {
    return cleaned;
  }
  return labels[labels.length - 2] ?? cleaned;
}
