import { validateRecruiterCreate, validateRecruiterAlias } from '../validation/recruiter.validation';

describe('Recruiter data foundation', () => {
  it('accepts valid recruiter create input', () => {
    const result = validateRecruiterCreate({
      canonicalName: 'Alicia Chen',
      source: 'crm',
      confidence: 0.92,
      verificationStatus: 'verified',
    });

    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects invalid recruiter create input', () => {
    const result = validateRecruiterCreate({
      canonicalName: '',
      source: 'crm',
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('accepts valid alias input', () => {
    const result = validateRecruiterAlias({
      alias: 'Alicia',
      normalizedAlias: 'alicia',
      source: 'crm',
    });

    expect(result.isValid).toBe(true);
  });

  it('rejects invalid alias input', () => {
    const result = validateRecruiterAlias({
      alias: '',
      normalizedAlias: 'alicia',
      source: 'crm',
    });

    expect(result.isValid).toBe(false);
  });
});
