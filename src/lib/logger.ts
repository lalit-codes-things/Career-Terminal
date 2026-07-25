/**
 * NOTE: logger.ts must NOT import config at module level.
 *
 * config/index.ts calls validateWorkloadIdentity() during module evaluation,
 * which calls logger before config finishes initializing — a circular
 * dependency that crashes with "Cannot read properties of undefined".
 *
 * Instead, we resolve the log level lazily on the first write() call and
 * cache it. This is safe because:
 *   1. The first real log call always happens after all modules are loaded.
 *   2. The level is constant for the lifetime of the process.
 *   3. Tests that manipulate process.env can still override LOG_LEVEL before
 *      the first log call.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerContext {
  readonly [key: string]: unknown;
  correlationId?: string;
  requestId?: string;
  traceId?: string;
  spanId?: string;
}

export interface Logger {
  debug(message: string, context?: LoggerContext): void;
  info(message: string, context?: LoggerContext): void;
  warn(message: string, context?: LoggerContext): void;
  error(message: string, context?: LoggerContext): void;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Resolve the active log level lazily on first use.
 * Reads LOG_LEVEL from process.env directly (not via config) to break
 * the circular dependency with config/index.ts.
 */
let resolvedLevel: number | null = null;

function getLevel(): number {
  if (resolvedLevel === null) {
    const raw = process.env.LOG_LEVEL as LogLevel | undefined;
    resolvedLevel = LOG_LEVELS[raw ?? 'info'] ?? LOG_LEVELS.info;
  }
  return resolvedLevel;
}

/**
 * Keys whose values are redacted from log output to prevent credential leakage.
 *
 * Epic 0.7: Extended to cover all secret categories identified in Phase 0.
 */
const SENSITIVE_KEYS = new Set([
  // Tokens
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'token',
  'idToken',
  'id_token',
  'bearerToken',
  'bearer_token',
  // OAuth
  'code', // OAuth authorization code
  'clientSecret',
  'client_secret',
  // Email content (PII)
  'bodyText',
  'body_text',
  'bodyHtml',
  'body_html',
  // Identity / contact (PII)
  'email',
  'candidateEmail',
  'candidate_email',
  'recruiterEmail',
  'recruiter_email',
  // Message IDs (could reveal structure)
  'providerMessageId',
  'provider_message_id',
  'providerThreadId',
  'provider_thread_id',
  // Authentication
  'password',
  'secret',
  'authorization',
  'cookie',
  // Encryption / key material
  'encryptionKey',
  'encryption_key',
  'apiKey',
  'api_key',
  'internalApiKey',
  'internal_api_key',
  'jwtSecret',
  'jwt_secret',
  // Stored encrypted values
  'refreshTokenEncrypted',
  'accessTokenEncrypted',
  // Stack traces (may contain file paths / sensitive context)
  'stack',
  // Database credentials
  'databaseUrl',
  'database_url',
  'DATABASE_URL',
  // Redis credentials
  'redisPassword',
  'redis_password',
  'REDIS_PASSWORD',
  // AWS credentials
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'awsSecretAccessKey',
  // Resume content (privacy)
  'resumeText',
  'resume_text',
  'extractedText',
  'extracted_text',
  'parsedContent',
  'parsed_content',
]);

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        SENSITIVE_KEYS.has(key) ? '[REDACTED]' : sanitize(entry),
      ]),
    );
  }

  return value;
}

function write(level: LogLevel, message: string, context?: LoggerContext): void {
  if (LOG_LEVELS[level] < getLevel()) {
    return;
  }

  const payload = context ? sanitize(context) : {};
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(payload as Record<string, unknown>),
  };

  const logString = JSON.stringify(logEntry);

  switch (level) {
    case 'debug':
      console.debug(logString);
      break;
    case 'info':
      console.info(logString);
      break;
    case 'warn':
      console.warn(logString);
      break;
    case 'error':
      console.error(logString);
      break;
  }
}

export const logger: Logger = {
  debug: (message, context) => write('debug', message, context),
  info: (message, context) => write('info', message, context),
  warn: (message, context) => write('warn', message, context),
  error: (message, context) => write('error', message, context),
};
