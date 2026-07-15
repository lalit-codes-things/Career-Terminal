// Force IDE re-parse to clear stale Prisma type cache
import { prisma } from '../../config/database';
import { Prisma } from '@prisma/client';               // namespace import for types
import type { JobApplication, JobApplicationStatus } from '../job-application';
import type { ClassifiableEmail, JobEmailClassification } from '../job-intelligence';
import { jobApplicationExtractor } from '../job-application';
import { applicationMergeService } from '../application-merge/application-merge.service';

// ─── Domain types (if not exported, define here) ──────────────────────────────

export interface ExtractedJobData {
  userId: string;
  company: { name: string; domain: string };
  role: { title: string; department?: string };
  status: string;                           // plain string (no enum)
  appliedDate: Date;
  recruiter: { name?: string; email?: string };
  sourceEmailId?: string;
  details: { location?: string; employmentType?: string };
  hiringProcess: {
    currentStage?: string;
    interviewRounds?: number;
    deadlines: readonly string[];               // extractor provides ISO strings
  };
}

// ─── Public Interfaces ──────────────────────────────────────────────────────────

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
  readonly eventType: string;
  readonly description: string;
  readonly timestamp: string;
}

// ─── Service ────────────────────────────────────────────────────────────────────

export class ApplicationTrackingService {
  public async listApplications(
    userId: string,
    filters: ApplicationListFilters = {},
  ): Promise<readonly JobApplication[]> {
    const where: Prisma.JobApplicationWhereInput = { userId };

    if (filters.status) {
      where.status = filters.status;          // string, no enum cast
    }
    if (filters.company) {
      where.companyName = { contains: filters.company, mode: 'insensitive' };
    }
    if (filters.role) {
      where.roleTitle = { contains: filters.role, mode: 'insensitive' };
    }
    if (filters.date) {
      const parsedDate = new Date(filters.date);
      if (!isNaN(parsedDate.getTime())) {
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

    return applications.map(this.mapPrismaToDomainModel);
  }

  public async getApplication(applicationId: string): Promise<ApplicationDetailsResult> {
    const applicationRecord = await prisma.jobApplication.findUnique({
      where: { id: applicationId },
      include: { timeline: { orderBy: { timestamp: 'desc' } } },
    });

    if (!applicationRecord) {
      throw new Error(`Application with ID ${applicationId} not found`);
    }

    // Build OR conditions safely
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
      emailHistory: emailHistoryRecords.map((e) => ({
        id: e.id,
        subject: e.subject ?? 'No Subject',
      })),
      timeline: applicationRecord.timeline.map((t) => ({
        id: t.id,
        eventType: t.eventType,
        description: t.description,
        timestamp: t.timestamp.toISOString(),
      })),
    };
  }

  public async updateApplicationStatus(
    applicationId: string,
    newStatus: string,
  ): Promise<ApplicationStatusUpdateResult> {
    const applicationRecord = await prisma.jobApplication.findUnique({
      where: { id: applicationId },
    });

    if (!applicationRecord) {
      throw new Error(`Application with ID ${applicationId} not found`);
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedApp = await tx.jobApplication.update({
        where: { id: applicationId },
        data: { status: newStatus },           // string, no enum
      });

      const timelineEvent = await tx.applicationTimeline.create({
        data: {
          applicationId,
          eventType: 'STATUS_CHANGED',
          description: `Application status updated to ${newStatus}`,
          timestamp: new Date(),
        },
      });

      return { updatedApp, timelineEvent };
    });

    return {
      application: this.mapPrismaToDomainModel(result.updatedApp),
      timelineEvent: {
        id: result.timelineEvent.id,
        eventType: result.timelineEvent.eventType,
        description: result.timelineEvent.description,
        timestamp: result.timelineEvent.timestamp.toISOString(),
      },
    };
  }

  public async processEmailForJobApplication(
    email: ClassifiableEmail,
    classification: JobEmailClassification,
    userId: string,
  ): Promise<void> {
    const extractedData = jobApplicationExtractor.extract(
      email,
      userId,
      classification,
    );

    // Use Deduplication Engine
    // We attempt to find a match before starting the transaction to keep it fast
    const mergeDecision = await applicationMergeService.findMatch(
      userId,
      extractedData,
      email
    );

    await prisma.$transaction(async (tx) => {
      let app = null;

      if (mergeDecision.targetApplication) {
        // Re-fetch inside transaction with lock if necessary, but standard update is fine
        app = await tx.jobApplication.findUnique({
          where: { id: mergeDecision.targetApplication.id }
        });
      }

      if (app) {
        // Update only if status changed or we need to add thread ID
        const threadIds = app.threadIds || [];
        const isNewThread = email.threadId && !threadIds.includes(email.threadId);
        
        const updateData: Prisma.JobApplicationUpdateInput = { updatedAt: new Date() };
        let needsUpdate = false;

        if (String(app.status) !== String(extractedData.status)) {
          updateData.status = extractedData.status;
          updateData.currentStage = extractedData.hiringProcess.currentStage;
          updateData.interviewRounds = extractedData.hiringProcess.interviewRounds;
          needsUpdate = true;
        }

        if (isNewThread && email.threadId) {
          updateData.threadIds = { push: email.threadId };
          needsUpdate = true;
        }

        if (needsUpdate) {
          app = await tx.jobApplication.update({
            where: { id: app.id },
            data: updateData,
          });
        }
      } else {
        // Create new – deadlines must be stored as String[]
        const deadlinesAsStrings = [...extractedData.hiringProcess.deadlines];
        
        const threadIds = email.threadId ? [email.threadId] : [];

        app = await tx.jobApplication.create({
          data: {
            userId: extractedData.userId,
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
            threadIds: threadIds,
          },
        });
      }

      const timelineDesc = mergeDecision.targetApplication 
        ? `Processed email: ${email.subject ?? 'Unknown'} as ${classification.category}. Merged with confidence ${mergeDecision.confidenceScore}% (${mergeDecision.reasons.join(', ')})`
        : `Processed email: ${email.subject ?? 'Unknown'} as ${classification.category}. Created new application.`;

      await tx.applicationTimeline.create({
        data: {
          applicationId: app.id,
          eventType: 'EMAIL_PROCESSED',
          description: timelineDesc,
          timestamp: new Date(),
        },
      });
    });
  }

  // ─── Private Mapper ──────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
private mapPrismaToDomainModel = (record: Prisma.JobApplicationGetPayload<{}>): JobApplication => {
    // Keep deadlines as stored ISO strings
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
      sourceEmailId: record.sourceEmailId ?? undefined,
      details: {
        applicationDate: record.appliedDate,
        location: record.location ?? undefined,
        employmentType: record.employmentType ?? undefined,
      },
      hiringProcess: {
        currentStage: record.currentStage ?? undefined,
        interviewRounds: record.interviewRounds ?? 0,
        deadlines,
      },
    };
  };
}

export const applicationTrackingService = new ApplicationTrackingService();