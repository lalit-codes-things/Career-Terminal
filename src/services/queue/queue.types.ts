/**
 * Job queue payload type definitions.
 *
 * Every job type has a strongly-typed payload so workers and producers
 * share the same contract at compile time, and schemas for runtime validation.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Queue names — one queue per job family
// ---------------------------------------------------------------------------
export const QUEUE_NAMES = {
  EMAIL: 'email',
  RESUME_PARSING: 'resume-parsing',
  APPLICATION_TRACKING: 'application-tracking',
  MALWARE_SCAN: 'malware-scan',
  INTELLIGENCE: 'intelligence',
  GMAIL_SYNC: 'gmail-sync',
  ECONOMIC_DOCUMENT: 'economic-document',
  INTERVIEW_SESSION: 'interview-session',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ---------------------------------------------------------------------------
// Base job payload
// ---------------------------------------------------------------------------

export const BaseJobPayloadSchema = z.object({
  correlationId: z.string().optional(), // Links across API, Event, Queue, Worker
  eventId: z.string().uuid().optional(), // Durable event ID that triggered this job
});
export type BaseJobPayload = z.infer<typeof BaseJobPayloadSchema>;

// ---------------------------------------------------------------------------
// Email job
// ---------------------------------------------------------------------------

export const EmailJobTypeSchema = z.enum([
  'SEND_NOTIFICATION',
  'SEND_DIGEST',
  'SEND_STATUS_UPDATE',
]);
export type EmailJobType = z.infer<typeof EmailJobTypeSchema>;

export const EmailJobPayloadSchema = BaseJobPayloadSchema.extend({
  type: EmailJobTypeSchema,
  userId: z.string().min(1),
  cellId: z.string().min(1).optional(),
  toAddress: z.string().email().optional(),
  subject: z.string(),
  bodyText: z.string(),
  bodyHtml: z.string().optional(),
  scheduledAt: z.string().datetime().optional(),
});
export type EmailJobPayload = z.infer<typeof EmailJobPayloadSchema>;

// ---------------------------------------------------------------------------
// Resume parsing job
// ---------------------------------------------------------------------------

export const ResumeParsingJobPayloadSchema = BaseJobPayloadSchema.extend({
  userId: z.string().min(1),
  cellId: z.string().min(1).optional(),
  storageKey: z.string().min(1),
  originalFilename: z.string().min(1),
  mimeType: z.string().min(1),
  fileHash: z.string().min(1),
});
export type ResumeParsingJobPayload = z.infer<typeof ResumeParsingJobPayloadSchema>;

export const MalwareScanJobPayloadSchema = BaseJobPayloadSchema.extend({
  userId: z.string().min(1),
  cellId: z.string().min(1).optional(),
  userResumeId: z.string().min(1),
  quarantineBucket: z.string().min(1),
  quarantineKey: z.string().min(1),
  cleanBucket: z.string().min(1),
  cleanKey: z.string().min(1),
  originalFilename: z.string().min(1),
  mimeType: z.string().min(1),
  fileHash: z.string().min(1),
});
export type MalwareScanJobPayload = z.infer<typeof MalwareScanJobPayloadSchema>;

// ---------------------------------------------------------------------------
// Application tracking job
// ---------------------------------------------------------------------------

export const ApplicationTrackingJobTypeSchema = z.enum([
  'PROCESS_EMAIL',
  'REFRESH_STATUS',
  'SYNC_ATS',
]);
export type ApplicationTrackingJobType = z.infer<typeof ApplicationTrackingJobTypeSchema>;

export const ApplicationTrackingJobPayloadSchema = BaseJobPayloadSchema.extend({
  type: ApplicationTrackingJobTypeSchema,
  userId: z.string().min(1),
  cellId: z.string().min(1).optional(),
  applicationId: z.string().min(1).optional(),
  emailMessageId: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type ApplicationTrackingJobPayload = z.infer<typeof ApplicationTrackingJobPayloadSchema>;

export const IntelligenceJobTypeSchema = z.enum([
  'GENERATE_EMBEDDING',
  'MATCH_RESUME',
  'MATCH_SKILLS',
  'GENERATE_RECOMMENDATION',
  'GENERATE_PREDICTION',
]);
export type IntelligenceJobType = z.infer<typeof IntelligenceJobTypeSchema>;

export const IntelligenceJobPayloadSchema = BaseJobPayloadSchema.extend({
  type: IntelligenceJobTypeSchema,
  userId: z.string().min(1),
  cellId: z.string().min(1).optional(),
  targetId: z.string().min(1).optional(),
  targetType: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type IntelligenceJobPayload = z.infer<typeof IntelligenceJobPayloadSchema>;

// ---------------------------------------------------------------------------
// Gmail sync job (BullMQ-backed authoritative scheduler)
// ---------------------------------------------------------------------------

export const GmailSyncJobTypeSchema = z.enum(['GMAIL_INITIAL_SYNC', 'GMAIL_INCREMENTAL_SYNC']);
export type GmailSyncJobType = z.infer<typeof GmailSyncJobTypeSchema>;

export const GmailSyncJobPayloadSchema = BaseJobPayloadSchema.extend({
  type: GmailSyncJobTypeSchema,
  userId: z.string().min(1),
  cellId: z.string().min(1).optional(),
  legacyUserId: z.string().min(1),
  connectionId: z.string().min(1),
  historyId: z.string().min(1).optional(),
  pageToken: z.string().optional(),
  priority: z.number().int().min(0).max(10).optional(),
});
export type GmailSyncJobPayload = z.infer<typeof GmailSyncJobPayloadSchema>;

// ---------------------------------------------------------------------------
// Economic document job
// ---------------------------------------------------------------------------

export const EconomicDocumentJobTypeSchema = z.enum([
  'EXTRACT_ECONOMIC_DOCUMENT',
  'INFER_ECONOMIC_SIGNALS',
]);
export type EconomicDocumentJobType = z.infer<typeof EconomicDocumentJobTypeSchema>;

export const EconomicDocumentJobPayloadSchema = BaseJobPayloadSchema.extend({
  type: EconomicDocumentJobTypeSchema,
  userId: z.string().min(1),
  cellId: z.string().min(1).optional(),
  documentId: z.string().min(1),
  documentType: z.string().min(1),
  documentCategory: z.string().min(1),
  s3Key: z.string().min(1),
  mimeType: z.string().min(1),
  originalFilename: z.string().min(1),
  content: z.string(),
  sourceName: z.string().optional(),
  sourceUri: z.string().optional(),
  currency: z.string().optional(),
  locale: z.string().optional(),
  validFrom: z.string().datetime().optional(),
  validTo: z.string().datetime().optional(),
  transactionStart: z.string().datetime().optional(),
  transactionEnd: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type EconomicDocumentJobPayload = z.infer<typeof EconomicDocumentJobPayloadSchema>;

// ---------------------------------------------------------------------------
// Interview session job
// ---------------------------------------------------------------------------

export const InterviewSessionJobTypeSchema = z.enum(['EXTRACT_INTERVIEW_SESSION']);
export type InterviewSessionJobType = z.infer<typeof InterviewSessionJobTypeSchema>;

export const InterviewSessionJobPayloadSchema = BaseJobPayloadSchema.extend({
  type: InterviewSessionJobTypeSchema,
  userId: z.string().min(1),
  sessionId: z.string().min(1),
  sourceType: z.string().min(1),
  s3Key: z.string().optional(),
  mimeType: z.string().optional(),
  originalFilename: z.string().optional(),
  content: z.string(),
  canonicalCompanyId: z.string().optional(),
  companyNameRaw: z.string().optional(),
  roleTitle: z.string().optional(),
  loopType: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type InterviewSessionJobPayload = z.infer<typeof InterviewSessionJobPayloadSchema>;
