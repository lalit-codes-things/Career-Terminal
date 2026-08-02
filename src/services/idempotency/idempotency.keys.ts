/**
 * Canonical idempotency-key schemes for every write operation in the system.
 *
 * These functions are the *single source of truth* — do NOT concatenate
 * idempotency keys inline inside business logic because drifting from the
 * canonical scheme silently drops idempotency guarantees.
 *
 * ── Key design guidelines ─────────────────────────────────────────────────
 *
 *   • Prefix with the logical operation family + component so two
 *     different operations over the same entity don't collide:
 *         `app:email:<msgId>`  vs  `outcome:email:<msgId>`
 *
 *   • Use stable, globally-unique source identifiers (providerMessageId,
 *     applicationId, userId + opportunityId combo).  Never include wall
 *     clock or nonces — that defeats determinism.
 *
 *   • Keys are deliberately kept short and human-readable; a SHA-256 hash
 *     over the long concatenation would work too, but operators debugging
 *     a replay incident will thank us for keeping them readable.
 *
 *   • Optional `salt` parameter for cases where the same operation legitimately
 *     needs multiple variants (e.g. two distinct manual applications for the
 *     same opportunity — extremely rare, exposed here for completeness).
 */
import { createHash } from 'crypto';

const MAX_KEY_LENGTH = 255;

function truncate(key: string): string {
  if (key.length <= MAX_KEY_LENGTH) return key;
  // Keep the human-readable prefix, append a short hash of the overflow so
  // different long keys still produce distinct short keys.
  const prefix = key.slice(0, MAX_KEY_LENGTH - 16);
  const suffix = createHash('sha256').update(key).digest('hex').slice(0, 16);
  return `${prefix}${suffix}`;
}

export type IdempotencyOperation =
  | 'app:email'
  | 'app:manual'
  | 'outcome:email'
  | 'action:user'
  | 'status:transition'
  | 'job:email'
  | 'job:resume'
  | 'merge:application';

function prefix(op: IdempotencyOperation): string {
  return op;
}

// ── Application creation ────────────────────────────────────────────────────

export function keyForAppFromEmail(providerMessageId: string): string {
  return truncate(`${prefix('app:email')}:${providerMessageId}`);
}

export function keyForAppFromManual(userId: string, opportunityId: string, salt?: string): string {
  const base = `${prefix('app:manual')}:${userId}:${opportunityId}`;
  return truncate(salt ? `${base}:${salt}` : base);
}

// ── Outcome & action events ─────────────────────────────────────────────────

export function keyForOutcomeFromEmail(providerMessageId: string): string {
  return truncate(`${prefix('outcome:email')}:${providerMessageId}`);
}

export function keyForUserAction(
  userId: string,
  applicationId: string,
  actionType: string,
  occurrenceHash: string,
): string {
  return truncate(
    `${prefix('action:user')}:${userId}:${applicationId}:${actionType}:${occurrenceHash}`,
  );
}

// ── Status transitions ──────────────────────────────────────────────────────

export function keyForStatusTransition(
  applicationId: string,
  newStatus: string,
  source: string,
  sourceEmailId?: string,
): string {
  const base = `${prefix('status:transition')}:${applicationId}:${newStatus}:${source}`;
  return truncate(sourceEmailId ? `${base}:${sourceEmailId}` : base);
}

// ── Worker / queue job ids ──────────────────────────────────────────────────

export function jobIdForEmailIngestion(emailMessageId: string): string {
  return truncate(`${prefix('job:email')}:${emailMessageId}`);
}

export function jobIdForResumeOperation(
  resumeHashId: string,
  operation: 'parse' | 'embed' | 'match',
): string {
  return truncate(`${prefix('job:resume')}:${resumeHashId}:${operation}`);
}

export function jobIdForApplicationMerge(
  userId: string,
  primaryApplicationId: string,
  duplicateApplicationId: string,
): string {
  return truncate(
    `${prefix('merge:application')}:${userId}:${primaryApplicationId}:${duplicateApplicationId}`,
  );
}

/**
 * Derive an occurrence hash from an ISO timestamp + a short hash of extra
 * context, used to distinguish the same user action happening twice on the
 * same application.  Callers should prefer *not* relying on this and should
 * prefer operation-specific stable keys instead.
 */
export function occurrenceHash(isoTimestamp: string, extraContext = ''): string {
  return createHash('sha1').update(`${isoTimestamp}|${extraContext}`).digest('hex').slice(0, 12);
}

// ── Validation (used by IdempotencyService when strict mode is enabled) ─────

export const IDEMPOTENCY_PREFIXES: ReadonlySet<string> = new Set([
  'app:email:',
  'app:manual:',
  'outcome:email:',
  'action:user:',
  'status:transition:',
  'job:email:',
  'job:resume:',
  'merge:application:',
]);

export function isWellFormedKey(key: string): boolean {
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) {
    return false;
  }
  for (const prefix of IDEMPOTENCY_PREFIXES) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}
