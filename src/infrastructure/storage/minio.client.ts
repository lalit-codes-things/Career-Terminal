/**
 * MinIO / S3 client factory.
 *
 * Returns an S3Client configured for:
 *   - Local MinIO: when AWS_ENDPOINT_URL_S3 is set (docker-compose dev)
 *   - AWS S3:      when AWS_ENDPOINT_URL_S3 is absent (production)
 *
 * The distinction is transparent to calling code — the same S3Client API
 * works against both MinIO and AWS S3.
 *
 * MinIO requires `forcePathStyle: true` because it uses path-style URLs
 * (http://localhost:9000/bucket/key) rather than virtual-hosted-style
 * (http://bucket.localhost:9000/key).
 */
import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { config } from '../../config';

export interface StorageClientOptions {
  /** Override the endpoint (MinIO in dev, absent for real S3 in prod). */
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucket?: string;
}

/**
 * Resolves storage client options from centralized config.
 */
function resolveStorageOptions(): StorageClientOptions {
  return {
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    bucket: config.s3.bucket,
  };
}

/**
 * Creates a configured S3Client.
 * In development (with MinIO), pass endpoint and forcePathStyle is enabled.
 * In production, standard AWS SDK credential resolution is used.
 */
export function createStorageClient(opts?: StorageClientOptions): S3Client {
  const options = opts ?? resolveStorageOptions();

  const clientConfig: S3ClientConfig = {
    region: options.region ?? 'us-east-1',
  };

  if (options.endpoint) {
    clientConfig.endpoint = options.endpoint;
    clientConfig.forcePathStyle = true; // Required for MinIO
  }

  if (options.accessKeyId && options.secretAccessKey) {
    clientConfig.credentials = {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    };
  }

  return new S3Client(clientConfig);
}

/**
 * Singleton storage client — configured from environment variables.
 * Import this in services that need to interact with storage.
 */
export const storageClient = createStorageClient();

/**
 * The configured bucket name — read from centralized config.
 * Use this wherever a bucket name is needed rather than reading env directly.
 */
export const storageBucket = config.s3.bucket;
