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
  databaseTimeout: number;
  databasePoolTimeout: number;

  /** JWT signing secret */
  jwtSecret: string;
  internalApiKey?: string;

  /** Redis connection details */
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
    timeout: number;
  };

  /** AWS S3 configuration */
  s3: {
    bucket: string;
    region: string;
    timeout: number;
  };

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

  // Epic 0.7: validate encryption subsystem (key format, version config)
  // This catches misconfiguration early — before any data is encrypted.
  validateEncryptionConfig();

  // Epic 0.7: validate workload identity (logs warning in production if unset)
  validateWorkloadIdentity();
}

function validateSecurityConfig(cfg: AppConfig): void {
  if (cfg.cors.credentials && cfg.cors.allowedOrigins.includes('*')) {
    throw new Error('CORS: Wildcard origin "*" is not allowed when credentials are enabled.');
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
    databaseTimeout: env.DATABASE_TIMEOUT,
    databasePoolTimeout: env.DATABASE_POOL_TIMEOUT,

    jwtSecret: env.JWT_SECRET,
    internalApiKey: env.INTERNAL_API_KEY,

    redis: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD,
      db: env.REDIS_DB,
      timeout: env.REDIS_TIMEOUT,
    },

    s3: {
      bucket: env.S3_BUCKET || '',
      region: env.AWS_REGION,
      timeout: env.S3_TIMEOUT,
    },

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
  };

  validateSecrets(cfg);
  validateSecurityConfig(cfg);
  return cfg;
}

export const config = loadConfig();
