/**
 * Timestamp / date normalization.
 *
 * Providers emit dates in many formats (ISO, "YYYY-MM-DD", RFC 3339, unix
 * millis, free text like "31-12-2020"). These helpers parse them into ISO
 * strings or Date instances and validate temporal ranges.
 */

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

/** Parse a date/timestamp string. Returns null when unparseable. */
export function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  // Plain "YYYY-MM-DD" is interpreted as UTC to avoid TZ ambiguity.
  if (DATE_RE.test(trimmed)) {
    const d = new Date(`${trimmed}T00:00:00.000Z`);
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
}

/** Parse a date/timestamp to an ISO 8601 string. Returns null when unparseable. */
export function normalizeTimestamp(value: string | null | undefined): string | null {
  const parsed = parseTimestamp(value);
  return parsed ? parsed.toISOString() : null;
}

/** Validate a date/timestamp string. */
export function isValidTimestamp(value: string): boolean {
  return parseTimestamp(value) !== null;
}

/** True when the timestamp is strictly in the future beyond a tolerance. */
export function isFutureTimestamp(value: string, now: Date = new Date(), toleranceMs = 0): boolean {
  const parsed = parseTimestamp(value);
  if (!parsed) {
    return false;
  }
  return parsed.getTime() > now.getTime() + toleranceMs;
}

/** Validate a temporal range [validFrom, validTo]. */
export function isValidTemporalRange(
  validFrom: string | null | undefined,
  validTo: string | null | undefined,
): boolean {
  if (!validFrom && !validTo) {
    return true;
  }
  const from = parseTimestamp(validFrom);
  const to = parseTimestamp(validTo);
  if (from && isNaN(from.getTime())) {
    return false;
  }
  if (to && isNaN(to.getTime())) {
    return false;
  }
  if (from && to && to.getTime() < from.getTime()) {
    return false;
  }
  return true;
}
