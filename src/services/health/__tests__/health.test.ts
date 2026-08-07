import { HealthIndicatorRegistry, BUILT_IN_HEALTH_INDICATORS } from '../registry';
import { HealthScoringEngine, IndicatorCalculator } from '../engine';
import { HealthIndicatorResult } from '../model';

class MockCalculator extends IndicatorCalculator {
  constructor(public readonly indicatorId: string, private score: number) {
    super();
  }

  async calculate(_companyId: string, _contextData: any): Promise<HealthIndicatorResult> {
    return {
      id: this.indicatorId,
      score: this.score,
      confidence: 0.9,
      evidence: [{ source: 'mock', description: 'test', value: this.score, timestamp: new Date() }],
      sources: ['mock'],
      calculationVersion: '1.0',
      timestamp: new Date()
    };
  }
}

describe('Company Health Intelligence Framework', () => {
  let registry: HealthIndicatorRegistry;
  let engine: HealthScoringEngine;

  beforeEach(() => {
    registry = new HealthIndicatorRegistry();
    BUILT_IN_HEALTH_INDICATORS.forEach(i => registry.register(i));
    engine = new HealthScoringEngine(registry);
  });

  it('registers and executes calculators', async () => {
    engine.registerCalculator(new MockCalculator('financial_health', 80));
    engine.registerCalculator(new MockCalculator('data_freshness', 50));

    const profile = await engine.computeHealthProfile('C123', {});

    expect(profile.indicators).toHaveLength(2);
    expect(profile.indicators[0]!.score).toBe(80);
    expect(profile.overallScore).toBeGreaterThan(0);
  });

  it('rejects unknown calculators', () => {
    expect(() => engine.registerCalculator(new MockCalculator('unknown', 100)))
      .toThrow(/unknown indicator/);
  });
});
