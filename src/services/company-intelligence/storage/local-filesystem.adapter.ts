/**
 * Local filesystem storage adapter.
 *
 * Maps logical dataset URIs onto files under a configured root directory.
 * Guards against path traversal so providers cannot read/write outside the
 * data root.
 */

import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { CompanyDataStorage, StoredObject } from './storage.types';

export class LocalFilesystemStorage implements CompanyDataStorage {
  readonly kind = 'local' as const;

  constructor(private readonly rootDir: string) {}

  /** Resolve a logical URI to an absolute path, rejecting traversal. */
  private resolve(uri: string): string {
    const normalized = uri.replace(/\\/g, '/');
    if (
      normalized.startsWith('/') ||
      normalized.includes('..') ||
      normalized.split('/').some((seg) => seg.length === 0)
    ) {
      throw new Error(`LocalFilesystemStorage: invalid dataset URI: ${uri}`);
    }
    return path.join(this.rootDir, normalized);
  }

  async read(uri: string): Promise<Buffer> {
    return readFile(this.resolve(uri));
  }

  async readText(uri: string): Promise<string> {
    return (await this.read(uri)).toString('utf8');
  }

  async write(uri: string, data: Buffer | string): Promise<void> {
    const absolute = this.resolve(uri);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, data);
  }

  async list(prefix: string): Promise<string[]> {
    const base = this.resolve(prefix || '.');
    const relative: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      const { readdir } = await import('node:fs/promises');
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else {
          relative.push(path.relative(this.rootDir, full).split(path.sep).join('/'));
        }
      }
    };
    await walk(base);
    return relative;
  }

  async exists(uri: string): Promise<boolean> {
    try {
      await stat(this.resolve(uri));
      return true;
    } catch {
      return false;
    }
  }

  async openStream(uri: string): Promise<{ stream: Readable; contentType: string }> {
    return {
      stream: createReadStream(this.resolve(uri)),
      contentType: 'application/octet-stream',
    };
  }

  /** Convenience for callers that need absolute paths (local backends only). */
  async listObjects(prefix: string): Promise<StoredObject[]> {
    const uris = await this.list(prefix);
    const objects: StoredObject[] = [];
    for (const uri of uris) {
      const s = await stat(this.resolve(uri));
      objects.push({ uri, sizeBytes: s.size, lastModified: s.mtime });
    }
    return objects;
  }
}
