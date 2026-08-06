import { PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { storageClient, storageBucket } from './minio.client';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { randomUUID } from 'crypto';

export interface S3UploadResult {
  key: string;
  bucket: string;
  size: number;
  etag: string;
  url: string;
}

export interface S3Object {
  key: string;
  bucket: string;
  body: Buffer;
  size: number;
  contentType: string;
  lastModified: Date;
}

export class S3Service {
  private readonly bucket: string;

  constructor(bucket?: string) {
    this.bucket = bucket ?? storageBucket;
  }

  async upload(buffer: Buffer, key: string, contentType: string): Promise<S3UploadResult> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });

    const response = await storageClient.send(command);

    const result: S3UploadResult = {
      key,
      bucket: this.bucket,
      size: buffer.length,
      etag: response.ETag ?? '',
      url: `s3://${this.bucket}/${key}`,
    };

    logger.info('[S3Service] Uploaded object', { key, bucket: this.bucket, size: buffer.length });

    return result;
  }

  async getObject(key: string): Promise<S3Object | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await storageClient.send(command);

      const chunks: Buffer[] = [];
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks);

      return {
        key,
        bucket: this.bucket,
        body,
        size: body.length,
        contentType: response.ContentType ?? 'application/octet-stream',
        lastModified: response.LastModified ?? new Date(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('NoSuchKey')) {
        return null;
      }
      logger.error('[S3Service] Failed to get object', { key, error: message });
      throw err;
    }
  }

  async headObject(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await storageClient.send(command);
      return true;
    } catch {
      return false;
    }
  }

  generateKey(prefix: string, filename: string): string {
    const ext = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')) : '.bin';
    return `${prefix}/${randomUUID()}${ext}`;
  }

  getPublicUrl(key: string): string {
    if (config.s3.endpoint) {
      return `${config.s3.endpoint}/${this.bucket}/${key}`;
    }
    return `https://${this.bucket}.s3.amazonaws.com/${key}`;
  }
}

export const s3Service = new S3Service();