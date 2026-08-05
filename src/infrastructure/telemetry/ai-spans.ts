/**
 * ai-spans.ts
 *
 * Extends the existing OpenTelemetry stack with AI-specific spans for
 * cost, latency, and token tracking.
 *
 * Design:
 *   - Uses the existing @opentelemetry/api tracer — no new SDK/exporter
 *   - Adds span attributes that observability platforms (Grafana, Datadog,
 *     Honeycomb) can query: ai.capability, ai.provider, ai.tokens.input, etc.
 *   - Wraps capability calls transparently via withAiSpan()
 *   - Sets provider event hook so company-intelligence OTel hook fires too
 *
 * Span naming convention: "ai.<capability>" e.g. "ai.extract", "ai.planner"
 *
 * Attributes added to every AI span:
 *   ai.capability         — capability name (extract, infer, predict, …)
 *   ai.provider           — deepseek | openrouter | stub
 *   ai.model              — model id
 *   ai.tokens.input       — prompt token count
 *   ai.tokens.output      — completion token count
 *   ai.tokens.total       — sum
 *   ai.cost.usd           — estimated cost in USD
 *   ai.latency.ms         — end-to-end latency including DB writes
 *   ai.confidence         — overall confidence score [0,1]
 *   ai.confidence.band    — low | medium | high | critical
 *   ai.entity.type        — recruiter | opportunity | resume | …
 *   ai.requires_review    — true/false
 *   ai.plan.id            — planner prediction id (when present)
 */

import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import { setProviderObservabilityHook } from '../../services/company-intelligence/framework/otel';

const TRACER_NAME = 'career-terminal.ai';

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Wrap an async AI operation in an OTel span with cost/latency/token attributes.
 * Returns the result of fn unchanged.
 */
export async function withAiSpan<T>(
  spanName: string,
  attributes: AiSpanAttributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(`ai.${spanName}`, async (span) => {
    // Set initial attributes
    applyAttributes(span, attributes);

    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Add AI attributes to the currently active span (for wrapping existing spans).
 * Safe to call even when there is no active span.
 */
export function recordAiAttributes(attributes: Partial<AiSpanAttributes>): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  applyAttributes(span, attributes);
}

export interface AiSpanAttributes {
  capability?: string;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  confidence?: number;
  confidenceBand?: string;
  entityType?: string;
  entityId?: string;
  requiresReview?: boolean;
  planId?: string;
  [key: string]: string | number | boolean | undefined;
}

// ── OTel hook for company-intelligence provider events ─────────────────────

/**
 * Install the OTel hook for company-intelligence provider lifecycle events.
 * Call this once during application startup (after initTracing()).
 */
export function installProviderOtelHook(): void {
  setProviderObservabilityHook({
    onProviderEvent(event) {
      const span = trace.getActiveSpan();
      if (!span) return;
      span.addEvent(`provider.${event.type}`, {
        'provider.key': event.providerKey,
        'provider.timestamp': event.timestamp,
        ...flattenAttributes(event.attributes ?? {}),
      });
    },
  });
}

// ── Private helpers ────────────────────────────────────────────────────────

function applyAttributes(span: Span, attrs: Partial<AiSpanAttributes>): void {
  if (attrs.capability)     span.setAttribute('ai.capability',       attrs.capability);
  if (attrs.provider)       span.setAttribute('ai.provider',         attrs.provider);
  if (attrs.model)          span.setAttribute('ai.model',            attrs.model);
  if (attrs.inputTokens != null)  span.setAttribute('ai.tokens.input',  attrs.inputTokens);
  if (attrs.outputTokens != null) span.setAttribute('ai.tokens.output', attrs.outputTokens);
  if (attrs.inputTokens != null && attrs.outputTokens != null) {
    span.setAttribute('ai.tokens.total', attrs.inputTokens + attrs.outputTokens);
  }
  if (attrs.costUsd != null)       span.setAttribute('ai.cost.usd',         attrs.costUsd);
  if (attrs.latencyMs != null)     span.setAttribute('ai.latency.ms',        attrs.latencyMs);
  if (attrs.confidence != null)    span.setAttribute('ai.confidence',        attrs.confidence);
  if (attrs.confidenceBand)        span.setAttribute('ai.confidence.band',   attrs.confidenceBand);
  if (attrs.entityType)            span.setAttribute('ai.entity.type',       attrs.entityType);
  if (attrs.entityId)              span.setAttribute('ai.entity.id',         attrs.entityId);
  if (attrs.requiresReview != null) span.setAttribute('ai.requires_review', attrs.requiresReview);
  if (attrs.planId)                span.setAttribute('ai.plan.id',           attrs.planId);
}

function flattenAttributes(obj: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = String(v);
  }
  return result;
}
