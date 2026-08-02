/**
 * S3-compatible object storage adapter.
 *
 * Maps logical dataset URIs onto objects in a configured bucket under a
 * configurable key prefix. Uses the AWS SDK v3 `S3Client` so the same adapter
 * works against AWS S3, MinIO or any S3-compatible endpoint — selection is
 * purely configuration (see `storage.factory.ts`).
 */

import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import type { CompanyDataStorage, StoredObject } from './storage.types';

export interface S3StorageOptions {
  bucket: string;
  prefix?: string;
  client?: S3Client;
}

export class S3Storage implements CompanyDataStorage {
  readonly kind = 's3' as const;
  private readonly prefix: string;

  constructor(
    private readonly bucket: string,
    prefix: string | undefined,
    private readonly client: S3Client,
  ) {
    this.prefix = (prefix ?? '').replace(/^\/+|\/+$/g, '');
  }

  /** Map a logical URI to a bucket key (prefix + uri). */
  private keyFor(uri: string): string {
    const normalized = uri.replace(/\\/g, '/');
    if (
      normalized.startsWith('/') ||
      normalized.includes('..') ||
      normalized.split('/').some((seg) => seg.length === 0)
    ) {
      throw new Error(`S3Storage: invalid dataset URI: ${uri}`);
    }
    return this.prefix ? `${this.prefix}/${normalized}` : normalized;
  }

  async read(uri: string): Promise<Buffer> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: this.keyFor(uri) });
    const response = await this.client.send(command);
    return this.streamToBuffer(response.Body as Readable);
  }

  async readText(uri: string): Promise<string> {
    return (await this.read(uri)).toString('utf8');
  }

  async write(uri: string, data: Buffer | string): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.keyFor(uri),
      Body: data,
    });
    await this.client.send(command);
  }

  async list(prefix: string): Promise<string[]> {
    const keyPrefix = prefix ? `${this.prefix ? `${this.prefix}/` : ''}${prefix}` : this.prefix;
    const uris: string[] = [];
    let continuationToken: string | undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: keyPrefix,
        ContinuationToken: continuationToken,
      });
      const response = await this.client.send(command);
      for (const obj of response.Contents ?? []) {
        uris.push(obj.Key ?? '');
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    const rootPrefix = this.prefix ? `${this.prefix}/` : '';
    return uris
      .filter((key) => key.startsWith(rootPrefix))
      .map((key) => key.slice(rootPrefix.length))
      .filter((key) => key.length > 0);
  }

  async exists(uri: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({ Bucket: this.bucket, Key: this.keyFor(uri) });
      await this.client.send(command);
      return true;
    } catch {
      return false;
    }
  }

  async openStream(uri: string): Promise<{ stream: Readable; contentType: string }> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: this.keyFor(uri) });
    const response = await this.client.send(command);
    return {
      stream: response.Body as Readable,
      contentType: response.ContentType ?? 'application/octet-stream',
    };
  }

  async listObjects(prefix: string): Promise<StoredObject[]> {
    const uris = await this.list(prefix);
    const objects: StoredObject[] = [];
    for (const uri of uris) {
      const key = this.keyFor(uri);
      const command = new HeadObjectCommand({ Bucket: this.bucket, Key: key });
      const head = await this.client.send(command);
      objects.push({
        uri,
        sizeBytes: head.ContentLength ?? 0,
        lastModified: head.LastModified ?? new Date(),
      });
    }
    return objects;
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Uint8Array);
    }
    return Buffer.concat(chunks);
  }
}
