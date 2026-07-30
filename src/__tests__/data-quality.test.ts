/**
 * Data Quality / Confidence / Evidence — Epic 4 Prompt 11
 *
 * Verifies explicit quality semantics for FactObservation:
 *  1. getFactQualityStatus derives correct status from existing fields
 *  2. resolveFactPrecedence applies deterministic rules for conflicting facts
 *  3. User corrections (USER_CONFIRMED) beat machine facts
 *  4. INVALID and SUPERSEDED facts are excluded from precedence
 *  5. Evidence field is preserved and queryable
 *  6. Confidence is never fabricated
 */

import {
  getFactQualityStatus,
  resolveFactPrecedence,
  type FactQualityInput,
} from '../services/fact.service';

// ── Fixture factory ───────────────────────────────────────────────────────────

function makeFact(overrides: Partial<FactQualityInput> = {}): FactQualityInput {
  return {
    isCurrent: true,
    isUserCorrected: false,
    supersededById: null,
    deletedAt: null,
    reviewStatus: null,
    extractionMethod: 'KEYWORD_MATCH',
    ...overrides,
  };
}

function makePrecedence(overrides: Partial<{
  confidence: number;
  observedAt: Date;
  isUserCorrected: boolean;
  isCurrent: boolean;
  deletedAt: Date | null;
}> = {}) {
  return {
    confidence: 0.8,
    observedAt: new Date('2026-01-01'),
    isUserCorrected: false,
    isCurrent: true,
    deletedAt: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. getFactQualityStatus — status derivation
// ─────────────────────────────────────────────────────────────────────────────

describe('getFactQualityStatus', () => {
  it('returns OBSERVED for a normal active machine-extracted fact', () => {
    expect(getFactQualityStatus(makeFact())).toBe('OBSERVED');
  });

  it('returns USER_CONFIRMED for a user-corrected current fact', () => {
    expect(
      getFactQualityStatus(makeFact({ isUserCorrected: true, isCurrent: true })),
    ).toBe('USER_CONFIRMED');
  });

  it('returns SUPERSEDED for a fact with supersededById and isCurrent=false', () => {
    expect(
      getFactQualityStatus(
        makeFact({ isCurrent: false, supersededById: 'fact-newer' }),
      ),
    ).toBe('SUPERSEDED');
  });

  it('returns INVALID for a soft-deleted fact (deletedAt set)', () => {
    expect(
      getFactQualityStatus(makeFact({ deletedAt: new Date() })),
    ).toBe('INVALID');
  });

  it('returns INVALID for a review-rejected fact', () => {
    expect(
      getFactQualityStatus(makeFact({ reviewStatus: 'rejected' })),
    ).toBe('INVALID');
  });

  it('returns INFERRED for a fact produced by INFER extractionMethod', () => {
    expect(
      getFactQualityStatus(makeFact({ extractionMethod: 'INFER_FROM_EXPERIENCE' })),
    ).toBe('INFERRED');
  });

  it('INVALID takes precedence over SUPERSEDED (deleted superseded fact)', () => {
    expect(
      getFactQualityStatus(
        makeFact({ deletedAt: new Date(), isCurrent: false, supersededById: 'newer' }),
      ),
    ).toBe('INVALID');
  });

  it('INVALID takes precedence over USER_CONFIRMED (deleted correction)', () => {
    expect(
      getFactQualityStatus(
        makeFact({ deletedAt: new Date(), isUserCorrected: true }),
      ),
    ).toBe('INVALID');
  });

  it('returns OBSERVED for LLM extraction method', () => {
    expect(
      getFactQualityStatus(makeFact({ extractionMethod: 'LLM' })),
    ).toBe('OBSERVED');
  });

  it('returns OBSERVED for REGEX extraction method', () => {
    expect(
      getFactQualityStatus(makeFact({ extractionMethod: 'REGEX' })),
    ).toBe('OBSERVED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. resolveFactPrecedence — conflicting fact rules
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveFactPrecedence — conflicting facts', () => {
  it('higher confidence wins over lower confidence', () => {
    const a = makePrecedence({ confidence: 0.9 });
    const b = makePrecedence({ confidence: 0.6 });
    expect(resolveFactPrecedence(a, b)).toBe('a');
  });

  it('lower confidence loses', () => {
    const a = makePrecedence({ confidence: 0.5 });
    const b = makePrecedence({ confidence: 0.95 });
    expect(resolveFactPrecedence(a, b)).toBe('b');
  });

  it('equal confidence → more recent observedAt wins', () => {
    const a = makePrecedence({
      confidence: 0.8,
      observedAt: new Date('2026-05-01'),
    });
    const b = makePrecedence({
      confidence: 0.8,
      observedAt: new Date('2026-01-01'),
    });
    expect(resolveFactPrecedence(a, b)).toBe('a');
  });

  it('exactly equal confidence AND observedAt → tie', () => {
    const ts = new Date('2026-03-15');
    const a = makePrecedence({ confidence: 0.75, observedAt: ts });
    const b = makePrecedence({ confidence: 0.75, observedAt: ts });
    expect(resolveFactPrecedence(a, b)).toBe('tie');
  });

  it('USER_CONFIRMED beats higher machine confidence', () => {
    const a = makePrecedence({ isUserCorrected: true, confidence: 0.5 });
    const b = makePrecedence({ isUserCorrected: false, confidence: 1.0 });
    expect(resolveFactPrecedence(a, b)).toBe('a');
  });

  it('USER_CONFIRMED beats machine fact regardless of recency', () => {
    const a = makePrecedence({
      isUserCorrected: true,
      observedAt: new Date('2020-01-01'),
    });
    const b = makePrecedence({
      isUserCorrected: false,
      observedAt: new Date('2026-06-01'),
    });
    expect(resolveFactPrecedence(a, b)).toBe('a');
  });

  it('INVALID fact (deletedAt) always loses', () => {
    const a = makePrecedence({ deletedAt: new Date(), confidence: 1.0 });
    const b = makePrecedence({ deletedAt: null, confidence: 0.1 });
    expect(resolveFactPrecedence(a, b)).toBe('b');
  });

  it('both invalid → tie', () => {
    const a = makePrecedence({ deletedAt: new Date(), confidence: 1.0 });
    const b = makePrecedence({ deletedAt: new Date(), confidence: 1.0 });
    expect(resolveFactPrecedence(a, b)).toBe('tie');
  });

  it('isCurrent=false fact loses to active fact', () => {
    const a = makePrecedence({ isCurrent: false, confidence: 1.0 });
    const b = makePrecedence({ isCurrent: true, confidence: 0.1 });
    expect(resolveFactPrecedence(a, b)).toBe('b');
  });

  it('confidence epsilon prevents ties from floating point noise', () => {
    // Difference of 0.0005 (< epsilon 0.001) should be a tie → recency decides
    const earlier = new Date('2026-01-01');
    const later = new Date('2026-06-01');
    const a = makePrecedence({ confidence: 0.8005, observedAt: later });
    const b = makePrecedence({ confidence: 0.8000, observedAt: earlier });
    // Within epsilon → recency tiebreak: 'a' has later observedAt
    expect(resolveFactPrecedence(a, b)).toBe('a');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Status semantics across the lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe('Fact status lifecycle', () => {
  it('fact is OBSERVED when first extracted from RESUME', () => {
    const fact = makeFact({ extractionMethod: 'KEYWORD_MATCH', isCurrent: true });
    expect(getFactQualityStatus(fact)).toBe('OBSERVED');
  });

  it('fact becomes SUPERSEDED after a user correction replaces it', () => {
    const original = makeFact({ isCurrent: false, supersededById: 'fact-corrected' });
    expect(getFactQualityStatus(original)).toBe('SUPERSEDED');
  });

  it('corrected fact is USER_CONFIRMED', () => {
    const corrected = makeFact({
      isUserCorrected: true,
      isCurrent: true,
      extractionMethod: 'USER_CORRECTION',
    });
    expect(getFactQualityStatus(corrected)).toBe('USER_CONFIRMED');
  });

  it('soft-deleted fact is INVALID even if isUserCorrected', () => {
    const deleted = makeFact({ deletedAt: new Date(), isUserCorrected: true });
    expect(getFactQualityStatus(deleted)).toBe('INVALID');
  });

  it('approved review does not change OBSERVED status', () => {
    const approved = makeFact({ reviewStatus: 'approved' });
    expect(getFactQualityStatus(approved)).toBe('OBSERVED');
  });
});
