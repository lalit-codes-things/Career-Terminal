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
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ---------------------------------------------------------------------------
// Email job
// ---------------------------------------------------------------------------

export const EmailJobTypeSchema = z.enum([
  'SEND_NOTIFICATION',
  'SEND_DIGEST',
  'SEND_STATUS_UPDATE',
]);
export type EmailJobType = z.infer<typeof EmailJobTypeSchema>;

export const EmailJobPayloadSchema = z.object({
  type: EmailJobTypeSchema,
  userId: z.string().min(1),
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

export const ResumeParsingJobPayloadSchema = z.object({
  userId: z.string().min(1),
  storageKey: z.string().min(1),
  originalFilename: z.string().min(1),
  mimeType: z.string().min(1),
  fileHash: z.string().min(1),
});
export type ResumeParsingJobPayload = z.infer<typeof ResumeParsingJobPayloadSchema>;

// ---------------------------------------------------------------------------
// Application tracking job
// ---------------------------------------------------------------------------

export const ApplicationTrackingJobTypeSchema = z.enum([
  'PROCESS_EMAIL',
  'REFRESH_STATUS',
  'SYNC_ATS',
]);
export type ApplicationTrackingJobType = z.infer<typeof ApplicationTrackingJobTypeSchema>;

export const ApplicationTrackingJobPayloadSchema = z.object({
  type: ApplicationTrackingJobTypeSchema,
  userId: z.string().min(1),
  applicationId: z.string().min(1).optional(),
  emailMessageId: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type ApplicationTrackingJobPayload = z.infer<typeof ApplicationTrackingJobPayloadSchema>;
