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
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '../../lib/logger';

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

  /**
   * Generate a fresh pre-signed GET URL for an existing object.
   * @param key     S3 object key.
   * @param ttlSec  URL validity in seconds (default: 3600).
   */
  getPresignedUrl(key: string, ttlSec?: number): Promise<string>;

  /**
   * Check whether an object exists in S3 (HEAD request — no data transfer).
   */
  exists(key: string): Promise<boolean>;

  /**
   * Delete an object. Used only for hard-delete flows (GDPR erasure, etc.).
   */
  delete(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// S3 implementation
// ---------------------------------------------------------------------------

export class S3StorageService implements IStorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

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
  }

  async upload(key: string, buffer: Buffer, mimeType: string): Promise<UploadResult> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        // Server-side encryption — use your KMS key ARN in production
        ServerSideEncryption: 'AES256',
      }),
    );

    const presignedUrl = await this.getPresignedUrl(key);

    logger.info('[StorageService] File uploaded', { key, mimeType, bytes: buffer.length });

    return { storageKey: key, presignedUrl };
  }

  async getPresignedUrl(key: string, ttlSec = 3_600): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttlSec,
    });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    logger.info('[StorageService] File deleted', { key });
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

  async getPresignedUrl(key: string): Promise<string> {
    return `http://localhost/storage/${key}`;
  }

  async exists(_key: string): Promise<boolean> {
    return false;
  }

  async delete(key: string): Promise<void> {
    logger.info('[NullStorageService] delete (no-op)', { key });
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const storageService: IStorageService =
  process.env.NODE_ENV === 'test' || !process.env.S3_BUCKET
    ? new NullStorageService()
    : new S3StorageService();
