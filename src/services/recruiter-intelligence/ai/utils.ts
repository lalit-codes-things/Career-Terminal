import type { AiProviderKind, ExtractionInput } from './types';
import type { ConfidenceBand, Provenance } from '../../../domain/recruiter-intelligence/shared-kernel/types';

export function toConfidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 0.90) return 'critical';
  if (confidence >= 0.72) return 'high';
  if (confidence >= 0.50) return 'medium';
  return 'low';
}

export function toProvenance(
  input: ExtractionInput,
  provider: AiProviderKind,
  model: string,
): Provenance {
  return {
    source: `ai-extraction:${input.sourceType}:${input.sourceId}`,
    sourceId: input.sourceId,
    collector: `${provider}/${model}`,
    collectedAt: new Date().toISOString(),
    consentState: 'granted',
  };
}

export function normalizeText(value: unknown): string {
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj['name'] === 'string') return obj['name'].trim().toLowerCase();
    if (typeof obj['value'] === 'string') return obj['value'].trim().toLowerCase();
  }
  return String(value ?? '').trim().toLowerCase();
}

export function normalizeOrganizationName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\b(inc\.|inc|corp\.|corp|ltd\.|ltd|llc|limited|co\.|co)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeSkillName(skill: string): string {
  return skill.trim().toLowerCase().replace(/[^a-z0-9#.+]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function normalizeLocation(location: string): string {
  return location.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function deduplicateByField<T>(items: T[], key: keyof T): T[] {
  const seen = new Set<unknown>();
  return items.filter((item) => {
    const val = item[key];
    if (seen.has(val)) return false;
    seen.add(val);
    return true;
  });
}
