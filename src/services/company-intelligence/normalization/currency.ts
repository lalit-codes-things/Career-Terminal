/** ISO 4217 currency normalization. */

const CURRENCY_ALIASES: Readonly<Record<string, string>> = {
  DOLLAR: 'USD',
  'US DOLLAR': 'USD',
  USD: 'USD',
  POUND: 'GBP',
  STERLING: 'GBP',
  GBP: 'GBP',
  EURO: 'EUR',
  EUR: 'EUR',
  RUPEE: 'INR',
  'INDIAN RUPEE': 'INR',
  INR: 'INR',
};

const ISO_4217_CODES = new Set([
  'USD',
  'EUR',
  'GBP',
  'INR',
  'JPY',
  'CNY',
  'CAD',
  'AUD',
  'CHF',
  'HKD',
  'SGD',
  'SEK',
  'NOK',
  'DKK',
  'NZD',
  'ZAR',
  'BRL',
  'MXN',
  'KRW',
  'TWD',
  'AED',
  'SAR',
  'ILS',
  'PLN',
  'TRY',
  'IDR',
  'THB',
  'MYR',
  'PHP',
  'VND',
  'CZK',
  'HUF',
  'RON',
  'BGN',
  'ISK',
  'CLP',
  'COP',
  'PEN',
  'ARS',
]);

export function normalizeCurrencyCode(value: string): string | null {
  const normalized = value.normalize('NFKC').trim().toUpperCase().replace(/[_-]+/g, ' ');
  const aliased = CURRENCY_ALIASES[normalized] ?? normalized.replace(/\s+/g, '');
  return ISO_4217_CODES.has(aliased) ? aliased : null;
}

export function isValidCurrencyCode(value: string): boolean {
  return normalizeCurrencyCode(value) !== null;
}
