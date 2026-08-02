import {
  isValidCountryCode,
  isValidCurrencyCode,
  isValidIdentifierValue,
  isValidTicker,
  isValidTimeZone,
  normalizeCompanyName,
  normalizeCurrencyCode,
  normalizeDisplayName,
  normalizeDomain,
  normalizeIdentifier,
  normalizeIdentifierValue,
  normalizeTicker,
  normalizeTimeZone,
} from '../normalization';

describe('company intelligence identifier normalization', () => {
  it('normalizes and zero-pads SEC CIK values', () => {
    expect(normalizeIdentifierValue(' CIK: 320193 ', 'cik')).toBe('0000320193');
    expect(isValidIdentifierValue('cik', '320193')).toBe(true);
  });

  it('validates LEI checksum and canonical format', () => {
    expect(normalizeIdentifierValue('5493001kjtiigc8y1r12', 'lei')).toBe('5493001KJTIIGC8Y1R12');
    expect(isValidIdentifierValue('lei', '5493001KJTIIGC8Y1R12')).toBe(true);
    expect(isValidIdentifierValue('lei', '5493000HKUKQ3C9W3K19')).toBe(false);
  });

  it('validates ISIN checksum and canonical format', () => {
    expect(normalizeIdentifierValue(' us-0378331005 ', 'isin')).toBe('US0378331005');
    expect(isValidIdentifierValue('isin', 'US0378331005')).toBe(true);
    expect(isValidIdentifierValue('isin', 'US0378331006')).toBe(false);
  });

  it('normalizes Companies House numbers and Indian CIN values', () => {
    expect(normalizeIdentifierValue(' sc-000001 ', 'company_number')).toBe('SC000001');
    expect(normalizeIdentifierValue(' u74999dl2019ptc345678 ', 'cin')).toBe(
      'U74999DL2019PTC345678',
    );
    expect(isValidIdentifierValue('cin', 'U74999DL2019PTC345678')).toBe(true);
  });

  it('normalizes ticker symbols without exchange suffixes', () => {
    expect(normalizeTicker(' infy.ns ')).toBe('INFY');
    expect(isValidTicker('BRK.B')).toBe(true);
  });

  it('returns a structured normalization result without losing original values', () => {
    expect(normalizeIdentifier('cik', ' 320193 ')).toEqual({
      type: 'cik',
      originalValue: ' 320193 ',
      normalizedValue: '0000320193',
      valid: true,
    });
  });
});

describe('company intelligence shared normalization', () => {
  it('normalizes legal names while preserving comparable core names', () => {
    expect(normalizeCompanyName('Acme Private Limited')).toBe('acme private limited');
    expect(normalizeDisplayName('ACME Pvt Ltd')).toBe('Acme');
  });

  it('normalizes web domains and internationalized domains', () => {
    expect(normalizeDomain('https://www.Example.com/path?q=1')).toBe('example.com');
    expect(normalizeDomain('https://bücher.example/')).toBe('xn--bcher-kva.example');
    expect(normalizeDomain('not a domain')).toBeNull();
  });

  it('normalizes country codes, currencies, and time zones', () => {
    expect(isValidCountryCode('USA')).toBe(true);
    expect(normalizeCurrencyCode('indian rupee')).toBe('INR');
    expect(isValidCurrencyCode('NOPE')).toBe(false);
    expect(normalizeTimeZone('UTC')).toBe('Etc/UTC');
    expect(normalizeTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});
