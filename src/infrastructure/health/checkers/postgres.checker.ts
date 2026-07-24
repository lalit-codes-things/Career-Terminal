import { prisma } from '../../../config/database';
import { IHealthChecker, HealthCheckResult } from '../health.types';

export class PostgresChecker implements IHealthChecker {
  readonly name = 'postgres';

  async check(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      return {
        name: this.name,
        status: 'healthy',
        message: 'Connected',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        name: this.name,
        status: 'unhealthy',
        message: message.slice(0, 200),
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
      };
    }
  }
}

export const postgresChecker = new PostgresChecker();
