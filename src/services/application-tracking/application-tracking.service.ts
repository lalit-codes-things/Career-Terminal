import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { NotFoundError } from '../../errors/app-errors';
import { applicationMergeService } from '../application-merge/application-merge.service';
import {
  applicationTimelineService,
  type ApplicationTimelineEventType,
} from '../application-timeline';
import { companyService } from '../company';
import { statusEngine } from '../status-engine';
import { recruiterService } from '../recruiter';
import { jobApplicationExtractor, type JobApplication, type JobApplicationStatus } from '../job-application';
import type { ClassifiableEmail, JobEmailClassification } from '../job-intelligence';

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

export interface ApplicationDetailsResult {
  readonly application: JobApplication;
  readonly emailHistory: readonly ApplicationEmailRecord[];
  readonly timeline: readonly ApplicationTimelineEvent[];
}

export interface ApplicationStatusUpdateResult {
  readonly application: JobApplication;
  readonly timelineEvent: ApplicationTimelineEvent;
}

export interface ApplicationEmailRecord {
  readonly id: string;
  readonly subject: string;
}

export interface ApplicationTimelineEvent {
  readonly id: string;
  readonly applicationId: string;
  readonly eventType: ApplicationTimelineEventType;
  readonly timestamp: string;
  readonly sourceEmailId: string | null;
  readonly metadata: Prisma.JsonValue | null;
  readonly description: string | null;
}

type JobApplicationRecord = {
  id: string;
  userId: string;
  companyName: string;
  companyDomain: string;
  roleTitle: string;
  roleDepartment: string;
  status: string;
  appliedDate: Date;
  recruiterName: string | null;
  recruiterEmail: string | null;
  sourceEmailId: string | null;
  location: string | null;
  employmentType: string | null;
  currentStage: string | null;
  interviewRounds: number;
  deadlines: string[] | null;
  threadIds: string[];
  recruiterId: string | null;
  companyId: string | null;
};

export class ApplicationTrackingService {
  public async listApplications(
    userId: string,
    filters: ApplicationListFilters = {},
  ): Promise<readonly JobApplication[]> {
    const where: Prisma.JobApplicationWhereInput = { userId };

    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.company) {
      where.companyName = { contains: filters.company, mode: 'insensitive' };
    }
    if (filters.role) {
      where.roleTitle = { contains: filters.role, mode: 'insensitive' };
    }
    if (filters.date) {
      const parsedDate = new Date(filters.date);
      if (!Number.isNaN(parsedDate.getTime())) {
        const start = new Date(parsedDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(parsedDate);
        end.setHours(23, 59, 59, 999);
        where.appliedDate = {
          gte: start,
          lt: end,
        };
      }
    }

    const applications = await prisma.jobApplication.findMany({
      where,
      orderBy: { appliedDate: 'desc' },
    });

    return applications.map((record) => this.mapPrismaToDomainModel(record));
  }

  public async getApplication(applicationId: string): Promise<ApplicationDetailsResult> {
    const applicationRecord = await prisma.jobApplication.findUnique({
      where: { id: applicationId },
    });

    if (!applicationRecord) {
      throw new NotFoundError('Application', applicationId);
    }

    const orConditions: Prisma.EmailMessageWhereInput[] = [];
    if (applicationRecord.companyDomain) {
      orConditions.push({
        sender: { contains: applicationRecord.companyDomain, mode: 'insensitive' },
      });
    }
    if (applicationRecord.sourceEmailId) {
      orConditions.push({ id: applicationRecord.sourceEmailId });
    }

    const emailHistoryRecords = await prisma.emailMessage.findMany({
      where: {
        userId: applicationRecord.userId,
        OR: orConditions.length > 0 ? orConditions : undefined,
      },
      select: { id: true, subject: true },
      orderBy: { receivedAt: 'desc' },
    });

    return {
      application: this.mapPrismaToDomainModel(applicationRecord),
      emailHistory: emailHistoryRecords.map((email) => ({
        id: email.id,
        subject: email.subject || 'No Subject',
      })),
      timeline: await this.getApplicationTimeline(applicationId),
    };
  }

  public async getApplicationTimeline(applicationId: string): Promise<readonly ApplicationTimelineEvent[]> {
    const timeline = await applicationTimelineService.listTimeline(applicationId);
    return timeline.map((event) => this.mapTimelineRecord(event));
  }

  public async updateTimelineEvent(
    eventId: string,
    input: {
      eventType?: ApplicationTimelineEventType;
      timestamp?: Date;
      sourceEmailId?: string | null;
      metadata?: Prisma.InputJsonValue | null;
      description?: string | null;
    },
  ): Promise<ApplicationTimelineEvent> {
    const updated = await applicationTimelineService.patchTimelineEvent(eventId, input);
    return this.mapTimelineRecord(updated);
  }

  public async updateApplicationStatus(
    applicationId: string,
    newStatus: string,
    changedByUserId?: string,
  ): Promise<ApplicationStatusUpdateResult> {
    const result = await prisma.$transaction(async (tx) => {
      const change = await statusEngine.overrideStatus(
        applicationId,
        newStatus,
        changedByUserId ?? 'manual',
        tx,
      );
      const updatedApp = await tx.jobApplication.findUnique({
        where: { id: applicationId },
      });

      if (!updatedApp) {
        throw new NotFoundError('Application', applicationId);
      }

      return { updatedApp, timelineEvent: change.timelineEvent };
    });

    return {
      application: this.mapPrismaToDomainModel(result.updatedApp),
      timelineEvent: result.timelineEvent
        ? this.mapTimelineRecord(result.timelineEvent)
        : (() => { throw new Error(`Unsupported application status for timeline event: ${newStatus}`); })(),
    };
  }

  public async getApplicationStatusHistory(applicationId: string) {
    return statusEngine.getStatusHistory(applicationId);
  }

  public async processEmailForJobApplication(
    email: ClassifiableEmail,
    classification: JobEmailClassification,
    userId: string,
  ): Promise<void> {
    const extractedData = jobApplicationExtractor.extract(email, userId, classification);

    const mergeDecision = await applicationMergeService.findMatch(
      userId,
      extractedData,
      email,
    );

    await prisma.$transaction(async (tx) => {
      const company = await companyService.resolveCompany(
        {
          name: extractedData.company.name,
          domain: extractedData.company.domain,
        },
        tx,
      );

      let app: JobApplicationRecord | null = null;

      if (mergeDecision.targetApplication) {
        app = await tx.jobApplication.findUnique({
          where: { id: mergeDecision.targetApplication.id },
        });
      }

      if (app) {
        const threadIds = app.threadIds || [];
        const isNewThread = email.threadId ? !threadIds.includes(email.threadId) : false;

        const updateData: Prisma.JobApplicationUpdateInput = { updatedAt: new Date() };
        let shouldWriteApp = false;

        if (app.companyId !== company.id) {
          updateData.company = {
            connect: {
              id: company.id,
            },
          };
          shouldWriteApp = true;
        }

        if (isNewThread && email.threadId) {
          updateData.threadIds = { push: email.threadId };
          shouldWriteApp = true;
        }

        if (shouldWriteApp) {
          app = await tx.jobApplication.update({
            where: { id: app.id },
            data: updateData,
          });
        }
      } else {
        const deadlinesAsStrings = [...extractedData.hiringProcess.deadlines];
        const threadIds = email.threadId ? [email.threadId] : [];

        app = await tx.jobApplication.create({
          data: {
            userId: extractedData.userId,
            companyId: company.id,
            companyName: extractedData.company.name,
            companyDomain: extractedData.company.domain,
            roleTitle: extractedData.role.title,
            roleDepartment: extractedData.role.department ?? '',
            status: extractedData.status,
            appliedDate: extractedData.appliedDate,
            recruiterName: extractedData.recruiter.name ?? '',
            recruiterEmail: extractedData.recruiter.email ?? '',
            sourceEmailId: extractedData.sourceEmailId ?? '',
            location: extractedData.details.location ?? '',
            employmentType: extractedData.details.employmentType ?? '',
            currentStage: extractedData.hiringProcess.currentStage ?? '',
            interviewRounds: extractedData.hiringProcess.interviewRounds ?? 0,
            deadlines: deadlinesAsStrings,
            threadIds,
          },
        });
      }

      const timelineInput = applicationTimelineService.buildEmailTimelineEvent({
        applicationId: app.id,
        email,
        classification,
        metadata: {
          mergeDecision: {
            matched: Boolean(mergeDecision.targetApplication),
            confidenceScore: mergeDecision.confidenceScore,
            reasons: mergeDecision.reasons,
          },
          extractedData: {
            company: extractedData.company,
            role: extractedData.role,
            status: extractedData.status,
            currentStage: extractedData.hiringProcess.currentStage,
          },
        },
      });

      if (timelineInput) {
        await tx.applicationTimeline.create({
          data: timelineInput,
        });
      }

      await statusEngine.applyEmailStatus(
        app.id,
        classification,
        {
          emailId: email.emailId,
          receivedAt: email.receivedAt,
          subject: email.subject,
        },
        tx,
      );

      await recruiterService.syncRecruiterFromEmail(
        {
          userId,
          application: {
            id: app.id,
            userId: app.userId,
            companyName: app.companyName,
            companyDomain: app.companyDomain,
            roleTitle: app.roleTitle,
            recruiterName: app.recruiterName ?? extractedData.recruiter.name ?? 'Recruiter',
            recruiterEmail: app.recruiterEmail ?? extractedData.recruiter.email ?? email.sender,
          },
          email: {
            emailId: email.emailId,
            sender: email.sender,
            subject: email.subject,
            bodyText: email.bodyText,
            receivedAt: email.receivedAt,
            threadId: email.threadId,
          },
          company: extractedData.company,
          recruiter: extractedData.recruiter,
        },
        tx,
      );
    });
  }

  private mapTimelineRecord(record: {
    id: string;
    applicationId: string;
    eventType: string;
    timestamp: string | Date;
    sourceEmailId: string | null;
    metadata: Prisma.JsonValue | null;
    description: string | null;
  }): ApplicationTimelineEvent {
    return {
      id: record.id,
      applicationId: record.applicationId,
      eventType: record.eventType as ApplicationTimelineEventType,
      timestamp: record.timestamp instanceof Date ? record.timestamp.toISOString() : record.timestamp,
      sourceEmailId: record.sourceEmailId,
      metadata: record.metadata,
      description: record.description,
    };
  }

  private mapPrismaToDomainModel = (record: JobApplicationRecord): JobApplication => {
    const deadlines = record.deadlines ?? [];

    return {
      id: record.id,
      userId: record.userId,
      company: {
        name: record.companyName,
        domain: record.companyDomain,
      },
      role: {
        title: record.roleTitle,
        department: record.roleDepartment,
      },
      status: record.status as JobApplicationStatus,
      appliedDate: record.appliedDate,
      recruiter: {
        name: record.recruiterName ?? 'Unknown',
        email: record.recruiterEmail ?? '',
      },
      sourceEmailId: record.sourceEmailId ?? '',
      details: {
        applicationDate: record.appliedDate,
            location: record.location ?? '',
        employmentType: record.employmentType ?? '',
      },
      hiringProcess: {
        currentStage: record.currentStage ?? '',
        interviewRounds: record.interviewRounds ?? 0,
        deadlines,
      },
    };
  };
}

export const applicationTrackingService = new ApplicationTrackingService();
