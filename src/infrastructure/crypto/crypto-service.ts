/**
 * CryptoService — KMS/HSM integration boundary (Epic 0.7, Phase 15).
 *
 * This module provides the abstraction layer between the application's
 * cryptographic needs and the key management backend.
 *
 * Current state: software AES-256-GCM using keys from env/secrets manager.
 * Scale-out path: HSM-backed or cloud KMS envelope encryption.
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
 * Envelope encryption (scale-out path):
 *   For large volumes of sensitive data, envelope encryption separates
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
 * Suitable for single-region, moderate-scale deployments.
 * Keys are loaded once from environment variables / Kubernetes secrets.
 *
 * At 1 billion users, consider migrating to KMSCryptoService with HSM backing.
 * The interface is identical — no caller changes needed.
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
// KMS integration boundary stub
// ---------------------------------------------------------------------------

/**
 * KMSCryptoService — cloud KMS integration boundary.
 *
 * NOT YET WIRED. Documents the integration contract.
 *
 * To activate for AWS KMS:
 *   1. Install @aws-sdk/client-kms.
 *   2. Set KMS_KEY_ID=arn:aws:kms:... in the environment.
 *   3. Implement encrypt/decrypt using GenerateDataKey + Decrypt calls.
 *   4. Update the factory below to return KMSCryptoService.
 *
 * Envelope encryption pattern for KMS:
 *
 *   encrypt(plaintext):
 *     dek = kms.generateDataKey(keyId, AES_256)
 *     encryptedDek = dek.encryptedDataKey           // KEK wraps DEK in KMS
 *     ciphertext = aesGcm(dek.plaintext, plaintext) // DEK encrypts data
 *     return encode(encryptedDek + ciphertext)      // store both
 *
 *   decrypt(envelope):
 *     (encryptedDek, ciphertext) = decode(envelope)
 *     dek = kms.decrypt(encryptedDek)               // KMS decrypts DEK
 *     return aesGcm.decrypt(dek, ciphertext)        // DEK decrypts data
 *
 * This means:
 *   - The application never holds the master key (KEK stays in KMS/HSM).
 *   - Rotating the master key re-wraps the DEKs without re-encrypting data.
 *   - IAM policies on the KMS key enforce which workload identities can use it.
 */
export class KMSCryptoService implements ICryptoService {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async encrypt(_plaintext: string): Promise<EncryptResult> {
    throw new Error(
      'KMSCryptoService is not yet configured. ' +
        'Set KMS_KEY_ID and implement the KMS SDK integration.',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async decrypt(_ciphertext: string): Promise<string> {
    throw new Error('KMSCryptoService is not yet configured.');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  keyVersionOf(_ciphertext: string): number {
    return 1;
  }

  activeKeyVersion(): number {
    return 1;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async reEncryptIfStale(_ciphertext: string): Promise<string | null> {
    throw new Error('KMSCryptoService is not yet configured.');
  }

  validateConfig(): void {
    throw new Error('KMSCryptoService is not yet configured.');
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the active ICryptoService based on CRYPTO_BACKEND env var.
 *
 *   (unset) | 'software' → SoftwareCryptoService (current)
 *   'kms'               → KMSCryptoService (activate when KMS is wired)
 */
export function createCryptoService(): ICryptoService {
  const backend = process.env.CRYPTO_BACKEND ?? 'software';

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
