import { createHash } from 'crypto';
import type { RecruiterContactKind, RecruiterIdentitySignal } from './identity.types';

export function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, '')
    .replace(/\s+/g, ' ');
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizePhone(value: string): string {
  return value.replace(/[^0-9+]/g, '').replace(/^00/, '+');
}

export function normalizeSocial(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
}

export function normalizeSignal(kind: RecruiterContactKind, value: string): string {
  if (kind === 'email') return normalizeEmail(value);
  if (kind === 'phone') return normalizePhone(value);
  if (kind === 'social') return normalizeSocial(value);
  return normalizeName(value);
}

export function fingerprintSignal(kind: RecruiterContactKind, value: string): string {
  return createHash('sha256')
    .update(`${kind}:${normalizeSignal(kind, value)}`)
    .digest('hex');
}

export function buildFingerprints(name: string, signals: RecruiterIdentitySignal[]): string[] {
  return Array.from(
    new Set([
      fingerprintSignal('name', name),
      ...signals.filter((s) => s.value.trim()).map((s) => fingerprintSignal(s.kind, s.value)),
    ]),
  ).sort();
}
