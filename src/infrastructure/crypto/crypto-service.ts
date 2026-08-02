/**
 * CryptoService — KMS/HSM integration boundary (Epic 0.7, Phase 15).
 *
 * This module provides the abstraction layer between the application's
 * cryptographic needs and the key management backend.
 *
 * Current state: software AES-256-GCM using keys from env/secrets manager.
 * Production path: KMSCryptoService (AWS KMS envelope encryption).
 *
 * Architecture:
 *
 *   Application code
 *       ↓  calls
 *   ICryptoService
 *       ↓  implemented by
 *   SoftwareCryptoService  (current — keys from env)
 *   KMSCryptoService       (scale-out — AWS KMS / GCP CMEK / Azure Key Vault)
 *   VaultTransitCryptoService (HashiCorp Vault Transit Engine)
 *
 * Envelope encryption (production path):
 *   For sensitive data at any scale, envelope encryption separates
 *   the Data Encryption Key (DEK) from the Key Encryption Key (KEK):
 *
 *     KEK (in KMS / HSM — never leaves hardware)
 *       └── Encrypts the DEK
 *             └── DEK encrypts application data
 *
 *   This design means:
 *     - The application never handles the KEK directly.
 *     - Rotating the KEK only requires re-wrapping the DEKs, not re-encrypting data.
 *     - The KMS can enforce per-key usage policies, audit logs, and HSM residency.
 *
 * Current SoftwareCryptoService delegates to utils/encryption.ts which
 * implements AES-256-GCM with versioned keys. The interface contract is
 * identical, so the KMSCryptoService can be a drop-in replacement.
 *
 * Key versioning across implementations:
 *   The version field is propagated through the envelope regardless of backend.
 *   SoftwareCryptoService uses integer key versions mapped to ENCRYPTION_KEY_VN env vars.
 *   KMSCryptoService would use KMS key aliases / ARNs as version identifiers.
 */

import {
  encryptToken,
  decryptToken,
  getEncryptedKeyVersion,
  getActiveEncryptionVersion,
  reEncryptIfStale,
  validateEncryptionConfig,
} from '../../utils/encryption';
import { logger } from '../../lib/logger';
import { EncryptionError } from '../../errors/app-errors';
import { KMSClient, GenerateDataKeyCommand, DecryptCommand } from '@aws-sdk/client-kms';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { config } from '../../config';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface EncryptResult {
  /** Versioned ciphertext safe for database storage */
  ciphertext: string;
  /** Key version used for this encryption */
  keyVersion: number;
}

export interface ICryptoService {
  /**
   * Encrypt a plaintext string.
   * Returns a versioned ciphertext that embeds the key version used.
   */
  encrypt(plaintext: string): Promise<EncryptResult>;

  /**
   * Decrypt a versioned ciphertext.
   * Automatically selects the correct key version from the envelope.
   */
  decrypt(ciphertext: string): Promise<string>;

  /**
   * Return the key version embedded in a ciphertext without decrypting.
   */
  keyVersionOf(ciphertext: string): number;

  /**
   * Return the current active key version for new encryptions.
   */
  activeKeyVersion(): number;

  /**
   * Re-encrypt a stale ciphertext to the active key version.
   * Returns null if the ciphertext is already using the active version.
   */
  reEncryptIfStale(ciphertext: string): Promise<string | null>;

  /**
   * Validate the crypto configuration at startup.
   * Throws if critical keys are missing or misconfigured.
   */
  validateConfig(): void;
}

// ---------------------------------------------------------------------------
// Software implementation (current — env-based keys)
// ---------------------------------------------------------------------------

/**
 * SoftwareCryptoService — AES-256-GCM with env-managed keys.
 *
 * Suitable for development and moderate-scale deployments.
 * Keys are loaded once from environment variables / Kubernetes secrets.
 *
 * For production KMS-backed encryption use KMSCryptoService with the
 * same interface — no caller changes needed.
 */
export class SoftwareCryptoService implements ICryptoService {
  async encrypt(plaintext: string): Promise<EncryptResult> {
    const ciphertext = encryptToken(plaintext);
    const keyVersion = getActiveEncryptionVersion();
    return { ciphertext, keyVersion };
  }

  async decrypt(ciphertext: string): Promise<string> {
    return decryptToken(ciphertext);
  }

  keyVersionOf(ciphertext: string): number {
    return getEncryptedKeyVersion(ciphertext);
  }

  activeKeyVersion(): number {
    return getActiveEncryptionVersion();
  }

  async reEncryptIfStale(ciphertext: string): Promise<string | null> {
    return reEncryptIfStale(ciphertext);
  }

  validateConfig(): void {
    validateEncryptionConfig();
  }
}

// ---------------------------------------------------------------------------
// KMS integration — AWS KMS envelope encryption
// ---------------------------------------------------------------------------

/**
 * KMSCryptoService — production envelope encryption backed by AWS KMS.
 *
 * The master key (Key Encryption Key) never leaves KMS. Per-record Data
 * Encryption Keys (DEKs) are generated by KMS, used locally for AES-256-GCM,
 * and stored wrapped (encrypted) beside the ciphertext:
 *
 *   KEK (KMS, never exposed) ──wraps──▶ DEK ──encrypts──▶ application data
 *
 * Envelope format (distinguishable from the software format):
 *   kms:<keyVersion>:<encryptedDek_b64>:<iv_b64>:<authTag_b64>:<ciphertext_b64>
 *
 * Key rotation:
 *   - Point KMS_KEY_ID at a new CMK and bump KMS_KEY_VERSION.
 *   - New ciphertext is wrapped by the new CMK.
 *   - Old ciphertext decrypts via kms.decrypt (KMS infers the wrapping key).
 *   - A background job calls reEncryptIfStale() to re-wrap old records.
 *
 * DEK caching:
 *   - Plaintext DEKs are cached in-process for KMS_DEK_CACHE_TTL_MS to avoid
 *     a KMS round-trip on every decrypt.
 *   - The active DEK used for new encryptions is also cached for the same TTL;
 *     a restart generates a fresh DEK (no re-wrapping needed).
 *
 * Availability: if KMS is unreachable, encrypt/decrypt fail fast rather than
 * falling back to weaker software keys.
 */
export class KMSCryptoService implements ICryptoService {
  private readonly keyId: string | undefined;
  private readonly encryptionContext: Record<string, string> | undefined;
  private readonly keyVersion: number;
  private readonly dekCacheTtlMs: number;
  private readonly client: KMSClient;

  // Active DEK for NEW encryptions (lazy, TTL-cached)
  private activeDek: { encrypted: Buffer; plaintext: Buffer; expiresAt: number } | null = null;

  // DEK decrypt cache: encryptedDek base64 → plaintext DEK (TTL-cached)
  private readonly dekCache = new Map<string, { plaintext: Buffer; expiresAt: number }>();

  constructor(
    keyId?: string,
    client?: KMSClient,
    opts: { keyVersion?: number; encryptionContext?: string; dekCacheTtlMs?: number } = {},
  ) {
    this.keyId = keyId ?? config.kms.keyId;
    this.keyVersion = opts.keyVersion ?? config.kms.keyVersion;
    this.dekCacheTtlMs = opts.dekCacheTtlMs ?? config.kms.dekCacheTtlMs;
    this.encryptionContext = opts.encryptionContext
      ? this.parseEncryptionContext(opts.encryptionContext)
      : config.kms.encryptionContext
        ? this.parseEncryptionContext(config.kms.encryptionContext)
        : undefined;

    this.client = client ?? new KMSClient({ region: config.s3.region ?? 'us-east-1' });
  }

  async encrypt(plaintext: string): Promise<EncryptResult> {
    this.validateConfig();
    const dek = await this.getActiveDek();

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dek.plaintext, iv, { authTagLength: 16 });
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const ciphertext = [
      'kms',
      String(this.keyVersion),
      dek.encrypted.toString('base64'),
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');

    return { ciphertext, keyVersion: this.keyVersion };
  }

  async decrypt(ciphertext: string): Promise<string> {
    const parts = ciphertext.split(':');
    if (parts[0] !== 'kms' || parts.length !== 6) {
      throw new EncryptionError('Unsupported ciphertext format — expected a KMS envelope.');
    }

    const [, , encryptedDekB64, ivB64, authTagB64, dataB64] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const plaintextDek = await this.getDekPlaintext(encryptedDekB64);

    const decipher = createDecipheriv('aes-256-gcm', plaintextDek, Buffer.from(ivB64, 'base64'), {
      authTagLength: 16,
    });
    decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));

    try {
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(dataB64, 'base64')),
        decipher.final(),
      ]);
      return decrypted.toString('utf8');
    } catch {
      throw new EncryptionError('Unsupported state or unable to authenticate data');
    }
  }

  keyVersionOf(ciphertext: string): number {
    const parts = ciphertext.split(':');
    if (parts[0] !== 'kms' || parts.length !== 6) {
      throw new EncryptionError('Unsupported ciphertext format — expected a KMS envelope.');
    }
    const version = parseInt(parts[1] as string, 10);
    if (isNaN(version) || version < 1) {
      throw new EncryptionError('Invalid key version in KMS envelope.');
    }
    return version;
  }

  activeKeyVersion(): number {
    return this.keyVersion;
  }

  async reEncryptIfStale(ciphertext: string): Promise<string | null> {
    if (!ciphertext.startsWith('kms:')) {
      // Software ciphertext is out of scope for the KMS service — the caller
      // must migrate it via SoftwareCryptoService during cutover.
      throw new EncryptionError(
        'Cannot re-encrypt a non-KMS envelope. Migrate software ciphertext before KMS cutover.',
      );
    }
    if (this.keyVersionOf(ciphertext) === this.keyVersion) {
      return null;
    }
    const plaintext = await this.decrypt(ciphertext);
    const result = await this.encrypt(plaintext);
    return result.ciphertext;
  }

  validateConfig(): void {
    if (!this.keyId) {
      throw new EncryptionError(
        'KMSCryptoService is not yet configured. Set KMS_KEY_ID to enable ' +
          'the KMS crypto backend (CRYPTO_BACKEND=kms).',
      );
    }
  }

  /**
   * Proactively validate KMS connectivity. Call this at startup when
   * CRYPTO_BACKEND=kms. Throws if the KMS service is unreachable,
   * the key does not exist, or IAM permissions are insufficient.
   */
  async validateConnectivity(): Promise<void> {
    if (!this.keyId) {
      throw new EncryptionError('KMSCryptoService is not yet configured. Set KMS_KEY_ID.');
    }

    try {
      const testCommand = new GenerateDataKeyCommand({
        KeyId: this.keyId,
        KeySpec: 'AES_256',
        EncryptionContext: this.encryptionContext,
      });
      await this.client.send(testCommand);
    } catch (err) {
      throw new EncryptionError(
        'KMS connectivity test failed. Verify KMS_KEY_ID, IAM permissions, ' +
          'network access, and encryption context: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private parseEncryptionContext(raw: string): Record<string, string> {
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      throw new EncryptionError(
        'AWS_KMS_ENCRYPTION_CONTEXT must be a JSON object (e.g. {"app":"career-terminal"}).',
      );
    }
  }

  private async getActiveDek(): Promise<{ encrypted: Buffer; plaintext: Buffer }> {
    this.validateConfig();
    if (this.activeDek && this.activeDek.expiresAt > Date.now()) {
      return { encrypted: this.activeDek.encrypted, plaintext: this.activeDek.plaintext };
    }

    const command = new GenerateDataKeyCommand({
      KeyId: this.keyId,
      KeySpec: 'AES_256',
      EncryptionContext: this.encryptionContext,
    });
    const response = await this.client.send(command);

    if (!response.Plaintext || !response.CiphertextBlob) {
      throw new EncryptionError('KMS GenerateDataKey returned no key material.');
    }

    this.activeDek = {
      encrypted: Buffer.from(response.CiphertextBlob),
      plaintext: Buffer.from(response.Plaintext),
      expiresAt: Date.now() + this.dekCacheTtlMs,
    };
    return { encrypted: this.activeDek.encrypted, plaintext: this.activeDek.plaintext };
  }

  private async getDekPlaintext(encryptedDekB64: string): Promise<Buffer> {
    this.validateConfig();

    const cached = this.dekCache.get(encryptedDekB64);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.plaintext;
    }

    const command = new DecryptCommand({
      CiphertextBlob: Buffer.from(encryptedDekB64, 'base64'),
      EncryptionContext: this.encryptionContext,
    });
    const response = await this.client.send(command);

    if (!response.Plaintext) {
      throw new EncryptionError('KMS Decrypt returned no key material.');
    }

    const plaintext = Buffer.from(response.Plaintext);
    this.dekCache.set(encryptedDekB64, {
      plaintext,
      expiresAt: Date.now() + this.dekCacheTtlMs,
    });
    return plaintext;
  }

  /** Clears in-process DEK caches (used in tests and rotation events). */
  clearCaches(): void {
    this.activeDek = null;
    this.dekCache.clear();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the active ICryptoService based on CRYPTO_BACKEND env var.
 *
 *   (unset) | 'software' → SoftwareCryptoService (AES-256-GCM with env keys)
 *   'kms'               → KMSCryptoService (AWS KMS envelope encryption)
 *
 * For the KMS backend, KMS_KEY_ID must be set; validateConfig() is invoked at
 * startup (see src/index.ts runStartupDiagnostics) so a missing key fails fast.
 */
export function createCryptoService(): ICryptoService {
  const backend = config.cryptoBackend ?? 'software';

  switch (backend) {
    case 'kms':
      logger.info('[CryptoService] Using KMS backend');
      return new KMSCryptoService();
    case 'software':
    default:
      logger.info('[CryptoService] Using software AES-256-GCM backend');
      return new SoftwareCryptoService();
  }
}

/** Singleton — created once at startup. */
export const cryptoService: ICryptoService = createCryptoService();
