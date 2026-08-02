/**
 * Legal suffix normalization for company names.
 *
 * A shared, provider-agnostic vocabulary of legal form suffixes and helpers
 * to strip them from company names when deriving canonical display names.
 */

/**
 * Canonical legal suffixes by family. Keys are the canonical form emitted by
 * `normalizeLegalSuffix`; values are the accepted variants (all lowercase).
 */
export const LEGAL_SUFFIX_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  INC: ['inc', 'incorporated', 'incorp'],
  LLC: ['llc', 'l.l.c', 'limited liability company'],
  LTD: ['ltd', 'limited'],
  CORP: ['corp', 'corporation'],
  CO: ['co', 'company'],
  PLC: ['plc', 'public limited company'],
  GMBH: ['gmbh'],
  AG: ['ag'],
  SA: ['sa', 'societe anonyme', 'sociedad anonima', 'société anonyme'],
  BV: ['bv', 'besloten vennootschap'],
  NV: ['nv', 'naamloze vennootschap'],
  SARL: ['sarl', 's.a.r.l'],
  SAS: ['sas'],
  PTY: ['pty', 'proprietary'],
  PTE: ['pte', 'private', 'pvt'],
  LLP: ['llp'],
  LP: ['lp'],
  KK: ['kk', 'kabushiki kaisha'],
  OY: ['oy', 'osakeyhtio', 'osakeyhtiö'],
  AB: ['ab', 'aktiebolag'],
  SPA: ['spa', 's.p.a'],
};

/** Flat set of every accepted variant for fast lookup. */
const LEGAL_SUFFIX_VARIANTS: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [canonical, variants] of Object.entries(LEGAL_SUFFIX_FAMILIES)) {
    for (const variant of variants) {
      map.set(variant, canonical);
    }
  }
  return map;
})();

/** True when the given token is a recognized legal suffix variant. */
export function isLegalSuffix(token: string): boolean {
  return LEGAL_SUFFIX_VARIANTS.has(token.trim().toLowerCase());
}

/** Map a legal suffix variant to its canonical family, or null when unknown. */
export function normalizeLegalSuffix(token: string): string | null {
  return LEGAL_SUFFIX_VARIANTS.get(token.trim().toLowerCase()) ?? null;
}

/** Collapse a raw token into a comparable form (letters/digits only). */
export function normalizeCompanyToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '')
    .replace(/\./g, '');
}

/**
 * Strip trailing legal suffixes from a company name.
 *
 * @param name  Raw company name.
 * @returns The name with recognized legal suffixes removed from the end.
 */
export function stripLegalSuffixes(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  while (parts.length > 0) {
    const last = parts[parts.length - 1] ?? '';
    if (!isLegalSuffix(last)) {
      break;
    }
    parts.pop();
  }

  return parts.join(' ').trim();
}
