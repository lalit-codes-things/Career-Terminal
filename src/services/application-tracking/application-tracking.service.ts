import { Prisma } from '@prisma/client';
import { applicationCommandService } from '../application-command/application-command.service';
import { applicationQueryService } from '../application-query/application-query.service';
import type {
  ApplicationDetailsView,
  ApplicationTimelineModel,
  ApplicationStatusHistoryModel,
} from '../../domain/application.models';
import type { PaginationInput } from '../../domain/pagination';
import type { ClassifiableEmail, JobEmailClassification } from '../job-intelligence';
import type { JobApplication } from '../job-application';
import type { ApplicationTimelineEventType } from '@prisma/client';

export interface ExtractedJobData {
  userId: string;
  company: { name: string; domain: string };
  role: { title: string; department?: string };
  status: string;
  appliedDate: Date;
  recruiter: { name?: string; email?: string };
  sourceEmailId?: string;
  details: { location?: string; employmentType?: string };
  hiringProcess: {
    currentStage?: string;
    interviewRounds?: number;
    deadlines: readonly string[];
  };
}

export interface ApplicationListFilters {
  readonly status?: string;
  readonly company?: string;
  readonly date?: string;
  readonly role?: string;
}

export type ApplicationDetailsResult = ApplicationDetailsView;

export interface ApplicationStatusUpdateResult {
  readonly application: JobApplication;
  readonly timelineEvent: ApplicationTimelineEvent;
}

export interface ApplicationEmailRecord {
  readonly id: string;
  readonly subject: string;
}

export type ApplicationTimelineEvent = ApplicationTimelineModel;
export type ApplicationStatusHistoryEvent = ApplicationStatusHistoryModel;

export class ApplicationTrackingService {
  public async listApplications(
    userId: string,
    filters: ApplicationListFilters = {},
    pagination?: PaginationInput,
  ): Promise<readonly JobApplication[]> {
    return applicationQueryService.listApplications(userId, filters, pagination);
  }

  public async getApplication(
    userId: string,
    applicationId: string,
  ): Promise<ApplicationDetailsResult> {
    return applicationQueryService.getApplication(userId, applicationId);
  }

  public async getApplicationTimeline(
    userId: string,
    applicationId: string,
    pagination?: PaginationInput,
  ): Promise<readonly ApplicationTimelineEvent[]> {
    return applicationQueryService.getApplicationTimeline(userId, applicationId, pagination);
  }

  public async updateTimelineEvent(
    userId: string,
    eventId: string,
    input: {
      eventType?: ApplicationTimelineEventType;
      timestamp?: Date;
      sourceEmailId?: string | null;
      metadata?: Prisma.InputJsonValue | null;
      description?: string | null;
    },
  ): Promise<ApplicationTimelineEvent> {
    return applicationCommandService.updateTimelineEvent(userId, eventId, input);
  }

  public async updateApplicationStatus(
    userId: string,
    applicationId: string,
    newStatus: string,
    changedByUserId?: string,
  ): Promise<ApplicationStatusUpdateResult> {
    return applicationCommandService.updateApplicationStatus(
      userId,
      applicationId,
      newStatus,
      changedByUserId,
    );
  }

  public async getApplicationStatusHistory(
    userId: string,
    applicationId: string,
    pagination?: PaginationInput,
  ): Promise<readonly ApplicationStatusHistoryEvent[]> {
    return applicationQueryService.getApplicationStatusHistory(userId, applicationId, pagination);
  }

  public async processEmailForJobApplication(
    email: ClassifiableEmail,
    classification: JobEmailClassification,
    userId: string,
  ): Promise<void> {
    return applicationCommandService.processEmailForJobApplication(email, classification, userId);
  }
}

export const applicationTrackingService = new ApplicationTrackingService();
