import { randomUUID } from 'crypto';
import type { ExtractionInput } from '../../recruiter-intelligence/ai/types';
import { pipeline } from '../../recruiter-intelligence/ai/pipeline.factory';
import {
  type ClassifiableEmail,
  type JobEmailClassification,
  JobEmailCategory,
} from '../models/job-intelligence.types';

export class JobEmailClassifier {
  async classify(email: ClassifiableEmail): Promise<JobEmailClassification> {
    const input: ExtractionInput = {
      extractionId: randomUUID(),
      tenantId: 'default',
      sourceType: 'email',
      sourceId: email.emailId,
      content: email.bodyText ?? email.bodyHtml ?? '',
      metadata: { emailId: email.emailId, sender: email.sender },
      requestedAt: new Date(),
    };

    const variables: Record<string, string> = {
      emailId: email.emailId,
      sender: email.sender,
      subject: email.subject,
      receivedAt: email.receivedAt ? email.receivedAt.toISOString() : '',
      content: input.content,
    };

    const output = await pipeline.extract('job-email-classification', input, variables);

    const categoryField = output.fields.find((f) => f.field === 'category');
    const companyField = output.fields.find((f) => f.field === 'company');
    const roleField = output.fields.find((f) => f.field === 'role');

    const category = this.normalizeCategory(categoryField?.value ?? '');
    const detectedCompany = this.normalizeString(companyField?.value);
    const detectedRole = this.normalizeString(roleField?.value);

    return {
      emailId: email.emailId,
      category,
      confidence: output.overallConfidence,
      detectedCompany,
      detectedRole,
      evidence: output.evidence,
      provenance: output.provenance,
    };
  }

  private normalizeCategory(raw: unknown): JobEmailCategory {
    const categoryMap: Record<string, JobEmailCategory> = {
      'Job Application': JobEmailCategory.JOB_APPLICATION,
      'Interview Invitation': JobEmailCategory.INTERVIEW_INVITATION,
      'Rejection': JobEmailCategory.REJECTION,
      'Offer': JobEmailCategory.OFFER,
      'Recruiter Outreach': JobEmailCategory.RECRUITER_OUTREACH,
      'Assessment/Test': JobEmailCategory.ASSESSMENT_TEST,
      'Networking': JobEmailCategory.NETWORKING,
      'Career Newsletter': JobEmailCategory.CAREER_NEWSLETTER,
      'Not Job Related': JobEmailCategory.NOT_JOB_RELATED,
    };

    if (typeof raw === 'string') {
      return categoryMap[raw] ?? JobEmailCategory.NOT_JOB_RELATED;
    }
    return JobEmailCategory.NOT_JOB_RELATED;
  }

  private normalizeString(value: unknown): string | null {
    if (typeof value !== 'string' || value === '' || value === undefined || value === null) {
      return null;
    }
    return value.trim();
  }
}

export const jobEmailClassifier = new JobEmailClassifier();
