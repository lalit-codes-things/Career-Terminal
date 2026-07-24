/**
 * Storage health checker.
 * Verifies S3 / MinIO connectivity by issuing a HeadBucket request.
 * Works for both AWS S3 and local MinIO (set AWS_ENDPOINT_URL_S3 for MinIO).
 */
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { type IHealthChecker, type HealthCheckResult } from '../health.types';

export class StorageChecker implements IHealthChecker {
  readonly name = 'storage';

  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const endpoint = process.env.AWS_ENDPOINT_URL_S3;

    this.bucket = process.env.S3_BUCKET ?? process.env.MINIO_BUCKET ?? '';

    this.client = new S3Client({
      region: process.env.AWS_REGION ?? 'us-east-1',
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
  }

  async check(): Promise<HealthCheckResult> {
    if (!this.bucket) {
      return {
        name: this.name,
        status: 'degraded',
        message: 'S3_BUCKET / MINIO_BUCKET not configured — storage checks skipped',
        checkedAt: new Date().toISOString(),
      };
    }

    const start = Date.now();
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return {
        name: this.name,
        status: 'healthy',
        message: `Bucket '${this.bucket}' accessible`,
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

export const storageChecker = new StorageChecker();
