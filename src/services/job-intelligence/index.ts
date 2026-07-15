/**
 * Job Intelligence Layer — barrel export.
 *
 * Identifies job-search-related emails from stored inbox messages using
 * a hybrid rules-first architecture with an optional ML fallback.
 *
 * Usage:
 *   import { jobEmailClassifier, JobEmailCategory } from '@/services/job-intelligence';
 *
 *   const result = jobEmailClassifier.classify({
 *     emailId: message.id,
 *     sender: message.sender,
 *     subject: message.subject,
 *     bodyText: message.bodyText,
 *   });
 */

export {
  JobEmailClassifier,
  jobEmailClassifier,
  type JobEmailClassifierOptions,
} from './classifier/job-email-classifier';

export {
  RuleBasedJobEmailClassifier,
  ruleBasedJobEmailClassifier,
} from './classifier/rule-based-classifier';

export type { JobEmailMlModel } from './classifier/ml-model.interface';

export {
  JobEmailCategory,
  type ClassifiableEmail,
  type JobEmailClassification,
  type RuleClassificationResult,
} from './models/job-intelligence.types';

export { extractCompany } from './classifier/extractors/company.extractor';
export { extractRole } from './classifier/extractors/role.extractor';

export { ATS_PLATFORM_DOMAINS, isAtsPlatformDomain } from './classifier/signals/ats-platforms';

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
