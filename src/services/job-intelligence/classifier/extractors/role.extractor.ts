/**
 * Extracts job role/title mentions from email subject and body.
 */

const ROLE_PATTERNS: RegExp[] = [
  /\b(?:application(?:\s+\w+){0,3}\s+for|applied for|interview for|role of|position of|opening for)\s+(?:the\s+)?([A-Za-z0-9][A-Za-z0-9 /,&+\-()]{2,60}?)(?:\s+(?:role|position|at|with|opening)\b|[,.!]|$)/i,
  /\b(?:hiring|opening|opportunity):\s*([A-Za-z0-9][A-Za-z0-9 /,&+\-()]{2,60}?)(?:[,.!]|$)/i,
  /\b([A-Za-z0-9][A-Za-z0-9 /,&+\-()]{2,60}?)\s+(?:role|position)\s+(?:at|with)\b/i,
  /^([A-Za-z0-9][A-Za-z0-9 /,&+\-()]{2,60}?)\s+[-–—|]\s+/,
];

const ROLE_NOISE = /\b(the|a|an|your|our|this|that)\b/gi;

function normalizeRole(raw: string): string {
  return raw
    .replace(ROLE_NOISE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function extractRole(subject: string, body: string): string | null {
  const sources = [subject, body.slice(0, 500)];

  for (const source of sources) {
    for (const pattern of ROLE_PATTERNS) {
      const match = pattern.exec(source);
      const candidate = match?.[1]?.trim();
      if (!candidate) {
        continue;
      }

      const normalized = normalizeRole(candidate);
      if (normalized.length >= 3 && normalized.length <= 80) {
        return normalized;
      }
    }
  }

  return null;
}
