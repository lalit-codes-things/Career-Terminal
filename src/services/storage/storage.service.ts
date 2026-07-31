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
import { config } from '../../config';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface UploadResult {
  storageKey: string;
  presignedUrl: string;
}

export interface IStorageService {
  upload(key: string, buffer: Buffer, mimeType: string): Promise<UploadResult>;
  uploadToBucket(
    bucket: string,
    key: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<UploadResult>;
  getPresignedUrl(key: string, ttlSec?: number, bucket?: string): Promise<string>;
  exists(key: string, bucket?: string): Promise<boolean>;
  download(key: string, bucket?: string): Promise<Buffer>;
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
    this.bucket = config.s3.bucket;
    if (!this.bucket) {
      logger.warn('[StorageService] S3 bucket is not configured — uploads will fail');
    }

    this.client = new S3Client({
      region: config.s3.region,
    });

    this.circuitBreaker = new CircuitBreaker('S3Storage', {
      failureThreshold: 3,
      resetTimeout: 30000,
      requestTimeout: config.s3.timeout,
    });
  }

  async upload(key: string, buffer: Buffer, mimeType: string): Promise<UploadResult> {
    return this.uploadToBucket(this.bucket, key, buffer, mimeType);
  }

  async uploadToBucket(
    bucket: string,
    key: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<UploadResult> {
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
    if (
      !body ||
      typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray !==
        'function'
    ) {
      throw new Error('S3 object body is not readable');
    }

    const bytes = await (
      body as { transformToByteArray: () => Promise<Uint8Array> }
    ).transformToByteArray();
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

  async uploadToBucket(
    _bucket: string,
    key: string,
    _buffer: Buffer,
    _mimeType: string,
  ): Promise<UploadResult> {
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

  async copyToBucket(
    _sourceKey: string,
    _destinationBucket: string,
    _destinationKey?: string,
  ): Promise<void> {
    logger.info('[NullStorageService] copyToBucket (no-op)');
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const storageService: IStorageService =
  config.nodeEnv === 'test' || !config.s3.bucket
    ? new NullStorageService()
    : new S3StorageService();
