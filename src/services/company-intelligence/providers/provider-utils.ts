/**
 * Shared provider utilities.
 */

import type { ProviderHealth } from './company-provider.types';

export function buildBasicAuthHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
}

export function buildProviderHealth(
  providerKey: string,
  status: ProviderHealth['status'],
  message?: string,
  detail?: Record<string, unknown>,
): ProviderHealth {
  return {
    providerKey,
    status,
    lastCheckedAt: new Date().toISOString(),
    message,
    detail,
  };
}

/** Coerce a raw fetched-at value to ISO string. */
export function toIsoTimestamp(value: string | number | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
