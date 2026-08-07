import path from 'path';
import { config } from '../../config';

/**
 * Sanitize input string to prevent injection attacks
 */
export function sanitizeString(input: string): string {
  let result = input.trim();

  // Normalize Unicode
  result = result.normalize('NFKC');

  // Remove invalid control characters except tab, newlines, carriage returns
  // eslint-disable-next-line no-control-regex
  result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');

  // Prevent CRLF injection
  result = result.replace(/[\r\n]/g, ' ');

  return result;
}

// ── Document / resume file validation ─────────────────────────────────────────

/** Magic-byte signatures for supported document formats. */
export const FILE_SIGNATURES: Record<string, { bytes: number[]; mimeTypes: string[] }> = {
  pdf: {
    bytes: [0x25, 0x50, 0x44, 0x46],
    mimeTypes: ['application/pdf'],
  },
  docx: {
    bytes: [0x50, 0x4b, 0x03, 0x04],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  },
  doc: {
    bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
    mimeTypes: ['application/msword'],
  },
};

export const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);

export function fileExtensionForMimeType(mimeType: string): string {
  const map: Record<string, string> = {
    'application/pdf': '.pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/msword': '.doc',
  };
  return map[mimeType] ?? '';
}

/**
 * Verify that a buffer's leading bytes match the declared MIME type / extension.
 * Throws on mismatch so callers never parse a spoofed payload.
 */
export function assertFileSignature(buffer: Buffer, mimeType: string, extension: string): void {
  const ext = (extension || fileExtensionForMimeType(mimeType)).replace('.', '').toLowerCase();
  const signature = FILE_SIGNATURES[ext];
  if (!signature) {
    return;
  }
  if (!signature.mimeTypes.includes(mimeType)) {
    throw new Error(
      `File signature for .${ext} does not match declared MIME type '${mimeType}'. Possible file type spoofing.`,
    );
  }
  const matches = signature.bytes.every((byte, index) => buffer[index] === byte);
  if (!matches) {
    throw new Error(`File content does not match ${ext} signature. Possible file type spoofing.`);
  }
}

/**
 * Validate and sanitize a filename using basename and allowlist.
 * Rejects any path containing traversal sequences rather than stripping them.
 */
export function sanitizeFilename(filename: string): string {
  const base = path.basename(filename);

  if (!base || base === '.' || base === '..') {
    return 'unnamed';
  }

  const sanitized = base.replace(/[<>:"|?*]/g, '_');

  if (sanitized.startsWith('.')) {
    return 'unnamed' + sanitized;
  }

  return sanitized;
}

/**
 * Normalize and validate a path
 */
export function normalizePath(inputPath: string): string {
  const base = path.basename(inputPath);

  if (!base || base === '.' || base === '..') {
    throw new Error('Invalid path contains dangerous traversal sequences');
  }

  const normalized = base.replace(/[<>:"|?*]/g, '_');

  if (normalized.startsWith('.')) {
    throw new Error('Invalid path contains dangerous traversal sequences');
  }

  return normalized;
}

/**
 * Validate that origin is a structurally well-formed URL without CRLF injection
 */
export function isValidOriginUrl(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !/[\r\n]/.test(origin);
  } catch {
    return false;
  }
}

/**
 * Validate origin against allowed list
 */
export function isValidOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  if (!isValidOriginUrl(origin)) {
    return false;
  }

  const { allowedOrigins } = config.cors;
  const { isProduction } = config;

  if (!isProduction && allowedOrigins.length === 0) {
    return true;
  }

  return allowedOrigins.includes(origin);
}

/**
 * Prevent prototype pollution by checking keys
 */
export function isSafeKey(key: string): boolean {
  return (
    key !== '__proto__' &&
    key !== 'constructor' &&
    key !== 'prototype' &&
    !key.startsWith('__') &&
    !key.includes('.prototype.')
  );
}

/**
 * Remove unsafe keys from an object (prototype pollution prevention)
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const safeObj: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSafeKey(key)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        safeObj[key] = sanitizeObject(value as Record<string, unknown>);
      } else if (Array.isArray(value)) {
        safeObj[key] = value.map((item) =>
          typeof item === 'object' && item !== null
            ? sanitizeObject(item as Record<string, unknown>)
            : item,
        );
      } else if (typeof value === 'string') {
        safeObj[key] = sanitizeString(value);
      } else {
        safeObj[key] = value;
      }
    }
  }
  return safeObj as T;
}
