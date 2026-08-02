/**
 * Company Intelligence — storage abstraction.
 *
 * Every provider reads its datasets exclusively through the `CompanyDataStorage`
 * interface. The concrete backend (local filesystem or S3-compatible object
 * storage) is selected by configuration (`COMPANY_INTEL_STORAGE_BACKEND`),
 * so switching between backends requires zero code changes.
 *
 * URIs are logical paths relative to the configured backend root, e.g.
 *   'sec/full-submissions/2024/1/0000320193.json'
 */

import type { Readable } from 'node:stream';

export type CompanyDataStorageKind = 'local' | 's3';

export interface StoredObject {
  uri: string;
  sizeBytes: number;
  lastModified: Date;
}

export interface CompanyDataStorage {
  readonly kind: CompanyDataStorageKind;

  /** Read a dataset URI as a Buffer. */
  read(uri: string): Promise<Buffer>;

  /** Read a dataset URI as UTF-8 text. */
  readText(uri: string): Promise<string>;

  /** Write bytes/text to a dataset URI, creating parent keys as needed. */
  write(uri: string, data: Buffer | string): Promise<void>;

  /** List object URIs under a logical prefix (non-recursive where supported). */
  list(prefix: string): Promise<string[]>;

  /** True when the URI resolves to an existing object. */
  exists(uri: string): Promise<boolean>;

  /** Open a URI as a readable stream with content-type metadata. */
  openStream(uri: string): Promise<{ stream: Readable; contentType: string }>;
}

export interface CompanyDataStorageOptions {
  kind: CompanyDataStorageKind;
  /** Local filesystem root when kind === 'local'. */
  localRootDir?: string;
  /** S3 bucket when kind === 's3'. */
  s3Bucket?: string;
  /** S3 key prefix when kind === 's3'. */
  s3Prefix?: string;
}
