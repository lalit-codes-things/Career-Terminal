/**
 * Job Intelligence — core type definitions.
 */

/** Job-related email categories. */
export enum JobEmailCategory {
  JOB_APPLICATION = 'Job Application',
  INTERVIEW_INVITATION = 'Interview Invitation',
  REJECTION = 'Rejection',
  OFFER = 'Offer',
  RECRUITER_OUTREACH = 'Recruiter Outreach',
  ASSESSMENT_TEST = 'Assessment/Test',
  NETWORKING = 'Networking',
  CAREER_NEWSLETTER = 'Career Newsletter',
  NOT_JOB_RELATED = 'Not Job Related',
}

/** Stored email shape used as classifier input. */
export interface ClassifiableEmail {
  emailId: string;
  sender: string;
  subject: string;
  bodyText?: string | null;
  bodyHtml?: string | null;
  receivedAt?: Date;
}

/** Classification result returned by JobEmailClassifier. */
export interface JobEmailClassification {
  emailId: string;
  category: JobEmailCategory;
  /** Confidence score between 0 and 1. */
  confidence: number;
  detectedCompany: string | null;
  detectedRole: string | null;
}

/** Internal rule-evaluation result before entity extraction. */
export interface RuleClassificationResult {
  category: JobEmailCategory;
  confidence: number;
  matchedSignals: string[];
}
