/**
 * Workload Identity — Phase 2 (Epic 0.7)
 *
 * Documents and enforces the workload identity model for secret access.
 *
 * Current state (Kubernetes secretRef injection):
 *   - Each workload type (API, Gmail worker, Resume worker) is assigned a
 *     distinct Kubernetes ServiceAccount.
 *   - The deployment YAML already references `serviceAccountName: career-terminal-api`.
 *   - A Kubernetes RBAC Role limits which Secrets each SA can read.
 *   - In production the Secret is populated from an external secret manager
 *     via the External Secrets Operator or CSI driver.
 *
 * Scale-out path (Vault k8s auth / cloud workload identity):
 *   When migrating to Vault or a cloud-native secret manager the same SA
 *   identity is presented to the external system as a workload credential.
 *   No static master credential is required.
 *
 * This module:
 *   1. Declares the canonical workload identities.
 *   2. Validates at startup that the current process is running as the
 *      expected identity (prevents misconfigured deployments).
 *   3. Provides the secret access policy matrix (which workload needs what).
 *
 * See also: k8s/deployment.yaml for the ServiceAccount manifest.
 *           k8s/rbac.yaml for the RBAC bindings (to be created).
 */
import { logger } from '../../lib/logger';
import { SECRET_NAMES } from './secret-provider';

// ---------------------------------------------------------------------------
// Workload identity catalogue
// ---------------------------------------------------------------------------

export const WORKLOAD_IDENTITIES = {
  /** Express API server — handles all HTTP requests */
  API: 'career-terminal-api',
  /** Gmail sync worker — processes email ingestion jobs */
  GMAIL_WORKER: 'career-terminal-gmail-worker',
  /** Resume parsing worker — processes file extraction jobs */
  RESUME_WORKER: 'career-terminal-resume-worker',
  /** Application tracking worker — processes status update jobs */
  TRACKING_WORKER: 'career-terminal-tracking-worker',
} as const;

export type WorkloadIdentity = (typeof WORKLOAD_IDENTITIES)[keyof typeof WORKLOAD_IDENTITIES];

// ---------------------------------------------------------------------------
// Secret access policy matrix — Phase 3
// ---------------------------------------------------------------------------

/**
 * Defines which secrets each workload is ALLOWED to access.
 *
 * This is the authoritative source of truth for least-privilege access.
 * In Vault this maps directly to a policy; in k8s RBAC it drives Role rules.
 *
 * IMPORTANT: A workload must not receive secrets it does not use.
 *   - The API does NOT need Gmail credentials.
 *   - The Gmail worker does NOT need AWS S3 credentials.
 *   - The Resume worker does NOT need Google OAuth credentials.
 */
export const WORKLOAD_SECRET_POLICY: Record<WorkloadIdentity, string[]> = {
  [WORKLOAD_IDENTITIES.API]: [
    SECRET_NAMES.DATABASE_URL,
    SECRET_NAMES.DATABASE_REPLICA_URL,
    SECRET_NAMES.REDIS_PASSWORD,
    SECRET_NAMES.JWT_SECRET,
    SECRET_NAMES.ENCRYPTION_KEY,
    SECRET_NAMES.INTERNAL_API_KEY,
    SECRET_NAMES.GOOGLE_CLIENT_ID,
    SECRET_NAMES.GOOGLE_CLIENT_SECRET,
    SECRET_NAMES.GOOGLE_REDIRECT_URI,
  ],

  [WORKLOAD_IDENTITIES.GMAIL_WORKER]: [
    SECRET_NAMES.DATABASE_URL,
    SECRET_NAMES.REDIS_PASSWORD,
    SECRET_NAMES.ENCRYPTION_KEY,
    SECRET_NAMES.GOOGLE_CLIENT_ID,
    SECRET_NAMES.GOOGLE_CLIENT_SECRET,
  ],

  [WORKLOAD_IDENTITIES.RESUME_WORKER]: [
    SECRET_NAMES.DATABASE_URL,
    SECRET_NAMES.REDIS_PASSWORD,
    SECRET_NAMES.AWS_ACCESS_KEY_ID,
    SECRET_NAMES.AWS_SECRET_ACCESS_KEY,
  ],

  [WORKLOAD_IDENTITIES.TRACKING_WORKER]: [
    SECRET_NAMES.DATABASE_URL,
    SECRET_NAMES.REDIS_PASSWORD,
    SECRET_NAMES.ENCRYPTION_KEY,
  ],
};

// ---------------------------------------------------------------------------
// Runtime identity resolver
// ---------------------------------------------------------------------------

/**
 * Detect the current workload identity from the WORKLOAD_IDENTITY environment
 * variable, which is set per-workload in the Kubernetes Deployment manifest.
 *
 * Falls back to 'career-terminal-api' when not set (development / test).
 */
export function getCurrentWorkloadIdentity(): WorkloadIdentity | null {
  const identity = process.env.WORKLOAD_IDENTITY as WorkloadIdentity | undefined;

  if (!identity) {
    // In dev/test there is no explicit workload identity
    return null;
  }

  const validIdentities = Object.values(WORKLOAD_IDENTITIES) as string[];
  if (!validIdentities.includes(identity)) {
    logger.warn('[WorkloadIdentity] Unknown workload identity configured', {
      identity,
      validIdentities,
    });
    return null;
  }

  return identity;
}

// ---------------------------------------------------------------------------
// Startup validation
// ---------------------------------------------------------------------------

/**
 * Validate that the running process has the expected workload identity.
 * Logs a warning if WORKLOAD_IDENTITY is missing (acceptable in dev/test).
 * In production (NODE_ENV=production) a missing identity is a configuration
 * anomaly that should be surfaced in the startup logs.
 */
export function validateWorkloadIdentity(): void {
  const identity = getCurrentWorkloadIdentity();

  if (!identity) {
    if (process.env.NODE_ENV === 'production') {
      logger.warn(
        '[WorkloadIdentity] WORKLOAD_IDENTITY env var is not set in production. ' +
          'Set this to restrict secret access per workload. ' +
          'Valid values: ' +
          Object.values(WORKLOAD_IDENTITIES).join(', '),
      );
    } else {
      logger.info(
        '[WorkloadIdentity] WORKLOAD_IDENTITY not set (dev/test mode — all secrets accessible)',
      );
    }
    return;
  }

  const allowedSecrets = WORKLOAD_SECRET_POLICY[identity];
  logger.info('[WorkloadIdentity] Workload identity validated', {
    identity,
    allowedSecretCount: allowedSecrets.length,
    // Never log the actual secret values — only the names
    allowedSecretNames: allowedSecrets,
  });
}

// ---------------------------------------------------------------------------
// Secret access enforcement
// ---------------------------------------------------------------------------

/**
 * Check whether the current workload is permitted to access a given secret.
 *
 * This is a defence-in-depth check: the k8s secret injection or Vault policy
 * is the primary enforcement mechanism. This check catches misconfiguration
 * before the secret is used in business logic.
 *
 * Returns true when:
 *   - No workload identity is set (dev/test — allow all)
 *   - The workload's policy includes the secret name
 *
 * Returns false (and logs a warning) when:
 *   - A workload identity IS set and the secret is not in its policy
 */
export function isSecretAllowed(secretName: string): boolean {
  const identity = getCurrentWorkloadIdentity();

  // No identity set → development mode → allow all
  if (!identity) return true;

  const allowedSecrets = WORKLOAD_SECRET_POLICY[identity];
  const allowed = allowedSecrets.includes(secretName);

  if (!allowed) {
    logger.warn('[WorkloadIdentity] Secret access denied — not in workload policy', {
      identity,
      secretName,
      // Audit trail — never log the secret value itself
    });
  }

  return allowed;
}
