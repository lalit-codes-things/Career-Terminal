/**
 * Storage factory — selects the dataset storage backend from configuration.
 *
 * Switching between local filesystem and S3-compatible object storage is a
 * configuration change only (`COMPANY_INTEL_STORAGE_BACKEND`); providers and
 * importers never reference a concrete adapter.
 */

import { S3Client } from '@aws-sdk/client-s3';
import type { CompanyIntelStorageBackend } from '../config';
import { LocalFilesystemStorage } from './local-filesystem.adapter';
import { S3Storage } from './s3.adapter';
import type { CompanyDataStorage } from './storage.types';

export interface StorageFactoryOptions {
  backend: CompanyIntelStorageBackend;
  localRootDir: string;
  s3Bucket?: string;
  s3Prefix?: string;
  s3Endpoint?: string;
  s3Region?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  client?: S3Client;
}

/** Create the storage adapter for the configured backend. */
export function createCompanyDataStorage(options: StorageFactoryOptions): CompanyDataStorage {
  if (options.backend === 's3') {
    if (!options.s3Bucket) {
      throw new Error(
        'Company intelligence storage backend is "s3" but no bucket was configured. ' +
          'Set COMPANY_INTEL_S3_BUCKET (and COMPANY_INTEL_S3_ENDPOINT for MinIO).',
      );
    }
    const client =
      options.client ??
      new S3Client({
        region: options.s3Region ?? 'us-east-1',
        ...(options.s3Endpoint
          ? {
              endpoint: options.s3Endpoint,
              forcePathStyle: true,
            }
          : {}),
        ...(options.s3AccessKeyId && options.s3SecretAccessKey
          ? {
              credentials: {
                accessKeyId: options.s3AccessKeyId,
                secretAccessKey: options.s3SecretAccessKey,
              },
            }
          : {}),
      });
    return new S3Storage(options.s3Bucket, options.s3Prefix, client);
  }

  return new LocalFilesystemStorage(options.localRootDir);
}
