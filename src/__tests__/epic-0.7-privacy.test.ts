/**
 * Epic 0.7 — Privacy & Security Infrastructure Tests (Phase 32).
 *
 * Covers:
 *   - PII Inventory helpers (Phase 20)
 *   - AI data protection guard (Phase 26)
 *   - Workload identity policy enforcement (Phases 2-3)
 *   - CryptoService — SoftwareCryptoService (Phase 15)
 *   - Request logger privacy controls (Phase 22)
 *   - Cryptographic token utilities (Phases 12 & 28)
 *   - Timing-safe comparison utilities (Phase 29)
 */

// ── Module imports ────────────────────────────────────────────────────────────

import {
  PII_INVENTORY,
  getLogRedactionFields,
  getDeletionScopeFields,
  getCriticalFields,
  getEncryptedFields,
} from '../infrastructure/privacy/pii-inventory';
import { createHmac } from 'crypto';

import {
  AI_DATA_PROTECTION_POLICY,
  assertAiDataMinimisation,
} from '../infrastructure/privacy/ai-data-protection';

import {
  WORKLOAD_IDENTITIES,
  WORKLOAD_SECRET_POLICY,
  getCurrentWorkloadIdentity,
  isSecretAllowed,
} from '../infrastructure/secrets/workload-identity';

import { SECRET_NAMES } from '../infrastructure/secrets/secret-provider';

import { SoftwareCryptoService, KMSCryptoService } from '../infrastructure/crypto/crypto-service';
import { invalidateKeyCache } from '../utils/encryption';

import {
  generateOpaqueToken,
  generateUrlSafeToken,
  generateVerificationToken,
  hashToken,
  generateIdempotencyKey,
  generateWebhookSecret,
} from '../utils/tokens';

import {
  timingSafeStringEqual,
  timingSafeBufferEqual,
  verifyHmacSha256,
} from '../utils/secure-compare';

import { REDACTED_REQUEST_HEADERS } from '../infrastructure/logger/request-logger.middleware';

// ── Test key fixture ──────────────────────────────────────────────────────────
const TEST_KEY = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';

// =============================================================================
// 1. PII INVENTORY (Phase 20)
// =============================================================================

describe('Epic 0.7 — PII Inventory (Phase 20)', () => {
  it('1a. inventory is non-empty', () => {
    expect(PII_INVENTORY.length).toBeGreaterThan(0);
  });

  it('1b. every field has all required properties', () => {
    for (const field of PII_INVENTORY) {
      expect(typeof field.name).toBe('string');
      expect(typeof field.dbLocation).toBe('string');
      expect(Array.isArray(field.storageLocations)).toBe(true);
      expect(['critical', 'high', 'medium', 'low']).toContain(field.sensitivity);
      expect(['consent', 'contract', 'legitimate_interest', 'legal_obligation']).toContain(
        field.legalBasis,
      );
      expect(typeof field.encryptedAtRest).toBe('boolean');
      expect(typeof field.mustRedactFromLogs).toBe('boolean');
      expect(typeof field.deletedOnAccountDeletion).toBe('boolean');
    }
  });

  it('1c. critical fields are all encrypted at rest', () => {
    const criticalNotEncrypted = getCriticalFields().filter((f) => !f.encryptedAtRest);
    // OAuth tokens must be encrypted; JWT/opaque refresh tokens are not stored in DB
    // so encryptedAtRest=false is correct for those. Verify no unexpected critical plain fields.
    const unexpectedPlainCritical = criticalNotEncrypted.filter(
      (f) =>
        f.dbLocation !== 'N/A (stateless — not stored in DB)' && !f.dbLocation.includes('Redis'),
    );
    expect(unexpectedPlainCritical).toHaveLength(0);
  });

  it('1d. getLogRedactionFields returns only mustRedactFromLogs=true fields', () => {
    const redactFields = getLogRedactionFields();
    expect(redactFields.length).toBeGreaterThan(0);
    for (const f of redactFields) {
      expect(f.mustRedactFromLogs).toBe(true);
    }
  });

  it('1e. getDeletionScopeFields returns only deletedOnAccountDeletion=true fields', () => {
    const deleteFields = getDeletionScopeFields();
    expect(deleteFields.length).toBeGreaterThan(0);
    for (const f of deleteFields) {
      expect(f.deletedOnAccountDeletion).toBe(true);
    }
  });

  it('1f. getEncryptedFields returns only encryptedAtRest=true fields', () => {
    const encFields = getEncryptedFields();
    expect(encFields.length).toBeGreaterThan(0);
    for (const f of encFields) {
      expect(f.encryptedAtRest).toBe(true);
    }
  });

  it('1g. encrypted fields are all critical sensitivity', () => {
    for (const f of getEncryptedFields()) {
      expect(f.sensitivity).toBe('critical');
    }
  });

  it('1h. getCriticalFields returns a non-empty set', () => {
    expect(getCriticalFields().length).toBeGreaterThan(0);
  });

  it('1i. all encrypted-at-rest fields must also be flagged for log redaction', () => {
    for (const f of getEncryptedFields()) {
      expect(f.mustRedactFromLogs).toBe(true);
    }
  });

  it('1j. no field has an empty name or dbLocation', () => {
    for (const f of PII_INVENTORY) {
      expect(f.name.trim().length).toBeGreaterThan(0);
      expect(f.dbLocation.trim().length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// 2. AI DATA PROTECTION GUARD (Phase 26)
// =============================================================================

describe('Epic 0.7 — AI Data Protection Guard (Phase 26)', () => {
  it('2a. policy declares no external AI providers currently in use', () => {
    expect(AI_DATA_PROTECTION_POLICY.externalProviders).toHaveLength(0);
  });

  it('2b. policy mandates PII redaction before sending to AI', () => {
    expect(AI_DATA_PROTECTION_POLICY.piiRedactionBeforeSending).toBe(true);
  });

  it('2c. policy disables prompt logging in production', () => {
    expect(AI_DATA_PROTECTION_POLICY.promptLoggingEnabled).toBe(false);
  });

  it('2d. assertAiDataMinimisation passes for safe structured data', () => {
    const safeData = {
      company: 'example-organization',
      role: 'Software Engineer',
      status: 'INTERVIEW',
      applicationId: 'abc123',
    };
    expect(() => assertAiDataMinimisation(safeData)).not.toThrow();
  });

  it('2e. blocks JWT token (eyJ... format)', () => {
    const data = {
      prompt:
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    };
    expect(() => assertAiDataMinimisation(data)).toThrow(/JWT access token/);
  });

  it('2f. blocks AES-256-GCM versioned envelope (v1: prefix)', () => {
    const data = { field: 'v1:aGVsbG8gd29ybGQ=:dGVzdGF1dGh0YWc=:Y2lwaGVydGV4dA==' };
    expect(() => assertAiDataMinimisation(data)).toThrow(/AES-256-GCM encrypted envelope/);
  });

  it('2g. blocks database connection strings', () => {
    const data = { config: 'postgresql://user:password@localhost:5432/db' };
    expect(() => assertAiDataMinimisation(data)).toThrow(/Database connection string/);
  });

  it('2h. blocks Redis connection strings with password', () => {
    const data = { url: 'redis://:mypassword@localhost:6379' };
    expect(() => assertAiDataMinimisation(data)).toThrow(/Redis connection string/);
  });

  it('2i. blocks AWS access key ID pattern', () => {
    const data = { key: 'AKIAIOSFODNN7EXAMPLE' };
    expect(() => assertAiDataMinimisation(data)).toThrow(/AWS access key/);
  });

  it('2j. blocks Bearer token in string', () => {
    const data = { header: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9sometoken' };
    expect(() => assertAiDataMinimisation(data)).toThrow(/Bearer token/);
  });

  it('2k. passes for plain string without credentials', () => {
    expect(() => assertAiDataMinimisation('Interview at Google next Tuesday')).not.toThrow();
  });

  it('2l. passes for null / undefined (no data to check)', () => {
    expect(() => assertAiDataMinimisation(null)).not.toThrow();
    expect(() => assertAiDataMinimisation(undefined)).not.toThrow();
  });

  it('2m. error message includes remediation guidance', () => {
    expect(() => assertAiDataMinimisation({ url: 'postgresql://u:p@host/db' })).toThrow(
      /Strip all credentials/,
    );
  });
});

// =============================================================================
// 3. WORKLOAD IDENTITY POLICY (Phases 2-3)
// =============================================================================

describe('Epic 0.7 — Workload Identity Policy (Phases 2-3)', () => {
  const originalEnv = process.env.WORKLOAD_IDENTITY;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.WORKLOAD_IDENTITY;
    } else {
      process.env.WORKLOAD_IDENTITY = originalEnv;
    }
  });

  it('3a. four canonical workload identities are defined', () => {
    expect(Object.keys(WORKLOAD_IDENTITIES)).toHaveLength(4);
  });

  it('3b. every workload has a non-empty secret policy', () => {
    for (const identity of Object.values(WORKLOAD_IDENTITIES)) {
      const policy = WORKLOAD_SECRET_POLICY[identity];
      expect(policy.length).toBeGreaterThan(0);
    }
  });

  it('3c. API workload can access JWT_SECRET', () => {
    const apiPolicy = WORKLOAD_SECRET_POLICY[WORKLOAD_IDENTITIES.API];
    expect(apiPolicy).toContain(SECRET_NAMES.JWT_SECRET);
  });

  it('3d. Gmail worker cannot access JWT_SECRET (least-privilege)', () => {
    const gmailPolicy = WORKLOAD_SECRET_POLICY[WORKLOAD_IDENTITIES.GMAIL_WORKER];
    expect(gmailPolicy).not.toContain(SECRET_NAMES.JWT_SECRET);
  });

  it('3e. Resume worker cannot access Google OAuth credentials', () => {
    const resumePolicy = WORKLOAD_SECRET_POLICY[WORKLOAD_IDENTITIES.RESUME_WORKER];
    expect(resumePolicy).not.toContain(SECRET_NAMES.GOOGLE_CLIENT_SECRET);
    expect(resumePolicy).not.toContain(SECRET_NAMES.GOOGLE_CLIENT_ID);
  });

  it('3f. API workload cannot access AWS S3 credentials', () => {
    const apiPolicy = WORKLOAD_SECRET_POLICY[WORKLOAD_IDENTITIES.API];
    expect(apiPolicy).not.toContain(SECRET_NAMES.AWS_ACCESS_KEY_ID);
    expect(apiPolicy).not.toContain(SECRET_NAMES.AWS_SECRET_ACCESS_KEY);
  });

  it('3g. getCurrentWorkloadIdentity returns null when WORKLOAD_IDENTITY is unset', () => {
    delete process.env.WORKLOAD_IDENTITY;
    expect(getCurrentWorkloadIdentity()).toBeNull();
  });

  it('3h. getCurrentWorkloadIdentity returns the configured identity', () => {
    process.env.WORKLOAD_IDENTITY = WORKLOAD_IDENTITIES.GMAIL_WORKER;
    expect(getCurrentWorkloadIdentity()).toBe(WORKLOAD_IDENTITIES.GMAIL_WORKER);
  });

  it('3i. getCurrentWorkloadIdentity returns null for unknown identity', () => {
    process.env.WORKLOAD_IDENTITY = 'unknown-workload';
    expect(getCurrentWorkloadIdentity()).toBeNull();
  });

  it('3j. isSecretAllowed returns true when no identity set (dev/test mode)', () => {
    delete process.env.WORKLOAD_IDENTITY;
    expect(isSecretAllowed(SECRET_NAMES.JWT_SECRET)).toBe(true);
    expect(isSecretAllowed(SECRET_NAMES.AWS_SECRET_ACCESS_KEY)).toBe(true);
  });

  it('3k. isSecretAllowed enforces least-privilege when identity is set', () => {
    process.env.WORKLOAD_IDENTITY = WORKLOAD_IDENTITIES.RESUME_WORKER;
    // Resume worker CAN access S3 creds
    expect(isSecretAllowed(SECRET_NAMES.AWS_ACCESS_KEY_ID)).toBe(true);
    // Resume worker CANNOT access JWT or Google creds
    expect(isSecretAllowed(SECRET_NAMES.JWT_SECRET)).toBe(false);
    expect(isSecretAllowed(SECRET_NAMES.GOOGLE_CLIENT_SECRET)).toBe(false);
  });

  it('3l. tracking worker has access to ENCRYPTION_KEY but not Google creds', () => {
    const trackingPolicy = WORKLOAD_SECRET_POLICY[WORKLOAD_IDENTITIES.TRACKING_WORKER];
    expect(trackingPolicy).toContain(SECRET_NAMES.ENCRYPTION_KEY);
    expect(trackingPolicy).not.toContain(SECRET_NAMES.GOOGLE_CLIENT_SECRET);
  });
});

// =============================================================================
// 4. CRYPTO SERVICE — SoftwareCryptoService (Phase 15)
// =============================================================================

describe('Epic 0.7 — CryptoService: SoftwareCryptoService (Phase 15)', () => {
  let svc: SoftwareCryptoService;

  beforeEach(() => {
    invalidateKeyCache();
    process.env.ENCRYPTION_KEY = TEST_KEY;
    delete process.env.ENCRYPTION_KEY_V2;
    delete process.env.ACTIVE_ENCRYPTION_KEY_VERSION;
    svc = new SoftwareCryptoService();
  });

  afterEach(() => {
    invalidateKeyCache();
  });

  it('4a. encrypt returns a ciphertext and keyVersion 1', async () => {
    const result = await svc.encrypt('my-oauth-token');
    expect(result.ciphertext).toMatch(/^v1:/);
    expect(result.keyVersion).toBe(1);
  });

  it('4b. decrypt recovers original plaintext', async () => {
    const plaintext = 'refresh-token-value';
    const { ciphertext } = await svc.encrypt(plaintext);
    const decrypted = await svc.decrypt(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it('4c. keyVersionOf extracts version from envelope without decrypting', async () => {
    const { ciphertext } = await svc.encrypt('test');
    expect(svc.keyVersionOf(ciphertext)).toBe(1);
  });

  it('4d. activeKeyVersion returns 1 by default', () => {
    expect(svc.activeKeyVersion()).toBe(1);
  });

  it('4e. reEncryptIfStale returns null when already on active version', async () => {
    const { ciphertext } = await svc.encrypt('test');
    const result = await svc.reEncryptIfStale(ciphertext);
    expect(result).toBeNull();
  });

  it('4f. reEncryptIfStale migrates v1 ciphertext to v2 when v2 is active', async () => {
    const V2_KEY = '0011223344556677889900aabbccddeeff0011223344556677889900aabbccdd';
    // Encrypt with v1
    const { ciphertext: v1Cipher } = await svc.encrypt('token-to-migrate');

    // Activate v2 — must re-require to pick up new config
    process.env.ENCRYPTION_KEY_V2 = V2_KEY;
    process.env.ACTIVE_ENCRYPTION_KEY_VERSION = '2';
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SoftwareCryptoService: FreshSvc } = require('../infrastructure/crypto/crypto-service');
    const freshSvc = new FreshSvc();

    const v2Cipher = await freshSvc.reEncryptIfStale(v1Cipher);
    expect(v2Cipher).not.toBeNull();
    expect(v2Cipher).toMatch(/^v2:/);
    // And the re-encrypted value must still decrypt correctly
    const decrypted = await freshSvc.decrypt(v2Cipher);
    expect(decrypted).toBe('token-to-migrate');

    delete process.env.ENCRYPTION_KEY_V2;
    delete process.env.ACTIVE_ENCRYPTION_KEY_VERSION;
  });

  it('4g. validateConfig does not throw with a valid key', () => {
    expect(() => svc.validateConfig()).not.toThrow();
  });

  it('4h. two encryptions of same plaintext produce different ciphertexts', async () => {
    const a = await svc.encrypt('same-value');
    const b = await svc.encrypt('same-value');
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});

describe('Epic 0.7 — CryptoService: KMSCryptoService stub (Phase 15)', () => {
  it('4i. KMSCryptoService.encrypt throws with clear message', async () => {
    const kms = new KMSCryptoService();
    await expect(kms.encrypt('test')).rejects.toThrow(/KMSCryptoService is not yet configured/);
  });

  it('4j. createCryptoService returns SoftwareCryptoService when CRYPTO_BACKEND=software', () => {
    process.env.CRYPTO_BACKEND = 'software';
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createCryptoService: freshCreate, SoftwareCryptoService: FreshSoftware } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../infrastructure/crypto/crypto-service');
    const service = freshCreate();
    expect(service).toBeInstanceOf(FreshSoftware);
    delete process.env.CRYPTO_BACKEND;
  });

  it('4k. createCryptoService returns KMSCryptoService when CRYPTO_BACKEND=kms', () => {
    process.env.CRYPTO_BACKEND = 'kms';
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createCryptoService: freshCreate, KMSCryptoService: FreshKMS } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../infrastructure/crypto/crypto-service');
    const service = freshCreate();
    expect(service).toBeInstanceOf(FreshKMS);
    delete process.env.CRYPTO_BACKEND;
  });
});

// =============================================================================
// 5. CRYPTOGRAPHIC TOKEN UTILITIES (Phases 12 & 28)
// =============================================================================

describe('Epic 0.7 — Cryptographic Token Utilities (Phases 12 & 28)', () => {
  it('5a. generateOpaqueToken returns 64-char hex by default (32 bytes)', () => {
    const token = generateOpaqueToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it('5b. generateOpaqueToken produces unique values', () => {
    const tokens = new Set(Array.from({ length: 20 }, () => generateOpaqueToken()));
    expect(tokens.size).toBe(20);
  });

  it('5c. generateUrlSafeToken contains no +, /, or = characters', () => {
    for (let i = 0; i < 20; i++) {
      const token = generateUrlSafeToken();
      expect(token).not.toContain('+');
      expect(token).not.toContain('/');
      expect(token).not.toContain('=');
    }
  });

  it('5d. generateVerificationToken returns token and matching hash', () => {
    const { token, hash } = generateVerificationToken();
    expect(token).toHaveLength(64); // 32 bytes hex
    expect(hash).toHaveLength(64); // sha256 hex
    expect(hash).toBe(hashToken(token));
  });

  it('5e. generateVerificationToken: different token yields different hash', () => {
    const a = generateVerificationToken();
    const b = generateVerificationToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(b.hash);
  });

  it('5f. hashToken is deterministic', () => {
    const token = 'my-fixed-token';
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('5g. hashToken produces 64-char SHA-256 hex', () => {
    expect(hashToken('test')).toHaveLength(64);
    expect(hashToken('test')).toMatch(/^[0-9a-f]+$/);
  });

  it('5h. generateIdempotencyKey includes the given prefix', () => {
    const key = generateIdempotencyKey('sync');
    expect(key).toMatch(/^sync:/);
  });

  it('5i. generateIdempotencyKey has 3 colon-separated parts', () => {
    const key = generateIdempotencyKey('job');
    const parts = key.split(':');
    expect(parts).toHaveLength(3);
  });

  it('5j. generateIdempotencyKey produces unique values', () => {
    const keys = new Set(Array.from({ length: 20 }, () => generateIdempotencyKey()));
    expect(keys.size).toBe(20);
  });

  it('5k. generateWebhookSecret returns a URL-safe base64url string', () => {
    const secret = generateWebhookSecret();
    expect(secret.length).toBeGreaterThan(30);
    expect(secret).not.toContain('+');
    expect(secret).not.toContain('/');
    expect(secret).not.toContain('=');
  });
});

// =============================================================================
// 6. TIMING-SAFE COMPARISON UTILITIES (Phase 29)
// =============================================================================

describe('Epic 0.7 — Timing-Safe Comparison (Phase 29)', () => {
  describe('timingSafeStringEqual', () => {
    it('6a. returns true for identical strings', () => {
      expect(timingSafeStringEqual('secret-api-key', 'secret-api-key')).toBe(true);
    });

    it('6b. returns false for different strings of the same length', () => {
      expect(timingSafeStringEqual('aaaa', 'aaab')).toBe(false);
    });

    it('6c. returns false for strings of different lengths', () => {
      expect(timingSafeStringEqual('short', 'longer-string')).toBe(false);
    });

    it('6d. returns false for empty vs non-empty', () => {
      expect(timingSafeStringEqual('', 'a')).toBe(false);
    });

    it('6e. returns true for two empty strings', () => {
      expect(timingSafeStringEqual('', '')).toBe(true);
    });

    it('6f. handles unicode characters', () => {
      expect(timingSafeStringEqual('café', 'café')).toBe(true);
      expect(timingSafeStringEqual('café', 'cafe')).toBe(false);
    });
  });

  describe('timingSafeBufferEqual', () => {
    it('6g. returns true for identical buffers', () => {
      const a = Buffer.from('hello');
      const b = Buffer.from('hello');
      expect(timingSafeBufferEqual(a, b)).toBe(true);
    });

    it('6h. returns false for different buffers of the same length', () => {
      const a = Buffer.from([1, 2, 3]);
      const b = Buffer.from([1, 2, 4]);
      expect(timingSafeBufferEqual(a, b)).toBe(false);
    });

    it('6i. returns false when lengths differ', () => {
      expect(timingSafeBufferEqual(Buffer.from('ab'), Buffer.from('abc'))).toBe(false);
    });
  });

  describe('verifyHmacSha256', () => {
    it('6j. returns true for a valid HMAC-SHA256 signature', () => {
      const payload = 'webhook-body-payload';
      const secret = 'my-webhook-secret';
      const signature = createHmac('sha256', secret).update(payload).digest('hex');

      expect(verifyHmacSha256(payload, secret, signature)).toBe(true);
    });

    it('6k. returns false for a tampered payload', () => {
      const secret = 'my-webhook-secret';
      const originalSignature = createHmac('sha256', secret).update('original').digest('hex');

      expect(verifyHmacSha256('tampered', secret, originalSignature)).toBe(false);
    });

    it('6l. returns false for a wrong secret', () => {
      const payload = 'payload';
      const signature = createHmac('sha256', 'correct-secret').update(payload).digest('hex');

      expect(verifyHmacSha256(payload, 'wrong-secret', signature)).toBe(false);
    });

    it('6m. works with Buffer payload', () => {
      const payload = Buffer.from('binary-payload');
      const secret = 'secret';
      const signature = createHmac('sha256', secret).update(payload).digest('hex');

      expect(verifyHmacSha256(payload, secret, signature)).toBe(true);
    });
  });
});

// =============================================================================
// 7. REQUEST LOGGER PRIVACY CONTROLS (Phase 22)
// =============================================================================

describe('Epic 0.7 — Request Logger Privacy Controls (Phase 22)', () => {
  it('7a. REDACTED_REQUEST_HEADERS includes authorization', () => {
    expect(REDACTED_REQUEST_HEADERS.has('authorization')).toBe(true);
  });

  it('7b. REDACTED_REQUEST_HEADERS includes cookie', () => {
    expect(REDACTED_REQUEST_HEADERS.has('cookie')).toBe(true);
  });

  it('7c. REDACTED_REQUEST_HEADERS includes x-internal-api-key', () => {
    expect(REDACTED_REQUEST_HEADERS.has('x-internal-api-key')).toBe(true);
  });

  it('7d. REDACTED_REQUEST_HEADERS includes x-user-id (test bypass header)', () => {
    expect(REDACTED_REQUEST_HEADERS.has('x-user-id')).toBe(true);
  });

  it('7e. REDACTED_REQUEST_HEADERS includes x-api-key', () => {
    expect(REDACTED_REQUEST_HEADERS.has('x-api-key')).toBe(true);
  });

  it('7f. REDACTED_REQUEST_HEADERS does not include safe headers like content-type', () => {
    expect(REDACTED_REQUEST_HEADERS.has('content-type')).toBe(false);
    expect(REDACTED_REQUEST_HEADERS.has('accept')).toBe(false);
    expect(REDACTED_REQUEST_HEADERS.has('x-request-id')).toBe(false);
  });

  it('7g. at least 4 sensitive headers are in the redaction set', () => {
    expect(REDACTED_REQUEST_HEADERS.size).toBeGreaterThanOrEqual(4);
  });
});

// =============================================================================
// 8. LOGGER SENSITIVE KEY REDACTION (Phase 0)
// =============================================================================

describe('Epic 0.7 — Logger Sensitive Key Redaction (Phase 0)', () => {
  // We test the logger's redaction behaviour by capturing console output.
  let consoleSpy: jest.SpyInstance;
  let capturedOutput: string[] = [];

  beforeEach(() => {
    capturedOutput = [];
    consoleSpy = jest.spyOn(console, 'info').mockImplementation((msg: string) => {
      capturedOutput.push(msg);
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('8a. logger does not emit accessToken values', async () => {
    // Import logger after setup so the spy is in place
    const { logger } = await import('../lib/logger');
    logger.info('test event', { accessToken: 'super-secret-token-value', userId: 'u1' });

    expect(capturedOutput.length).toBeGreaterThan(0);
    const output = capturedOutput.join('');
    expect(output).not.toContain('super-secret-token-value');
    expect(output).toContain('[REDACTED]');
    expect(output).toContain('u1');
  });

  it('8b. logger does not emit email values', async () => {
    const { logger } = await import('../lib/logger');
    logger.info('test event', { email: 'user@example.com' });

    const output = capturedOutput.join('');
    expect(output).not.toContain('user@example.com');
    expect(output).toContain('[REDACTED]');
  });

  it('8c. logger does not emit refreshTokenEncrypted values', async () => {
    const { logger } = await import('../lib/logger');
    logger.info('test event', { refreshTokenEncrypted: 'v1:someIV:someTag:someCipher' });

    const output = capturedOutput.join('');
    expect(output).not.toContain('v1:someIV:someTag:someCipher');
    expect(output).toContain('[REDACTED]');
  });

  it('8d. logger does not emit encryptionKey values', async () => {
    const { logger } = await import('../lib/logger');
    logger.info('test event', { encryptionKey: TEST_KEY });

    const output = capturedOutput.join('');
    expect(output).not.toContain(TEST_KEY);
    expect(output).toContain('[REDACTED]');
  });

  it('8e. logger preserves non-sensitive context fields', async () => {
    const { logger } = await import('../lib/logger');
    logger.info('job application tracked', {
      applicationId: 'app-123',
      status: 'INTERVIEW',
      company: 'example-organization',
    });

    const output = capturedOutput.join('');
    expect(output).toContain('app-123');
    expect(output).toContain('INTERVIEW');
    expect(output).toContain('example-organization');
  });

  it('8f. redaction works on nested objects', async () => {
    const { logger } = await import('../lib/logger');
    logger.info('nested test', {
      connection: { accessToken: 'nested-secret', id: 'conn-1' },
    });

    const output = capturedOutput.join('');
    expect(output).not.toContain('nested-secret');
    expect(output).toContain('conn-1');
  });
});
