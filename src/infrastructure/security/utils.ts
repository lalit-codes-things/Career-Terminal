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

/**
 * Validate and sanitize a filename
 */
export function sanitizeFilename(filename: string): string {
  // Remove directory traversal
  let sanitized = filename.replace(/\.\.\//g, '').replace(/\.\.\\/g, '');

  // Remove invalid characters
  sanitized = sanitized.replace(/[<>:"/\\|?*]/g, '_');

  // Trim whitespace
  sanitized = sanitized.trim();

  // Remove leading/trailing dots
  sanitized = sanitized.replace(/^\.+|\.+$/g, '');

  // Prevent empty filename
  if (!sanitized) {
    sanitized = 'unnamed';
  }

  return sanitized;
}

/**
 * Normalize and validate a path
 */
export function normalizePath(path: string): string {
  let normalized = path.trim();

  // Normalize separators to forward slashes
  normalized = normalized.replace(/\\/g, '/');

  // Remove directory traversal
  while (normalized.includes('../')) {
    normalized = normalized.replace(/\/[^/]+\/\.\./g, '');
  }
  normalized = normalized.replace(/^\.\.\//g, '');
  normalized = normalized.replace(/\/\.\.\//g, '/');

  // Prevent leading/trailing slashes issues
  normalized = normalized.replace(/\/+/g, '/');

  // Reject dangerous patterns
  if (normalized.includes('/../') || normalized.includes('..\\')) {
    throw new Error('Invalid path contains dangerous traversal sequences');
  }

  return normalized;
}

/**
 * Validate origin against allowed list
 */
export function isValidOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
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
