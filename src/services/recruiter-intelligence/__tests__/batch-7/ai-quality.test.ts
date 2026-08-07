import { EvaluationFrameworkService } from '../../ai-quality/evaluation-framework.service';
import { PromptRegistryService } from '../../ai-quality/prompt-registry.service';
import { ModelRegistryService } from '../../ai-quality/model-registry.service';
import { HallucinationDetector } from '../../ai-quality/hallucination-detector.service';
import { ConfidenceCalibrator } from '../../ai-quality/confidence-calibrator.service';
import { TracingService } from '../../ai-quality/tracing.service';
import { FeedbackPipelineService } from '../../ai-quality/feedback-pipeline.service';
import { BenchmarkSuiteService } from '../../ai-quality/benchmark-suite.service';
import type { ModelEvaluation, RegressionTestResult } from '../../../../domain/recruiter-intelligence/ai-quality/contracts';
import type { ExtractionOutput } from '../../ai/types';

describe('AI Quality Infrastructure', () => {
  let evaluationFramework: EvaluationFrameworkService;
  let promptRegistry: PromptRegistryService;
  let modelRegistry: ModelRegistryService;
  let hallucinationDetector: HallucinationDetector;
  let confidenceCalibrator: ConfidenceCalibrator;
  let tracingService: TracingService;
  let feedbackPipeline: FeedbackPipelineService;
  let benchmarkSuite: BenchmarkSuiteService;

  beforeEach(() => {
    evaluationFramework = new EvaluationFrameworkService();
    promptRegistry = new PromptRegistryService();
    modelRegistry = new ModelRegistryService();
    hallucinationDetector = new HallucinationDetector();
    confidenceCalibrator = new ConfidenceCalibrator();
    tracingService = new TracingService();
    feedbackPipeline = new FeedbackPipelineService();
    benchmarkSuite = new BenchmarkSuiteService();
  });

  describe('EvaluationFrameworkService', () => {
    test('evaluate records an evaluation result', async () => {
      const result = await evaluationFramework.evaluate(
        'offline',
        'accuracy',
        0.92,
        0.85,
        ['evidence-1', 'evidence-2'],
        { templateId: 'test-template' },
      );

      expect(result.evaluationId).toBeDefined();
      expect(result.phase).toBe('offline');
      expect(result.dimension).toBe('accuracy');
      expect(result.score).toBe(0.92);
      expect(result.confidence).toBe(0.85);
      expect(result.evidence).toHaveLength(2);
    });

    test('recordQualityMetric records a quality metric', async () => {
      const metric = await evaluationFramework.recordQualityMetric(
        'accuracy',
        0.92,
        0.85,
        'test-source',
        { modelId: 'test-model' },
      );

      expect(metric.metricId).toBeDefined();
      expect(metric.dimension).toBe('accuracy');
      expect(metric.value).toBe(0.92);
    });

    test('recordCostMetrics records cost metrics', async () => {
      const metrics = await evaluationFramework.recordCostMetrics(
        1000,
        500,
        0.05,
        120,
        100,
        150,
        200,
      );

      expect(metrics.totalInputTokens).toBe(1000);
      expect(metrics.totalOutputTokens).toBe(500);
      expect(metrics.totalCostUsd).toBe(0.05);
      expect(metrics.averageLatencyMs).toBe(120);
      expect(metrics.p50LatencyMs).toBe(100);
      expect(metrics.p95LatencyMs).toBe(150);
      expect(metrics.p99LatencyMs).toBe(200);
    });

    test('runRegressionTest returns pass/fail result', async () => {
      const result = await evaluationFramework.runRegressionTest(
        'benchmark-1',
        'model-1',
        'template-1',
        0.92,
        0.85,
        { accuracy: 0.92, precision: 0.90 },
      );

      expect(result.testId).toBeDefined();
      expect(result.passed).toBe(true);
      expect(result.score).toBe(0.92);
      expect(result.threshold).toBe(0.85);
      expect(result.delta).toBeCloseTo(0.07, 5);
    });

    test('compareProviders returns the best provider', async () => {
      const results = new Map<string, any[]>();
      results.set('openrouter', [{ evaluationId: 'e1', score: 0.92, dimension: 'accuracy' }]);
      results.set('openrouter', [{ evaluationId: 'e2', score: 0.88, dimension: 'accuracy' }]);

      const comparison = await evaluationFramework.compareProviders(
        ['openrouter', 'openrouter'],
        ['gpt-4', 'claude-3'],
        'template-1',
        results,
      );

      expect(comparison.winner).toBe('openrouter');
      expect(comparison.providers).toContain('openrouter');
      expect(comparison.providers).toContain('openrouter');
    });

    test('compareModels returns the best model', async () => {
      const results = new Map<string, any[]>();
      results.set('model-v1', [{ evaluationId: 'e1', score: 0.90, dimension: 'accuracy' }]);
      results.set('model-v2', [{ evaluationId: 'e2', score: 0.95, dimension: 'accuracy' }]);

      const comparison = await evaluationFramework.compareModels(
        ['model-v1', 'model-v2'],
        'template-1',
        results,
      );

      expect(comparison.winner).toBe('model-v2');
    });

    test('comparePrompts returns the best prompt version', async () => {
      const results = new Map<string, any[]>();
      results.set('1.0.0', [{ evaluationId: 'e1', score: 0.85, dimension: 'accuracy' }]);
      results.set('1.1.0', [{ evaluationId: 'e2', score: 0.92, dimension: 'accuracy' }]);

      const comparison = await evaluationFramework.comparePrompts(
        'template-1',
        ['1.0.0', '1.1.0'],
        results,
      );

      expect(comparison.winner).toBe('1.1.0');
    });

    test('createBenchmarkSuite creates a benchmark suite', async () => {
      const suite = await evaluationFramework.createBenchmarkSuite(
        'Recruiter Extraction Bench',
        'Benchmark for recruiter entity extraction quality',
        [
          {
            benchmarkId: 'b1',
            name: 'Accuracy Benchmark',
            description: 'Measure extraction accuracy',
            datasetSize: 1000,
            evaluationDimensions: ['accuracy', 'precision', 'recall'],
            passThreshold: 0.85,
            isActive: true,
          },
        ],
      );

      expect(suite.suiteId).toBeDefined();
      expect(suite.name).toBe('Recruiter Extraction Bench');
      expect(suite.benchmarks).toHaveLength(1);
    });
  });

  describe('PromptRegistryService', () => {
    test('register stores a prompt registry entry', () => {
      const entry = {
        templateId: 'test-template',
        name: 'Test Template',
        description: 'A test prompt template',
        versions: [],
        activeVersion: '1.0.0',
        createdAt: new Date(),
        updatedAt: new Date(),
        tags: ['test'],
      };

      promptRegistry.register(entry);
      const retrieved = promptRegistry.get('test-template');
      expect(retrieved).toBeDefined();
      expect(retrieved!.templateId).toBe('test-template');
    });

    test('updateVersion adds a new version', () => {
      const entry = {
        templateId: 'test-template',
        name: 'Test Template',
        description: 'A test prompt template',
        versions: [],
        activeVersion: '1.0.0',
        createdAt: new Date(),
        updatedAt: new Date(),
        tags: ['test'],
      };

      promptRegistry.register(entry);

      const newVersion = {
        versionId: 'v2',
        templateId: 'test-template',
        version: '2.0.0',
        systemPrompt: 'New system prompt',
        userPromptTemplate: 'New user prompt',
        outputSchema: {},
        maxTokens: 2048,
        temperature: 0.1,
        tier: 'balanced' as const,
        changelog: 'Updated prompt for better accuracy',
        createdAt: new Date(),
        createdBy: 'test-user',
        isActive: true,
      };

      const updated = promptRegistry.updateVersion('test-template', newVersion);
      expect(updated).not.toBeNull();
      expect(updated!.activeVersion).toBe('2.0.0');
      expect(updated!.versions).toHaveLength(1);
    });

    test('createExperiment stores a prompt experiment', () => {
      const experiment = {
        experimentId: 'exp-1',
        name: 'Prompt A/B Test',
        description: 'Compare prompt versions',
        templateId: 'test-template',
        baselineVersion: '1.0.0',
        candidateVersion: '2.0.0',
        status: 'active' as const,
        metrics: {
          accuracy: 0,
          precision: 0,
          recall: 0,
          f1Score: 0,
          hallucinationRate: 0,
          evidenceFidelity: 0,
          confidenceCalibration: 0,
          latencyMs: 0,
          costUsd: 0,
          tokenUsage: { input: 0, output: 0 },
        },
        createdAt: new Date(),
      };

      const created = promptRegistry.createExperiment(experiment);
      expect(created.experimentId).toBe('exp-1');
      expect(created.status).toBe('active');
    });

    test('updateExperimentStatus changes experiment status', () => {
      const experiment = {
        experimentId: 'exp-1',
        name: 'Prompt A/B Test',
        description: 'Compare prompt versions',
        templateId: 'test-template',
        baselineVersion: '1.0.0',
        candidateVersion: '2.0.0',
        status: 'active' as const,
        metrics: {
          accuracy: 0, precision: 0, recall: 0, f1Score: 0,
          hallucinationRate: 0, evidenceFidelity: 0, confidenceCalibration: 0,
          latencyMs: 0, costUsd: 0, tokenUsage: { input: 0, output: 0 },
        },
        createdAt: new Date(),
      };

      promptRegistry.createExperiment(experiment);
      const updated = promptRegistry.updateExperimentStatus('exp-1', 'completed');
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('completed');
      expect(updated!.completedAt).toBeInstanceOf(Date);
    });
  });

  describe('ModelRegistryService', () => {
    test('register stores a model entry', () => {
      const model = {
        modelId: 'model-1',
        provider: 'openrouter' as const,
        modelName: 'gpt-4',
        tier: 'powerful' as const,
        capabilities: ['text-generation', 'reasoning'],
        maxTokens: 8192,
        costPerTokenUsd: 0.03,
        latencyMs: 200,
        isActive: true,
        createdAt: new Date(),
      };

      modelRegistry.register(model);
      const retrieved = modelRegistry.get('model-1');
      expect(retrieved).toBeDefined();
      expect(retrieved!.modelName).toBe('gpt-4');
    });

    test('getBestModel returns the best model for a dimension', () => {
      modelRegistry.register({
        modelId: 'model-1',
        provider: 'openrouter',
        modelName: 'gpt-4',
        tier: 'powerful',
        capabilities: ['text-generation'],
        maxTokens: 8192,
        costPerTokenUsd: 0.03,
        latencyMs: 200,
        isActive: true,
        createdAt: new Date(),
      });

      modelRegistry.register({
        modelId: 'model-2',
        provider: 'openrouter',
        modelName: 'claude-3',
        tier: 'powerful',
        capabilities: ['text-generation'],
        maxTokens: 8192,
        costPerTokenUsd: 0.04,
        latencyMs: 180,
        isActive: true,
        createdAt: new Date(),
      });

      const eval1 = {
        evaluationId: 'e1',
        modelId: 'model-1',
        templateId: 'template-1',
        phase: 'offline' as const,
        results: new Map([['accuracy', { evaluationId: 'e1', phase: 'offline', dimension: 'accuracy', score: 0.90, confidence: 0.85, evidence: [], metadata: {}, recordedAt: new Date() }]]) as any,
        overallScore: 0.90,
        completedAt: new Date(),
      };

      const eval2 = {
        evaluationId: 'e2',
        modelId: 'model-2',
        templateId: 'template-1',
        phase: 'offline' as const,
        results: new Map([['accuracy', { evaluationId: 'e2', phase: 'offline', dimension: 'accuracy', score: 0.95, confidence: 0.90, evidence: [], metadata: {}, recordedAt: new Date() }]]) as any,
        overallScore: 0.95,
        completedAt: new Date(),
      } as ModelEvaluation;

      modelRegistry.recordEvaluation(eval1);
      modelRegistry.recordEvaluation(eval2);

      const best = modelRegistry.getBestModel('template-1', 'accuracy');
      expect(best).not.toBeNull();
      expect(best!.modelId).toBe('model-2');
    });
  });

  describe('HallucinationDetector', () => {
    test('detect identifies hallucinated fields', () => {
      const output = {
        extractionId: 'ext-1',
        templateId: 'template-1',
        templateVersion: '1.0.0',
        provider: 'stub' as const,
        model: 'stub-model',
        fields: [
          { field: 'name', value: 'John Doe', rawValue: 'John Doe', confidence: 0.9, confidenceBand: 'high' as const, evidence: [{ sourceId: 's1', excerpt: 'John Doe', confidence: 0.9 }], provenance: { source: 'test', sourceId: 's1', collectedAt: new Date().toISOString(), consentState: 'unknown' as const } },
          { field: 'fabricated', value: 'fake data', rawValue: 'fake data', confidence: 0.95, confidenceBand: 'critical' as const, evidence: [], provenance: { source: 'test', sourceId: 's1', collectedAt: new Date().toISOString(), consentState: 'unknown' as const } },
        ],
        overallConfidence: 0.92,
        confidenceBand: 'high' as const,
        evidence: [],
        provenance: { source: 'test', sourceId: 's1', collectedAt: new Date().toISOString(), consentState: 'unknown' as const },
        usage: { inputTokens: 100, outputTokens: 50, estimatedCostUsd: 0.01, latencyMs: 100 },
        completedAt: new Date(),
        requiresHumanReview: false,
      };

      const result = hallucinationDetector.detect(output as unknown as ExtractionOutput, ['John Doe']);
      expect(result.hasHallucination).toBe(true);
      expect(result.hallucinatedFields).toContain('fabricated');
      expect(result.evidenceSupport['name']).toBeGreaterThan(0);
      expect(result.evidenceSupport['fabricated']).toBe(0);
    });

    test('detect returns no hallucinations for well-evidenced output', () => {
      const output = {
        extractionId: 'ext-2',
        templateId: 'template-1',
        templateVersion: '1.0.0',
        provider: 'stub' as const,
        model: 'stub-model',
        fields: [
          { field: 'name', value: 'John Doe', rawValue: 'John Doe', confidence: 0.9, confidenceBand: 'high' as const, evidence: [{ sourceId: 's1', excerpt: 'John Doe', confidence: 0.9 }], provenance: { source: 'test', sourceId: 's1', collectedAt: new Date().toISOString(), consentState: 'unknown' as const } },
        ],
        overallConfidence: 0.9,
        confidenceBand: 'high' as const,
        evidence: [],
        provenance: { source: 'test', sourceId: 's1', collectedAt: new Date().toISOString(), consentState: 'unknown' as const },
        usage: { inputTokens: 100, outputTokens: 50, estimatedCostUsd: 0.01, latencyMs: 100 },
        completedAt: new Date(),
        requiresHumanReview: false,
      };

      const result = hallucinationDetector.detect(output as unknown as ExtractionOutput, ['John Doe']);
      expect(result.hasHallucination).toBe(false);
      expect(result.hallucinatedFields).toHaveLength(0);
    });

    test('computeHallucinationRate computes correct rate', () => {
      const detections = [
        { hasHallucination: true, hallucinatedFields: ['field1'], evidenceSupport: {}, confidence: 0.8, explanation: '', completedAt: new Date() },
        { hasHallucination: false, hallucinatedFields: [], evidenceSupport: {}, confidence: 0.9, explanation: '', completedAt: new Date() },
        { hasHallucination: true, hallucinatedFields: ['field2'], evidenceSupport: {}, confidence: 0.7, explanation: '', completedAt: new Date() },
      ];

      const rate = hallucinationDetector.computeHallucinationRate(detections as any);
      expect(rate).toBe(2 / 3);
    });
  });

  describe('ConfidenceCalibrator', () => {
    test('calibrate computes calibration metrics', () => {
      const predictions = [
        { confidence: 0.9, correct: true },
        { confidence: 0.8, correct: true },
        { confidence: 0.7, correct: false },
        { confidence: 0.6, correct: true },
        { confidence: 0.5, correct: false },
        { confidence: 0.4, correct: false },
        { confidence: 0.3, correct: false },
        { confidence: 0.2, correct: false },
        { confidence: 0.1, correct: false },
      ];

      const result = confidenceCalibrator.calibrate('model-1', 'template-1', predictions);

      expect(result.calibrationId).toBeDefined();
      expect(result.totalPredictions).toBe(9);
      expect(result.correctPredictions).toBe(3);
      expect(result.ece).toBeGreaterThanOrEqual(0);
      expect(result.brierScore).toBeGreaterThanOrEqual(0);
      expect(result.reliabilityDiagram).toHaveLength(10);
    });
  });

  describe('TracingService', () => {
    test('startSpan creates a new span', () => {
      const span = tracingService.startSpan('extract', undefined, { templateId: 'test' });
      expect(span.spanId).toBeDefined();
      expect(span.operationName).toBe('extract');
      expect(span.status).toBe('ok');
    });

    test('endSpan closes a span and records duration', () => {
      const span = tracingService.startSpan('extract');
      const ended = tracingService.endSpan(span.spanId);
      expect(ended).not.toBeNull();
      expect(ended!.status).toBe('ok');
      expect(ended!.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('addEvent adds an event to an active span', () => {
      const span = tracingService.startSpan('extract');
      const event = tracingService.addEvent(span.spanId, 'model-called', { model: 'gpt-4' });
      expect(event).not.toBeNull();
      expect(event!.name).toBe('model-called');
      expect(span.events).toHaveLength(1);
    });

    test('logInference records an inference log entry', () => {
      const log = tracingService.logInference({
        extractionId: 'ext-1',
        templateId: 'template-1',
        provider: 'openrouter',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 120,
        costUsd: 0.01,
        confidence: 0.85,
        requiresReview: false,
        timestamp: new Date(),
      });

      expect(log.logId).toBeDefined();
      expect(log.extractionId).toBe('ext-1');
      expect(log.latencyMs).toBe(120);
    });

    test('getLatencyStats returns latency statistics', () => {
      const span1 = tracingService.startSpan('extract');
      tracingService.endSpan(span1.spanId);

      const span2 = tracingService.startSpan('extract');
      tracingService.endSpan(span2.spanId);

      const stats = tracingService.getLatencyStats('extract');
      expect(stats.count).toBe(2);
      expect(stats.avgLatencyMs).toBeGreaterThanOrEqual(0);
      expect(stats.p50LatencyMs).toBeGreaterThanOrEqual(0);
      expect(stats.p95LatencyMs).toBeGreaterThanOrEqual(0);
      expect(stats.p99LatencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('FeedbackPipelineService', () => {
    test('submitFeedback records feedback', () => {
      const feedback = feedbackPipeline.submitFeedback({
        extractionId: 'ext-1',
        rating: 4,
        comment: 'Good extraction quality',
        reviewerId: 'reviewer-1',
        timestamp: new Date(),
      });

      expect(feedback.feedbackId).toBeDefined();
      expect(feedback.rating).toBe(4);
      expect(feedback.comment).toBe('Good extraction quality');
    });

    test('getAverageRating computes correct average', () => {
      feedbackPipeline.submitFeedback({ extractionId: 'ext-1', rating: 5, comment: 'Great', reviewerId: 'r1', timestamp: new Date() });
      feedbackPipeline.submitFeedback({ extractionId: 'ext-1', rating: 3, comment: 'Okay', reviewerId: 'r2', timestamp: new Date() });

      const avg = feedbackPipeline.getAverageRating('ext-1');
      expect(avg).toBe(4);
    });

    test('computeFeedbackSummary returns correct summary', () => {
      feedbackPipeline.submitFeedback({ extractionId: 'ext-1', rating: 5, comment: 'Great', reviewerId: 'r1', timestamp: new Date() });
      feedbackPipeline.submitFeedback({ extractionId: 'ext-1', rating: 1, comment: 'Poor', reviewerId: 'r2', timestamp: new Date() });
      feedbackPipeline.submitFeedback({ extractionId: 'ext-2', rating: 4, comment: 'Good', reviewerId: 'r3', timestamp: new Date() });

      const summary = feedbackPipeline.computeFeedbackSummary();
      expect(summary.totalFeedback).toBe(3);
      expect(summary.averageRating).toBe(3.33);
      expect(summary.positiveFeedback).toBe(2);
      expect(summary.negativeFeedback).toBe(1);
    });
  });

  describe('BenchmarkSuiteService', () => {
    test('createSuite creates a benchmark suite', async () => {
      const suite = await benchmarkSuite.createSuite(
        'Extraction Bench',
        'Benchmark for extraction quality',
        [
          {
            benchmarkId: 'b1',
            name: 'Accuracy',
            description: 'Measure extraction accuracy',
            datasetSize: 100,
            evaluationDimensions: ['accuracy', 'precision'],
            passThreshold: 0.85,
            isActive: true,
          },
        ],
      );

      expect(suite.suiteId).toBeDefined();
      expect(suite.name).toBe('Extraction Bench');
      expect(suite.benchmarks).toHaveLength(1);
    });

    test('recordRegressionResult stores a regression result', () => {
      const result: RegressionTestResult = {
        testId: 't1',
        benchmarkId: 'b1',
        modelId: 'model-1',
        templateId: 'template-1',
        passed: true,
        score: 0.92,
        threshold: 0.85,
        delta: 0.07,
        details: { accuracy: 0.92 },
        completedAt: new Date(),
      };

      benchmarkSuite.recordRegressionResult(result);
      const results = benchmarkSuite.getRegressionResults('b1');
      expect(results).toHaveLength(1);
      expect(results[0]!.passed).toBe(true);
    });

    test('getRegressionSummary computes correct summary', () => {
      benchmarkSuite.recordRegressionResult({
        testId: 't1', benchmarkId: 'b1', modelId: 'm1', templateId: 't1',
        passed: true, score: 0.92, threshold: 0.85, delta: 0.07,
        details: { accuracy: 0.92 }, completedAt: new Date(),
      });
      benchmarkSuite.recordRegressionResult({
        testId: 't2', benchmarkId: 'b1', modelId: 'm1', templateId: 't1',
        passed: false, score: 0.78, threshold: 0.85, delta: -0.07,
        details: { accuracy: 0.78 }, completedAt: new Date(),
      });

      const summary = benchmarkSuite.getRegressionSummary('b1');
      expect(summary.totalTests).toBe(2);
      expect(summary.passedTests).toBe(1);
      expect(summary.failedTests).toBe(1);
      expect(summary.passRate).toBe(0.5);
      expect(summary.averageScore).toBe(0.85);
    });

    test('runOfflineEvaluation runs evaluation and records results', () => {
      const results = benchmarkSuite.runOfflineEvaluation(
        'benchmark-1',
        'model-1',
        'template-1',
        { accuracy: 0.92, precision: 0.88, recall: 0.85 },
        0.85,
      );

      expect(results).toHaveLength(3);
      expect(results[0]!.passed).toBe(true);
      expect(results[1]!.passed).toBe(true);
      expect(results[2]!.passed).toBe(true);
    });
  });
});