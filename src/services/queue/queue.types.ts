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
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ---------------------------------------------------------------------------
// Base job payload (Epic 4 Prompt 5)
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
