export interface RecruiterIntelligenceMetric {
  name: string;
  value: number;
  labels?: Record<string, string>;
}

export interface RecruiterIntelligenceObserver {
  recordMetric(metric: RecruiterIntelligenceMetric): void;
  trace(operation: string, payload: Record<string, unknown>): void;
  log(level: 'info' | 'warn' | 'error', message: string, payload?: Record<string, unknown>): void;
}
