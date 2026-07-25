/**
 * Timing-safe comparison utilities (Epic 0.7, Phase 29).
 *
 * Standard string comparison (===) is vulnerable to timing attacks because
 * JavaScript short-circuits on the first differing character, leaking
 * information about how many leading characters match the secret.
 *
 * timingSafeEqual (Node.js crypto) always takes constant time regardless of
 * where the strings differ, preventing an attacker from measuring response
 * latency to infer secret bytes.
 *
 * Use these utilities for ALL comparisons involving:
 *   - API keys (INTERNAL_API_KEY)
 *   - HMAC signatures
 *   - Webhook secrets
 *   - Any value derived from a secret that an attacker might compare against
 *
 * Note on JWTs: jsonwebtoken's verify() already uses timing-safe comparison
 * internally. Use verifyAccessToken() from token.service.ts; never compare
 * JWT strings directly.
 */
import { timingSafeEqual, createHmac } from 'crypto';

/**
 * Compare two strings in constant time.
 *
 * Returns false immediately (without timing info) if lengths differ —
 * length itself is public information in most protocols and does not leak
 * the secret value.
 *
 * @param a - First string (e.g. the configured secret)
 * @param b - Second string (e.g. the caller-supplied value)
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  // Compare byte lengths, not character lengths. Multi-byte UTF-8 characters
  // (e.g. accented letters, CJK) have char length != byte length.
  if (bufA.length !== bufB.length) return false;

  return timingSafeEqual(bufA, bufB);
}

/**
 * Compare two Buffers in constant time.
 * Returns false immediately if lengths differ.
 */
export function timingSafeBufferEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verify an HMAC-SHA256 signature in constant time.
 *
 * @param payload  - The raw payload that was signed
 * @param secret   - The shared HMAC secret
 * @param provided - The signature supplied by the caller
 * @returns true if the signature is valid
 */
export function verifyHmacSha256(payload: string | Buffer, secret: string, provided: string): boolean {
  const expected = createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return timingSafeStringEqual(expected, provided);
}
