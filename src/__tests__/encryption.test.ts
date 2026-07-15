import { encryptToken, decryptToken } from '../utils/encryption';
import { EncryptionError } from '../errors/app-errors';

describe('Encryption Utility', () => {
  const originalEnv = process.env;
  const mockKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // 64 hex chars (32 bytes)
  const plaintext = 'sensitive_oauth_token_12345!@#';

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, ENCRYPTION_KEY: mockKey };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should successfully encrypt and decrypt a string', () => {
    const encrypted = encryptToken(plaintext);
    expect(encrypted).not.toEqual(plaintext);
    expect(encrypted.split(':')).toHaveLength(3); // iv:authTag:ciphertext

    const decrypted = decryptToken(encrypted);
    expect(decrypted).toEqual(plaintext);
  });

  it('should generate different ciphertexts for the same plaintext (semantic security)', () => {
    const encrypted1 = encryptToken(plaintext);
    const encrypted2 = encryptToken(plaintext);
    
    expect(encrypted1).not.toEqual(encrypted2);
    
    // Both should decrypt back to the same plaintext
    expect(decryptToken(encrypted1)).toEqual(plaintext);
    expect(decryptToken(encrypted2)).toEqual(plaintext);
  });

  it('should throw EncryptionError if ENCRYPTION_KEY is missing', () => {
    delete process.env.ENCRYPTION_KEY;
    
    expect(() => encryptToken(plaintext)).toThrow(EncryptionError);
    expect(() => encryptToken(plaintext)).toThrow(/ENCRYPTION_KEY environment variable is not set/);
  });

  it('should throw EncryptionError if ENCRYPTION_KEY is wrong length', () => {
    process.env.ENCRYPTION_KEY = 'tooshort';
    
    expect(() => encryptToken(plaintext)).toThrow(EncryptionError);
    expect(() => encryptToken(plaintext)).toThrow(/must be 64 hex characters/);
  });

  it('should throw EncryptionError if ciphertext is tampered with', () => {
    const encrypted = encryptToken(plaintext);
    const parts = encrypted.split(':');
    
    // Tamper with the ciphertext part
    parts[2] = Buffer.from('tampered_data').toString('base64');
    const tampered = parts.join(':');

    expect(() => decryptToken(tampered)).toThrow(EncryptionError);
    expect(() => decryptToken(tampered)).toThrow(/Unsupported state or unable to authenticate data/);
  });

  it('should throw EncryptionError for invalid encrypted format', () => {
    expect(() => decryptToken('invalid_format_string')).toThrow(EncryptionError);
    expect(() => decryptToken('invalid_format_string')).toThrow(/expected iv:authTag:ciphertext/);
  });
});
