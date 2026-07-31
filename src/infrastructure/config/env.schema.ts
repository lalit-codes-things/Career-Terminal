import { z } from 'zod';

export const envSchema = z.object({
  // Runtime
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_VERSION: z.string().default('unknown'),
  GIT_COMMIT: z.string().default('unknown'),
  BUILD_TIMESTAMP: z.string().default('unknown'),
  TRUST_PROXY: z.string().default('1'),

  // Database
  DATABASE_URL: z.string().min(1),
  DATABASE_REPLICA_URL: z.string().optional(),
  // Dedicated least-privilege connection URLs. In production the API/worker
  // pods use DATABASE_APP_URL / DATABASE_WORKER_URL and ONLY the migration
  // job uses DATABASE_MIGRATION_URL. DATABASE_URL may also carry the app URL.
  DATABASE_APP_URL: z.string().optional(),
  DATABASE_WORKER_URL: z.string().optional(),
  DATABASE_MIGRATION_URL: z.string().optional(),
  // Shadow database for Prisma migrate dev (must have same extensions as primary)
  SHADOW_DATABASE_URL: z.string().optional(),
  DATABASE_TIMEOUT: z.coerce.number().int().positive().default(30000),
  DATABASE_POOL_TIMEOUT: z.coerce.number().int().positive().default(30000),
  DATABASE_CONNECTION_LIMIT: z.coerce.number().int().positive().max(100).default(5),
  DATABASE_CONNECT_TIMEOUT: z.coerce.number().int().positive().default(10),
  DATABASE_ROLE: z
    .enum(['app_runtime', 'app_worker', 'app_migration', 'app_readonly', 'app_admin'])
    .default('app_runtime'),
  DATABASE_APP_USER: z.string().optional(),
  DATABASE_APP_PASSWORD: z.string().optional(),
  // How long (ms) a read-after-write request routes reads to the primary to
  // avoid stale reads from a lagging replica.
  DATABASE_STICKY_READ_WINDOW_MS: z.coerce.number().int().positive().default(5000),

  // PostgreSQL (used by docker-compose / migrations)
  POSTGRES_USER: z.string().default('career-terminal'),
  POSTGRES_PASSWORD: z.string().optional(),
  POSTGRES_DB: z.string().default('career-terminal'),

  // PgBouncer
  PGBOUNCER_HOST: z.string().optional(),
  PGBOUNCER_PORT: z.coerce.number().int().positive().optional(),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().min(1),

  // Security
  ENCRYPTION_KEY: z.string().length(64), // 32 bytes hex = 64 chars
  JWT_SECRET: z.string().min(32),
  INTERNAL_API_KEY: z.string().optional(),

  // Encryption key rotation (Epic 0.7)
  ENCRYPTION_KEY_V2: z.string().length(64).optional(),
  ENCRYPTION_KEY_V3: z.string().length(64).optional(),
  ACTIVE_ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive().default(1),

  // Secret provider backend (Epic 0.7)
  // 'env' = environment variables (default)
  // 'vault' = HashiCorp Vault (requires implementation)
  // 'aws' | 'gcp' | 'azure' = cloud secret managers (requires implementation)
  SECRET_PROVIDER_BACKEND: z.enum(['env', 'vault', 'aws', 'gcp', 'azure']).default('env'),

  // Crypto backend (Epic 0.7)
  // 'software' = AES-256-GCM with env keys (default)
  // 'kms' = cloud KMS / HSM (requires implementation)
  CRYPTO_BACKEND: z.enum(['software', 'kms']).default('software'),

  // Workload identity (Epic 0.7)
  // Set per-workload in k8s deployment to restrict secret access
  WORKLOAD_IDENTITY: z.string().optional(),

  // Redis Queue Cluster (BullMQ + job state)
  // Use separate credentials for isolated workloads. No eviction policy — jobs must not be silently dropped.
  REDIS_QUEUE_HOST: z.string().default('localhost'),
  REDIS_QUEUE_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_QUEUE_PASSWORD: z.string().optional(),
  REDIS_QUEUE_DB: z.coerce.number().int().min(0).max(15).default(0),

  // Redis Ephemeral Cluster (cache + rate-limiting + OAuth state + coordination)
  // Eviction policy is acceptable here because this data is disposable.
  REDIS_CACHE_HOST: z.string().optional(),
  REDIS_CACHE_PORT: z.coerce.number().int().positive().optional(),
  REDIS_CACHE_PASSWORD: z.string().optional(),
  REDIS_CACHE_DB: z.coerce.number().int().min(0).max(15).optional(),

  // Legacy single-Redis fallback (queue + cache share the same instance)
  // Only used when *_QUEUE_HOST / *_CACHE_HOST are not explicitly configured.
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().min(0).max(15).default(0),
  REDIS_TIMEOUT: z.coerce.number().int().positive().default(10000),

  // Worker execution. Keep this bounded so replicas cannot overwhelm PostgreSQL
  // or downstream providers; scale worker replicas before increasing concurrency.
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(100).default(5),
  WORKER_QUEUES: z.string().default('email,resume-parsing,application-tracking,outbox-dispatcher'),
  WORKER_SHUTDOWN_TIMEOUT: z.coerce.number().int().positive().default(30000),

  // AWS / S3
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_ENDPOINT_URL_S3: z.string().optional(), // MinIO endpoint in local dev
  S3_BUCKET: z.string().min(1),
  S3_TIMEOUT: z.coerce.number().int().positive().default(30000),

  // MinIO (docker-compose local dev)
  MINIO_ROOT_USER: z.string().default('minioadmin'),
  MINIO_ROOT_PASSWORD: z.string().optional(),
  MINIO_BUCKET: z.string().default('career-terminal-resumes'),
  MINIO_ENDPOINT: z.string().optional(),

  // Malware scanner
  CLAMAV_HOST: z.string().default('localhost'),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  CLAMAV_SCAN_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

  // Gmail ingestion
  INGESTION_QUEUE_DEPTH_LIMIT: z.coerce.number().int().positive().default(10000),

  // CORS
  ALLOWED_ORIGINS: z.string().optional(),
  ALLOWED_METHODS: z.string().default('GET,POST,PUT,PATCH,DELETE,OPTIONS'),
  ALLOWED_HEADERS: z.string().default('Content-Type,Authorization,x-user-id,x-internal-api-key'),
  EXPOSED_HEADERS: z.string().default('x-request-id,x-correlation-id'),
  CORS_PREFLIGHT_CACHE: z.coerce.number().int().positive().default(86400),
  CORS_CREDENTIALS: z.coerce.boolean().default(true),

  // Helmet & Security Headers
  HSTS_ENABLED: z.coerce.boolean().default(true),
  HSTS_MAX_AGE: z.coerce.number().int().positive().default(31536000),
  HSTS_INCLUDE_SUBDOMAINS: z.coerce.boolean().default(true),
  HSTS_PRELOAD: z.coerce.boolean().default(false),
  X_FRAME_OPTIONS: z.enum(['DENY', 'SAMEORIGIN']).default('DENY'),
  REFERRER_POLICY: z.string().default('strict-origin-when-cross-origin'),
  PERMISSIONS_POLICY: z.string().default(''),
  CSP_DIRECTIVES: z.string().optional(),
  COOP: z.enum(['same-origin', 'same-origin-allow-popups', 'unsafe-none']).default('same-origin'),
  COEP: z.enum(['require-corp', 'credentialless', 'unsafe-none']).default('require-corp'),
  CORP: z.enum(['same-origin', 'same-site', 'cross-origin']).default('same-origin'),

  // Request Limits
  MAX_BODY_SIZE: z.string().default('1mb'),
  MAX_JSON_SIZE: z.string().default('1mb'),
  MAX_URL_LENGTH: z.coerce.number().int().positive().default(2048),
  MAX_QUERY_PARAMS: z.coerce.number().int().positive().default(100),
  MAX_MULTIPART_SIZE: z.string().default('10mb'),
  MAX_HEADER_SIZE: z.coerce.number().int().positive().default(8192),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  MAX_OBJECT_DEPTH: z.coerce.number().int().positive().default(10),
  MAX_ARRAY_SIZE: z.coerce.number().int().positive().default(100),
  MAX_STRING_LENGTH: z.coerce.number().int().positive().default(5000),

  // Validation
  VALIDATION_STRIP_UNKNOWN: z.coerce.boolean().default(true),
  VALIDATION_STRICT: z.coerce.boolean().default(true),

  // HTTP Methods
  ALLOWED_HTTP_METHODS: z.string().default('GET,POST,PUT,PATCH,DELETE,OPTIONS'),
  HTTP_METHOD_OVERRIDE_ENABLED: z.coerce.boolean().default(false),

  // Timeouts
  HTTP_TIMEOUT: z.coerce.number().int().positive().default(60000),
  REQUEST_TIMEOUT: z.coerce.number().int().positive().default(60000),
  SHUTDOWN_TIMEOUT: z.coerce.number().int().positive().default(30000),

  // Telemetry
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  METRICS_ENABLED: z.coerce.boolean().default(true),
  TRACING_ENABLED: z.coerce.boolean().default(true),
  TRACING_SAMPLER: z
    .enum([
      'always_on',
      'always_off',
      'traceidratio',
      'parentbased_always_on',
      'parentbased_always_off',
      'parentbased_traceidratio',
    ])
    .default('parentbased_always_on'),
  TRACING_SAMPLER_RATIO: z.coerce.number().min(0).max(1).default(1),
  TRACING_EXPORTER_TYPE: z.enum(['otlp', 'console', 'none']).default('none'),
  OTLP_ENDPOINT: z.string().default('http://localhost:4318'),

  // Performance thresholds
  SLOW_REQUEST_THRESHOLD: z.coerce.number().int().positive().default(1000),
  SLOW_QUERY_THRESHOLD: z.coerce.number().int().positive().default(500),
  EVENT_LOOP_BLOCKED_THRESHOLD: z.coerce.number().int().positive().default(100),

  // Outbox dispatcher
  OUTBOX_DISPATCH_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(50),

  // KMS (AWS KMS envelope encryption)
  KMS_KEY_ID: z.string().optional(),
  AWS_KMS_ENCRYPTION_CONTEXT: z.string().optional(),
  // Integer key version stamped into KMS envelopes (defaults to 1).
  KMS_KEY_VERSION: z.coerce.number().int().positive().default(1),
  // How long a decrypted Data Encryption Key is cached in-process (ms).
  KMS_DEK_CACHE_TTL_MS: z.coerce.number().int().positive().default(300000),

  // Redis ACL / TLS
  REDIS_ACL_USERNAME: z.string().optional(),
  REDIS_ACL_PASSWORD: z.string().optional(),
  REDIS_TLS_ENABLED: z.coerce.boolean().default(false),
  REDIS_TLS_CA_PATH: z.string().optional(),

  // Worker service account
  WORKER_SERVICE_ACCOUNT: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${issues}`);
  }

  return result.data;
}
