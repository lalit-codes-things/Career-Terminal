/**
 * HealthService — aggregates all dependency health checkers.
 */
import {
  type IHealthChecker,
  type HealthCheckResult,
  type HealthReport,
  type ReadinessResponse,
  type LivenessResponse,
  type HealthStatus,
} from './health.types';
import { postgresChecker } from './checkers/postgres.checker';
import { redisChecker } from './checkers/redis.checker';
import { storageChecker } from './checkers/storage.checker';
import { config } from '../../config';

/** Milliseconds before a single health check is considered timed out. */
const CHECK_TIMEOUT_MS = 5_000;

export class HealthService {
  private readonly checkers: IHealthChecker[];
  private readonly startTime: Date;

  constructor(checkers?: IHealthChecker[]) {
    this.checkers = checkers ?? [postgresChecker, redisChecker, storageChecker];
    this.startTime = new Date();
  }

  async runAll(): Promise<HealthCheckResult[]> {
    return Promise.all(this.checkers.map((checker) => this.runWithTimeout(checker)));
  }

  async getHealthReport(): Promise<HealthReport> {
    const checks = await this.runAll();
    return {
      status: this.aggregate(checks),
      timestamp: new Date().toISOString(),
      version: config.appVersion,
      gitCommit: config.gitCommit,
      buildTimestamp: config.buildTimestamp,
      uptimeSeconds: Math.floor(process.uptime()),
      startupDurationMs: Date.now() - this.startTime.getTime(),
      checks,
    };
  }

  async getReadinessReport(): Promise<ReadinessResponse> {
    const checks = await this.runAll();
    return {
      status: this.aggregate(checks),
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  getLiveness(): LivenessResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  private aggregate(checks: HealthCheckResult[]): HealthStatus {
    if (checks.every((c) => c.status === 'healthy')) return 'healthy';
    if (checks.some((c) => c.status === 'unhealthy')) return 'unhealthy';
    return 'degraded';
  }

  private async runWithTimeout(checker: IHealthChecker): Promise<HealthCheckResult> {
    const timeout = new Promise<HealthCheckResult>((resolve) =>
      setTimeout(
        () =>
          resolve({
            name: checker.name,
            status: 'unhealthy',
            message: `Health check timed out after ${CHECK_TIMEOUT_MS}ms`,
            checkedAt: new Date().toISOString(),
          }),
        CHECK_TIMEOUT_MS,
      ),
    );
    return Promise.race([checker.check(), timeout]);
  }
}

export const healthService = new HealthService();
