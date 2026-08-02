/**
 * Ticker symbol normalization.
 */

/** Canonical exchange codes used by CompanyExchangeListing. */
export const EXCHANGE_CODES: ReadonlySet<string> = new Set([
  'NYSE',
  'NASDAQ',
  'AMEX',
  'LSE',
  'NSE',
  'BSE',
  'TSE',
  'HKEX',
  'SSE',
  'XETRA',
  'SWX',
  'TSX',
  'ASX',
  'JSE',
]);

/**
 * Normalize a ticker symbol: uppercase, trim and strip common exchange
 * suffixes (".NS", ".L", ".PA", ".TO", etc.).
 */
export function normalizeTicker(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\.(NS|BO|L|PA|DE|TO|V|MI|AS|SS|HK|T|AX|F|BE|NE|OL|ST|CO|MC|SW|BR)$/i, '')
    .trim();
}

/** True when the normalized ticker looks plausible (letters/digits/^-. only). */
export function isValidTicker(value: string): boolean {
  const normalized = normalizeTicker(value);
  return normalized.length > 0 && normalized.length <= 10 && /^[A-Z0-9.^*-]+$/.test(normalized);
}
