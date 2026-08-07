/**
 * Gmail Ingestion Command — Explicit async ingestion contract
 *
 * Strongly-typed command for enqueueing Gmail ingestion work.
 * Contains enough information to:
 *   - Identify the user and connection
 *   - Determine ingestion mode
 *   - Track correlation across API → Queue → Worker
 *   - Enforce idempotency
 *   - Apply priority/backpressure controls
 *
 * SECURITY: Never contains raw OAuth tokens or sensitive mailbox data.
 * The worker reconstructs user context from durable state.
 */

export interface GmailIngestionCommand {
  /** The platform user ID requesting ingestion. */
  userId: string;

  /** The UserEmailConnection reference (NOT tokens). */
  connectionId: string;

  /** Ingestion mode: initial historical backfill vs incremental delta. */
  mode: 'INITIAL_SYNC' | 'INCREMENTAL_SYNC';

  /** Correlation ID for tracing across API → Queue → Worker. */
  correlationId: string;

  /** Idempotency key derived from (userId, connectionId, mode, approximate time window). */
  idempotencyKey: string;

  /** Priority level (default: NORMAL). Higher priority for user-triggered syncs. */
  priority?: 'LOW' | 'NORMAL' | 'HIGH';

  /** When the ingestion was requested. */
  requestedAt: Date;

  /** Optional history ID for incremental sync (cursor from last successful sync). */
  startHistoryId?: string;

  /** Optional batch ID if this is part of a larger batch operation. */
  batchId?: string;

  /** Cell routing context */
  cellId?: string;

  /** Legacy user ID for Gmail API calls */
  legacyUserId?: string;

  /** Page token for pagination resumption */
  pageToken?: string;
}

/**
 * ProcessingState — tracks the lifecycle of an ingestion attempt.
 * Must capture all states for observability and recovery.
 */
export type GmailIngestionState =
  'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'PARTIALLY_COMPLETED' | 'FAILED' | 'RETRYING';

/**
 * TelemetryEvent — structured telemetry for ingestion observability.
 */
export interface GmailIngestionTelemetry {
  /** The state transition being recorded. */
  event:
    | 'INGESTION_REQUESTED'
    | 'INGESTION_ENQUEUED'
    | 'INGESTION_STARTED'
    | 'INGESTION_COMPLETED'
    | 'INGESTION_FAILED'
    | 'RETRY_SCHEDULED';

  /** The command being tracked. */
  command: GmailIngestionCommand;

  /** Processing metrics (populated on completion/failure). */
  metrics?: {
    /** How many retries so far. */
    retryCount: number;

    /** Total processing duration in milliseconds. */
    durationMs: number;

    /** Number of messages attempted. */
    messagesAttempted?: number;

    /** Number of messages successfully normalized. */
    messagesNormalized?: number;

    /** Number of messages rejected/skipped. */
    messagesRejected?: number;

    /** Whether backpressure was active. */
    backpressureActive?: boolean;
  };

  /** Error details (on failure). */
  error?: {
    code: string;
    message: string;
    /** Whether this is a retryable error. */
    retryable: boolean;
  };

  /** Timestamp of the event. */
  timestamp: Date;
}

/**
 * FailureClassification — categorizes failures for retry decisions.
 */
export type FailureClassification = {
  /** Whether the failure is retryable. */
  retryable: boolean;

  /** Suggested backoff delay (ms), if retryable. */
  backoffMs?: number;

  /** Error category for observability. */
  category:
    | 'TRANSIENT_API_ERROR'
    | 'NETWORK_ERROR'
    | 'RATE_LIMIT'
    | 'AUTH_REVOKED'
    | 'INVALID_CONNECTION'
    | 'MALFORMED_DATA'
    | 'QUOTA_EXCEEDED'
    | 'UNKNOWN';
};
