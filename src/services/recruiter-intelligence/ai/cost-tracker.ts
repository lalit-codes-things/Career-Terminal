import type { AiProviderKind, ModelUsageRecord } from './types';
import { randomUUID } from 'crypto';

/**
 * Pricing per 1k tokens (USD). Kept here as a central registry.
 * Updated manually when providers change pricing.
 */
const PRICING_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  // OpenRouter models (single gateway)
  'deepseek/deepseek-chat': { input: 0.00014, output: 0.00028 },
  'deepseek/deepseek-r1': { input: 0.00055, output: 0.00219 },
  'meta-llama/llama-3.3-70b-instruct': { input: 0.00065, output: 0.00065 },
  'google/gemini-flash-1.5': { input: 0.0000375, output: 0.00015 },
  // Stubs
  'stub-fast': { input: 0, output: 0 },
  'stub-balanced': { input: 0, output: 0 },
  'stub-powerful': { input: 0, output: 0 },
};

const DEFAULT_PRICING = { input: 0.001, output: 0.002 };

export class CostTracker {
  private readonly records: ModelUsageRecord[] = [];

  record(params: {
    provider: AiProviderKind;
    model: string;
    templateId: string;
    tenantId: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    success: boolean;
    error?: string;
  }): ModelUsageRecord {
    const pricing = PRICING_PER_1K_TOKENS[params.model] ?? DEFAULT_PRICING;
    const estimatedCostUsd =
      (params.inputTokens / 1000) * pricing.input +
      (params.outputTokens / 1000) * pricing.output;

    const record: ModelUsageRecord = {
      usageId: randomUUID(),
      ...params,
      totalTokens: params.inputTokens + params.outputTokens,
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(8)),
      recordedAt: new Date(),
    };

    this.records.push(record);
    return record;
  }

  getRecords(): readonly ModelUsageRecord[] {
    return this.records;
  }

  totalCostUsd(): number {
    return this.records.reduce((sum, r) => sum + r.estimatedCostUsd, 0);
  }

  totalTokens(): number {
    return this.records.reduce((sum, r) => sum + r.totalTokens, 0);
  }

  byTemplate(templateId: string): ModelUsageRecord[] {
    return this.records.filter((r) => r.templateId === templateId);
  }

  byTenant(tenantId: string): ModelUsageRecord[] {
    return this.records.filter((r) => r.tenantId === tenantId);
  }

  summarize(): {
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    successRate: number;
    averageLatencyMs: number;
  } {
    const total = this.records.length;
    if (total === 0) {
      return {
        totalCalls: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
        successRate: 1,
        averageLatencyMs: 0,
      };
    }

    const successful = this.records.filter((r) => r.success).length;
    const totalLatency = this.records.reduce((sum, r) => sum + r.latencyMs, 0);

    return {
      totalCalls: total,
      totalInputTokens: this.records.reduce((s, r) => s + r.inputTokens, 0),
      totalOutputTokens: this.records.reduce((s, r) => s + r.outputTokens, 0),
      totalCostUsd: this.totalCostUsd(),
      successRate: successful / total,
      averageLatencyMs: Math.round(totalLatency / total),
    };
  }

  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = PRICING_PER_1K_TOKENS[model] ?? DEFAULT_PRICING;
    return (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;
  }
}
