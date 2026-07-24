/**
 * Health check type definitions.
 */

/** The possible states a single dependency can be in. */
export type HealthStatus = 'healthy' | 'unhealthy' | 'degraded';

export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  message: string;
  latencyMs?: number;
  checkedAt: string;
}

export interface HealthReport {
  status: HealthStatus;
  timestamp: string;
  version: string;
  gitCommit?: string;
  buildTimestamp?: string;
  uptimeSeconds: number;
  startupDurationMs?: number;
  checks: HealthCheckResult[];
}

export interface LivenessResponse {
  status: 'ok';
  timestamp: string;
  uptimeSeconds: number;
}

export interface ReadinessResponse {
  status: HealthStatus;
  timestamp: string;
  checks: HealthCheckResult[];
}

export interface IHealthChecker {
  readonly name: string;
  check(): Promise<HealthCheckResult>;
}
