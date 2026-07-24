/**
 * Job queue payload type definitions.
 *
 * Every job type has a strongly-typed payload so workers and producers
 * share the same contract at compile time.
 */

// ---------------------------------------------------------------------------
// Queue names — one queue per job family
// ---------------------------------------------------------------------------
export const QUEUE_NAMES = {
  EMAIL: 'email',
  RESUME_PARSING: 'resume-parsing',
  APPLICATION_TRACKING: 'application-tracking',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ---------------------------------------------------------------------------
// Email job
// ---------------------------------------------------------------------------

export type EmailJobType = 'SEND_NOTIFICATION' | 'SEND_DIGEST' | 'SEND_STATUS_UPDATE';

export interface EmailJobPayload {
  type: EmailJobType;
  /** Recipient's user id — used to resolve address from DB. */
  userId: string;
  /** Email address override (when userId lookup would be redundant). */
  toAddress?: string;
  subject: string;
  /** Plain-text fallback. */
  bodyText: string;
  /** Optional rich HTML version. */
  bodyHtml?: string;
  /** ISO timestamp — useful for digest deduplication. */
  scheduledAt?: string;
}

// ---------------------------------------------------------------------------
// Resume parsing job
// ---------------------------------------------------------------------------

export interface ResumeParsingJobPayload {
  userId: string;
  /** S3/GCS object key pointing to the uploaded resume file. */
  storageKey: string;
  /** Original filename — preserved for display purposes. */
  originalFilename: string;
  /** MIME type (application/pdf, application/vnd.openxmlformats...). */
  mimeType: string;
  /** SHA-256 hash of the file — pre-computed by the upload handler. */
  fileHash: string;
}

// ---------------------------------------------------------------------------
// Application tracking job
// ---------------------------------------------------------------------------

export type ApplicationTrackingJobType = 'PROCESS_EMAIL' | 'REFRESH_STATUS' | 'SYNC_ATS';

export interface ApplicationTrackingJobPayload {
  type: ApplicationTrackingJobType;
  userId: string;
  /** Present for PROCESS_EMAIL and REFRESH_STATUS jobs. */
  applicationId?: string;
  /** Present for PROCESS_EMAIL jobs — the raw email message id. */
  emailMessageId?: string;
  /** Provider-specific metadata (e.g. Gmail historyId). */
  metadata?: Record<string, unknown>;
}
