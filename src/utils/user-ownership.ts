/**
 * Helpers for user ownership queries during the legacy → FK migration period.
 *
 * Matches rows by the new UUID FK (`userId`) or the preserved legacy string
 * (`legacyUserId`) so ownership checks work before and after backfill.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Build a Prisma `OR` filter that matches either FK or legacy user id. */
export function userOwnershipFilter(externalUserId: string, resolvedUserId?: string) {
  const resolved = resolvedUserId ?? externalUserId;
  const clauses: Array<{ userId: string } | { legacyUserId: string }> = [{ userId: resolved }];

  if (externalUserId !== resolved || !isValidUuid(externalUserId)) {
    clauses.push({ legacyUserId: externalUserId });
  } else {
    clauses.push({ legacyUserId: externalUserId });
  }

  return { OR: clauses };
}

/** Fields to set when creating user-scoped records. */
export function userScopeFields(externalUserId: string, resolvedUserId: string) {
  return {
    userId: resolvedUserId,
    legacyUserId: externalUserId,
  };
}
