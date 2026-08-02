/** IANA time zone normalization. */

const TIME_ZONE_ALIASES: Readonly<Record<string, string>> = {
  UTC: 'Etc/UTC',
  GMT: 'Etc/UTC',
  Z: 'Etc/UTC',
  EST: 'America/New_York',
  EDT: 'America/New_York',
  CST: 'America/Chicago',
  CDT: 'America/Chicago',
  MST: 'America/Denver',
  MDT: 'America/Denver',
  PST: 'America/Los_Angeles',
  PDT: 'America/Los_Angeles',
  IST: 'Asia/Kolkata',
};

export function normalizeTimeZone(value: string): string | null {
  const trimmed = value.normalize('NFKC').trim();
  if (!trimmed) return null;
  const alias = TIME_ZONE_ALIASES[trimmed.toUpperCase()];
  const candidate = alias ?? trimmed;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(
      new Date('2024-01-01T00:00:00Z'),
    );
    return candidate;
  } catch {
    return null;
  }
}

export function isValidTimeZone(value: string): boolean {
  return normalizeTimeZone(value) !== null;
}
