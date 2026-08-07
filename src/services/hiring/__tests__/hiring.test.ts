import { HiringSignalRegistry, BUILT_IN_HIRING_SIGNALS } from '../registry';
import { HiringAggregationEngine } from '../engine';
import { HiringSignalEvidence } from '../model';

describe('Hiring Activity Framework', () => {
  let registry: HiringSignalRegistry;
  let engine: HiringAggregationEngine;

  beforeEach(() => {
    registry = new HiringSignalRegistry();
    BUILT_IN_HIRING_SIGNALS.forEach(s => registry.register(s));
    engine = new HiringAggregationEngine(registry);
  });

  it('aggregates evidence correctly', () => {
    const t1 = new Date('2023-01-01');
    const t2 = new Date('2023-01-02');

    const evidence: HiringSignalEvidence[] = [
      { provider: 'provA', source: 'linkedin', description: 'test', value: 'yes', timestamp: t1, confidence: 0.8 },
      { provider: 'provB', source: 'indeed', description: 'test', value: 'yes', timestamp: t2, confidence: 0.7 }
    ];

    const signal = engine.aggregate('C123', 'current_hiring', evidence);

    expect(signal.companyId).toBe('C123');
    expect(signal.signalId).toBe('current_hiring');
    expect(signal.confidence).toBeGreaterThan(0.8); // 0.8 max + 0.1 for 2 sources = 0.9
    expect(signal.evidence).toHaveLength(2);
    expect(signal.validFrom).toEqual(t1);
    expect(signal.validTo).toEqual(t2);
  });

  it('rejects unknown signals', () => {
    expect(() => engine.aggregate('C1', 'unknown', [{ provider: 'prov', source: 's', description: 'd', value: 'v', timestamp: new Date(), confidence: 1 }]))
      .toThrow(/Unknown hiring signal/);
  });
});
