import { OpportunityTypeRegistry, BUILT_IN_OPPORTUNITY_TYPES } from '../registry';
import { OpportunityIntelligenceEngine } from '../engine';
import { Opportunity } from '../model';

const makeOpportunity = (overrides: Partial<Opportunity> = {}): Opportunity => ({
  id: 'opp-1',
  opportunityTypeId: 'external_job',
  title: 'Senior Software Engineer',
  companyName: 'Acme Corp',
  location: { countryCode: 'US', city: 'San Francisco', remoteModel: 'hybrid' },
  employmentType: 'full_time',
  source: 'linkedin',
  confidence: 0.85,
  validFrom: new Date('2024-01-01'),
  provenance: {
    provider: 'linkedin-scraper',
    collectedAt: new Date('2024-01-02'),
    sourceUrl: 'https://linkedin.com/jobs/123'
  },
  metadata: {},
  currentVersion: 1,
  versions: [],
  ...overrides
});

describe('Opportunity Intelligence Framework', () => {
  let registry: OpportunityTypeRegistry;
  let engine: OpportunityIntelligenceEngine;

  beforeEach(() => {
    registry = new OpportunityTypeRegistry();
    BUILT_IN_OPPORTUNITY_TYPES.forEach(t => registry.register(t));
    engine = new OpportunityIntelligenceEngine(registry);
  });

  // ─── Registry ────────────────────────────────────────────────────────────────

  describe('OpportunityTypeRegistry', () => {
    it('registers all built-in types', () => {
      expect(registry.getAll()).toHaveLength(5);
    });

    it('retrieves a type by id', () => {
      const def = registry.get('referral');
      expect(def?.name).toBe('Referral');
      expect(def?.requiresCompany).toBe(true);
    });

    it('throws on duplicate registration', () => {
      expect(() =>
        registry.register({ id: 'external_job', name: 'X', description: 'X', requiresCompany: false, defaultConfidence: 1 })
      ).toThrow(/already registered/);
    });
  });

  // ─── Validation ──────────────────────────────────────────────────────────────

  describe('Validation', () => {
    it('passes a valid opportunity', () => {
      const result = engine.validate(makeOpportunity());
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.confidence).toBe(0.85);
    });

    it('rejects an unknown opportunity type', () => {
      const result = engine.validate(makeOpportunity({ opportunityTypeId: 'unknown' }));
      expect(result.isValid).toBe(false);
      expect(result.errors[0]!.field).toBe('opportunityTypeId');
    });

    it('rejects when required company is missing', () => {
      const result = engine.validate(makeOpportunity({ opportunityTypeId: 'referral', companyId: undefined, companyName: undefined }));
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'companyId')).toBe(true);
    });

    it('rejects invalid confidence values', () => {
      const result = engine.validate(makeOpportunity({ confidence: 1.5 }));
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'confidence')).toBe(true);
    });

    it('rejects invalid country code length', () => {
      const result = engine.validate(makeOpportunity({ location: { countryCode: 'USA', remoteModel: 'remote' } }));
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'location.countryCode')).toBe(true);
    });

    it('rejects validTo before validFrom', () => {
      const result = engine.validate(makeOpportunity({
        validFrom: new Date('2024-06-01'),
        validTo: new Date('2024-01-01')
      }));
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'validTo')).toBe(true);
    });
  });

  // ─── Versioning ───────────────────────────────────────────────────────────────

  describe('Versioning', () => {
    it('creates a version history on update', () => {
      const opp = makeOpportunity({ currentVersion: 1 });
      const updated = engine.applyUpdate(opp, { title: 'Staff Engineer' }, 'system');

      expect(updated.title).toBe('Staff Engineer');
      expect(updated.currentVersion).toBe(2);
      expect(updated.versions).toHaveLength(1);
      expect(updated.versions[0]!.snapshot.title).toBe('Senior Software Engineer');
      expect(updated.versions[0]!.changedBy).toBe('system');
    });

    it('accumulates multiple versions', () => {
      let opp = makeOpportunity();
      opp = engine.applyUpdate(opp, { title: 'V2 Title' }, 'user-a');
      opp = engine.applyUpdate(opp, { title: 'V3 Title' }, 'user-b');

      expect(opp.currentVersion).toBe(3);
      expect(opp.versions).toHaveLength(2);
    });
  });

  // ─── Explainability ──────────────────────────────────────────────────────────

  describe('Explainability', () => {
    it('includes type, source, and confidence in explanation', () => {
      const result = engine.validate(makeOpportunity());
      expect(result.explanation).toContain('External Job');
      expect(result.explanation).toContain('linkedin');
      expect(result.explanation).toContain('85%');
      expect(result.explanation).toContain('Validation passed');
    });

    it('includes error summary in explanation on failure', () => {
      const result = engine.validate(makeOpportunity({ opportunityTypeId: 'unknown' }));
      expect(result.explanation).toContain('Validation failed');
    });
  });
});
