/**
 * Custom application error classes.
 *
 * Provides a structured error hierarchy for consistent error handling
 * across the application. Each error carries an HTTP status code and
 * machine-readable error code for API responses.
 */

/**
 * Base application error. All custom errors extend this.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, code: string, isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Thrown when OAuth flow encounters an error.
 * Examples: invalid state parameter, failed token exchange, missing consent.
 */
export class OAuthError extends AppError {
  constructor(message: string, code = 'OAUTH_ERROR') {
    super(message, 401, code);
  }
}

/**
 * Thrown when token operations fail.
 * Examples: expired refresh token, revoked access, failed refresh.
 */
export class TokenError extends AppError {
  constructor(message: string, code = 'TOKEN_ERROR') {
    super(message, 401, code);
  }
}

/**
 * Thrown when Gmail API calls fail.
 * Examples: rate limiting (429), server errors (500), permission denied.
 */
export class GmailApiError extends AppError {
  public readonly gmailErrorCode?: number;

  constructor(message: string, gmailErrorCode?: number) {
    const statusCode = gmailErrorCode === 429 ? 429 : 502;
    super(message, statusCode, 'GMAIL_API_ERROR');
    this.gmailErrorCode = gmailErrorCode;
  }
}

/**
 * Thrown when encryption or decryption operations fail.
 * Examples: corrupted ciphertext, wrong key, tampered data.
 */
export class EncryptionError extends AppError {
  constructor(message: string) {
    super(message, 500, 'ENCRYPTION_ERROR', false);
  }
}

/**
 * Thrown when request validation fails.
 * Examples: missing required fields, invalid format, constraint violations.
 */
export class ValidationError extends AppError {
  public readonly details?: Record<string, string[]>;

  constructor(message: string, details?: Record<string, string[]>) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

/**
 * Thrown when a requested resource is not found.
 */
export class NotFoundError extends AppError {
  constructor(resource: string, identifier: string) {
    super(`${resource} not found: ${identifier}`, 404, 'NOT_FOUND');
  }
}

/**
 * Thrown when a repository query is missing a required partition key.
 * Prevents unbounded full-table scans that would destroy DB performance at scale.
 *
 * @example
 * // Every query on `job_applications` must include `userId`
 * throw new MissingPartitionKeyError('job_applications', 'userId');
 */
export class MissingPartitionKeyError extends AppError {
  constructor(table: string, partitionKey: string) {
    super(
      `Query on "${table}" is missing required partition key: "${partitionKey}". ` +
        `All queries must be scoped to a partition to prevent full-table scans.`,
      500,
      'MISSING_PARTITION_KEY',
      false, // programming error — not user-facing
    );
  }
}
