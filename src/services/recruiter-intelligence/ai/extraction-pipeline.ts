import { randomUUID } from 'crypto';
import type {
  AiAdapterRequest,
  AiModelAdapter,
  AiProviderKind,
  BatchExtractionRequest,
  BatchExtractionResult,
  CostBudget,
  ExtractedField,
  ExtractionInput,
  ExtractionOutput,
  RetryContext,
  RetryPolicy,
  StreamHandler,
} from './types';
import { CostTracker } from './cost-tracker';
import { InMemoryHumanReviewQueue } from './human-review';
import { OutputValidator } from './output-validator';
import { PromptManager } from './prompt-manager';
import { TokenBucketRateLimiter } from './rate-limiter';
import { toConfidenceBand, toProvenance } from './utils';

export interface ExtractionPipelineOptions {
  providers: AiModelAdapter[];
  preferredProvider?: AiProviderKind;
  retryPolicy?: Partial<RetryPolicy>;
  costBudget?: Partial<CostBudget>;
  humanReviewThreshold?: number;
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  backoffMultiplier: 2,
  retryableErrors: ['rate_limit', '429', '500', '502', '503', 'timeout', 'ECONNRESET'],
};

const DEFAULT_COST_BUDGET: CostBudget = {
  maxUsdPerCall: 0.10,
  maxTokensPerCall: 4096,
  maxCallsPerMinute: 60,
};

/**
 * ExtractionPipeline — the central AI orchestration engine.
 *
 * Responsibilities:
 *  - Selects provider and model
 *  - Renders prompt templates
 *  - Enforces rate limits and cost budgets
 *  - Sends requests to model adapters
 *  - Validates and normalizes structured output
 *  - Applies retry with exponential backoff
 *  - Scores confidence and generates evidence
 *  - Records provenance
 *  - Tracks tokens and costs
 *  - Routes low-confidence outputs to human review queue
 *  - Supports streaming
 *  - Supports batch inference
 */
export class ExtractionPipeline {
  private readonly promptManager: PromptManager;
  private readonly validator: OutputValidator;
  private readonly costTracker: CostTracker;
  private readonly reviewQueue: InMemoryHumanReviewQueue;
  private readonly rateLimiter: TokenBucketRateLimiter;
  private readonly retryPolicy: RetryPolicy;
  private readonly providers: Map<AiProviderKind, AiModelAdapter>;
  private readonly preferredProvider: AiProviderKind;

  constructor(options: ExtractionPipelineOptions) {
    this.promptManager = new PromptManager();
    this.validator = new OutputValidator();
    this.costTracker = new CostTracker();
    this.reviewQueue = new InMemoryHumanReviewQueue({
      confidenceThreshold: options.humanReviewThreshold ?? 0.55,
    });

    const budget = { ...DEFAULT_COST_BUDGET, ...(options.costBudget ?? {}) };
    this.rateLimiter = new TokenBucketRateLimiter(budget);
    this.retryPolicy = { ...DEFAULT_RETRY_POLICY, ...(options.retryPolicy ?? {}) };

    this.providers = new Map(options.providers.map((p) => [p.provider, p]));
    this.preferredProvider = options.preferredProvider ?? options.providers[0]?.provider ?? 'stub';
  }

  getPromptManager(): PromptManager {
    return this.promptManager;
  }

  getCostTracker(): CostTracker {
    return this.costTracker;
  }

  getReviewQueue(): InMemoryHumanReviewQueue {
    return this.reviewQueue;
  }

  // ─── Core extraction ────────────────────────────────────────────────────────

  async extract(
    templateId: string,
    input: ExtractionInput,
    variables: Record<string, string>,
    options: { stream?: boolean; onChunk?: StreamHandler; providerOverride?: AiProviderKind } = {},
  ): Promise<ExtractionOutput> {
    const template = this.promptManager.get(templateId);
    const rendered = this.promptManager.render(templateId, variables);

    await this.rateLimiter.acquire(rendered.estimatedInputTokens + template.maxTokens);

    const adapter = this.selectAdapter(options.providerOverride);
    const model = this.selectModel(adapter, template.tier);

    const retryCtx: RetryContext = { attempt: 0, totalDelayMs: 0 };

    while (retryCtx.attempt < this.retryPolicy.maxAttempts) {
      retryCtx.attempt++;

      try {
        const adapterRequest: AiAdapterRequest = {
          provider: adapter.provider,
          model,
          systemPrompt: rendered.systemPrompt,
          userPrompt: rendered.userPrompt,
          maxTokens: template.maxTokens,
          temperature: template.temperature,
          stream: options.stream ?? false,
          onChunk: options.onChunk,
        };

        const start = Date.now();
        const response = await adapter.complete(adapterRequest);
        const latencyMs = Date.now() - start;

        const usage = this.costTracker.record({
          provider: adapter.provider,
          model,
          templateId,
          tenantId: input.tenantId,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          latencyMs,
          success: true,
        });

        // Parse and validate
        const { parsed, valid, error: parseError } = this.validator.validateJson(response.rawText);
        if (!valid || !parsed) {
          throw new ExtractionParseError(parseError ?? 'JSON parse failed', response.rawText);
        }

        const validation = this.validateByTemplate(templateId, parsed);
        if (!validation.valid) {
          throw new ExtractionValidationError(
            `Validation failed: ${validation.errors.map((e) => e.message).join(', ')}`,
            validation,
          );
        }

        const fields = this.normalizeFields(parsed as Record<string, unknown>, input, templateId);
        const overallConfidence = this.computeOverallConfidence(fields);
        const confidenceBand = toConfidenceBand(overallConfidence);

        const output: ExtractionOutput = {
          extractionId: input.extractionId,
          templateId,
          templateVersion: rendered.templateVersion,
          provider: adapter.provider,
          model,
          fields,
          overallConfidence,
          confidenceBand,
          evidence: fields.map((f) => ({
            evidenceId: randomUUID(),
            confidence: f.confidence,
            provenance: f.provenance,
          })),
          provenance: toProvenance(input, adapter.provider, model),
          usage,
          completedAt: new Date(),
          requiresHumanReview: overallConfidence < 0.55,
        };

        // Human review hook
        if (this.reviewQueue.isReviewRequired(output)) {
          const reviewRequest = this.reviewQueue.buildReviewRequest(
            output,
            `Confidence ${overallConfidence.toFixed(2)} below threshold`,
          );
          await this.reviewQueue.queue(reviewRequest);
          output.requiresHumanReview = true;
          output.reviewReason = reviewRequest.reason;
        }

        return output;
      } catch (err) {
        if (!this.isRetryable(err) || retryCtx.attempt >= this.retryPolicy.maxAttempts) {
          this.costTracker.record({
            provider: adapter.provider,
            model,
            templateId,
            tenantId: input.tenantId,
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: 0,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }

        const delay = this.computeDelay(retryCtx.attempt);
        retryCtx.totalDelayMs += delay;
        retryCtx.lastError = err instanceof Error ? err.message : String(err);
        await sleep(delay);
      }
    }

    throw new Error(`Extraction failed after ${this.retryPolicy.maxAttempts} attempts`);
  }

  // ─── Batch inference ────────────────────────────────────────────────────────

  async extractBatch(
    templateId: string,
    request: BatchExtractionRequest,
    variablesBuilder: (item: ExtractionInput) => Record<string, string>,
  ): Promise<BatchExtractionResult> {
    const { items, concurrency, batchId } = request;
    const results: BatchExtractionResult['results'] = [];
    let succeeded = 0;
    let failed = 0;

    // Process in chunks of `concurrency`
    for (let i = 0; i < items.length; i += concurrency) {
      const chunk = items.slice(i, i + concurrency);
      const chunkResults = await Promise.allSettled(
        chunk.map((item) =>
          this.extract(templateId, item, variablesBuilder(item)),
        ),
      );

      for (let j = 0; j < chunkResults.length; j++) {
        const result = chunkResults[j]!;
        const item = chunk[j]!;
        if (result.status === 'fulfilled') {
          results.push({ extractionId: item.extractionId, output: result.value });
          succeeded++;
        } else {
          results.push({
            extractionId: item.extractionId,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
          failed++;
        }
      }
    }

    const summary = this.costTracker.summarize();

    return {
      batchId,
      totalItems: items.length,
      succeeded,
      failed,
      results,
      completedAt: new Date(),
      totalUsage: {
        inputTokens: summary.totalInputTokens,
        outputTokens: summary.totalOutputTokens,
        estimatedCostUsd: summary.totalCostUsd,
      },
    };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private selectAdapter(override?: AiProviderKind): AiModelAdapter {
    const target = override ?? this.preferredProvider;
    const adapter = this.providers.get(target);
    if (!adapter) {
      // Fallback to first available
      const first = [...this.providers.values()][0];
      if (!first) throw new Error('No AI provider adapters registered');
      return first;
    }
    return adapter;
  }

  private selectModel(adapter: AiModelAdapter, tier: string): string {
    const tierMap: Record<string, number> = { fast: 0, balanced: 1, powerful: 2 };
    const idx = tierMap[tier] ?? 1;
    return adapter.supportedModels[Math.min(idx, adapter.supportedModels.length - 1)] ?? adapter.supportedModels[0] ?? 'unknown';
  }

  private validateByTemplate(templateId: string, parsed: unknown): ReturnType<OutputValidator['validateExtractionOutput']> {
    if (templateId === 'recruiter-entity-extraction') {
      return this.validator.validateExtractionOutput(parsed);
    }
    if (templateId === 'recruiter-reasoning-enrichment') {
      return this.validator.validateReasoningOutput(parsed);
    }
    if (templateId === 'recruiter-intelligence-profile') {
      return this.validator.validateProfileOutput(parsed);
    }
    return this.validator.validateExtractionOutput(parsed);
  }

  private normalizeFields(
    parsed: Record<string, unknown>,
    input: ExtractionInput,
    templateId: string,
  ): ExtractedField[] {
    const provenance = toProvenance(input, this.preferredProvider, 'unknown');

    if (templateId === 'recruiter-reasoning-enrichment') {
      const inferences = (parsed['inferences'] as unknown[]) ?? [];
      return inferences.map((inf) => {
        const i = inf as Record<string, unknown>;
        const confidence = typeof i['confidence'] === 'number'
          ? Math.max(0, Math.min(1, i['confidence']))
          : 0.5;
        return {
          field: String(i['attribute'] ?? ''),
          value: i['value'],
          rawValue: String(i['value'] ?? ''),
          confidence,
          confidenceBand: toConfidenceBand(confidence),
          evidence: ((i['supportingEvidence'] as string[] | undefined) ?? []).map((exc) => ({
            sourceId: input.sourceId,
            excerpt: exc,
            confidence,
          })),
          provenance,
          normalizedValue: i['value'],
        };
      });
    }

    if (templateId === 'recruiter-intelligence-profile') {
      // Profile output is a flat object — convert top-level keys to fields
      return Object.entries(parsed).map(([key, val]) => {
        return {
          field: key,
          value: val,
          rawValue: typeof val === 'string' ? val : JSON.stringify(val),
          confidence: 0.82,
          confidenceBand: toConfidenceBand(0.82),
          evidence: [{ sourceId: input.sourceId, excerpt: key, confidence: 0.82 }],
          provenance,
          normalizedValue: val,
        };
      });
    }

    // Default: fields array
    const fields = (parsed['fields'] as unknown[]) ?? [];
    return fields.map((f) => {
      const field = f as Record<string, unknown>;
      const confidence = typeof field['confidence'] === 'number'
        ? Math.max(0, Math.min(1, field['confidence']))
        : 0.5;
      const evidence = (field['evidence'] as Array<{ excerpt?: string; confidence?: number }> | undefined) ?? [];
      return {
        field: String(field['field'] ?? ''),
        value: field['value'],
        rawValue: String(field['rawValue'] ?? field['value'] ?? ''),
        confidence,
        confidenceBand: toConfidenceBand(confidence),
        evidence: evidence.map((e) => ({
          sourceId: input.sourceId,
          excerpt: String(e.excerpt ?? ''),
          confidence: typeof e.confidence === 'number' ? e.confidence : confidence,
        })),
        provenance,
        normalizedValue: field['value'],
      };
    });
  }

  private computeOverallConfidence(fields: ExtractedField[]): number {
    if (fields.length === 0) return 0;
    const avg = fields.reduce((sum, f) => sum + f.confidence, 0) / fields.length;
    return Number(avg.toFixed(4));
  }

  private isRetryable(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    if (err instanceof ExtractionParseError) return true; // malformed output may succeed on retry
    if (err instanceof ExtractionValidationError) return false; // structural mismatch — don't retry
    const msg = err.message.toLowerCase();
    return this.retryPolicy.retryableErrors.some((pattern) => msg.includes(pattern.toLowerCase()));
  }

  private computeDelay(attempt: number): number {
    const delay = this.retryPolicy.baseDelayMs * Math.pow(this.retryPolicy.backoffMultiplier, attempt - 1);
    const jitter = Math.random() * 100;
    return Math.min(delay + jitter, this.retryPolicy.maxDelayMs);
  }
}

// ─── Pipeline Errors ──────────────────────────────────────────────────────────

export class ExtractionParseError extends Error {
  constructor(message: string, public readonly rawText: string) {
    super(message);
    this.name = 'ExtractionParseError';
  }
}

export class ExtractionValidationError extends Error {
  constructor(
    message: string,
    public readonly validationResult: ReturnType<OutputValidator['validateExtractionOutput']>,
  ) {
    super(message);
    this.name = 'ExtractionValidationError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
