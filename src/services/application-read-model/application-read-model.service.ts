import type { Prisma } from '@prisma/client';
import { ApplicationStatus, normalizeApplicationStatus } from '../../domain/application-status';
import type {
  ApplicationDetailsView,
  ApplicationEmailHistoryItem,
  ApplicationHiringProcessModel,
  ApplicationStatusHistoryModel,
  ApplicationTimelineModel,
} from '../../domain/application.models';

export class ApplicationReadModelService {
  public toApplication(record: {
    id: string;
    userId: string | null;
    legacyUserId?: string | null;
    companyName: string | null;
    companyDomain: string | null;
    roleTitle: string | null;
    roleDepartment: string | null;
    status: string;
    appliedDate: Date | null;
    recruiterName: string | null;
    recruiterEmail: string | null;
    sourceEmailId: string | null;
    location: string | null;
    employmentType: string | null;
    currentStage: string | null;
    interviewRounds: number;
    deadlines: string[] | null;
  }): ApplicationDetailsView['application'] {
    return {
      id: record.id,
      userId: record.userId ?? record.legacyUserId ?? '',
      company: {
        name: record.companyName ?? '',
        domain: record.companyDomain ?? '',
      },
      role: {
        title: record.roleTitle ?? '',
        department: record.roleDepartment ?? '',
      },
      status: normalizeApplicationStatus(record.status) ?? ApplicationStatus.SAVED,
      appliedDate: record.appliedDate ?? new Date(),
      recruiter: {
        name: record.recruiterName ?? 'Unknown',
        email: record.recruiterEmail ?? '',
      },
      sourceEmailId: record.sourceEmailId ?? '',
      details: {
        applicationDate: record.appliedDate ?? new Date(),
        location: record.location ?? '',
        employmentType: record.employmentType ?? '',
      },
      hiringProcess: {
        currentStage: record.currentStage ?? '',
        interviewRounds: record.interviewRounds ?? 0,
        deadlines: record.deadlines ?? [],
      },
    };
  }

  public toTimelineEvent(record: {
    id: string;
    applicationId: string;
    eventType: string;
    timestamp: string | Date;
    sourceEmailId: string | null;
    metadata: Prisma.JsonValue | null;
    description: string | null;
  }): ApplicationTimelineModel {
    return {
      id: record.id,
      applicationId: record.applicationId,
      eventType: record.eventType,
      timestamp:
        record.timestamp instanceof Date ? record.timestamp.toISOString() : record.timestamp,
      sourceEmailId: record.sourceEmailId,
      metadata: record.metadata,
      description: record.description,
    };
  }

  public toStatusHistory(record: {
    id: string;
    applicationId: string;
    previousStatus: string | null;
    status: string;
    source: string;
    sourceEmailId: string | null;
    changedByUserId: string | null;
    timestamp: string | Date;
    metadata: Prisma.JsonValue | null;
    createdAt: string | Date;
    updatedAt: string | Date | null;
  }): ApplicationStatusHistoryModel {
    return {
      id: record.id,
      applicationId: record.applicationId,
      previousStatus: record.previousStatus
        ? normalizeApplicationStatus(record.previousStatus)
        : null,
      status: normalizeApplicationStatus(record.status) ?? ApplicationStatus.SAVED,
      source: record.source,
      sourceEmailId: record.sourceEmailId,
      changedByUserId: record.changedByUserId,
      timestamp:
        record.timestamp instanceof Date ? record.timestamp.toISOString() : record.timestamp,
      metadata: record.metadata,
      createdAt:
        record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt,
      updatedAt:
        record.updatedAt instanceof Date
          ? record.updatedAt.toISOString()
          : (record.updatedAt ?? ''),
    };
  }

  public buildDetailsView(input: {
    application: ApplicationDetailsView['application'];
    emailHistory: readonly ApplicationEmailHistoryItem[];
    timeline: readonly ApplicationTimelineModel[];
  }): ApplicationDetailsView {
    return input;
  }

  public toHiringProcess(input: {
    currentStage?: string | null;
    interviewRounds?: number | null;
    deadlines?: readonly string[] | null;
  }): ApplicationHiringProcessModel {
    return {
      currentStage: input.currentStage ?? '',
      interviewRounds: input.interviewRounds ?? 0,
      deadlines: input.deadlines ?? [],
    };
  }
}

export const applicationReadModelService = new ApplicationReadModelService();
