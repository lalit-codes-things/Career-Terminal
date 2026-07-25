/**
 * Cryptographic token utilities — Epic 0.7, Phases 12 & 28.
 *
 * Centralises all token generation so every caller uses the same
 * cryptographically strong source of randomness.  Math.random(),
 * timestamps, and predictable counters are explicitly banned here.
 *
 * All functions use Node.js crypto.randomBytes(), which reads from
 * the OS CSPRNG (/dev/urandom on Linux, CryptGenRandom on Windows).
 *
 * Token classification (Phase 9):
 *
 *   CATEGORY B — RECOVERABLE TOKENS (must be stored and later retrieved)
 *     generateOpaqueToken()  — refresh tokens, API keys, OAuth state
 *     generateIdempotencyKey() — BullMQ / request deduplication
 *
 *   CATEGORY A — HASHABLE ONE-TIME TOKENS (store hash, not plaintext)
 *     generateVerificationToken() — email verification, password reset
 *     generateWebhookSecret()     — HMAC signing secrets
 *
 *   Refresh tokens (Category B):
 *     Stored in Redis as-is — the Redis key itself acts as the lookup;
 *     an attacker who reads Redis already has the token.
 *     They are revocable: delete the Redis key to invalidate.
 *
 *   Verification / reset tokens (Category A):
 *     The token is sent to the user; only the hash is stored in the DB.
 *     On verification, hash the presented token and compare to stored hash.
 *     This prevents DB leaks from yielding usable tokens.
 *
 * Security guarantees:
 *   - All tokens are generated from the OS CSPRNG.
 *   - Default entropy is 256 bits (32 bytes) for all token types.
 *   - URL-safe Base64 encoding for tokens sent in URLs (no +/=).
 */
import { randomBytes, createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Opaque token (Category B — recoverable, full entropy)
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically secure opaque token.
 *
 * Default: 32 bytes = 256 bits of entropy, hex-encoded (64 chars).
 * Use for: refresh tokens, API keys, internal session identifiers.
 *
 * @param byteLength - Number of random bytes (default: 32)
 * @param encoding   - Output encoding (default: 'hex')
 */
export function generateOpaqueToken(byteLength = 32, encoding: BufferEncoding = 'hex'): string {
  return randomBytes(byteLength).toString(encoding);
}

/**
 * Generate a URL-safe opaque token (Base64url, no +/=).
 * Suitable for use in URLs, query params, and OAuth state parameters.
 *
 * @param byteLength - Number of random bytes (default: 32)
 */
export function generateUrlSafeToken(byteLength = 32): string {
  return randomBytes(byteLength)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// ---------------------------------------------------------------------------
// One-time verification token (Category A — hash before storing)
// ---------------------------------------------------------------------------

/**
 * Generate a one-time verification token and its SHA-256 hash.
 *
 * Usage pattern:
 *   const { token, hash } = generateVerificationToken();
 *   // Send `token` to the user (email link, SMS)
 *   // Store only `hash` in the database
 *   // On verification: compare hash(userSupplied) to stored hash
 *
 * @param byteLength - Random bytes for the token (default: 32 = 256-bit)
 * @returns { token: hex string, hash: sha256 hex hash }
 */
export function generateVerificationToken(byteLength = 32): {
  token: string;
  hash: string;
} {
  const token = randomBytes(byteLength).toString('hex');
  const hash = hashToken(token);
  return { token, hash };
}

/**
 * SHA-256 hash a token for safe database storage.
 * Use this when storing verification / reset tokens: store the hash,
 * not the plaintext, so a DB breach does not yield usable tokens.
 *
 * NOT suitable for password storage — use bcrypt/argon2 for passwords.
 * Suitable for high-entropy random tokens (verification, reset links).
 *
 * @param token - The plaintext token to hash
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Idempotency key
// ---------------------------------------------------------------------------

/**
 * Generate a collision-resistant idempotency key.
 * Use for BullMQ job deduplication, API request deduplication, etc.
 *
 * Format: `<prefix>:<timestamp>:<random16bytes>`
 * Example: `job:1720000000000:a1b2c3d4e5f6...`
 *
 * @param prefix - Semantic namespace (e.g. 'job', 'request', 'sync')
 */
export function generateIdempotencyKey(prefix = 'op'): string {
  const timestamp = Date.now().toString();
  const random = randomBytes(16).toString('hex');
  return `${prefix}:${timestamp}:${random}`;
}

// ---------------------------------------------------------------------------
// Webhook secret
// ---------------------------------------------------------------------------

/**
 * Generate a webhook signing secret (32 bytes, base64url).
 * Store encrypted (Category B); use for HMAC-SHA256 request signing.
 *
 * Verification: see verifyHmacSha256() in utils/secure-compare.ts
 */
export function generateWebhookSecret(): string {
  return generateUrlSafeToken(32);
}
