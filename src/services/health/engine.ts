import { HealthIndicatorResult, CompanyHealthProfile } from './model';
import { HealthIndicatorRegistry } from './registry';

export abstract class IndicatorCalculator {
  abstract readonly indicatorId: string;
  abstract calculate(companyId: string, contextData: any): Promise<HealthIndicatorResult>;
}

export class HealthScoringEngine {
  private calculators = new Map<string, IndicatorCalculator>();

  constructor(private registry: HealthIndicatorRegistry) {}

  registerCalculator(calculator: IndicatorCalculator) {
    if (!this.registry.get(calculator.indicatorId)) {
      throw new Error(`Calculator references unknown indicator ${calculator.indicatorId}`);
    }
    this.calculators.set(calculator.indicatorId, calculator);
  }

  async computeHealthProfile(companyId: string, contextData: any): Promise<CompanyHealthProfile> {
    const results: HealthIndicatorResult[] = [];
    let weightedScoreSum = 0;
    let totalWeight = 0;

    for (const [id, calculator] of this.calculators.entries()) {
      const def = this.registry.get(id);
      if (!def) continue;

      const result = await calculator.calculate(companyId, contextData);
      results.push(result);
      
      weightedScoreSum += (result.score * def.weight);
      totalWeight += def.weight;
    }

    const overallScore = totalWeight > 0 ? weightedScoreSum / totalWeight : 0;

    return {
      companyId,
      indicators: results,
      overallScore: Math.round(overallScore * 100) / 100,
      calculatedAt: new Date()
    };
  }
}
