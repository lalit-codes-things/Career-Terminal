import {
  IDENTIFIER_TYPES,
  REQUIRED_IDENTIFIERS_BY_JURISDICTION,
  REQUIRED_IDENTIFIERS_BY_PROVIDER,
  isKnownIdentifierType,
  isValidIdentifierValue,
  normalizeIdentifierValue,
} from '../identifiers';

describe('identifier catalogue', () => {
  it('exposes expected types', () => {
    expect(IDENTIFIER_TYPES.COMPANY_NUMBER).toBe('company_number');
    expect(IDENTIFIER_TYPES.CIK).toBe('cik');
    expect(IDENTIFIER_TYPES.CIN).toBe('cin');
  });

  it('recognizes known types', () => {
    expect(isKnownIdentifierType('lei')).toBe(true);
    expect(isKnownIdentifierType('nonsense')).toBe(false);
  });
});

describe('normalizeIdentifierValue', () => {
  it('strips whitespace, uppercases, keeps structural chars', () => {
    expect(normalizeIdentifierValue(' us-1234 ')).toBe('US-1234');
  });
  it('normalizes CIK with leading zeros preserved as digits', () => {
    expect(normalizeIdentifierValue('320193', 'cik')).toBe('0000320193');
  });
});

describe('isValidIdentifierValue', () => {
  it('validates CIK', () => {
    expect(isValidIdentifierValue('cik', '320193')).toBe(true);
    expect(isValidIdentifierValue('cik', '12x')).toBe(false);
  });
  it('validates LEI', () => {
    expect(isValidIdentifierValue('lei', '5493001KJTIIGC8Y1R12')).toBe(true);
    expect(isValidIdentifierValue('lei', 'short')).toBe(false);
  });
  it('validates EIN with or without dash', () => {
    expect(isValidIdentifierValue('ein', '12-3456789')).toBe(true);
    expect(isValidIdentifierValue('ein', '123456789')).toBe(true);
  });
  it('validates CIN', () => {
    expect(isValidIdentifierValue('cin', 'U74999DL2019PTC345678')).toBe(true);
    expect(isValidIdentifierValue('cin', 'not-a-cin')).toBe(false);
  });
  it('passes unknown types with any non-empty value', () => {
    expect(isValidIdentifierValue('tax_id', 'anything')).toBe(true);
  });
});

describe('required identifiers', () => {
  it('lists per-jurisdiction requirements', () => {
    expect(REQUIRED_IDENTIFIERS_BY_JURISDICTION.GB).toContain('company_number');
  });
  it('lists per-provider requirements', () => {
    expect(REQUIRED_IDENTIFIERS_BY_PROVIDER.sec).toContain('cik');
    expect(REQUIRED_IDENTIFIERS_BY_PROVIDER['companies-house']).toContain('company_number');
    expect(REQUIRED_IDENTIFIERS_BY_PROVIDER['india-mca']).toContain('cin');
  });
});
