import type {
  ClassifiableEmail,
  JobEmailClassification,
} from '../job-intelligence/models/job-intelligence.types';
import { JobEmailCategory } from '../job-intelligence/models/job-intelligence.types';
import { ApplicationStatus } from '../../domain/application-status';

export { ApplicationStatus as JobApplicationStatus };

export interface JobApplicationCompany {
  readonly name: string;
  readonly domain: string;
}

export interface JobApplicationRole {
  readonly title: string;
  readonly department: string;
}

export interface JobApplicationDetails {
  readonly applicationDate: Date;
  readonly location: string;
  readonly employmentType: string;
}

export interface JobApplicationHiringProcess {
  readonly currentStage: string;
  readonly interviewRounds: number;
  readonly deadlines: readonly string[];
}

export interface JobApplicationRecruiter {
  readonly name: string;
  readonly email: string;
}

export interface JobApplication {
  readonly id: string;
  readonly userId: string;
  readonly company: JobApplicationCompany;
  readonly role: JobApplicationRole;
  readonly status: ApplicationStatus;
  readonly appliedDate: Date;
  readonly recruiter: JobApplicationRecruiter;
  readonly sourceEmailId: string;
  readonly details: JobApplicationDetails;
  readonly hiringProcess: JobApplicationHiringProcess;
}

export class JobApplicationExtractor {
  public extract(
    email: ClassifiableEmail,
    userId: string,
    classification: JobEmailClassification,
  ): JobApplication {
    const companyName = this.extractCompanyName(classification.detectedCompany, email.sender);
    const companyDomain = this.extractCompanyDomain(companyName, email.sender);
    const roleTitle = this.extractRoleTitle(classification.detectedRole, email.subject);
    const department = this.extractDepartment(email.bodyText ?? '', roleTitle, email.subject);
    const status = this.mapStatus(classification.category);
    const recruiter = this.extractRecruiter(email);
    const appliedDate = this.extractAppliedDate(email.bodyText ?? '', email.receivedAt);
    const location = this.extractLocation(email.bodyText ?? '', email.subject);
    const employmentType = this.extractEmploymentType(email.bodyText ?? '', email.subject);
    const deadlines = this.extractDeadlines(email.bodyText ?? '');
    const interviewRounds = this.extractInterviewRounds(
      email.bodyText ?? '',
      classification.category,
    );
    const currentStage = this.extractCurrentStage(status, classification.category);

    return {
      id: this.buildId(userId, companyName, roleTitle),
      userId,
      company: {
        name: companyName,
        domain: companyDomain,
      },
      role: {
        title: roleTitle,
        department,
      },
      status,
      appliedDate,
      recruiter,
      sourceEmailId: email.emailId,
      details: {
        applicationDate: appliedDate,
        location,
        employmentType,
      },
      hiringProcess: {
        currentStage,
        interviewRounds,
        deadlines,
      },
    };
  }

  private buildId(userId: string, companyName: string, roleTitle: string): string {
    const slug = `${companyName}-${roleTitle}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `${userId}:${slug}`;
  }

  private extractCompanyName(detectedCompany: string | null, sender: string): string {
    if (detectedCompany && detectedCompany.trim().length > 0) {
      return detectedCompany.trim();
    }

    const domain = this.extractDomain(sender);
    return domain ? this.formatDomainLabel(domain) : 'Unknown Company';
  }

  private extractCompanyDomain(companyName: string, sender: string): string {
    const domain = this.extractDomain(sender);
    if (domain) {
      return domain;
    }

    return companyName.toLowerCase().replace(/\s+/g, '') + '.com';
  }

  private extractRoleTitle(detectedRole: string | null, subject: string): string {
    if (detectedRole && detectedRole.trim().length > 0) {
      return detectedRole.trim();
    }

    const match = /for\s+(.+?)(?:\s+-|\s*\||:|$)/i.exec(subject);
    if (match?.[1]) {
      return match[1].trim();
    }

    return 'Unknown Role';
  }

  private extractDepartment(text: string, roleTitle: string, subject: string): string {
    const patterns: ReadonlyArray<RegExp> = [
      /for the\s+([A-Za-z\s]+)\s+team/i,
      /department\s+([A-Za-z\s]+?)(?:\.|,|;|$)/i,
      /(?:engineering|product|design|sales|marketing|hr|operations|finance|legal|people)/i,
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(`${subject} ${text}`);
      if (match?.[1]) {
        return this.capitalize(match[1].trim());
      }
      if (match?.[0]) {
        return this.capitalize(match[0].trim());
      }
    }

    return roleTitle.includes('Engineer') ? 'Engineering' : 'General';
  }

  private extractRecruiter(email: ClassifiableEmail): JobApplicationRecruiter {
    const body = email.bodyText ?? '';
    const senderEmail =
      this.extractEmailFromText(body) ?? this.extractEmailFromSender(email.sender);
    const senderName = this.extractNameFromText(body, senderEmail ?? email.sender);
    const inferredEmail = this.inferRecruiterEmail(senderName, senderEmail, email.sender);

    return {
      name: senderName ?? 'Recruiter',
      email: inferredEmail ?? 'unknown@unknown.com',
    };
  }

  private extractAppliedDate(text: string, fallbackDate: Date | undefined): Date {
    const datePattern = /(\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/;
    const match = datePattern.exec(text);
    if (match?.[1]) {
      const parsed = new Date(match[1]);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    return fallbackDate ?? new Date();
  }

  private extractLocation(text: string, subject: string): string {
    const searchText = `${subject} ${text}`;
    const locationPatterns: ReadonlyArray<RegExp> = [
      /in\s+([A-Za-z\s]+?)(?:\.|,|;|$)/i,
      /remote/i,
      /hybrid/i,
      /on-site/i,
    ];

    for (const pattern of locationPatterns) {
      const match = pattern.exec(searchText);
      if (match?.[1]) {
        return this.capitalize(match[1].trim());
      }
      if (match?.[0]) {
        return this.capitalize(match[0].trim());
      }
    }

    return 'Remote';
  }

  private extractEmploymentType(text: string, subject: string): string {
    const searchText = `${subject} ${text}`;
    if (/full[- ]time/i.test(searchText)) {
      return 'Full-time';
    }
    if (/part[- ]time/i.test(searchText)) {
      return 'Part-time';
    }
    if (/contract/i.test(searchText)) {
      return 'Contract';
    }
    return 'Full-time';
  }

  private extractDeadlines(text: string): readonly string[] {
    const matches =
      text.match(/(?:by|before)\s+([A-Za-z0-9,\s]+(?:\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4}))/gi) ?? [];
    return matches.map((value) => value.trim());
  }

  private extractInterviewRounds(text: string, category: JobEmailCategory): number {
    const roundMatch = /round\s+(\d+)/i.exec(text);
    if (roundMatch?.[1]) {
      return Number.parseInt(roundMatch[1], 10);
    }

    const secondRoundMatch = /second\s+round|round\s+2/i.test(text);
    if (secondRoundMatch) {
      return 2;
    }

    if (category === JobEmailCategory.INTERVIEW_INVITATION) {
      return 1;
    }

    return 0;
  }

  private extractCurrentStage(status: ApplicationStatus, category: JobEmailCategory): string {
    if (status === ApplicationStatus.INTERVIEW) {
      return 'Interview';
    }
    if (status === ApplicationStatus.ASSESSMENT) {
      return 'Assessment';
    }
    if (category === JobEmailCategory.REJECTION) {
      return 'Rejected';
    }
    return 'Applied';
  }

  private mapStatus(category: JobEmailCategory): ApplicationStatus {
    switch (category) {
      case JobEmailCategory.JOB_APPLICATION:
        return ApplicationStatus.APPLIED;
      case JobEmailCategory.INTERVIEW_INVITATION:
        return ApplicationStatus.INTERVIEW;
      case JobEmailCategory.ASSESSMENT_TEST:
        return ApplicationStatus.ASSESSMENT;
      case JobEmailCategory.OFFER:
        return ApplicationStatus.OFFER;
      case JobEmailCategory.REJECTION:
        return ApplicationStatus.REJECTED;
      case JobEmailCategory.RECRUITER_OUTREACH:
        return ApplicationStatus.SAVED;
      case JobEmailCategory.NETWORKING:
        return ApplicationStatus.SAVED;
      case JobEmailCategory.CAREER_NEWSLETTER:
        return ApplicationStatus.SAVED;
      case JobEmailCategory.NOT_JOB_RELATED:
        return ApplicationStatus.SAVED;
      default:
        return ApplicationStatus.SAVED;
    }
  }

  private extractDomain(sender: string): string | null {
    const match = /@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$/i.exec(sender);
    return match?.[1] ?? null;
  }

  private formatDomainLabel(domain: string): string {
    const withoutTld = domain.split('.').slice(0, -1).join(' ');
    return withoutTld.replace(/\b\w/g, (char: string) => char.toUpperCase());
  }

  private extractNameFromText(text: string, sender: string): string | null {
    const senderNameMatch = /hi\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i.exec(text);
    if (senderNameMatch?.[1]) {
      return this.capitalize(senderNameMatch[1].trim());
    }

    const domain = this.extractDomain(sender);
    return domain ? this.formatDomainLabel(domain) : null;
  }

  private extractEmailFromText(text: string): string | null {
    const emailMatch = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/i.exec(text);
    return emailMatch ? `${emailMatch[1]}@${emailMatch[2]}` : null;
  }

  private inferRecruiterEmail(
    name: string | null,
    explicitEmail: string | null,
    sender: string,
  ): string | null {
    if (explicitEmail) {
      const localPart = explicitEmail.split('@')[0]?.toLowerCase() ?? '';
      const genericAliases = new Set([
        'recruiting',
        'recruiter',
        'hr',
        'talent',
        'noreply',
        'jobs',
        'careers',
        'hello',
      ]);
      if (!genericAliases.has(localPart)) {
        return explicitEmail;
      }
    }

    if (!name) {
      return explicitEmail;
    }

    const domain = this.extractDomain(sender);
    if (!domain) {
      return explicitEmail;
    }

    const firstName = name.trim().split(/\s+/)[0]?.toLowerCase();
    if (!firstName) {
      return explicitEmail;
    }

    return `${firstName}@${domain}`;
  }

  private extractEmailFromSender(sender: string): string | null {
    return sender.includes('@') ? sender : null;
  }

  private capitalize(value: string): string {
    return value.replace(/\b\w/g, (char: string) => char.toUpperCase());
  }
}

export const jobApplicationExtractor = new JobApplicationExtractor();
