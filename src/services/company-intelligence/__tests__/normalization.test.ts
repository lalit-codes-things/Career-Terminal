import {
  canonicalNameKey,
  companyRecordNormalizer,
  isFutureTimestamp,
  isValidCountryCode,
  isValidJurisdiction,
  isValidTemporalRange,
  isValidTimestamp,
  normalizeCompanyName,
  normalizeCountryCode,
  normalizeDisplayName,
  normalizeDomain,
  normalizeJurisdiction,
  normalizeTicker,
} from '../normalization';

describe('normalizeCompanyName', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalizeCompanyName('  ACME   Corp., Ltd.  ')).toBe('acme corp ltd');
  });
  it('handles empty input', () => {
    expect(normalizeCompanyName('')).toBe('');
  });
});

describe('canonicalNameKey', () => {
  it('strips legal suffixes for comparison', () => {
    expect(canonicalNameKey('Acme Ltd')).toBe('acme');
    expect(canonicalNameKey('Acme Limited')).toBe('acme');
  });
});

describe('normalizeDisplayName', () => {
  it('title-cases and strips legal suffixes', () => {
    expect(normalizeDisplayName('acme limited')).toBe('Acme');
  });
});

describe('normalizeDomain', () => {
  it('normalizes scheme, www and case', () => {
    expect(normalizeDomain('HTTPS://www.Example.COM/')).toBe('example.com');
  });
  it('rejects invalid domains', () => {
    expect(normalizeDomain('not a domain')).toBeNull();
    expect(normalizeDomain('')).toBeNull();
  });
});

describe('country normalization', () => {
  it('accepts alpha-2 and alpha-3 codes', () => {
    expect(normalizeCountryCode('gb')).toBe('GB');
    expect(normalizeCountryCode('GBR')).toBe('GB');
  });
  it('validates codes', () => {
    expect(isValidCountryCode('US')).toBe(true);
    expect(isValidCountryCode('XX')).toBe(false);
  });
});

describe('jurisdiction normalization', () => {
  it('normalizes country and subdivision codes', () => {
    expect(normalizeJurisdiction('gb')).toBe('GB');
    expect(normalizeJurisdiction('us-de')).toBe('US-DE');
  });
  it('validates jurisdiction codes', () => {
    expect(isValidJurisdiction('GB-ENG')).toBe(true);
    expect(isValidJurisdiction('not-real')).toBe(false);
  });
});

describe('ticker normalization', () => {
  it('uppercases tickers', () => {
    expect(normalizeTicker('aapl')).toBe('AAPL');
  });
});

describe('timestamp helpers', () => {
  it('validates timestamps', () => {
    expect(isValidTimestamp('2024-01-01')).toBe(true);
    expect(isValidTimestamp('not-a-date')).toBe(false);
  });
  it('detects future timestamps beyond tolerance', () => {
    const now = new Date('2024-01-01T00:00:00Z');
    expect(isFutureTimestamp('2025-01-01', now, 0)).toBe(true);
    expect(isFutureTimestamp('2024-01-10', now, 30 * 24 * 60 * 60 * 1000)).toBe(false);
  });
  it('validates temporal ranges', () => {
    expect(isValidTemporalRange('2024-01-01', '2024-06-01')).toBe(true);
    expect(isValidTemporalRange('2024-06-01', '2024-01-01')).toBe(false);
    expect(isValidTemporalRange(null, null)).toBe(true);
  });
});

describe('CompanyRecordNormalizer', () => {
  it('normalizes a raw record into the full normalized shape', () => {
    const normalized = companyRecordNormalizer.normalize(
      {
        name: '  ACME Limited  ',
        legalName: 'ACME Limited',
        jurisdiction: 'GB',
        website: 'https://www.acme.example.co.uk',
        identifiers: [{ type: 'company_number', value: '01234567' }],
        status: 'active',
        incorporatedDate: '2001-02-03',
        aliases: ['ACME Trading'],
      },
      { providerKey: 'companies-house', providerRecordId: '01234567' },
    );

    expect(normalized.name).toBe('ACME Limited');
    expect(normalized.normalizedName).toBe('acme');
    expect(normalized.jurisdiction).toBe('GB');
    expect(normalized.countryCode).toBe('GB');
    expect(normalized.domain).toBe('acme.example.co.uk');
    expect(normalized.status).toBe('active');
    expect(normalized.identifiers[0]?.normalizedValue).toBe('01234567');
    expect(normalized.checksum).toHaveLength(64);
    expect(normalized.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('derives jurisdiction from a subdivision code', () => {
    const normalized = companyRecordNormalizer.normalize(
      { name: 'X' },
      { providerKey: 'sec', providerRecordId: '1', jurisdiction: 'US-DE' },
    );
    expect(normalized.jurisdiction).toBe('US-DE');
    expect(normalized.countryCode).toBe('US');
  });
});
