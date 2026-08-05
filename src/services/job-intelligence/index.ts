/**
 * Job Intelligence Layer — barrel export.
 *
 * Identifies job-search-related emails from stored inbox messages using
 * an AI-first extraction pipeline via OpenRouter.
 *
 * Usage:
 *   import { jobEmailClassifier, JobEmailCategory } from '@/services/job-intelligence';
 *
 *   const result = await jobEmailClassifier.classify({
 *     emailId: message.id,
 *     sender: message.sender,
 *     subject: message.subject,
 *     bodyText: message.bodyText,
 *   });
 */

export { JobEmailClassifier, jobEmailClassifier } from './classifier/job-email-classifier';

export {
  JobEmailCategory,
  type ClassifiableEmail,
  type JobEmailClassification,
} from './models/job-intelligence.types';

export {
  JobApplicationExtractor,
  JobApplicationStatus,
  jobApplicationExtractor,
  type JobApplication,
  type JobApplicationCompany,
  type JobApplicationDetails,
  type JobApplicationHiringProcess,
  type JobApplicationRecruiter,
  type JobApplicationRole,
} from '../job-application';
