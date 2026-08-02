/**
 * Standardized provider error hierarchy.
 *
 * Every failure a provider (or the provider framework) can raise is typed so
 * callers can branch on semantics instead of string-matching: retryable vs
 * non-retryable, configuration vs network vs storage, etc. `ProviderError`
 * carries structured context (provider key, HTTP status, retry-after) that is
 * safe to log — credentials never appear.
 */

export type ProviderErrorCode =
  | 'PROVIDER_CONFIGURATION_ERROR'
  | 'PROVIDER_AUTHENTICATION_ERROR'
  | 'PROVIDER_NETWORK_ERROR'
  | 'PROVIDER_RATE_LIMIT_ERROR'
  | 'PROVIDER_MALFORMED_RESPONSE_ERROR'
  | 'PROVIDER_STORAGE_ERROR'
  | 'PROVIDER_VALIDATION_ERROR';

export interface ProviderErrorContext {
  providerKey?: string;
  httpStatus?: number;
  retryAfterMs?: number;
  [key: string]: unknown;
}

export interface ProviderErrorOptions {
  providerKey?: string;
  retryable?: boolean;
  context?: ProviderErrorContext;
  cause?: unknown;
}

export abstract class ProviderError extends Error {
  abstract readonly code: ProviderErrorCode;
  abstract readonly retryable: boolean;
  readonly providerKey?: string;
  readonly context: ProviderErrorContext;
  readonly cause?: unknown;

  constructor(message: string, options: ProviderErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.providerKey = options.providerKey;
    this.context = { ...options.context };
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }

  /** Structured, log-safe representation. Credentials are never included. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      providerKey: this.providerKey ?? null,
      context: this.context,
    };
  }
}

export class ProviderConfigurationError extends ProviderError {
  readonly code = 'PROVIDER_CONFIGURATION_ERROR' as const;
  readonly retryable = false;
}

export class ProviderAuthenticationError extends ProviderError {
  readonly code = 'PROVIDER_AUTHENTICATION_ERROR' as const;
  readonly retryable = false;
}

export class ProviderNetworkError extends ProviderError {
  readonly code = 'PROVIDER_NETWORK_ERROR' as const;
  readonly retryable = true;
}

export class ProviderRateLimitError extends ProviderError {
  readonly code = 'PROVIDER_RATE_LIMIT_ERROR' as const;
  readonly retryable = true;

  /** Suggested wait before retrying, when the provider discloses it. */
  readonly retryAfterMs?: number;

  constructor(message: string, options: ProviderErrorOptions & { retryAfterMs?: number } = {}) {
    super(message, options);
    this.retryAfterMs = options.retryAfterMs;
    if (this.retryAfterMs !== undefined) {
      this.context.retryAfterMs = this.retryAfterMs;
    }
  }
}

export class ProviderMalformedResponseError extends ProviderError {
  readonly code = 'PROVIDER_MALFORMED_RESPONSE_ERROR' as const;
  readonly retryable = false;
}

export class ProviderStorageError extends ProviderError {
  readonly code = 'PROVIDER_STORAGE_ERROR' as const;
  readonly retryable = false;
}

export class ProviderValidationError extends ProviderError {
  readonly code = 'PROVIDER_VALIDATION_ERROR' as const;
  readonly retryable = false;
}

export function isProviderError(err: unknown): err is ProviderError {
  return err instanceof ProviderError;
}

/** Message-safe representation of any thrown value. */
export function providerErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Structured, log-safe summary of any thrown value (ProviderError or not). */
export function describeProviderError(err: unknown): {
  code: string;
  retryable: boolean;
  message: string;
  providerKey?: string;
} {
  if (err instanceof ProviderError) {
    return {
      code: err.code,
      retryable: err.retryable,
      message: err.message,
      providerKey: err.providerKey,
    };
  }
  return {
    code: 'UNKNOWN_ERROR',
    retryable: false,
    message: providerErrorMessage(err),
  };
}
