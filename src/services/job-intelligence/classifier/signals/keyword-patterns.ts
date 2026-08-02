/**
 * Keyword and phrase patterns grouped by job email category.
 * Patterns are matched case-insensitively against subject + body text.
 */
import { JobEmailCategory } from '../../models/job-intelligence.types';

export interface CategoryKeywordRule {
  category: JobEmailCategory;
  /** Higher weight = stronger signal for this category. */
  weight: number;
  patterns: readonly string[];
}

export const CATEGORY_KEYWORD_RULES: readonly CategoryKeywordRule[] = [
  {
    category: JobEmailCategory.OFFER,
    weight: 1.0,
    patterns: [
      'offer letter',
      'pleased to offer',
      'job offer',
      'extend an offer',
      'compensation package',
      'offer of employment',
      'congratulations on your offer',
    ],
  },
  {
    category: JobEmailCategory.REJECTION,
    weight: 0.95,
    patterns: [
      'not moving forward',
      'decided to pursue other candidates',
      'regret to inform',
      'unfortunately',
      'we will not be moving forward',
      'not selected',
      'rejected',
      'unable to offer you a position',
      'chosen another candidate',
      'position has been filled',
    ],
  },
  {
    category: JobEmailCategory.INTERVIEW_INVITATION,
    weight: 0.9,
    patterns: [
      'interview scheduled',
      'schedule an interview',
      'invite you to interview',
      'invited to interview',
      'next round',
      'phone screen',
      'video interview',
      'onsite interview',
      'interview invitation',
      'meet with our team',
      'calendar invite',
    ],
  },
  {
    category: JobEmailCategory.ASSESSMENT_TEST,
    weight: 0.88,
    patterns: [
      'assessment',
      'coding challenge',
      'take-home',
      'take home assignment',
      'technical test',
      'online test',
      'complete the assessment',
      'skills assessment',
      'hackerrank',
      'codility',
      'testgorilla',
      'hirevue',
    ],
  },
  {
    category: JobEmailCategory.JOB_APPLICATION,
    weight: 0.85,
    patterns: [
      'application received',
      'thank you for applying',
      'we received your application',
      'your application has been received',
      'application confirmation',
      'successfully submitted your application',
      'applied for the',
    ],
  },
  {
    category: JobEmailCategory.RECRUITER_OUTREACH,
    weight: 0.8,
    patterns: [
      'recruiter',
      'talent acquisition',
      'hiring for',
      'opportunity at',
      'open role',
      'great fit for',
      'reaching out regarding',
      'exciting opportunity',
      'would you be interested',
      'passive candidate',
    ],
  },
  {
    category: JobEmailCategory.NETWORKING,
    weight: 0.75,
    patterns: [
      'connect on linkedin',
      'coffee chat',
      'networking',
      'referral',
      'informational interview',
      'catch up',
      'introduce you to',
      'professional connection',
    ],
  },
  {
    category: JobEmailCategory.CAREER_NEWSLETTER,
    weight: 0.7,
    patterns: [
      'newsletter',
      'weekly digest',
      'job alerts',
      'career tips',
      'unsubscribe',
      'view in browser',
      'top jobs for you',
      'curated roles',
      'career newsletter',
      'jobs roundup',
    ],
  },
];

/** Sender-context boosts applied when domain/local-part matches job signals. */
export const SENDER_CATEGORY_BOOSTS: Readonly<Partial<Record<JobEmailCategory, number>>> = {
  [JobEmailCategory.JOB_APPLICATION]: 0.15,
  [JobEmailCategory.INTERVIEW_INVITATION]: 0.12,
  [JobEmailCategory.ASSESSMENT_TEST]: 0.12,
  [JobEmailCategory.RECRUITER_OUTREACH]: 0.18,
  [JobEmailCategory.OFFER]: 0.1,
  [JobEmailCategory.REJECTION]: 0.1,
};
