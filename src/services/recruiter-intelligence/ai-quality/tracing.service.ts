import { randomUUID } from 'crypto';
import type { TraceSpan, TraceEvent, InferenceLogEntry } from '../../domain/recruiter-intelligence/ai-quality/contracts';

export class TracingService {
  private readonly spans = new Map<string, TraceSpan>();
  private readonly inferenceLogs = new Map<string, InferenceLogEntry>();
  private readonly activeSpans = new Map<string, TraceSpan>();

  startSpan(
    operationName: string,
    parentSpanId?: string,
    attributes?: Record<string, unknown>,
  ): TraceSpan {
    const spanId = randomUUID();
    const span: TraceSpan = {
      spanId,
      parentSpanId,
      operationName,
      startTime: new Date(),
      endTime: new Date(),
      durationMs: 0,
      attributes: attributes ?? {},
      events: [],
      status: 'ok',
    };
    this.activeSpans.set(spanId, span);
    return span;
  }

  endSpan(spanId: string, status?: 'ok' | 'error' | 'unset'): TraceSpan | null {
    const span = this.activeSpans.get(spanId);
    if (!span) return null;

    span.endTime = new Date();
    span.durationMs = span.endTime.getTime() - span.startTime.getTime();
    span.status = status ?? 'ok';
    this.spans.set(spanId, span);
    this.activeSpans.delete(spanId);
    return span;
  }

  addEvent(spanId: string, eventName: string, attributes?: Record<string, unknown>): TraceEvent | null {
    const span = this.activeSpans.get(spanId);
    if (!span) return null;

    const event: TraceEvent = {
      eventId: randomUUID(),
      name: eventName,
      timestamp: new Date(),
      attributes: attributes ?? {},
    };
    span.events.push(event);
    return event;
  }

  logInference(entry: Omit<InferenceLogEntry, 'logId'>): InferenceLogEntry {
    const logId = randomUUID();
    const logEntry: InferenceLogEntry = {
      logId,
      ...entry,
      timestamp: new Date(),
    };
    this.inferenceLogs.set(logId, logEntry);
    return logEntry;
  }

  getSpan(spanId: string): TraceSpan | undefined {
    return this.spans.get(spanId);
  }

  getActiveSpans(): TraceSpan[] {
    return [...this.activeSpans.values()];
  }

  getInferenceLogs(): InferenceLogEntry[] {
    return [...this.inferenceLogs.values()];
  }

  getSpansByOperation(operationName: string): TraceSpan[] {
    return [...this.spans.values()].filter((s) => s.operationName === operationName);
  }

  getLatencyStats(operationName?: string): {
    count: number;
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    minLatencyMs: number;
    maxLatencyMs: number;
  } {
    const spans = operationName
      ? [...this.spans.values()].filter((s) => s.operationName === operationName)
      : [...this.spans.values()];

    if (spans.length === 0) {
      return { count: 0, avgLatencyMs: 0, p50LatencyMs: 0, p95LatencyMs: 0, p99LatencyMs: 0, minLatencyMs: 0, maxLatencyMs: 0 };
    }

    const durations = spans.map((s) => s.durationMs).sort((a, b) => a - b);
    const count = durations.length;
    const avgLatencyMs = durations.reduce((s, d) => s + d, 0) / count;
    const p50 = durations[Math.floor(count * 0.5)] ?? 0;
    const p95 = durations[Math.floor(count * 0.95)] ?? 0;
    const p99 = durations[Math.floor(count * 0.99)] ?? 0;

    return {
      count,
      avgLatencyMs: Number(avgLatencyMs.toFixed(2)),
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      p99LatencyMs: p99,
      minLatencyMs: durations[0] ?? 0,
      maxLatencyMs: durations[count - 1] ?? 0,
    };
  }
}