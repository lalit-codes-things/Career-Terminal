/**
 * Encryption utility — legacy test suite (updated for versioned envelope format).
 *
 * The new versioned envelope format is: v<N>:iv:authTag:ciphertext (4 parts).
 * Tests for the full Epic 0.7 encryption suite are in epic-0.7-encryption.test.ts.
 */
export {};

const mockKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const plaintext = 'sensitive_oauth_token_12345!@#';

const originalEnv = { ...process.env };

function loadFreshEncryption(): {
  encryptToken: (s: string) => string;
  decryptToken: (s: string) => string;
  invalidateKeyCache: () => void;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../utils/encryption');
}

describe('Encryption Utility', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, ENCRYPTION_KEY: mockKey };
    delete process.env.ENCRYPTION_KEY_V2;
    delete process.env.ACTIVE_ENCRYPTION_KEY_VERSION;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should successfully encrypt and decrypt a string', () => {
    const { encryptToken, decryptToken } = loadFreshEncryption();
    const encrypted = encryptToken(plaintext);
    expect(encrypted).not.toEqual(plaintext);

    const parts = encrypted.split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');

    const decrypted = decryptToken(encrypted);
    expect(decrypted).toEqual(plaintext);
  });

  it('should generate different ciphertexts for the same plaintext (semantic security)', () => {
    const { encryptToken, decryptToken } = loadFreshEncryption();
    const encrypted1 = encryptToken(plaintext);
    const encrypted2 = encryptToken(plaintext);

    expect(encrypted1).not.toEqual(encrypted2);
    expect(decryptToken(encrypted1)).toEqual(plaintext);
    expect(decryptToken(encrypted2)).toEqual(plaintext);
  });

  it('should throw if ENCRYPTION_KEY is missing', () => {
    delete process.env.ENCRYPTION_KEY;
    const { encryptToken } = loadFreshEncryption();
    expect(() => encryptToken(plaintext)).toThrow(/ENCRYPTION_KEY/);
  });

  it('should throw if ENCRYPTION_KEY is wrong length', () => {
    process.env.ENCRYPTION_KEY = 'tooshort';
    const { encryptToken } = loadFreshEncryption();
    expect(() => encryptToken(plaintext)).toThrow(/ENCRYPTION_KEY/);
  });

  it('should throw if ciphertext is tampered with', () => {
    const { encryptToken, decryptToken } = loadFreshEncryption();
    const encrypted = encryptToken(plaintext);
    const parts = encrypted.split(':');

    parts[3] = Buffer.from('tampered_data').toString('base64');
    const tampered = parts.join(':');

    expect(() => decryptToken(tampered)).toThrow(
      /Unsupported state or unable to authenticate data/,
    );
  });

  it('should throw for invalid encrypted format', () => {
    const { decryptToken } = loadFreshEncryption();
    expect(() => decryptToken('invalid_format_string')).toThrow(/expected.*iv:authTag:ciphertext/);
  });
});
