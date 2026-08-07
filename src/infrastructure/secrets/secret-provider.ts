/**
 * Secret Provider Abstraction —
 *
 * Provider-agnostic interface for secret retrieval. The application requests
 * secrets by logical identity and never embeds provider-specific logic in
 * business services.
 *
 * Architecture:
 *
 *   LOCAL DEVELOPMENT
 *     .env / process.env
 *       └── EnvironmentSecretProvider
 *
 *   PRODUCTION (current)
 *     Kubernetes Secret → Pod env vars
 *       └── EnvironmentSecretProvider (secrets injected via secretRef)
 *
 *   PRODUCTION (scale-out path — no rewrite required)
 *     External Secret Manager (Vault / AWS SM / GCP SM / Azure KV)
 *       └── VaultSecretProvider | CloudSecretProvider
 *
 * The application is decoupled from the backend: swap the provider at the
 * factory level without touching a single service or worker.
 *
 * Caching:
 *   Each provider implementation may cache values for a bounded TTL to avoid
 *   hitting the secret manager on every request at scale. See .
 *   The EnvironmentSecretProvider reads process.env once on startup, which
 *   is already correct for the current k8s secretRef injection pattern.
 *
 * Rotation:
 *   On secret rotation the operator must trigger a rolling restart (current)
 *   or implement a live-refresh hook via the provider interface (future).
 *   The cacheTimeoutMs field on CachedSecretResult enables bounded-lifetime
 *   in-process caching so live refresh can be wired without changing callers.
 *
 * Regional architecture:
 *   Multiple Secret Manager instances across regions are supported by
 *   instantiating a regional provider per zone and routing via the factory.
 *   The interface is intentionally thin so providers can choose the most
 *   appropriate regional access strategy.
 */

// ---------------------------------------------------------------------------
// Core interface
// ---------------------------------------------------------------------------

import { config } from '../../config';

export interface ISecretProvider {
  /**
   * Retrieve a secret value by logical name.
   * Returns null when the secret does not exist (caller decides to throw or use default).
   */
  get(name: string): Promise<string | null>;

  /**
   * Return all available secret names (for diagnostics; never log values).
   */
  listNames(): Promise<string[]>;

  /**
   * Refresh a secret from the backing store, bypassing the in-process cache.
   * Used during rotation events.
   */
  refresh(name: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Secret names — logical identity catalogue
// ---------------------------------------------------------------------------

/**
 * Canonical logical names for every secret the application uses.
 * Services import these constants instead of bare strings.
 */
export const SECRET_NAMES = {
  DATABASE_URL: 'DATABASE_URL',
  DATABASE_REPLICA_URL: 'DATABASE_REPLICA_URL',
  REDIS_PASSWORD: 'REDIS_PASSWORD',
  JWT_SECRET: 'JWT_SECRET',
  ENCRYPTION_KEY: 'ENCRYPTION_KEY',
  INTERNAL_API_KEY: 'INTERNAL_API_KEY',
  GOOGLE_CLIENT_ID: 'GOOGLE_CLIENT_ID',
  GOOGLE_CLIENT_SECRET: 'GOOGLE_CLIENT_SECRET',
  GOOGLE_REDIRECT_URI: 'GOOGLE_REDIRECT_URI',
  AWS_ACCESS_KEY_ID: 'AWS_ACCESS_KEY_ID',
  AWS_SECRET_ACCESS_KEY: 'AWS_SECRET_ACCESS_KEY',
} as const;

export type SecretName = (typeof SECRET_NAMES)[keyof typeof SECRET_NAMES];

// ---------------------------------------------------------------------------
// Environment / Kubernetes secretRef provider
// ---------------------------------------------------------------------------

/**
 * EnvironmentSecretProvider — reads secrets from process.env.
 *
 * Used for:
 *   - Local development (values from .env via dotenv)
 *   - Kubernetes production (values injected via envFrom: secretRef)
 *
 * Security: process.env is loaded once at process start from the k8s secret
 * volume or the .env file. Values are never re-read from disk at runtime,
 * which is correct: a pod restart is the rotation mechanism.
 *
 * This means zero Secret Manager SDK calls per request — no latency, no
 * availability dependency, no bottleneck at scale. The k8s API server
 * is the only component that reads from the external secret store.
 *
 * Scale: suitable for 1B-user workloads — the secret is read once from
 * process.env at startup. No per-request round-trip to any secret manager.
 */
export class EnvironmentSecretProvider implements ISecretProvider {
  private readonly snapshot: Map<string, string>;

  constructor() {
    // Snapshot env at construction time so the set of available secret names
    // is stable for the lifetime of the process.
    this.snapshot = new Map(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
  }

  async get(name: string): Promise<string | null> {
    return this.snapshot.get(name) ?? null;
  }

  async listNames(): Promise<string[]> {
    return Array.from(this.snapshot.keys());
  }

  async refresh(name: string): Promise<string | null> {
    // Re-read live process.env value (useful after a SIGHUP-triggered reload
    // that some runtimes support, though not standard Node.js).
    const value = process.env[name] ?? null;
    if (value !== null) {
      this.snapshot.set(name, value);
    }
    return value;
  }
}

// ---------------------------------------------------------------------------
// Vault provider stub — production scale-out path
// ---------------------------------------------------------------------------

/**
 * VaultSecretProvider — production integration boundary for HashiCorp Vault.
 *
 * NOT YET WIRED: this stub documents the integration boundary so the
 * architecture can scale to Vault without rewriting any business service.
 *
 * Integration path:
 *   1. Kubernetes ServiceAccount authenticates to Vault via k8s auth method.
 *   2. Vault returns a short-lived token scoped to the workload's policy.
 *   3. The provider reads secrets from Vault KV v2 using that token.
 *   4. Secrets are cached in-process with a bounded TTL (see cacheTtlMs).
 *   5. On rotation: Vault lease renewal triggers a refresh() call.
 *
 * Regional replication:
 *   - Deploy a Vault cluster per region.
 *   - Set VAULT_ADDR to the regional endpoint via the pod's env.
 *   - The global control plane manages policy and audit; each regional cluster
 *     serves reads for local workloads without cross-region latency.
 *
 * Workload identity (k8s):
 *   - Each ServiceAccount (api, gmail-worker, resume-worker) has a distinct
 *     Vault policy granting access only to its required secrets .
 *   - No static master credential is embedded in the pod or image.
 *
 * To activate: install node-vault or @hashicorp/vault-client, implement
 * the methods below, and change the factory to return VaultSecretProvider
 * in production. No caller code changes needed.
 */
export class VaultSecretProvider implements ISecretProvider {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async get(_name: string): Promise<string | null> {
    throw new Error(
      'VaultSecretProvider is not yet configured. ' +
        'Set VAULT_ADDR and implement the Vault SDK integration. ' +
        'See src/infrastructure/secrets/secret-provider.ts for the integration contract.',
    );
  }

  async listNames(): Promise<string[]> {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async refresh(_name: string): Promise<string | null> {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CloudSecretProvider stub — AWS SM / GCP SM / Azure KV boundary
// ---------------------------------------------------------------------------

/**
 * CloudSecretProvider — integration boundary for cloud-native secret managers.
 *
 * NOT YET WIRED: stub for AWS Secrets Manager / GCP Secret Manager / Azure Key Vault.
 *
 * The choice of backend is infrastructure-driven (which cloud the cluster runs on).
 * Set SECRET_PROVIDER_BACKEND='aws'|'gcp'|'azure' to select at runtime.
 *
 * Caching strategy for 1B users:
 *   At massive scale each pod should cache decrypted secret values in-process
 *   for a short TTL (e.g. 5 minutes). This avoids per-request SDK calls while
 *   still rotating within a predictable window. The refresh() method provides
 *   the hook for out-of-band cache invalidation on rotation events.
 *
 * Secret replication:
 *   Do NOT replicate all secrets globally by default. Provision each secret
 *   only in the regions where its consumers run. For Gmail credentials, only
 *   the regions that process Gmail must have access.
 */
export class CloudSecretProvider implements ISecretProvider {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async get(_name: string): Promise<string | null> {
    throw new Error(
      'CloudSecretProvider is not yet configured. ' +
        'Implement AWS SM / GCP SM / Azure KV integration and set ' +
        'SECRET_PROVIDER_BACKEND in the environment.',
    );
  }

  async listNames(): Promise<string[]> {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async refresh(_name: string): Promise<string | null> {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Factory — single selection point for the active provider
// ---------------------------------------------------------------------------

/**
 * Construct the active ISecretProvider based on runtime configuration.
 *
 * SECRET_PROVIDER_BACKEND controls the selection:
 *   (unset) | 'env'   → EnvironmentSecretProvider (default: local dev + k8s secretRef)
 *   'vault'            → VaultSecretProvider (implement before enabling)
 *   'aws' | 'gcp' | 'azure' → CloudSecretProvider (implement before enabling)
 *
 * The factory is called once at startup. The resulting singleton is used
 * everywhere secrets are needed (via config/index.ts and the cryptographic
 * key manager).
 */
export function createSecretProvider(): ISecretProvider {
  const backend = config.secretProviderBackend;

  switch (backend) {
    case 'vault':
      return new VaultSecretProvider();
    case 'aws':
    case 'gcp':
    case 'azure':
      return new CloudSecretProvider();
    case 'env':
    default:
      return new EnvironmentSecretProvider();
  }
}

/**
 * Singleton — created lazily to avoid circular import issues at module load.
 * The first call to `getSecretProvider()` triggers creation once `config`
 * is fully initialized.
 */
let _secretProvider: ISecretProvider | null = null;

export function getSecretProvider(): ISecretProvider {
  if (!_secretProvider) {
    _secretProvider = createSecretProvider();
  }
  return _secretProvider;
}
