/**
 * StorageService — S3-backed file storage abstraction.
 *
 * Business logic depends on IStorageService, not the AWS SDK directly.
 * Swap the implementation for GCS, Azure Blob, or a local-disk mock in tests.
 *
 * Key design decisions:
 *  - Files are stored under `uploads/resumes/<sha256hash>.<ext>` so the
 *    object key is deterministic and content-addressable.
 *  - We never re-upload a file whose hash already exists — the dedup check
 *    happens in ResumeUploadService before calling upload().
 *  - Pre-signed GET URLs (1 hour TTL) are returned instead of public URLs
 *    so the bucket stays private.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '../../lib/logger';
import { CircuitBreaker } from '../../lib/circuit-breaker';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface UploadResult {
  /** Permanent S3 object key (use as the canonical reference in the DB). */
  storageKey: string;
  /** Pre-signed URL valid for 1 hour — for immediate client download. */
  presignedUrl: string;
}

export interface IStorageService {
  /**
   * Upload a file buffer.
   * @param key      S3 object key (caller computes this — keeps service dumb).
   * @param buffer   Raw file bytes.
   * @param mimeType Content-Type header value.
   * @returns        The storage key and a short-lived presigned URL.
   */
  upload(key: string, buffer: Buffer, mimeType: string): Promise<UploadResult>;
  uploadToBucket(bucket: string, key: string, buffer: Buffer, mimeType: string): Promise<UploadResult>;

  /**
   * Generate a fresh pre-signed GET URL for an existing object.
   * @param key     S3 object key.
   * @param ttlSec  URL validity in seconds (default: 3600).
   */
  getPresignedUrl(key: string, ttlSec?: number, bucket?: string): Promise<string>;

  /**
   * Check whether an object exists in S3 (HEAD request — no data transfer).
   */
  exists(key: string, bucket?: string): Promise<boolean>;

  download(key: string, bucket?: string): Promise<Buffer>;

  /**
   * Delete an object. Used only for hard-delete flows (GDPR erasure, etc.).
   */
  delete(key: string, bucket?: string): Promise<void>;

  copyToBucket(
    sourceKey: string,
    destinationBucket: string,
    destinationKey?: string,
    sourceBucket?: string,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// S3 implementation
// ---------------------------------------------------------------------------

export class S3StorageService implements IStorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly circuitBreaker: CircuitBreaker;

  constructor() {
    this.bucket = process.env.S3_BUCKET ?? '';
    if (!this.bucket) {
      logger.warn('[StorageService] S3_BUCKET env var is not set — uploads will fail');
    }

    this.client = new S3Client({
      region: process.env.AWS_REGION ?? 'us-east-1',
      // Credentials are picked up from env vars (AWS_ACCESS_KEY_ID /
      // AWS_SECRET_ACCESS_KEY) or the EC2 instance metadata service automatically.
    });

    this.circuitBreaker = new CircuitBreaker('S3Storage', {
      failureThreshold: 3,
      resetTimeout: 30000,
      requestTimeout: 10000, // 10 seconds timeout for S3 calls
    });
  }

  async upload(key: string, buffer: Buffer, mimeType: string): Promise<UploadResult> {
    return this.uploadToBucket(this.bucket, key, buffer, mimeType);
  }

  async uploadToBucket(bucket: string, key: string, buffer: Buffer, mimeType: string): Promise<UploadResult> {
    await this.circuitBreaker.fire(() =>
      this.client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
          // Server-side encryption — use your KMS key ARN in production
          ServerSideEncryption: 'AES256',
        }),
      ),
    );

    const presignedUrl = await this.getPresignedUrl(key);

    logger.info('[StorageService] File uploaded', { key, mimeType, bytes: buffer.length });

    return { storageKey: key, presignedUrl };
  }

  async getPresignedUrl(key: string, ttlSec = 3_600, bucket = this.bucket): Promise<string> {
    return this.circuitBreaker.fire(() =>
      getSignedUrl(this.client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: ttlSec,
      }),
    );
  }

  async exists(key: string, bucket = this.bucket): Promise<boolean> {
    try {
      await this.circuitBreaker.fire(() =>
        this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })),
      );
      return true;
    } catch {
      return false;
    }
  }

  async download(key: string, bucket = this.bucket): Promise<Buffer> {
    const result = await this.circuitBreaker.fire(() =>
      this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key })),
    );

    const body = result.Body;
    if (!body || typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray !== 'function') {
      throw new Error('S3 object body is not readable');
    }

    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }

  async delete(key: string, bucket = this.bucket): Promise<void> {
    await this.circuitBreaker.fire(() =>
      this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
    );
    logger.info('[StorageService] File deleted', { key });
  }

  async copyToBucket(
    sourceKey: string,
    destinationBucket: string,
    destinationKey = sourceKey,
    sourceBucket = this.bucket,
  ): Promise<void> {
    await this.circuitBreaker.fire(() =>
      this.client.send(
        new CopyObjectCommand({
          Bucket: destinationBucket,
          CopySource: `${sourceBucket}/${sourceKey}`,
          Key: destinationKey,
          ServerSideEncryption: 'AES256',
        }),
      ),
    );
    logger.info('[StorageService] File copied', { sourceKey, destinationBucket, destinationKey });
  }
}

// ---------------------------------------------------------------------------
// Null implementation — for tests / local dev without AWS credentials
// ---------------------------------------------------------------------------

export class NullStorageService implements IStorageService {
  async upload(key: string, _buffer: Buffer, _mimeType: string): Promise<UploadResult> {
    logger.info('[NullStorageService] upload (no-op)', { key });
    return {
      storageKey: key,
      presignedUrl: `http://localhost/storage/${key}`,
    };
  }

  async uploadToBucket(_bucket: string, key: string, _buffer: Buffer, _mimeType: string): Promise<UploadResult> {
    return this.upload(key, Buffer.from(''), 'application/octet-stream');
  }

  async getPresignedUrl(key: string): Promise<string> {
    return `http://localhost/storage/${key}`;
  }

  async exists(_key: string): Promise<boolean> {
    return false;
  }

  async download(_key: string): Promise<Buffer> {
    return Buffer.from('');
  }

  async delete(key: string): Promise<void> {
    logger.info('[NullStorageService] delete (no-op)', { key });
  }

  async copyToBucket(_sourceKey: string, _destinationBucket: string, _destinationKey?: string): Promise<void> {
    logger.info('[NullStorageService] copyToBucket (no-op)');
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const storageService: IStorageService =
  process.env.NODE_ENV === 'test' || !process.env.S3_BUCKET
    ? new NullStorageService()
    : new S3StorageService();
