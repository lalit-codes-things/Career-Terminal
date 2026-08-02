import { AuthenticityRuleRegistry, BUILT_IN_AUTHENTICITY_RULES } from '../registry';
import { AuthenticityEngine, AuthenticityRuleExecutor } from '../engine';
import { AuthenticityEvidence } from '../model';

class MockRuleExecutor extends AuthenticityRuleExecutor {
  constructor(public readonly ruleId: string, private passed: boolean) {
    super();
  }

  async evaluate(_companyId: string, _contextData: any): Promise<AuthenticityEvidence> {
    return {
      ruleId: this.ruleId,
      source: 'mock',
      passed: this.passed,
      details: this.passed ? 'Looks good' : 'Mismatch detected'
    };
  }
}

describe('Company Authenticity Framework', () => {
  let registry: AuthenticityRuleRegistry;
  let engine: AuthenticityEngine;

  beforeEach(() => {
    registry = new AuthenticityRuleRegistry();
    BUILT_IN_AUTHENTICITY_RULES.forEach(r => registry.register(r));
    engine = new AuthenticityEngine(registry);
  });

  it('calculates authenticity with mixed rules', async () => {
    engine.registerExecutor(new MockRuleExecutor('identity_consistency', true));
    engine.registerExecutor(new MockRuleExecutor('provider_agreement', false));

    const result = await engine.estimateAuthenticity('C123', {});
    
    // Identity consistency (0.25) passed = 25 points
    // Provider agreement (0.25) failed = 0 points
    // Total weight = 0.5
    // Score = 25 / 0.5 = 50
    expect(result.trustScore).toBe(50);
    expect(result.riskIndicators).toHaveLength(1);
    expect(result.riskIndicators[0]!.type).toBe('provider_agreement');
    expect(result.evidence).toHaveLength(2);
    expect(result.explanation).toContain('Identity Consistency (Pass)');
  });

  it('rejects unknown rules', () => {
    expect(() => engine.registerExecutor(new MockRuleExecutor('unknown', true)))
      .toThrow(/unknown rule/);
  });
});
