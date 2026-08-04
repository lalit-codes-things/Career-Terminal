import { randomUUID } from 'crypto';
import type {
  EvaluationResult,
  EvaluationDimension,
  EvaluationPhase,
  QualityMetrics,
  CostMetrics,
  RegressionTestResult,
  ProviderComparison,
  ModelComparison,
  PromptComparison,
  BenchmarkDefinition,
  BenchmarkSuite,
} from '../../domain/recruiter-intelligence/ai-quality/contracts';

export class EvaluationFrameworkService {
  private readonly results = new Map<string, EvaluationResult>();
  private readonly qualityMetrics = new Map<string, QualityMetrics>();
  private readonly costMetrics = new Map<string, CostMetrics>();
  private readonly benchmarkSuites = new Map<string, BenchmarkSuite>();

  async evaluate(
    phase: EvaluationPhase,
    dimension: EvaluationDimension,
    score: number,
    confidence: number,
    evidence: string[],
    metadata: Record<string, unknown>,
  ): Promise<EvaluationResult> {
    const evaluationId = randomUUID();
    const result: EvaluationResult = {
      evaluationId,
      phase,
      dimension,
      score,
      confidence,
      evidence,
      metadata,
      recordedAt: new Date(),
    };
    this.results.set(evaluationId, result);
    return result;
  }

  async evaluateBatch(
    phase: EvaluationPhase,
    dimension: EvaluationDimension,
    scores: number[],
    confidence: number,
    evidence: string[],
    metadata: Record<string, unknown>,
  ): Promise<EvaluationResult[]> {
    const results: EvaluationResult[] = [];
    for (const score of scores) {
      const result = await this.evaluate(phase, dimension, score, confidence, evidence, metadata);
      results.push(result);
    }
    return results;
  }

  async recordQualityMetric(
    dimension: EvaluationDimension,
    value: number,
    confidence: number,
    source: string,
    metadata: Record<string, unknown>,
  ): Promise<QualityMetrics> {
    const metricId = randomUUID();
    const metric: QualityMetrics = {
      metricId,
      timestamp: new Date(),
      dimension,
      value,
      confidence,
      source,
      metadata,
    };
    this.qualityMetrics.set(metricId, metric);
    return metric;
  }

  async recordCostMetrics(
    totalInputTokens: number,
    totalOutputTokens: number,
    totalCostUsd: number,
    averageLatencyMs: number,
    p50LatencyMs: number,
    p95LatencyMs: number,
    p99LatencyMs: number,
  ): Promise<CostMetrics> {
    const metricId = randomUUID();
    const metrics: CostMetrics = {
      totalInputTokens,
      totalOutputTokens,
      totalCostUsd,
      averageCostPerCallUsd: totalCostUsd > 0 ? totalCostUsd / (totalInputTokens + totalOutputTokens) * 1000 : 0,
      averageLatencyMs,
      averageTokensPerCall: totalInputTokens + totalOutputTokens,
      p50LatencyMs,
      p95LatencyMs,
      p99LatencyMs,
      recordedAt: new Date(),
    };
    this.costMetrics.set(metricId, metrics);
    return metrics;
  }

  async runRegressionTest(
    benchmarkId: string,
    modelId: string,
    templateId: string,
    score: number,
    threshold: number,
    details: Record<string, number>,
  ): Promise<RegressionTestResult> {
    const testId = randomUUID();
    const passed = score >= threshold;
    const result: RegressionTestResult = {
      testId,
      benchmarkId,
      modelId,
      templateId,
      passed,
      score,
      threshold,
      delta: score - threshold,
      details,
      completedAt: new Date(),
    };
    return result;
  }

  async compareProviders(
    providers: string[],
    models: string[],
    templateId: string,
    results: Map<string, EvaluationResult[]>,
  ): Promise<ProviderComparison> {
    const comparisonId = randomUUID();
    const providerResults = new Map<ProviderKind, EvaluationResult[]>();

    for (const provider of providers) {
      const providerKey = provider as ProviderKind;
      const providerResultsList = results.get(provider) ?? [];
      providerResults.set(providerKey, providerResultsList);
    }

    let winner = providers[0] ?? 'stub';
    let bestScore = -Infinity;

    for (const [provider, providerResults] of providerResults.entries()) {
      const avgScore = providerResults.length > 0
        ? providerResults.reduce((s, r) => s + r.score, 0) / providerResults.length
        : 0;
      if (avgScore > bestScore) {
        bestScore = avgScore;
        winner = provider;
      }
    }

    return {
      comparisonId,
      providers: providers as ProviderKind[],
      models,
      templateId,
      results: providerResults as Map<ProviderKind, EvaluationResult[]>,
      winner: winner as ProviderKind,
      completedAt: new Date(),
    };
  }

  async compareModels(
    modelIds: string[],
    templateId: string,
    results: Map<string, EvaluationResult[]>,
  ): Promise<ModelComparison> {
    const comparisonId = randomUUID();
    const modelResults = new Map<string, EvaluationResult[]>();

    for (const modelId of modelIds) {
      modelResults.set(modelId, results.get(modelId) ?? []);
    }

    let winner = modelIds[0] ?? 'unknown';
    let bestScore = -Infinity;

    for (const [modelId, modelResults] of modelResults.entries()) {
      const avgScore = modelResults.length > 0
        ? modelResults.reduce((s, r) => s + r.score, 0) / modelResults.length
        : 0;
      if (avgScore > bestScore) {
        bestScore = avgScore;
        winner = modelId;
      }
    }

    return {
      comparisonId,
      modelIds,
      templateId,
      results: modelResults,
      winner,
      completedAt: new Date(),
    };
  }

  async comparePrompts(
    templateId: string,
    versions: string[],
    results: Map<string, EvaluationResult[]>,
  ): Promise<PromptComparison> {
    const comparisonId = randomUUID();
    const versionResults = new Map<string, EvaluationResult[]>();

    for (const version of versions) {
      versionResults.set(version, results.get(version) ?? []);
    }

    let winner = versions[0] ?? 'unknown';
    let bestScore = -Infinity;

    for (const [version, versionResults] of versionResults.entries()) {
      const avgScore = versionResults.length > 0
        ? versionResults.reduce((s, r) => s + r.score, 0) / versionResults.length
        : 0;
      if (avgScore > bestScore) {
        bestScore = avgScore;
        winner = version;
      }
    }

    return {
      comparisonId,
      templateId,
      versions,
      results: versionResults,
      winner,
      completedAt: new Date(),
    };
  }

  async createBenchmarkSuite(
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
    this.benchmarkSuites.set(suiteId, suite);
    return suite;
  }

  getResults(): EvaluationResult[] {
    return [...this.results.values()];
  }

  getQualityMetrics(): QualityMetrics[] {
    return [...this.qualityMetrics.values()];
  }

  getCostMetrics(): CostMetrics[] {
    return [...this.costMetrics.values()];
  }

  getBenchmarkSuites(): BenchmarkSuite[] {
    return [...this.benchmarkSuites.values()];
  }
}