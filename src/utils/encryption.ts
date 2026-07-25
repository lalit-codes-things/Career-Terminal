/**
 * AES-256-GCM encryption utility — with key versioning (Epic 0.7 retrofit).
 *
 * Design decisions:
 *   - AES-256-GCM: authenticated encryption (confidentiality + integrity).
 *   - Random 12-byte IV per operation: semantic security (no IV reuse).
 *   - 16-byte (128-bit) auth tag: tamper detection; decryption fails hard.
 *   - Versioned envelope: `v<keyVersion>:iv:authTag:ciphertext`
 *     The key version prefix enables zero-downtime key rotation:
 *       1. Add new key version to ENCRYPTION_KEY_V2.
 *       2. New data is encrypted with V2.
 *       3. Old ciphertext (V1 prefix) is decrypted with V1 until re-encrypted.
 *       4. Background job re-encrypts V1 data to V2.
 *       5. Remove V1 key after all data is migrated.
 *
 * Key loading:
 *   Keys are loaded from environment variables once per process and cached
 *   in the module-level keyCache. This avoids process.env reads on every
 *   encrypt/decrypt call and allows safe key rotation via refresh().
 *
 * Environment variables:
 *   ENCRYPTION_KEY      — active key (64-char hex / 32 bytes), version=1
 *   ENCRYPTION_KEY_V2   — rotation key (64-char hex / 32 bytes), version=2 (optional)
 *   ENCRYPTION_KEY_V3   — rotation key (64-char hex / 32 bytes), version=3 (optional)
 *   ACTIVE_ENCRYPTION_KEY_VERSION — which version to use for NEW encryptions (default=1)
 *
 * KMS/HSM integration boundary:
 *   For hardware-backed keys, replace getKeyByVersion() with a call to the
 *   CryptoService which wraps the KMS API. The envelope format is identical;
 *   the only change is where the raw key bytes come from.
 *   See src/infrastructure/crypto/crypto-service.ts for the boundary.
 */
import crypto from 'crypto';
import { EncryptionError } from '../errors/app-errors';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV (GCM recommended)
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag
const KEY_LENGTH = 32; // 256-bit key
const KEY_HEX_LENGTH = KEY_LENGTH * 2; // 64 hex characters

/** Default version used when no version prefix is present (legacy format). */
const LEGACY_VERSION = 1;

// ---------------------------------------------------------------------------
// Key cache — loaded once per process, refreshable for rotation
// ---------------------------------------------------------------------------

interface KeyCacheEntry {
  version: number;
  keyBuffer: Buffer;
}

/** Module-level key cache — never exposed outside this module. */
const keyCache = new Map<number, KeyCacheEntry>();
let activeCachedVersion: number | null = null;

/**
 * Load and cache a key from the environment.
 * env var name follows the pattern: ENCRYPTION_KEY (v1), ENCRYPTION_KEY_V2 (v2+)
 */
function buildEnvVarName(version: number): string {
  return version === 1 ? 'ENCRYPTION_KEY' : `ENCRYPTION_KEY_V${version}`;
}

function loadKeyVersion(version: number): Buffer | null {
  const envVarName = buildEnvVarName(version);
  const keyHex = process.env[envVarName];
  if (!keyHex) return null;

  if (keyHex.length !== KEY_HEX_LENGTH) {
    throw new EncryptionError(
      `${envVarName} must be exactly ${KEY_HEX_LENGTH} hex characters (${KEY_LENGTH} bytes). ` +
        `Got ${keyHex.length} characters.`,
    );
  }

  // Validate it is valid hex
  if (!/^[0-9a-fA-F]+$/.test(keyHex)) {
    throw new EncryptionError(`${envVarName} contains non-hex characters.`);
  }

  return Buffer.from(keyHex, 'hex');
}

/**
 * Get the active key version for NEW encryptions.
 * Reads ACTIVE_ENCRYPTION_KEY_VERSION from env (default: 1).
 */
function getActiveVersion(): number {
  const v = process.env.ACTIVE_ENCRYPTION_KEY_VERSION;
  if (!v) return 1;
  const n = parseInt(v, 10);
  if (isNaN(n) || n < 1) return 1;
  return n;
}

/**
 * Retrieve a key buffer for the given version.
 * Loads from environment on first access per version, then serves from cache.
 */
function getKeyByVersion(version: number): Buffer {
  const cached = keyCache.get(version);
  if (cached) return cached.keyBuffer;

  const keyBuffer = loadKeyVersion(version);
  if (!keyBuffer) {
    throw new EncryptionError(
      `Encryption key version ${version} is not configured. ` +
        `Set ${buildEnvVarName(version)} to a 64-character hex string.`,
    );
  }

  keyCache.set(version, { version, keyBuffer });
  return keyBuffer;
}

/**
 * Get the active (current) key buffer, resolving to the active version.
 * This is the key used for all NEW encryptions.
 */
function getActiveKey(): { version: number; keyBuffer: Buffer } {
  const version = activeCachedVersion ?? getActiveVersion();
  const keyBuffer = getKeyByVersion(version);

  // Cache the resolved active version so subsequent calls skip re-reading env
  if (activeCachedVersion === null) {
    activeCachedVersion = version;
  }

  return { version, keyBuffer };
}

// ---------------------------------------------------------------------------
// Versioned envelope format
// ---------------------------------------------------------------------------

/**
 * Parse an encrypted value into its components.
 *
 * Supported formats:
 *   Versioned (new): `v<N>:<iv_b64>:<authTag_b64>:<ciphertext_b64>`
 *   Legacy (v1 only): `<iv_b64>:<authTag_b64>:<ciphertext_b64>`
 */
function parseEnvelope(
  encryptedValue: string,
): { version: number; iv: Buffer; authTag: Buffer; ciphertext: Buffer } {
  if (encryptedValue.startsWith('v') && /^v\d+:/.test(encryptedValue)) {
    // Versioned format
    const firstColon = encryptedValue.indexOf(':');
    const versionStr = encryptedValue.slice(1, firstColon);
    const version = parseInt(versionStr, 10);
    if (isNaN(version) || version < 1) {
      throw new EncryptionError(`Invalid key version in envelope: ${versionStr}`);
    }

    const rest = encryptedValue.slice(firstColon + 1);
    const parts = rest.split(':');
    if (parts.length !== 3) {
      throw new EncryptionError(
        'Invalid versioned encrypted token format: expected v<N>:iv:authTag:ciphertext',
      );
    }

    const [ivB64, authTagB64, ciphertextB64] = parts as [string, string, string];
    return {
      version,
      iv: Buffer.from(ivB64, 'base64'),
      authTag: Buffer.from(authTagB64, 'base64'),
      ciphertext: Buffer.from(ciphertextB64, 'base64'),
    };
  }

  // Legacy format: 3-part iv:authTag:ciphertext (version 1 implied)
  const parts = encryptedValue.split(':');
  if (parts.length !== 3) {
    throw new EncryptionError(
      'Invalid encrypted token format: expected iv:authTag:ciphertext (legacy) ' +
        'or v<N>:iv:authTag:ciphertext (versioned)',
    );
  }

  const [ivB64, authTagB64, ciphertextB64] = parts as [string, string, string];
  return {
    version: LEGACY_VERSION,
    iv: Buffer.from(ivB64, 'base64'),
    authTag: Buffer.from(authTagB64, 'base64'),
    ciphertext: Buffer.from(ciphertextB64, 'base64'),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypts a plaintext string using AES-256-GCM with the active key version.
 *
 * Output format: `v<keyVersion>:<iv_b64>:<authTag_b64>:<ciphertext_b64>`
 *
 * @param plaintext - The string to encrypt (e.g. an OAuth token)
 * @returns Versioned encrypted string safe for database storage
 * @throws {EncryptionError} If the key is missing, invalid, or encryption fails
 */
export function encryptToken(plaintext: string): string {
  try {
    const { version, keyBuffer } = getActiveKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Versioned envelope: v<N>:iv:authTag:ciphertext (all base64)
    return [
      `v${version}`,
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
 * Supports both legacy (v1-implied) and versioned envelope formats.
 * Decrypts using the key version embedded in the envelope.
 *
 * @param encryptedValue - Encrypted string from the database
 * @returns The original plaintext string
 * @throws {EncryptionError} If decryption fails (wrong key, tampered data, invalid format)
 */
export function decryptToken(encryptedValue: string): string {
  try {
    const { version, iv, authTag, ciphertext } = parseEnvelope(encryptedValue);
    const keyBuffer = getKeyByVersion(version);

    const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (error) {
    if (error instanceof EncryptionError) throw error;
    // Never leak whether failure was bad key, bad tag, or bad format
    throw new EncryptionError('Unsupported state or unable to authenticate data');
  }
}

/**
 * Returns the key version embedded in an encrypted value.
 * Used by re-encryption jobs to determine whether data uses an old key.
 */
export function getEncryptedKeyVersion(encryptedValue: string): number {
  try {
    return parseEnvelope(encryptedValue).version;
  } catch {
    return LEGACY_VERSION;
  }
}

/**
 * Returns the currently active encryption key version.
 * Used by re-encryption jobs to determine the target version.
 */
export function getActiveEncryptionVersion(): number {
  return getActiveVersion();
}

/**
 * Re-encrypts a value from any previous key version to the current active key.
 * Returns null if the value is already encrypted with the active key version.
 *
 * Used by background re-encryption jobs during key rotation.
 *
 * @param encryptedValue - Ciphertext potentially encrypted with an old key
 * @returns New ciphertext (active key version) or null if already current
 * @throws {EncryptionError} If decryption or re-encryption fails
 */
export function reEncryptIfStale(encryptedValue: string): string | null {
  const currentVersion = getEncryptedKeyVersion(encryptedValue);
  const activeVersion = getActiveVersion();

  if (currentVersion === activeVersion) {
    return null; // Already using the active key — no work needed
  }

  // Decrypt with old key, re-encrypt with new key
  const plaintext = decryptToken(encryptedValue);
  return encryptToken(plaintext);
}

/**
 * Invalidate the key cache for a specific version (or all versions).
 * Call this when keys are rotated at runtime to force re-load from env.
 *
 * Note: in the k8s + secretRef model, key rotation requires a pod restart,
 * which rebuilds the cache automatically. This is provided for environments
 * where runtime key reload is supported (e.g. Vault lease renewal).
 */
export function invalidateKeyCache(version?: number): void {
  if (version !== undefined) {
    keyCache.delete(version);
    if (activeCachedVersion === version) {
      activeCachedVersion = null;
    }
  } else {
    keyCache.clear();
    activeCachedVersion = null;
  }
}

/**
 * Validate that the encryption subsystem is correctly configured.
 * Throws EncryptionError if the primary key is missing or malformed.
 * Call this during application startup to fail fast on misconfiguration.
 */
export function validateEncryptionConfig(): void {
  // Always validate primary key (version 1)
  const v1Key = loadKeyVersion(1);
  if (!v1Key) {
    throw new EncryptionError(
      'ENCRYPTION_KEY is not set. ' +
        'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }

  const allZeros = v1Key.every((b) => b === 0);
  if (allZeros && process.env.NODE_ENV === 'production') {
    throw new EncryptionError(
      'ENCRYPTION_KEY is set to the all-zeros placeholder value in production. ' +
        'This is a critical security misconfiguration.',
    );
  }

  // Validate optional higher-version keys if configured
  for (let v = 2; v <= 10; v++) {
    const envVarName = buildEnvVarName(v);
    if (process.env[envVarName]) {
      loadKeyVersion(v); // throws on invalid format
    }
  }

  const activeVersion = getActiveVersion();
  getKeyByVersion(activeVersion); // throws if active version is not configured
}
