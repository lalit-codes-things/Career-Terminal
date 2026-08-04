import { randomUUID } from 'crypto';
import type { BenchmarkSuite, BenchmarkDefinition, RegressionTestResult } from '../../domain/recruiter-intelligence/ai-quality/contracts';

export class BenchmarkSuiteService {
  private readonly suites = new Map<string, BenchmarkSuite>();
  private readonly regressionResults = new Map<string, RegressionTestResult[]>();

  async createSuite(
    name: string,
    description: string,
    benchmarks: BenchmarkDefinition[],
  ): Promise<BenchmarkSuite> {
    const suiteId = randomUUID();
    const suite: BenchmarkSuite = {
      suiteId,
      name,
      description,
      benchmarks,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.suites.set(suiteId, suite);
    return suite;
  }

  getSuite(suiteId: string): BenchmarkSuite | undefined {
    return this.suites.get(suiteId);
  }

  getAllSuites(): BenchmarkSuite[] {
    return [...this.suites.values()];
  }

  updateSuite(suiteId: string, updates: Partial<BenchmarkSuite>): BenchmarkSuite | null {
    const suite = this.suites.get(suiteId);
    if (!suite) return null;
    const updated = { ...suite, ...updates, updatedAt: new Date() };
    this.suites.set(suiteId, updated);
    return updated;
  }

  deleteSuite(suiteId: string): boolean {
    return this.suites.delete(suiteId);
  }

  recordRegressionResult(result: RegressionTestResult): void {
    const existing = this.regressionResults.get(result.benchmarkId) ?? [];
    existing.push(result);
    this.regressionResults.set(result.benchmarkId, existing);
  }

  getRegressionResults(benchmarkId?: string): RegressionTestResult[] {
    if (benchmarkId) {
      return this.regressionResults.get(benchmarkId) ?? [];
    }
    return [...this.regressionResults.values()].flat();
  }

  getRegressionSummary(benchmarkId: string): {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    passRate: number;
    averageScore: number;
    averageDelta: number;
  } {
    const results = this.regressionResults.get(benchmarkId) ?? [];
    const totalTests = results.length;
    const passedTests = results.filter((r) => r.passed).length;
    const failedTests = totalTests - passedTests;
    const passRate = totalTests > 0 ? passedTests / totalTests : 0;
    const averageScore = totalTests > 0
      ? results.reduce((s, r) => s + r.score, 0) / totalTests
      : 0;
    const averageDelta = totalTests > 0
      ? results.reduce((s, r) => s + r.delta, 0) / totalTests
      : 0;

    return {
      totalTests,
      passedTests,
      failedTests,
      passRate: Number(passRate.toFixed(4)),
      averageScore: Number(averageScore.toFixed(4)),
      averageDelta: Number(averageDelta.toFixed(4)),
    };
  }

  runOfflineEvaluation(
    benchmarkId: string,
    modelId: string,
    templateId: string,
    scores: Record<string, number>,
    threshold: number,
  ): RegressionTestResult[] {
    const results: RegressionTestResult[] = [];

    for (const [dimension, score] of Object.entries(scores)) {
      const result: RegressionTestResult = {
        testId: randomUUID(),
        benchmarkId,
        modelId,
        templateId,
        passed: score >= threshold,
        score,
        threshold,
        delta: score - threshold,
        details: { [dimension]: score },
        completedAt: new Date(),
      };
      results.push(result);
      this.recordRegressionResult(result);
    }

    return results;
  }
}