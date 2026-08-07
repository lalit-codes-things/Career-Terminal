/**
 * PII Inventory.
 *
 * Authoritative catalogue of all personally identifiable information (PII)
 * processed by the Career Terminal platform. Used for:
 *   - Data Protection Impact Assessments (DPIA)
 *   - GDPR / CCPA compliance documentation
 *   - Log redaction configuration
 *   - Account deletion scoping
 *   - Encryption-at-rest audit
 *
 * Keep this document in sync with:
 *   - prisma/schema.prisma (DB column names)
 *   - src/lib/logger.ts (SENSITIVE_KEYS)
 *   - src/services/retention/data-retention.service.ts (deleteUserData)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PIISensitivity = 'critical' | 'high' | 'medium' | 'low';
export type LegalBasis = 'consent' | 'contract' | 'legitimate_interest' | 'legal_obligation';
export type RetentionPolicy =
  | 'deleted_on_account_deletion'
  | 'deleted_with_connection'
  | '30_days_after_expiry'
  | '90_days_after_completion'
  | 'server_log_rotation'
  | 'presigned_url_expiry_1h';

export interface PIIField {
  /** Human-readable name for documentation */
  name: string;
  /** Primary DB table and column (schema.prisma reference) */
  dbLocation: string;
  /** All locations where this data lives */
  storageLocations: string[];
  /** How sensitive is this field */
  sensitivity: PIISensitivity;
  /** Why we process this data */
  purpose: string;
  /** Legal basis for processing under GDPR */
  legalBasis: LegalBasis;
  /** How long the data is retained */
  retentionPolicy: RetentionPolicy;
  /** Whether deleteUserData() removes this field */
  deletedOnAccountDeletion: boolean;
  /** Third-party processors that receive this data */
  externalProcessors: string[];
  /** Whether this field is encrypted at rest in DB */
  encryptedAtRest: boolean;
  /** Whether this value must be redacted from application logs */
  mustRedactFromLogs: boolean;
  /** Additional notes for the privacy team */
  notes?: string;
}

// ---------------------------------------------------------------------------
// PII Inventory
// ---------------------------------------------------------------------------

export const PII_INVENTORY: PIIField[] = [
  // ── User Identity ──────────────────────────────────────────────────────────
  {
    name: 'User ID',
    dbLocation: 'user_email_connections.user_id, job_applications.user_id, etc.',
    storageLocations: ['PostgreSQL (multiple tables)', 'Redis (refresh: prefix)', 'JWT sub claim'],
    sensitivity: 'medium',
    purpose: 'Primary user partition key for all data scoping',
    legalBasis: 'contract',
    retentionPolicy: 'deleted_on_account_deletion',
    deletedOnAccountDeletion: true,
    externalProcessors: [],
    encryptedAtRest: false,
    mustRedactFromLogs: false,
    notes: 'UUID — not directly PII but used to link all user data',
  },
  {
    name: 'Gmail Email Address (OAuth connection)',
    dbLocation: 'user_email_connections.email_address',
    storageLocations: ['PostgreSQL: user_email_connections'],
    sensitivity: 'high',
    purpose: 'Gmail account linkage, email ingestion routing',
    legalBasis: 'consent',
    retentionPolicy: 'deleted_on_account_deletion',
    deletedOnAccountDeletion: true,
    externalProcessors: ['Google OAuth2 API'],
    encryptedAtRest: false,
    mustRedactFromLogs: true,
    notes: 'Collected during OAuth consent flow',
  },

  // ── OAuth Tokens ───────────────────────────────────────────────────────────
  {
    name: 'Gmail OAuth Access Token (encrypted)',
    dbLocation: 'user_email_connections.access_token_encrypted',
    storageLocations: ['PostgreSQL: user_email_connections (AES-256-GCM encrypted)'],
    sensitivity: 'critical',
    purpose: 'Authorize Gmail API calls on behalf of the user',
    legalBasis: 'consent',
    retentionPolicy: 'deleted_with_connection',
    deletedOnAccountDeletion: true,
    externalProcessors: ['Google Gmail API'],
    encryptedAtRest: true,
    mustRedactFromLogs: true,
    notes: 'Short-lived (~1h). Encrypted with ENCRYPTION_KEY (AES-256-GCM versioned envelope).',
  },
  {
    name: 'Gmail OAuth Refresh Token (encrypted)',
    dbLocation: 'user_email_connections.refresh_token_encrypted',
    storageLocations: ['PostgreSQL: user_email_connections (AES-256-GCM encrypted)'],
    sensitivity: 'critical',
    purpose: 'Obtain fresh access tokens without re-consent',
    legalBasis: 'consent',
    retentionPolicy: 'deleted_with_connection',
    deletedOnAccountDeletion: true,
    externalProcessors: ['Google OAuth2 token endpoint'],
    encryptedAtRest: true,
    mustRedactFromLogs: true,
    notes: 'Long-lived. Must be revoked via Google API on connection deletion.',
  },

  // ── Application JWT / Session ──────────────────────────────────────────────
  {
    name: 'JWT Access Token',
    dbLocation: 'N/A (stateless — not stored in DB)',
    storageLocations: ['Client memory / httpOnly cookie', 'In-flight HTTP headers'],
    sensitivity: 'critical',
    purpose: 'Stateless API authentication (15-min TTL)',
    legalBasis: 'contract',
    retentionPolicy: 'presigned_url_expiry_1h',
    deletedOnAccountDeletion: false,
    externalProcessors: [],
    encryptedAtRest: false,
    mustRedactFromLogs: true,
    notes: 'HS256, 15-min TTL. Not stored — expires by design.',
  },
  {
    name: 'Opaque Refresh Token',
    dbLocation: 'N/A (Redis: refresh:{userId}:{tokenId})',
    storageLocations: ['Redis (refresh: key prefix, 7-day TTL)'],
    sensitivity: 'critical',
    purpose: 'Issue new JWT access tokens after expiry',
    legalBasis: 'contract',
    retentionPolicy: 'deleted_on_account_deletion',
    deletedOnAccountDeletion: true,
    externalProcessors: [],
    encryptedAtRest: false,
    mustRedactFromLogs: true,
    notes:
      'revokeAllRefreshTokens() deletes all redis:refresh:{userId}:* keys on account deletion.',
  },

  // ── Email Content ──────────────────────────────────────────────────────────
  {
    name: 'Email Body Text',
    dbLocation: 'email_messages.body_text',
    storageLocations: ['PostgreSQL: email_messages'],
    sensitivity: 'high',
    purpose: 'Job application status classification from email content',
    legalBasis: 'consent',
    retentionPolicy: 'deleted_on_account_deletion',
    deletedOnAccountDeletion: true,
    externalProcessors: [],
    encryptedAtRest: false,
    mustRedactFromLogs: true,
    notes: 'Not sent to external AI. Stored for classification only.',
  },
  {
    name: 'Email Body HTML',
    dbLocation: 'email_messages.body_html',
    storageLocations: ['PostgreSQL: email_messages'],
    sensitivity: 'high',
    purpose: 'Job application status classification from email content',
    legalBasis: 'consent',
    retentionPolicy: 'deleted_on_account_deletion',
    deletedOnAccountDeletion: true,
    externalProcessors: [],
    encryptedAtRest: false,
    mustRedactFromLogs: true,
    notes: 'Not sent to external AI. Stored for classification only.',
  },
  {
    name: 'Email Sender',
    dbLocation: 'email_messages.sender',
    storageLocations: ['PostgreSQL: email_messages'],
    sensitivity: 'medium',
    purpose: 'Recruiter identification and application matching',
    legalBasis: 'legitimate_interest',
    retentionPolicy: 'deleted_on_account_deletion',
    deletedOnAccountDeletion: true,
    externalProcessors: [],
    encryptedAtRest: false,
    mustRedactFromLogs: false,
  },
  {
    name: 'Email Recipients',
    dbLocation: 'email_messages.recipients (JSON)',
    storageLocations: ['PostgreSQL: email_messages'],
    sensitivity: 'medium',
    purpose: 'Email thread participant tracking',
    legalBasis: 'legitimate_interest',
    retentionPolicy: 'deleted_on_account_deletion',
    deletedOnAccountDeletion: true,
    externalProcessors: [],
    encryptedAtRest: false,
    mustRedactFromLogs: false,
  },
  {
    name: 'Email Subject',
    dbLocation: 'email_messages.subject',
    storageLocations: ['PostgreSQL: email_messages'],
    sensitivity: 'medium',
    purpose: 'Job title and company extraction for application tracking',
    legalBasis: 'consent',
    retentionPolicy: 'deleted_on_account_deletion',
    deletedOnAccountDeletion: true,
    externalProcessors: [],
    encryptedAtRest: false,
    mustRedactFromLogs: false,
  },

  // ── Job Application Data ───────────────────────────────────────────────────
  {
    name: 'Candidate Email',
    dbLocation: 'job_applications.candidate_email',
    storageLocations: ['PostgreSQL: job_applications'],
    sensitivity: 'high',
    purpose: "User's own email address for application context",
    legalBasis: 'contract',
    retentionPolicy: 'deleted_on_account_deletion',
    deletedOnAccountDeletion: true,
    externalProcessors: [],
    encryptedAtRest: false,
    mustRedactFromLogs: true,
  },
  {
    name: 'Recruiter Name',
    dbLocation: 'recruiters.name, job_applications.recruiter_name',
    storageLocations: ['PostgreSQL: recruiters, job_applications'],
    sensitivity: 'medium',
    purpose: 'Recruiter relationship tracking',
    legalBasis: 'legitimate_interest',
    retentionPolicy: 'deleted_on_account_deletion',
    deletedOnAccountDeletion: true,
    externalProcessors: [],
    encryptedAtRest: false,
    mustRedactFromLogs: false,
    notes: 'Third-party professional — legitimate interest basis applies.',
  },
  {
    name: 'Recruiter Email',
    dbLocation: 'recruiters.email, job_applications.recruiter_email',
    storageLocations: ['PostgreSQL: recruiters, job_applications'],
    sensitivity: 'high',
    purpose: 'Recruiter identification and deduplication',
    legalBasis: 'legitimate_interest',
    retentionPolicy: 'deleted_on_account_deletion',
    deletedOnAccountDeletion: true,
    externalProcessors: [],
    encryptedAtRest: false,
    mustRedactFromLogs: true,
  },

  // ── Resume / CV ────────────────────────────────────────────────────────────
  {
    name: 'Resume File (S3 object)',
    dbLocation: 'resume_hashes.storage_key (S3 key reference)',
    storageLocations: ['S3/MinIO bucket (private)', 'PostgreSQL: resume_hashes (metadata)'],
    sensitivity: 'high',
    purpose: 'Resume parsing and job description matching',
    legalBasis: 'contract',
    retentionPolicy: 'deleted_on_account_deletion',
    deletedOnAccountDeletion: true,
    externalProcessors: [],
    encryptedAtRest: false,
    mustRedactFromLogs: false,
    notes:
      'S3 object deleted only when last UserResume reference removed (SHA-256 dedup). Private bucket — presigned URLs (1h TTL) for access.',
  },
  {
    name: 'Resume Filename',
    dbLocation: 'user_resumes.original_name',
    storageLocations: ['PostgreSQL: user_resumes'],
    sensitivity: 'low',
    purpose: 'Display original filename to user',
    legalBasis: 'contract',
    retentionPolicy: 'deleted_on_account_deletion',
    deletedOnAccountDeletion: true,
    externalProcessors: [],
    encryptedAtRest: false,
    mustRedactFromLogs: false,
  },

  // ── Application History ────────────────────────────────────────────────────
  {
    name: 'Job Application History',
    dbLocation: 'job_applications (full table)',
    storageLocations: [
      'PostgreSQL: job_applications, application_timeline, application_status_history',
    ],
    sensitivity: 'medium',
    purpose: 'Core product feature — tracking job search progress',
    legalBasis: 'contract',
    retentionPolicy: 'deleted_on_account_deletion',
    deletedOnAccountDeletion: true,
    externalProcessors: [],
    encryptedAtRest: false,
    mustRedactFromLogs: false,
  },

  // ── Infrastructure / Logs ──────────────────────────────────────────────────
  {
    name: 'IP Address in Logs',
    dbLocation: 'N/A (server access logs only)',
    storageLocations: ['Application logs (structured JSON)', 'Reverse proxy access logs'],
    sensitivity: 'low',
    purpose: 'Rate limiting, abuse detection, security audit trail',
    legalBasis: 'legitimate_interest',
    retentionPolicy: 'server_log_rotation',
    deletedOnAccountDeletion: false,
    externalProcessors: [],
    encryptedAtRest: false,
    mustRedactFromLogs: false,
    notes:
      'Log retention controlled by infrastructure log rotation policy. Not linked to userId in logs.',
  },
];

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Returns PII fields that must be redacted from application logs.
 * Source of truth for lib/logger.ts SENSITIVE_KEYS set.
 */
export function getLogRedactionFields(): PIIField[] {
  return PII_INVENTORY.filter((field) => field.mustRedactFromLogs);
}

/**
 * Returns all PII fields that are deleted when a user account is deleted.
 * Cross-reference with deleteUserData() in data-retention.service.ts.
 */
export function getDeletionScopeFields(): PIIField[] {
  return PII_INVENTORY.filter((field) => field.deletedOnAccountDeletion);
}

/**
 * Returns PII fields classified as 'critical' sensitivity.
 * These require the highest protection controls (encryption, access auditing).
 */
export function getCriticalFields(): PIIField[] {
  return PII_INVENTORY.filter((field) => field.sensitivity === 'critical');
}

/**
 * Returns PII fields that are encrypted at rest in the database.
 * These use AES-256-GCM via encryptToken() / decryptToken().
 */
export function getEncryptedFields(): PIIField[] {
  return PII_INVENTORY.filter((field) => field.encryptedAtRest);
}
