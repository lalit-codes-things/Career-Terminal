/**
 * Extracts company names from email sender, subject, and body.
 */
import { isAtsPlatformDomain } from '../signals/ats-platforms';
import { parseSender } from '../signals/sender-patterns';

const COMPANY_FROM_TEXT_PATTERNS: RegExp[] = [
  /\b(?:at|from|with|join)\s+([A-Z][A-Za-z0-9&.\- ]{1,40}?)(?:\s+(?:team|recruiting|talent|careers|hr)\b|[,.!]|$)/,
  /\b(?:opportunity|role|position)\s+(?:at|with)\s+([A-Z][A-Za-z0-9&.\- ]{1,40}?)(?:[,.!]|$)/,
  /\b([A-Z][A-Za-z0-9&.\- ]{1,40}?)\s+(?:is hiring|recruiting team|talent team)\b/,
];

const GENERIC_DOMAIN_LABELS = new Set([
  'gmail',
  'yahoo',
  'hotmail',
  'outlook',
  'icloud',
  'mail',
  'email',
  'googlemail',
]);

function titleCase(label: string): string {
  return label
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function companyFromDomain(domain: string): string | null {
  const parts = domain.toLowerCase().split('.').filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  const label = parts[parts.length - 2] ?? '';
  if (!label || GENERIC_DOMAIN_LABELS.has(label) || isAtsPlatformDomain(domain)) {
    return null;
  }

  return titleCase(label);
}

function companyFromText(text: string): string | null {
  for (const pattern of COMPANY_FROM_TEXT_PATTERNS) {
    const match = pattern.exec(text);
    const candidate = match?.[1]?.trim();
    if (candidate && candidate.length >= 2) {
      return candidate.replace(/\s{2,}/g, ' ');
    }
  }
  return null;
}

export function extractCompany(sender: string, subject: string, body: string): string | null {
  const parsed = parseSender(sender);
  if (parsed) {
    const fromDomain = companyFromDomain(parsed.domain);
    if (fromDomain) {
      return fromDomain;
    }
  }

  const combined = `${subject}\n${body}`;
  return companyFromText(combined);
}
