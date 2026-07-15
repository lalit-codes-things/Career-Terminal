/**
 * AES-256-GCM encryption utility for secure token storage.
 *
 * Design decisions:
 * - AES-256-GCM provides authenticated encryption (confidentiality + integrity)
 * - Random IV per encryption ensures semantic security (identical plaintexts produce different ciphertexts)
 * - Auth tag prevents tampering — any modification to the ciphertext is detected on decryption
 * - Output format: `iv:authTag:ciphertext` (all base64-encoded) for safe DB storage
 */
import crypto from 'crypto';
import { EncryptionError } from '../errors/app-errors';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128-bit IV for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag
const KEY_LENGTH = 32; // 256-bit key

/**
 * Resolves the encryption key from the environment.
 * The key must be a 64-character hex string (32 bytes).
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex) {
    throw new EncryptionError('ENCRYPTION_KEY environment variable is not set');
  }
  if (keyHex.length !== KEY_LENGTH * 2) {
    throw new EncryptionError(
      `ENCRYPTION_KEY must be ${KEY_LENGTH * 2} hex characters (${KEY_LENGTH} bytes)`,
    );
  }
  return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 *
 * @param plaintext - The string to encrypt (e.g., an OAuth token)
 * @returns Encrypted string in format `iv:authTag:ciphertext` (base64-encoded parts)
 * @throws {EncryptionError} If the encryption key is missing or invalid
 */
export function encryptToken(plaintext: string): string {
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:ciphertext (all base64)
    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  } catch (error) {
    if (error instanceof EncryptionError) throw error;
    throw new EncryptionError(
      `Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/**
 * Decrypts a token that was encrypted with `encryptToken`.
 *
 * @param encryptedValue - The encrypted string in format `iv:authTag:ciphertext`
 * @returns The original plaintext string
 * @throws {EncryptionError} If decryption fails (wrong key, tampered data, or invalid format)
 */
export function decryptToken(encryptedValue: string): string {
  try {
    const key = getEncryptionKey();
    const parts = encryptedValue.split(':');

    if (parts.length !== 3) {
      throw new EncryptionError(
        'Invalid encrypted token format: expected iv:authTag:ciphertext',
      );
    }

    const [ivB64, authTagB64, ciphertextB64] = parts as [string, string, string];

    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const ciphertext = Buffer.from(ciphertextB64, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  } catch (error) {
    if (error instanceof EncryptionError) throw error;
    throw new EncryptionError(
      `Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
