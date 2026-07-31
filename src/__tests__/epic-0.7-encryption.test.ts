/**
 * Epic 0.7 — Encryption tests (Phase 33).
 *
 * Tests for versioned envelope encryption, key rotation, tamper detection,
 * and configuration validation.
 *
 * Uses dynamic require + jest.resetModules() to pick up env var changes
 * at module load time (config is evaluated once per module instance).
 */
export {};

// ---------------------------------------------------------------------------
// Test key fixtures — 64 hex chars each (32 bytes)
// ---------------------------------------------------------------------------

const V1_KEY = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';
const V2_KEY = '0011223344556677889900aabbccddeeff0011223344556677889900aabbccdd';

const originalEnv = { ...process.env };

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

function loadFresh(): {
  encryptToken: (s: string) => string;
  decryptToken: (s: string) => string;
  getEncryptedKeyVersion: (s: string) => number;
  getActiveEncryptionVersion: () => number;
  reEncryptIfStale: (s: string) => string | null;
  validateEncryptionConfig: (opts?: Record<string, unknown>) => void;
  invalidateKeyCache: () => void;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../utils/encryption');
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Epic 0.7 — Encryption (versioned envelope)', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    setV1Only();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ── 1. Key versioning ────────────────────────────────────────────────────
  it('1. encrypts with v1 and produces a v1: envelope prefix', () => {
    const { encryptToken } = loadFresh();
    const plaintext = 'test-oauth-token-v1';
    const ciphertext = encryptToken(plaintext);

    expect(ciphertext).toMatch(/^v1:/);
    const parts = ciphertext.split(':');
    expect(parts).toHaveLength(4);
  });

  it('1b. decrypts v1 ciphertext back to original plaintext', () => {
    const { encryptToken, decryptToken } = loadFresh();
    const plaintext = 'sensitive-token-payload';
    const ciphertext = encryptToken(plaintext);
    const decrypted = decryptToken(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  // ── 2. Multi-version ──────────────────────────────────────────────────────
  it('2. encrypts with v2 when ACTIVE_ENCRYPTION_KEY_VERSION=2', () => {
    setV2Active();
    const { encryptToken } = loadFresh();
    const plaintext = 'test-token-v2';
    const ciphertext = encryptToken(plaintext);

    expect(ciphertext).toMatch(/^v2:/);
  });

  it('2b. v2 ciphertext decrypts correctly with v2 key', () => {
    setV2Active();
    const { encryptToken, decryptToken } = loadFresh();
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
    const { encryptToken: enc1 } = loadFresh();
    const plaintext = 'legacy-token';
    const v1Ciphertext = enc1(plaintext);
    expect(v1Ciphertext).toMatch(/^v1:/);

    // Switch to v2 active
    setV2Active();
    const { decryptToken: dec2 } = loadFresh();

    // Should still decrypt v1 ciphertext (backward compat)
    const decrypted = dec2(v1Ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  // ── 4. Tampered ciphertext ────────────────────────────────────────────────
  it('4. throws EncryptionError when ciphertext bytes are tampered', () => {
    const { encryptToken, decryptToken } = loadFresh();
    const plaintext = 'original-token';
    const ciphertext = encryptToken(plaintext);

    const parts = ciphertext.split(':');
    parts[3] = Buffer.from('completely-wrong-ciphertext-data').toString('base64');
    const tampered = parts.join(':');

    expect(() => decryptToken(tampered)).toThrow();
  });

  it('5. throws EncryptionError when auth tag is tampered', () => {
    const { encryptToken, decryptToken } = loadFresh();
    const plaintext = 'authentic-token';
    const ciphertext = encryptToken(plaintext);

    const parts = ciphertext.split(':');
    parts[2] = Buffer.from('bad-auth-tag-bytes-here!').toString('base64');
    const tampered = parts.join(':');

    expect(() => decryptToken(tampered)).toThrow();
  });

  // ── 6. Wrong key version ──────────────────────────────────────────────────
  it('6. throws EncryptionError when decrypting v2 ciphertext without v2 key', () => {
    // Encrypt with v2
    setV2Active();
    const { encryptToken } = loadFresh();
    const plaintext = 'v2-only-token';
    const v2Ciphertext = encryptToken(plaintext);
    expect(v2Ciphertext).toMatch(/^v2:/);

    // Remove v2 key and reset to v1 only
    setV1Only();
    // Re-require to get fresh module with v1-only config
    jest.resetModules();
    const { decryptToken } = loadFresh();

    // Attempting to decrypt v2 ciphertext without v2 key should throw
    expect(() => decryptToken(v2Ciphertext)).toThrow();
  });

  // ── 7. reEncryptIfStale() ─────────────────────────────────────────────────
  it('7a. reEncryptIfStale returns null when ciphertext uses active version', () => {
    const { encryptToken, reEncryptIfStale } = loadFresh();
    const plaintext = 'current-token';
    const ciphertext = encryptToken(plaintext); // v1 active
    expect(reEncryptIfStale(ciphertext)).toBeNull();
  });

  it('7b. reEncryptIfStale returns new v2 ciphertext when v1 ciphertext is stale', () => {
    // Encrypt with v1
    setV1Only();
    const { encryptToken: enc1 } = loadFresh();
    const plaintext = 'stale-token';
    const v1Ciphertext = enc1(plaintext);
    expect(v1Ciphertext).toMatch(/^v1:/);

    // Switch to v2 active
    setV2Active();
    jest.resetModules();
    const { reEncryptIfStale: freshReEncrypt, decryptToken } = loadFresh();
    const result = freshReEncrypt(v1Ciphertext);
    expect(result).not.toBeNull();
    expect(result).toMatch(/^v2:/);

    // New ciphertext should decrypt to same plaintext
    expect(decryptToken(result!)).toBe(plaintext);
  });

  // ── 8. getEncryptedKeyVersion() ───────────────────────────────────────────
  it('8a. getEncryptedKeyVersion returns 1 for v1: prefix', () => {
    const { encryptToken, getEncryptedKeyVersion } = loadFresh();
    const ciphertext = encryptToken('test');
    expect(getEncryptedKeyVersion(ciphertext)).toBe(1);
  });

  it('8b. getEncryptedKeyVersion returns 2 for v2: prefix', () => {
    setV2Active();
    const { encryptToken, getEncryptedKeyVersion } = loadFresh();
    const ciphertext = encryptToken('test');
    expect(getEncryptedKeyVersion(ciphertext)).toBe(2);
  });

  it('8c. getEncryptedKeyVersion returns 1 for legacy format (no prefix)', () => {
    const { encryptToken, getEncryptedKeyVersion } = loadFresh();
    const ciphertext = encryptToken('test');
    const legacyCiphertext = ciphertext.replace(/^v1:/, '');
    expect(getEncryptedKeyVersion(legacyCiphertext)).toBe(1);
  });

  // ── 9. Semantic security ──────────────────────────────────────────────────
  it('9. encrypting the same plaintext twice produces different ciphertexts', () => {
    const { encryptToken, decryptToken } = loadFresh();
    const plaintext = 'same-input-token';
    const c1 = encryptToken(plaintext);
    const c2 = encryptToken(plaintext);

    expect(c1).not.toBe(c2);
    expect(decryptToken(c1)).toBe(plaintext);
    expect(decryptToken(c2)).toBe(plaintext);
  });

  // ── 10. validateEncryptionConfig() ───────────────────────────────────────
  it('10a. validateEncryptionConfig throws when ENCRYPTION_KEY is missing', () => {
    delete process.env.ENCRYPTION_KEY;
    jest.resetModules();
    const { validateEncryptionConfig } = loadFresh();

    expect(() =>
      validateEncryptionConfig({
        encryptionKey: undefined,
        encryptionKeyV2: undefined,
        encryptionKeyV3: undefined,
        activeEncryptionKeyVersion: 1,
        isProduction: false,
      }),
    ).toThrow();
    expect(() =>
      validateEncryptionConfig({
        encryptionKey: undefined,
        encryptionKeyV2: undefined,
        encryptionKeyV3: undefined,
        activeEncryptionKeyVersion: 1,
        isProduction: false,
      }),
    ).toThrow(/ENCRYPTION_KEY is not set/);
  });

  it('10b. validateEncryptionConfig throws on all-zeros key in production', () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    const { validateEncryptionConfig } = loadFresh();

    expect(() =>
      validateEncryptionConfig({
        encryptionKey: '0'.repeat(64),
        encryptionKeyV2: undefined,
        encryptionKeyV3: undefined,
        activeEncryptionKeyVersion: 1,
        isProduction: true,
      }),
    ).toThrow();
    expect(() =>
      validateEncryptionConfig({
        encryptionKey: '0'.repeat(64),
        encryptionKeyV2: undefined,
        encryptionKeyV3: undefined,
        activeEncryptionKeyVersion: 1,
        isProduction: true,
      }),
    ).toThrow(/all-zeros/);
  });

  it('10c. validateEncryptionConfig passes on a valid 64-char hex key', () => {
    setV1Only();
    const { validateEncryptionConfig } = loadFresh();

    expect(() =>
      validateEncryptionConfig({
        encryptionKey: V1_KEY,
        encryptionKeyV2: undefined,
        encryptionKeyV3: undefined,
        activeEncryptionKeyVersion: 1,
        isProduction: false,
      }),
    ).not.toThrow();
  });

  it('10d. getActiveEncryptionVersion returns 1 by default', () => {
    const { getActiveEncryptionVersion } = loadFresh();
    expect(getActiveEncryptionVersion()).toBe(1);
  });

  it('10e. getActiveEncryptionVersion returns 2 when ACTIVE_ENCRYPTION_KEY_VERSION=2', () => {
    setV2Active();
    const { getActiveEncryptionVersion } = loadFresh();
    expect(getActiveEncryptionVersion()).toBe(2);
  });
});
