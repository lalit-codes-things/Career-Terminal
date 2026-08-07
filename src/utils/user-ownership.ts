/**
 * Helpers for user ownership queries.
 *
 * Matches rows by the UUID FK (`userId`). The legacy `legacyUserId` migration
 * is complete; ownership checks no longer need dual FK/legacy matching.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Build a Prisma filter that matches by resolved user ID. */
export function userOwnershipFilter(externalUserId: string, resolvedUserId?: string) {
  const resolved = resolvedUserId ?? externalUserId;
  return { userId: resolved };
}

/** Fields to set when creating user-scoped records. */
export function userScopeFields(resolvedUserId: string) {
  return {
    userId: resolvedUserId,
  };
}
