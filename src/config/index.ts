/**
 * Centralized application configuration.
 * Loads and validates all environment variables at startup using zod schema.
 *
 * Epic 0.7: This module is the sole gateway between the application and its
 * secrets. All services must access secrets through this config object or
 * through the cryptoService/secretProvider abstractions — never via
 * process.env directly in business logic.
 */
import 'dotenv/config';
import { parseEnv, type Env } from '../infrastructure/config/env.schema';
import { validateEncryptionConfig } from '../utils/encryption';
import { validateWorkloadIdentity } from '../infrastructure/secrets/workload-identity';

interface AppConfig {
  /** Server port */
  port: number;
  /** Runtime environment */
  nodeEnv: string;
  /** Whether we're in production */
  isProduction: boolean;
  /** Application version */
  appVersion: string;
  /** Git commit */
  gitCommit: string;
  /** Build timestamp */
  buildTimestamp: string;
  /** Trust proxy config */
  trustProxy: string;

  /** Google OAuth2 credentials */
  google: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };

  /** Encryption key for token storage (32 bytes hex) */
  encryptionKey: string;

  /** Database connection URL */
  databaseUrl: string;
  databaseReplicaUrl?: string;
  /** Least-privilege URLs per role. Fall back to databaseUrl when unset. */
  databaseAppUrl?: string;
  databaseWorkerUrl?: string;
  databaseMigrationUrl?: string;
  databaseTimeout: number;
  databasePoolTimeout: number;
  databaseRole: 'app_runtime' | 'app_worker' | 'app_migration' | 'app_readonly' | 'app_admin';
  databaseAppUser?: string;
  databaseAppPassword?: string;
  /** Read-after-write window (ms) — reads route to primary after a write. */
  databaseStickyReadWindowMs: number;
  /** Container/bootstrap superuser (docker-compose only; never used by app). */
  postgresUser: string;

  /** JWT signing secret */
  jwtSecret: string;
  internalApiKey?: string;

  /** Redis Queue Cluster (BullMQ + job state) */
  redisQueue: {
    host: string;
    port: number;
    password?: string;
    db: number;
    timeout: number;
  };

  /** Redis Ephemeral Cluster (cache + rate-limiting + OAuth state + coordination) */
  redisCache: {
    host: string;
    port: number;
    password?: string;
    db: number;
    timeout: number;
  };

  /**
   * Legacy single-Redis connection — used as fallback when separate
   * REDIS_QUEUE_* / REDIS_CACHE_* env vars are not provided.
   */
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
    timeout: number;
  };

  /** S3 configuration */
  s3: {
    bucket: string;
    region: string;
    endpoint?: string;
    timeout: number;
  };

  /** Malware scanner configuration */
  malware: {
    clamavHost: string;
    clamavPort: number;
    scanTimeoutMs: number;
  };

  /** MinIO configuration (local dev) */
  minio: {
    rootUser: string;
    rootPassword?: string;
    bucket: string;
    endpoint?: string;
  };

  /** Gmail ingestion depth limit */
  ingestionQueueDepthLimit: number;

  /** CORS configuration */
  cors: {
    allowedOrigins: string[];
    allowedMethods: string[];
    allowedHeaders: string[];
    exposedHeaders: string[];
    preflightCache: number;
    credentials: boolean;
  };

  /** Helmet & Security Headers */
  security: {
    hsts: {
      enabled: boolean;
      maxAge: number;
      includeSubdomains: boolean;
      preload: boolean;
    };
    xFrameOptions: 'DENY' | 'SAMEORIGIN';
    referrerPolicy: string;
    permissionsPolicy: string;
    cspDirectives?: string;
    coop: Env['COOP'];
    coep: Env['COEP'];
    corp: Env['CORP'];
  };

  /** Request Limits */
  limits: {
    maxBodySize: string;
    maxJsonSize: string;
    maxUrlLength: number;
    maxQueryParams: number;
    maxMultipartSize: string;
    maxHeaderSize: number;
    requestTimeoutMs: number;
    maxObjectDepth: number;
    maxArraySize: number;
    maxStringLength: number;
  };

  /** Validation configuration */
  validation: {
    stripUnknown: boolean;
    strict: boolean;
  };

  /** HTTP Methods configuration */
  http: {
    allowedMethods: string[];
    methodOverrideEnabled: boolean;
  };

  /** Timeouts */
  timeouts: {
    http: number;
    request: number;
    shutdown: number;
  };

  /** Telemetry */
  telemetry: {
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    metricsEnabled: boolean;
    tracingEnabled: boolean;
    tracingSampler: Env['TRACING_SAMPLER'];
    tracingSamplerRatio: number;
    tracingExporterType: Env['TRACING_EXPORTER_TYPE'];
    otlpEndpoint: string;
  };

  /** Performance thresholds */
  thresholds: {
    slowRequest: number;
    slowQuery: number;
    eventLoopBlocked: number;
  };

  /** PgBouncer config */
  pgbouncer: {
    host?: string;
    port?: number;
  };

  /** KMS config */
  kms: {
    keyId?: string;
    encryptionContext?: string;
    keyVersion: number;
    dekCacheTtlMs: number;
  };

  /** Active crypto backend ('software' | 'kms') */
  cryptoBackend: string;

  /** Redis ACL / TLS */
  redisAcl: {
    username?: string;
    password?: string;
    tlsEnabled: boolean;
    tlsCaPath?: string;
  };

  /** Worker execution settings */
  worker: {
    concurrency: number;
    queues: string;
    shutdownTimeoutMs: number;
    startOnDev: boolean;
  };

  /** Worker service account (k8s workload identity) */
  workerServiceAccount?: string;
}

function validateSecrets(cfg: {
  jwtSecret: string;
  encryptionKey: string;
  nodeEnv: string;
  internalApiKey?: string;
}): void {
  if (cfg.jwtSecret.length < 32) {
    throw new Error(
      `JWT_SECRET must be at least 32 characters long (current: ${cfg.jwtSecret.length}).`,
    );
  }
  const allZeros = /^0+$/.test(cfg.encryptionKey);
  if (allZeros && cfg.nodeEnv === 'production') {
    throw new Error('ENCRYPTION_KEY is set to the all-zeros placeholder value.');
  }
  if (cfg.nodeEnv === 'production' && !cfg.internalApiKey) {
    throw new Error('INTERNAL_API_KEY is required in production.');
  }

  validateEncryptionConfig();
  validateWorkloadIdentity();
}

function validateProductionStorage(cfg: AppConfig): void {
  if (cfg.isProduction && !cfg.s3.bucket) {
    throw new Error(
      'S3_BUCKET is required in production. Durable storage must not fall back to NullStorage in production.',
    );
  }
}

function validateSecurityConfig(cfg: AppConfig): void {
  if (cfg.cors.credentials && cfg.cors.allowedOrigins.includes('*')) {
    throw new Error('CORS: Wildcard origin "*" is not allowed when credentials are enabled.');
  }
}

/**
 * Production database credential guard.
 *
 * Enforces that application processes never connect with a superuser or
 * migration credential:
 *   - DATABASE_URL must use a dedicated application user (never the
 *     POSTGRES superuser, never 'postgres').
 *   - The active role must be a DML role (app_runtime / app_worker) for
 *     API/worker processes. app_migration / app_admin are only valid for
 *     migration jobs and ops tooling.
 *   - If DATABASE_MIGRATION_URL is set, it must use a DIFFERENT user than
 *     the application URL.
 */
function validateProductionDatabaseCredentials(cfg: AppConfig): void {
  if (!cfg.isProduction) return;

  const forbiddenUsers = new Set(['postgres', 'root']);
  if (cfg.postgresUser) {
    forbiddenUsers.add(cfg.postgresUser);
  }

  const url = cfg.databaseAppUrl ?? cfg.databaseUrl;
  let user: string | null = null;
  try {
    user = url ? new URL(url).username : null;
  } catch {
    throw new Error(
      'DATABASE_URL is not a valid PostgreSQL connection URL. Refusing to start in production.',
    );
  }

  if (user && forbiddenUsers.has(user)) {
    throw new Error(
      `Production DATABASE_URL uses the superuser credential '${user}'. ` +
        'Application processes must connect with a dedicated least-privilege ' +
        'role user (e.g. career_terminal_runtime / career_terminal_worker).',
    );
  }

  if (cfg.databaseRole === 'app_migration' || cfg.databaseRole === 'app_admin') {
    throw new Error(
      `Production API/worker processes must not run as '${cfg.databaseRole}'. ` +
        'Use app_runtime (api) or app_worker (worker). Migrations run only in ' +
        'the dedicated migration job with DATABASE_MIGRATION_URL.',
    );
  }

  if (cfg.databaseMigrationUrl) {
    let migrationUser: string | null = null;
    try {
      migrationUser = new URL(cfg.databaseMigrationUrl).username;
    } catch {
      throw new Error('DATABASE_MIGRATION_URL is not a valid PostgreSQL connection URL.');
    }
    if (migrationUser && migrationUser === user) {
      throw new Error(
        'Production DATABASE_MIGRATION_URL must use a DIFFERENT user than the ' +
          'application DATABASE_URL. The application must never share the ' +
          'migration credential.',
      );
    }
  }
}

function loadConfig(): AppConfig {
  const env = parseEnv();

  const cfg: AppConfig = {
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    appVersion: env.APP_VERSION,
    gitCommit: env.GIT_COMMIT,
    buildTimestamp: env.BUILD_TIMESTAMP,
    trustProxy: env.TRUST_PROXY,

    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: env.GOOGLE_REDIRECT_URI,
    },

    encryptionKey: env.ENCRYPTION_KEY,
    databaseUrl: env.DATABASE_URL,
    databaseReplicaUrl: env.DATABASE_REPLICA_URL,
    databaseAppUrl: env.DATABASE_APP_URL,
    databaseWorkerUrl: env.DATABASE_WORKER_URL,
    databaseMigrationUrl: env.DATABASE_MIGRATION_URL,
    databaseTimeout: env.DATABASE_TIMEOUT,
    databasePoolTimeout: env.DATABASE_POOL_TIMEOUT,
    databaseRole: env.DATABASE_ROLE,
    databaseAppUser: env.DATABASE_APP_USER,
    databaseAppPassword: env.DATABASE_APP_PASSWORD,
    databaseStickyReadWindowMs: env.DATABASE_STICKY_READ_WINDOW_MS,
    postgresUser: env.POSTGRES_USER,

    jwtSecret: env.JWT_SECRET,
    internalApiKey: env.INTERNAL_API_KEY,

    // Legacy Redis (queue + cache fallback)
    redis: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD,
      db: env.REDIS_DB,
      timeout: env.REDIS_TIMEOUT,
    },

    // Logical Redis clusters
    redisQueue: {
      host: env.REDIS_QUEUE_HOST,
      port: env.REDIS_QUEUE_PORT,
      password: env.REDIS_QUEUE_PASSWORD,
      db: env.REDIS_QUEUE_DB,
      timeout: env.REDIS_TIMEOUT,
    },
    redisCache: {
      host: env.REDIS_CACHE_HOST ?? env.REDIS_HOST,
      port: env.REDIS_CACHE_PORT ?? env.REDIS_PORT,
      password: env.REDIS_CACHE_PASSWORD ?? env.REDIS_PASSWORD,
      db: env.REDIS_CACHE_DB ?? env.REDIS_DB,
      timeout: env.REDIS_TIMEOUT,
    },

    s3: {
      bucket: env.S3_BUCKET || '',
      region: env.AWS_REGION,
      endpoint: env.AWS_ENDPOINT_URL_S3,
      timeout: env.S3_TIMEOUT,
    },

    malware: {
      clamavHost: env.CLAMAV_HOST,
      clamavPort: env.CLAMAV_PORT,
      scanTimeoutMs: env.CLAMAV_SCAN_TIMEOUT_MS,
    },

    minio: {
      rootUser: env.MINIO_ROOT_USER,
      rootPassword: env.MINIO_ROOT_PASSWORD,
      bucket: env.MINIO_BUCKET,
      endpoint: env.MINIO_ENDPOINT,
    },

    ingestionQueueDepthLimit: env.INGESTION_QUEUE_DEPTH_LIMIT,

    cors: {
      allowedOrigins: env.ALLOWED_ORIGINS
        ? env.ALLOWED_ORIGINS.split(',')
            .map((o) => o.trim())
            .filter(Boolean)
        : [],
      allowedMethods: env.ALLOWED_METHODS.split(',').map((m) => m.trim()),
      allowedHeaders: env.ALLOWED_HEADERS.split(',').map((h) => h.trim()),
      exposedHeaders: env.EXPOSED_HEADERS.split(',').map((h) => h.trim()),
      preflightCache: env.CORS_PREFLIGHT_CACHE,
      credentials: env.CORS_CREDENTIALS,
    },

    security: {
      hsts: {
        enabled: env.HSTS_ENABLED,
        maxAge: env.HSTS_MAX_AGE,
        includeSubdomains: env.HSTS_INCLUDE_SUBDOMAINS,
        preload: env.HSTS_PRELOAD,
      },
      xFrameOptions: env.X_FRAME_OPTIONS,
      referrerPolicy: env.REFERRER_POLICY,
      permissionsPolicy: env.PERMISSIONS_POLICY,
      cspDirectives: env.CSP_DIRECTIVES,
      coop: env.COOP,
      coep: env.COEP,
      corp: env.CORP,
    },

    limits: {
      maxBodySize: env.MAX_BODY_SIZE,
      maxJsonSize: env.MAX_JSON_SIZE,
      maxUrlLength: env.MAX_URL_LENGTH,
      maxQueryParams: env.MAX_QUERY_PARAMS,
      maxMultipartSize: env.MAX_MULTIPART_SIZE,
      maxHeaderSize: env.MAX_HEADER_SIZE,
      requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
      maxObjectDepth: env.MAX_OBJECT_DEPTH,
      maxArraySize: env.MAX_ARRAY_SIZE,
      maxStringLength: env.MAX_STRING_LENGTH,
    },

    validation: {
      stripUnknown: env.VALIDATION_STRIP_UNKNOWN,
      strict: env.VALIDATION_STRICT,
    },

    http: {
      allowedMethods: env.ALLOWED_HTTP_METHODS.split(',').map((m) => m.trim()),
      methodOverrideEnabled: env.HTTP_METHOD_OVERRIDE_ENABLED,
    },

    timeouts: {
      http: env.HTTP_TIMEOUT,
      request: env.REQUEST_TIMEOUT,
      shutdown: env.SHUTDOWN_TIMEOUT,
    },

    telemetry: {
      logLevel: env.LOG_LEVEL,
      metricsEnabled: env.METRICS_ENABLED,
      tracingEnabled: env.TRACING_ENABLED,
      tracingSampler: env.TRACING_SAMPLER,
      tracingSamplerRatio: env.TRACING_SAMPLER_RATIO,
      tracingExporterType: env.TRACING_EXPORTER_TYPE,
      otlpEndpoint: env.OTLP_ENDPOINT,
    },

    thresholds: {
      slowRequest: env.SLOW_REQUEST_THRESHOLD,
      slowQuery: env.SLOW_QUERY_THRESHOLD,
      eventLoopBlocked: env.EVENT_LOOP_BLOCKED_THRESHOLD,
    },

    pgbouncer: {
      host: env.PGBOUNCER_HOST,
      port: env.PGBOUNCER_PORT,
    },

    kms: {
      keyId: env.KMS_KEY_ID,
      encryptionContext: env.AWS_KMS_ENCRYPTION_CONTEXT,
      keyVersion: env.KMS_KEY_VERSION,
      dekCacheTtlMs: env.KMS_DEK_CACHE_TTL_MS,
    },

    cryptoBackend: env.CRYPTO_BACKEND,

    redisAcl: {
      username: env.REDIS_ACL_USERNAME,
      password: env.REDIS_ACL_PASSWORD,
      tlsEnabled: env.REDIS_TLS_ENABLED,
      tlsCaPath: env.REDIS_TLS_CA_PATH,
    },

    worker: {
      concurrency: env.WORKER_CONCURRENCY,
      queues: env.WORKER_QUEUES,
      shutdownTimeoutMs: env.WORKER_SHUTDOWN_TIMEOUT,
      startOnDev: env.NODE_ENV === 'development' || process.env.START_WORKERS === 'true',
    },

    workerServiceAccount: env.WORKER_SERVICE_ACCOUNT,
  };

  validateSecrets(cfg);
  validateSecurityConfig(cfg);
  validateProductionStorage(cfg);
  validateProductionDatabaseCredentials(cfg);
  return cfg;
}

export const config = loadConfig();
