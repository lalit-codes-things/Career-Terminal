import { CompanyAuthenticityResult, AuthenticityEvidence, AuthenticityRiskIndicator } from './model';
import { AuthenticityRuleRegistry } from './registry';

export abstract class AuthenticityRuleExecutor {
  abstract readonly ruleId: string;
  abstract evaluate(companyId: string, contextData: any): Promise<AuthenticityEvidence>;
}

export class AuthenticityEngine {
  private executors = new Map<string, AuthenticityRuleExecutor>();

  constructor(private registry: AuthenticityRuleRegistry) {}

  registerExecutor(executor: AuthenticityRuleExecutor) {
    if (!this.registry.get(executor.ruleId)) {
      throw new Error(`Executor references unknown rule ${executor.ruleId}`);
    }
    this.executors.set(executor.ruleId, executor);
  }

  async estimateAuthenticity(companyId: string, contextData: any): Promise<CompanyAuthenticityResult> {
    const evidenceList: AuthenticityEvidence[] = [];
    const riskIndicators: AuthenticityRiskIndicator[] = [];
    let scoreSum = 0;
    let totalWeight = 0;
    let explanation = 'Authenticity calculated based on: ';

    for (const [id, executor] of this.executors.entries()) {
      const def = this.registry.get(id);
      if (!def) continue;

      const evidence = await executor.evaluate(companyId, contextData);
      evidenceList.push(evidence);

      const score = evidence.passed ? 100 : 0;
      scoreSum += (score * def.weight);
      totalWeight += def.weight;

      if (!evidence.passed) {
        riskIndicators.push({
          type: def.id,
          severity: def.weight > 0.2 ? 'high' : 'medium',
          description: evidence.details
        });
      }

      explanation += `${def.name} (${evidence.passed ? 'Pass' : 'Fail'}), `;
    }

    const trustScore = totalWeight > 0 ? scoreSum / totalWeight : 0;
    const confidence = evidenceList.length > 0 ? Math.min(1.0, evidenceList.length * 0.2) : 0;

    return {
      companyId,
      trustScore: Math.round(trustScore * 100) / 100,
      confidence,
      riskIndicators,
      evidence: evidenceList,
      explanation: explanation.replace(/, $/, '.'),
      timestamp: new Date()
    };
  }
}
