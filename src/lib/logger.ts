import { config } from '../config';

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

const currentLevel = LOG_LEVELS[config.telemetry.logLevel];

/**
 * Keys whose values are redacted from log output to prevent credential leakage.
 */
const SENSITIVE_KEYS = new Set([
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'token',
  'bodyText',
  'bodyHtml',
  'email',
  'providerMessageId',
  'providerThreadId',
  'password',
  'secret',
  'authorization',
  'cookie',
  'encryptionKey',
  'encryption_key',
  'apiKey',
  'api_key',
  'internalApiKey',
  'internal_api_key',
  'jwtSecret',
  'jwt_secret',
  'refreshTokenEncrypted',
  'accessTokenEncrypted',
  'stack',
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
  if (LOG_LEVELS[level] < currentLevel) {
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
