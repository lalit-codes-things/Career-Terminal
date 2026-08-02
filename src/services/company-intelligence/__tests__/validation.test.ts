import type { NormalizedCompanyData } from '../contracts';
import { CompanyValidator } from '../validation';

const baseRecord = (overrides: Partial<NormalizedCompanyData> = {}): NormalizedCompanyData => ({
  providerKey: 'companies-house',
  providerRecordId: '01234567',
  name: 'Acme Ltd',
  normalizedName: 'acme',
  jurisdiction: 'GB',
  countryCode: 'GB',
  aliases: [],
  identifiers: [{ type: 'company_number', value: '01234567', normalizedValue: '01234567' }],
  addresses: [],
  websites: [],
  industryClassifications: [],
  exchangeListings: [],
  status: 'active',
  fetchedAt: '2024-01-01T00:00:00.000Z',
  checksum: 'abc',
  ...overrides,
});

describe('CompanyValidator', () => {
  const validator = new CompanyValidator();

  it('accepts a valid record', () => {
    const report = validator.validate(baseRecord());
    expect(report.valid).toBe(true);
    expect(report.issues).toHaveLength(0);
  });

  it('flags a missing name', () => {
    const report = validator.validate(baseRecord({ name: '  ' }));
    expect(report.valid).toBe(false);
    expect(report.hasErrors).toBe(true);
    expect(report.issues.some((i) => i.code === 'MISSING_NAME')).toBe(true);
  });

  it('flags missing required identifier for the provider', () => {
    const report = validator.validate(
      baseRecord({ providerKey: 'sec', identifiers: [] }),
    );
    expect(report.valid).toBe(false);
    expect(report.issues.some((i) => i.code === 'MISSING_REQUIRED_IDENTIFIER')).toBe(true);
  });

  it('flags an invalid domain as an error', () => {
    const report = validator.validate(baseRecord({ domain: 'not a domain' }));
    expect(report.hasErrors).toBe(true);
    expect(report.issues.some((i) => i.code === 'INVALID_DOMAIN')).toBe(true);
  });

  it('flags a duplicate identifier within a record', () => {
    const report = validator.validate(
      baseRecord({
        identifiers: [
          { type: 'company_number', value: '01234567', normalizedValue: '01234567' },
          { type: 'company_number', value: '01234567', normalizedValue: '01234567' },
        ],
      }),
    );
    expect(report.hasErrors).toBe(true);
    expect(report.issues.some((i) => i.code === 'DUPLICATE_IDENTIFIER')).toBe(true);
  });

  it('flags invalid temporal range', () => {
    const report = validator.validate(
      baseRecord({ validFrom: '2024-06-01', validTo: '2024-01-01' }),
    );
    expect(report.hasErrors).toBe(true);
    expect(report.issues.some((i) => i.code === 'INVALID_TEMPORAL_RANGE')).toBe(true);
  });

  it('emits warnings that do not block validity', () => {
    const report = validator.validate(
      baseRecord({ websites: [{ url: 'not-a-url' }], aliases: ['  '] }),
    );
    expect(report.valid).toBe(true);
    expect(report.hasWarnings).toBe(true);
  });

  it('flags unknown identifier type as a warning', () => {
    const report = validator.validate(
      baseRecord({
        identifiers: [
          { type: 'company_number', value: '01234567', normalizedValue: '01234567' },
          { type: 'made-up', value: 'x', normalizedValue: 'x' },
        ],
      }),
    );
    expect(report.valid).toBe(true);
    expect(report.issues.some((i) => i.code === 'UNKNOWN_IDENTIFIER_TYPE')).toBe(true);
  });
});
