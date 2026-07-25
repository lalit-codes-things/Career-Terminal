/**
 * Epic 0.7 — Encryption tests (Phase 33).
 *
 * Tests for versioned envelope encryption, key rotation, tamper detection,
 * and configuration validation.
 */
import {
  encryptToken,
  decryptToken,
  getEncryptedKeyVersion,
  getActiveEncryptionVersion,
  reEncryptIfStale,
  validateEncryptionConfig,
  invalidateKeyCache,
} from '../utils/encryption';
import { EncryptionError } from '../errors/app-errors';

// ---------------------------------------------------------------------------
// Test key fixtures — 64 hex chars each (32 bytes)
// ---------------------------------------------------------------------------

const V1_KEY = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';
const V2_KEY = '0011223344556677889900aabbccddeeff0011223344556677889900aabbccdd';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setV1Only(): void {
  process.env.ENCRYPTION_KEY = V1_KEY;
  delete process.env.ENCRYPTION_KEY_V2;
  delete process.env.ACTIVE_ENCRYPTION_KEY_VERSION;
}

function setV2Active(): void {
  process.env.ENCRYPTION_KEY = V1_KEY;
  process.env.ENCRYPTION_KEY_V2 = V2_KEY;
  process.env.ACTIVE_ENCRYPTION_KEY_VERSION = '2';
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Epic 0.7 — Encryption (versioned envelope)', () => {
  beforeEach(() => {
    invalidateKeyCache();
    setV1Only();
  });

  afterEach(() => {
    invalidateKeyCache();
    delete process.env.ENCRYPTION_KEY_V2;
    delete process.env.ACTIVE_ENCRYPTION_KEY_VERSION;
  });

  // ── 1. Key versioning ────────────────────────────────────────────────────
  it('1. encrypts with v1 and produces a v1: envelope prefix', () => {
    const plaintext = 'test-oauth-token-v1';
    const ciphertext = encryptToken(plaintext);

    expect(ciphertext).toMatch(/^v1:/);
    const parts = ciphertext.split(':');
    // v1 : iv : authTag : ciphertext = 4 parts
    expect(parts).toHaveLength(4);
  });

  it('1b. decrypts v1 ciphertext back to original plaintext', () => {
    const plaintext = 'sensitive-token-payload';
    const ciphertext = encryptToken(plaintext);
    const decrypted = decryptToken(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  // ── 2. Multi-version ──────────────────────────────────────────────────────
  it('2. encrypts with v2 when ACTIVE_ENCRYPTION_KEY_VERSION=2', () => {
    setV2Active();
    invalidateKeyCache();

    const plaintext = 'test-token-v2';
    const ciphertext = encryptToken(plaintext);

    expect(ciphertext).toMatch(/^v2:/);
  });

  it('2b. v2 ciphertext decrypts correctly with v2 key', () => {
    setV2Active();
    invalidateKeyCache();

    const plaintext = 'v2-refresh-token';
    const ciphertext = encryptToken(plaintext);
    expect(ciphertext).toMatch(/^v2:/);

    const decrypted = decryptToken(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  // ── 3. Cross-version decryption (backward compat) ────────────────────────
  it('3. v1 ciphertext is still decryptable after v2 becomes active', () => {
    // Encrypt with v1
    setV1Only();
    invalidateKeyCache();
    const plaintext = 'legacy-token';
    const v1Ciphertext = encryptToken(plaintext);
    expect(v1Ciphertext).toMatch(/^v1:/);

    // Switch to v2 active
    setV2Active();
    invalidateKeyCache();

    // Should still decrypt v1 ciphertext (backward compat)
    const decrypted = decryptToken(v1Ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  // ── 4. Tampered ciphertext ────────────────────────────────────────────────
  it('4. throws EncryptionError when ciphertext bytes are tampered', () => {
    const plaintext = 'original-token';
    const ciphertext = encryptToken(plaintext);

    // Corrupt the ciphertext part (4th colon-separated segment)
    const parts = ciphertext.split(':');
    parts[3] = Buffer.from('completely-wrong-ciphertext-data').toString('base64');
    const tampered = parts.join(':');

    expect(() => decryptToken(tampered)).toThrow(EncryptionError);
  });

  // ── 5. Tampered auth tag ──────────────────────────────────────────────────
  it('5. throws EncryptionError when auth tag is tampered', () => {
    const plaintext = 'authentic-token';
    const ciphertext = encryptToken(plaintext);

    // Corrupt the auth tag (3rd colon-separated segment in versioned format)
    const parts = ciphertext.split(':');
    parts[2] = Buffer.from('bad-auth-tag-bytes-here!').toString('base64');
    const tampered = parts.join(':');

    expect(() => decryptToken(tampered)).toThrow(EncryptionError);
  });

  // ── 6. Wrong key version ──────────────────────────────────────────────────
  it('6. throws EncryptionError when decrypting v2 ciphertext without v2 key', () => {
    // Encrypt with v2
    setV2Active();
    invalidateKeyCache();
    const plaintext = 'v2-only-token';
    const v2Ciphertext = encryptToken(plaintext);
    expect(v2Ciphertext).toMatch(/^v2:/);

    // Remove v2 key and reset to v1 only
    setV1Only();
    invalidateKeyCache();

    // Attempting to decrypt v2 ciphertext without v2 key should throw
    expect(() => decryptToken(v2Ciphertext)).toThrow(EncryptionError);
  });

  // ── 7. reEncryptIfStale() ─────────────────────────────────────────────────
  it('7a. reEncryptIfStale returns null when ciphertext uses active version', () => {
    const plaintext = 'current-token';
    const ciphertext = encryptToken(plaintext); // v1 active
    expect(reEncryptIfStale(ciphertext)).toBeNull();
  });

  it('7b. reEncryptIfStale returns new v2 ciphertext when v1 ciphertext is stale', () => {
    // Encrypt with v1
    setV1Only();
    invalidateKeyCache();
    const plaintext = 'stale-token';
    const v1Ciphertext = encryptToken(plaintext);
    expect(v1Ciphertext).toMatch(/^v1:/);

    // Switch to v2 active
    setV2Active();
    invalidateKeyCache();

    const result = reEncryptIfStale(v1Ciphertext);
    expect(result).not.toBeNull();
    expect(result).toMatch(/^v2:/);

    // New ciphertext should decrypt to same plaintext
    expect(decryptToken(result!)).toBe(plaintext);
  });

  // ── 8. getEncryptedKeyVersion() ───────────────────────────────────────────
  it('8a. getEncryptedKeyVersion returns 1 for v1: prefix', () => {
    const ciphertext = encryptToken('test');
    expect(getEncryptedKeyVersion(ciphertext)).toBe(1);
  });

  it('8b. getEncryptedKeyVersion returns 2 for v2: prefix', () => {
    setV2Active();
    invalidateKeyCache();

    const ciphertext = encryptToken('test');
    expect(getEncryptedKeyVersion(ciphertext)).toBe(2);
  });

  it('8c. getEncryptedKeyVersion returns 1 for legacy format (no prefix)', () => {
    // Legacy format: iv:authTag:ciphertext (no v prefix)
    // We simulate by removing the v1: prefix
    const ciphertext = encryptToken('test');
    const legacyCiphertext = ciphertext.replace(/^v1:/, ''); // strip v1: prefix
    expect(getEncryptedKeyVersion(legacyCiphertext)).toBe(1);
  });

  // ── 9. Semantic security ──────────────────────────────────────────────────
  it('9. encrypting the same plaintext twice produces different ciphertexts', () => {
    const plaintext = 'same-input-token';
    const c1 = encryptToken(plaintext);
    const c2 = encryptToken(plaintext);

    // Different ciphertexts (different IVs)
    expect(c1).not.toBe(c2);

    // Both decrypt to the same plaintext
    expect(decryptToken(c1)).toBe(plaintext);
    expect(decryptToken(c2)).toBe(plaintext);
  });

  // ── 10. validateEncryptionConfig() ───────────────────────────────────────
  it('10a. validateEncryptionConfig throws when ENCRYPTION_KEY is missing', () => {
    delete process.env.ENCRYPTION_KEY;
    invalidateKeyCache();

    expect(() => validateEncryptionConfig()).toThrow(EncryptionError);
    expect(() => validateEncryptionConfig()).toThrow(/ENCRYPTION_KEY is not set/);
  });

  it('10b. validateEncryptionConfig throws on all-zeros key in production', () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    process.env.NODE_ENV = 'production';
    invalidateKeyCache();

    expect(() => validateEncryptionConfig()).toThrow(EncryptionError);
    expect(() => validateEncryptionConfig()).toThrow(/all-zeros/);

    process.env.NODE_ENV = 'test';
  });

  it('10c. validateEncryptionConfig passes on a valid 64-char hex key', () => {
    setV1Only();
    invalidateKeyCache();

    expect(() => validateEncryptionConfig()).not.toThrow();
  });

  it('10d. getActiveEncryptionVersion returns 1 by default', () => {
    expect(getActiveEncryptionVersion()).toBe(1);
  });

  it('10e. getActiveEncryptionVersion returns 2 when ACTIVE_ENCRYPTION_KEY_VERSION=2', () => {
    setV2Active();
    invalidateKeyCache();
    expect(getActiveEncryptionVersion()).toBe(2);
  });
});
