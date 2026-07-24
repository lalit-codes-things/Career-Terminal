import { ApplicationTimelineEventType, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../config/database';
import { NotFoundError } from '../../errors/app-errors';
import { DomainValidationError } from '../../errors/domain-errors';
import { ApplicationSourceProvider } from '../../domain/application-source';
import { applicationMergeService } from '../application-merge/application-merge.service';
import { applicationReadModelService } from '../application-read-model/application-read-model.service';
import { applicationTimelineService } from '../application-timeline';
import { companyService } from '../company';
import { dashboardService } from '../dashboard';
import { ownershipGuard } from '../ownership/ownership.guard';
import { recruiterService } from '../recruiter';
import { statusEngine } from '../status-engine';
import { jobApplicationExtractor } from '../job-application';
import type { JobApplication } from '../job-application';
import type { ClassifiableEmail, JobEmailClassification } from '../job-intelligence';

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface ApplicationTimelineEvent {
  readonly id: string;
  readonly applicationId: string;
  readonly eventType: string;
  readonly timestamp: string;
  readonly sourceEmailId: string | null;
  readonly metadata: Prisma.JsonValue | null;
  readonly description: string | null;
}

export interface ApplicationStatusUpdateResult {
  readonly application: JobApplication;
  readonly timelineEvent: ApplicationTimelineEvent;
}

type JobApplicationRecord = {
  id: string;
  userId: string;
  companyId: string | null;
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
};

export class ApplicationCommandService {
  public async updateApplicationStatus(
    userId: string,
    applicationId: string,
    newStatus: string,
    changedByUserId?: string,
    db: DbClient = prisma,
  ): Promise<ApplicationStatusUpdateResult> {
    await ownershipGuard.ensureApplicationAccess(userId, applicationId, db);

    const result = await prisma.$transaction(async (tx) => {
      const change = await statusEngine.overrideStatus(
        applicationId,
        newStatus,
        changedByUserId ?? userId,
        tx,
        userId,
      );

      const updatedApp = await tx.jobApplication.findUnique({
        where: { id: applicationId },
      });

      if (!updatedApp) {
        throw new NotFoundError('Application', applicationId);
      }

      return { updatedApp, timelineEvent: change.timelineEvent };
    });

    dashboardService.invalidateUser(userId);

    return {
      application: applicationReadModelService.toApplication(result.updatedApp),
      timelineEvent: result.timelineEvent
        ? applicationReadModelService.toTimelineEvent(result.timelineEvent)
        : (() => {
            throw new DomainValidationError(
              `Unsupported timeline event for application ${applicationId}`,
            );
          })(),
    };
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
    db: DbClient = prisma,
  ): Promise<ApplicationTimelineEvent> {
    await ownershipGuard.ensureTimelineAccess(userId, eventId, db);
    const updated = await applicationTimelineService.patchTimelineEvent(eventId, input, db, userId);
    return applicationReadModelService.toTimelineEvent(updated);
  }

  public async processEmailForJobApplication(
    email: ClassifiableEmail,
    classification: JobEmailClassification,
    userId: string,
  ): Promise<void> {
    const extractedData = jobApplicationExtractor.extract(email, userId, classification);

    const mergeDecision = await applicationMergeService.findMatch(userId, extractedData, email);

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

      await tx.applicationSource.create({
        data: {
          applicationId: app.id,
          provider: ApplicationSourceProvider.GMAIL,
          providerMessageId: email.emailId,
          providerThreadId: email.threadId ?? null,
          providerConversationId: email.threadId ?? null,
          providerMetadata: {
            sender: email.sender,
            subject: email.subject,
            classification: {
              category: classification.category,
              confidence: classification.confidence,
              detectedCompany: classification.detectedCompany,
              detectedRole: classification.detectedRole,
            },
            extractedData: {
              company: extractedData.company,
              role: extractedData.role,
              status: extractedData.status,
              currentStage: extractedData.hiringProcess.currentStage,
            },
          } as unknown as Prisma.InputJsonValue,
        },
      });

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
        await applicationTimelineService.createTimelineEvent(timelineInput, tx, userId);
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
        userId,
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

    dashboardService.invalidateUser(userId);
  }
}

export const applicationCommandService = new ApplicationCommandService();
