import type { Prisma } from '@prisma/client';
import { ApplicationStatus } from './application-status';

export interface ApplicationCompanyModel {
  readonly name: string;
  readonly domain: string;
}

export interface ApplicationRoleModel {
  readonly title: string;
  readonly department: string;
}

export interface ApplicationDetailsModel {
  readonly applicationDate: Date;
  readonly location: string;
  readonly employmentType: string;
}

export interface ApplicationHiringProcessModel {
  readonly currentStage: string;
  readonly interviewRounds: number;
  readonly deadlines: readonly string[];
}

export interface ApplicationRecruiterModel {
  readonly name: string;
  readonly email: string;
}

export interface ApplicationSourceModel {
  readonly id: string;
  readonly applicationId: string;
  readonly provider: string;
  readonly providerMessageId: string | null;
  readonly providerThreadId: string | null;
  readonly providerConversationId: string | null;
  readonly providerMetadata: Prisma.JsonValue | null;
  readonly createdAt: string;
}

export interface ApplicationTimelineModel {
  readonly id: string;
  readonly applicationId: string;
  readonly eventType: string;
  readonly timestamp: string;
  readonly sourceEmailId: string | null;
  readonly metadata: Prisma.JsonValue | null;
  readonly description: string | null;
}

export interface ApplicationStatusHistoryModel {
  readonly id: string;
  readonly applicationId: string;
  readonly previousStatus: ApplicationStatus | null;
  readonly status: ApplicationStatus;
  readonly source: string;
  readonly sourceEmailId: string | null;
  readonly changedByUserId: string | null;
  readonly timestamp: string;
  readonly metadata: Prisma.JsonValue | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApplicationEmailHistoryItem {
  readonly id: string;
  readonly subject: string;
}

export interface ApplicationDetailsView {
  readonly application: {
    readonly id: string;
    readonly userId: string;
    readonly company: ApplicationCompanyModel;
    readonly role: ApplicationRoleModel;
    readonly status: ApplicationStatus;
    readonly appliedDate: Date;
    readonly recruiter: ApplicationRecruiterModel;
    readonly sourceEmailId: string;
    readonly details: ApplicationDetailsModel;
    readonly hiringProcess: ApplicationHiringProcessModel;
  };
  readonly emailHistory: readonly ApplicationEmailHistoryItem[];
  readonly timeline: readonly ApplicationTimelineModel[];
}
