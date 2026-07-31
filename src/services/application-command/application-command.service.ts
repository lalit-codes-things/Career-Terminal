import { ApplicationTimelineEventType, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../config/database';
import { NotFoundError } from '../../errors/app-errors';
import { DomainValidationError } from '../../errors/domain-errors';
import { ApplicationSourceProvider } from '../../domain/application-source';
import { executeWithTransientRetry } from '../../db/transaction-utils';
import { acquireLock, releaseLock } from '../../lib/mutex';
import { IdempotencyService, idempotencyService, keyForAppFromEmail } from '../idempotency';
import { applicationMergeService } from '../application-merge/application-merge.service';
import { applicationReadModelService } from '../application-read-model/application-read-model.service';
import { applicationTimelineService } from '../application-timeline';
import { companyService } from '../company';
import { dashboardService } from '../dashboard';
import { opportunityService } from '../opportunity';
import { ownershipGuard } from '../ownership/ownership.guard';
import { recruiterService } from '../recruiter';
import { statusEngine } from '../status-engine';
import { jobApplicationExtractor } from '../job-application';
import { userService } from '../user';
import { resumeUploadService } from '../resume/resume-upload.service';
import {
  createApplicationSnapshot,
  recordApplicationSentOutcome,
  recordApplyAction,
} from './application-integration';
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
  userId: string | null;
  legacyUserId: string | null;
  companyId: string | null;
  opportunityId: string | null;
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

    const result = await executeWithTransientRetry(prisma, async (tx) => {
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
    idempotencySvc: IdempotencyService = idempotencyService,
  ): Promise<void> {
    // ── 1. Idempotency gate ────────────────────────────────────────────────
    //    Stable key per (source email message).  We use a 2-phase claim
    //    because we don't know the final applicationId until after the
    //    merge-resolution / update / create transaction runs.
    const idemKey = keyForAppFromEmail(email.emailId);

    const preflight = await idempotencySvc.check<{ applicationId: string }>(idemKey);
    if (preflight.alreadyExecuted) {
      return;
    }

    const lockKey = `lock:process_email:${email.emailId}`;
    const lockToken = await acquireLock(lockKey, 60);
    if (!lockToken) return; // Prevent concurrent processing of same email

    const claim = await idempotencySvc.claim(idemKey, 'create_application');
    if (!claim.claimed) {
      // Either it finished between the preflight check and our mutex acquire
      // (handled), or another worker claimed it and is still running (in
      // which case we short-circuit rather than duplicate the work).
      if (claim.existing.resultId) return;
      if (
        claim.existing.resultData &&
        (claim.existing.resultData as { __inProgress?: boolean }).__inProgress
      ) {
        return;
      }
      return;
    }

    let committed = false;
    try {
      // Legacy dedup guard still runs inside the transaction; with the new
      // unique index it is formally redundant, but we keep it to avoid
      // throwing expensive P2002 errors in the hot path.
      const existing = await prisma.applicationSource.findFirst({
        where: { sourceEmailId: email.emailId, provider: ApplicationSourceProvider.GMAIL },
      });
      if (existing) {
        await idempotencySvc.commit(claim.recordId, existing.applicationId, {
          applicationId: existing.applicationId,
          source: 'existing_source_row',
        });
        committed = true;
        return;
      }

      const extractedData = jobApplicationExtractor.extract(email, userId, classification);
      const userScope = await userService.userScopeFor(userId);

      const activeResumeRow = await resumeUploadService.getActiveResumeRow(userId);

      const company = await companyService.resolveCompany({
        name: extractedData.company.name,
        domain: extractedData.company.domain,
      });

      const opportunityResult = await opportunityService.resolve({
        companyName: extractedData.company.name,
        companyDomain: extractedData.company.domain,
        roleTitle: extractedData.role.title,
        location: extractedData.details.location,
        description: email.bodyText ?? undefined,
        sourceEmailId: email.emailId,
        sourceMetadata: {
          ingestionSource: 'gmail',
          emailSubject: email.subject,
          classificationCategory: classification.category,
        },
      });

      const mergeDecision = await applicationMergeService.findMatch(
        userId,
        extractedData,
        email,
        undefined,
        undefined,
        opportunityResult.opportunityId,
      );

      let finalApplicationId: string | null = null;
      let isNewApplication = false;

      await executeWithTransientRetry(prisma, async (tx) => {
        let app: JobApplicationRecord | null = null;

        if (mergeDecision.targetApplication) {
          app = await tx.jobApplication.findUnique({
            where: { id: mergeDecision.targetApplication.id },
          });
        }

        isNewApplication = !app;

        if (app) {
          const threadIds = app.threadIds || [];
          const isNewThread = email.threadId ? !threadIds.includes(email.threadId) : false;

          const updateData: Prisma.JobApplicationUncheckedUpdateInput = { updatedAt: new Date() };
          let shouldWriteApp = false;

          if (app.companyId !== company.id) {
            updateData.companyId = company.id;
            shouldWriteApp = true;
          }

          if (!app.opportunityId) {
            updateData.opportunityId = opportunityResult.opportunityId;
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
              userId: userScope.userId,
              legacyUserId: userScope.legacyUserId,
              companyId: company.id,
              opportunityId: opportunityResult.opportunityId,
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

        if (!app) throw new Error('Application not found or created');

        await tx.applicationSource.create({
          data: {
            applicationId: app.id,
            provider: ApplicationSourceProvider.GMAIL,
            sourceEmailId: email.emailId,
            sourceData: {
              threadId: email.threadId ?? null,
              conversationId: email.threadId ?? null,
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
              userId: (app.userId ?? app.legacyUserId)!,
              companyName: app.companyName ?? '',
              companyDomain: app.companyDomain ?? '',
              roleTitle: app.roleTitle ?? '',
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

        if (activeResumeRow) {
          await resumeUploadService.linkApplicationResume(
            app.id,
            activeResumeRow,
            {
              appliedAt: app.appliedDate ?? new Date(),
              usageContext: { strategy: 'generic' },
            },
            tx,
          );
        }

        finalApplicationId = app.id;
      });

      // Commit idempotency record with the real application id / snapshot.
      await idempotencySvc.commit(claim.recordId, finalApplicationId!, {
        applicationId: finalApplicationId,
        classification: classification.category,
        matched: Boolean(mergeDecision.targetApplication),
      });
      committed = true;

      // ── Prompt 10 + 12 integrations for NEW applications ────────────────
      if (isNewApplication && finalApplicationId) {
        const snapshotId = await createApplicationSnapshot(
          userId,
          finalApplicationId,
          extractedData.company.name,
          extractedData.role.title,
        );

        if (snapshotId) {
          await prisma.jobApplication.update({
            where: { id: finalApplicationId },
            data: { snapshotId },
          });
        }

        await recordApplicationSentOutcome(
          finalApplicationId,
          userId,
          extractedData.appliedDate,
          extractedData.sourceEmailId ?? undefined,
          email.subject,
        );

        await recordApplyAction(userId, finalApplicationId, extractedData.appliedDate, {
          opportunityId: opportunityResult.opportunityId,
          sourceEmailId: extractedData.sourceEmailId ?? undefined,
          applicationChannel: 'gmail',
          resumeVersionId: activeResumeRow?.userResumeId,
          resumeVersion: activeResumeRow?.version,
        });
      }

      dashboardService.invalidateUser(userId);
    } finally {
      if (!committed) {
        // The claim is left as an "in-progress" row if we crash before
        // commit.  Aborting it lets a future retry re-claim cleanly; the
        // 60-day TTL is a fallback in case abort() itself fails.
        await idempotencySvc.abort(claim.recordId);
      }
      if (lockToken) await releaseLock(lockKey, lockToken);
    }
  }
}

export const applicationCommandService = new ApplicationCommandService();
