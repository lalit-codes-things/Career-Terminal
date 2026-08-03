import type { AiProviderKind, ModelUsageRecord } from './types';
import { randomUUID } from 'crypto';

/**
 * Pricing per 1k tokens (USD). Kept here as a central registry.
 * Updated manually when providers change pricing.
 */
const PRICING_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
  'claude-3-5-haiku-20241022': { input: 0.0008, output: 0.004 },
  'claude-3-opus-20240229': { input: 0.015, output: 0.075 },
  'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
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
