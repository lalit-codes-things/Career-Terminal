import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../config/database';
import { NotFoundError } from '../../errors/app-errors';
import { DomainValidationError } from '../../errors/domain-errors';
import { ApplicationStatus, normalizeApplicationStatus } from '../../domain/application-status';
import { resolvePagination, type PaginationInput } from '../../domain/pagination';
import { applicationTimelineService } from '../application-timeline';
import { JobEmailCategory, type JobEmailClassification } from '../job-intelligence';

type DbClient = PrismaClient | Prisma.TransactionClient;

export type ApplicationStatusSource = 'EMAIL' | 'MANUAL';

export interface ApplicationStatusHistoryRecord {
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
  readonly updatedAt: string | null;
}

export interface StatusChangeInput {
  readonly applicationId: string;
  readonly status: string;
  readonly timestamp?: Date;
  readonly source: ApplicationStatusSource;
  readonly sourceEmailId?: string | null;
  readonly changedByUserId?: string | null;
  readonly userId?: string | null;
  readonly metadata?: Prisma.InputJsonValue | null;
}

export interface StatusChangeResult {
  readonly application: {
    readonly id: string;
    readonly status: string;
    readonly currentStage: string | null;
    readonly updatedAt: Date;
  };
  readonly historyEntry: ApplicationStatusHistoryRecord | null;
  readonly timelineEvent: {
    readonly id: string;
    readonly applicationId: string;
    readonly eventType: string;
    readonly timestamp: string;
    readonly sourceEmailId: string | null;
    readonly metadata: Prisma.JsonValue | null;
    readonly description: string | null;
  } | null;
}

export interface StatusHistoryItem {
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
  readonly updatedAt: string | null;
}

export class StatusEngine {
  public async applyEmailStatus(
    applicationId: string,
    classification: JobEmailClassification,
    email: {
      emailId: string;
      receivedAt?: Date;
      subject?: string;
    },
    db: DbClient = prisma,
    userId?: string,
  ): Promise<StatusChangeResult> {
    const status = this.resolveStatusFromEmail(classification);
    if (!status) {
      throw new DomainValidationError(
        `Unsupported email classification for status updates: ${classification.category}`,
      );
    }

    return this.recordStatusChange(
      {
        applicationId,
        status,
        timestamp: email.receivedAt ?? new Date(),
        source: 'EMAIL',
        sourceEmailId: email.emailId,
        userId,
        metadata: {
          classification: {
            emailId: classification.emailId,
            category: classification.category,
            confidence: classification.confidence,
            detectedCompany: classification.detectedCompany,
            detectedRole: classification.detectedRole,
          },
          subject: email.subject ?? null,
        },
      },
      db,
    );
  }

  public async overrideStatus(
    applicationId: string,
    status: string,
    changedByUserId: string,
    db: DbClient = prisma,
    userId?: string,
  ): Promise<StatusChangeResult> {
    return this.recordStatusChange(
      {
        applicationId,
        status,
        timestamp: new Date(),
        source: 'MANUAL',
        changedByUserId,
        userId,
        metadata: {
          manualOverride: true,
        },
      },
      db,
    );
  }

  public async getStatusHistory(
    applicationId: string,
    db: DbClient = prisma,
    userId?: string,
    pagination?: PaginationInput,
  ): Promise<readonly StatusHistoryItem[]> {
    const application = await db.jobApplication.findFirst({
      where: {
        id: applicationId,
        ...(userId ? { userId } : {}),
      },
      select: { id: true },
    });

    if (!application) {
      throw new NotFoundError('Application', applicationId);
    }

    const paging = resolvePagination(pagination);

    const entries = await db.applicationStatusHistory.findMany({
      where: { applicationId },
      orderBy: [{ timestamp: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      ...(paging ? { skip: paging.skip, take: paging.take } : {}),
    });

    return entries.map((entry) => this.mapHistory(entry));
  }

  public resolveStatusFromEmail(classification: JobEmailClassification): ApplicationStatus | null {
    switch (classification.category) {
      case JobEmailCategory.JOB_APPLICATION:
        return ApplicationStatus.APPLIED;
      case JobEmailCategory.RECRUITER_OUTREACH:
      case JobEmailCategory.NETWORKING:
      case JobEmailCategory.CAREER_NEWSLETTER:
      case JobEmailCategory.NOT_JOB_RELATED:
        return ApplicationStatus.SAVED;
      case JobEmailCategory.ASSESSMENT_TEST:
        return ApplicationStatus.ASSESSMENT;
      case JobEmailCategory.INTERVIEW_INVITATION:
        return ApplicationStatus.INTERVIEW;
      case JobEmailCategory.OFFER:
        return ApplicationStatus.OFFER;
      case JobEmailCategory.REJECTION:
        return ApplicationStatus.REJECTED;
      default:
        return null;
    }
  }

  private async recordStatusChange(
    input: StatusChangeInput,
    db: DbClient,
  ): Promise<StatusChangeResult> {
    const normalizedStatus = this.normalizeStatus(input.status);
    if (!normalizedStatus) {
      throw new DomainValidationError(`Unsupported application status: ${input.status}`);
    }

    const application = input.userId
      ? await db.jobApplication.findFirst({
          where: {
            id: input.applicationId,
            userId: input.userId,
          },
          select: {
            id: true,
            status: true,
            currentStage: true,
            userId: true,
          },
        })
      : await db.jobApplication.findUnique({
          where: { id: input.applicationId },
          select: {
            id: true,
            status: true,
            currentStage: true,
            userId: true,
          },
        });

    if (!application) {
      throw new NotFoundError('Application', input.applicationId);
    }

    let orderedHistory = await db.applicationStatusHistory.findMany({
      where: { applicationId: input.applicationId },
      orderBy: [{ timestamp: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    let historyEntry: ApplicationStatusHistoryRecord | null = null;

    const previousStatus =
      orderedHistory.at(-1)?.status ?? this.normalizeStatus(application.status) ?? null;
    const created = await db.applicationStatusHistory.create({
      data: {
        applicationId: input.applicationId,
        previousStatus,
        status: normalizedStatus,
        source: input.source,
        sourceEmailId: input.sourceEmailId ?? null,
        changedByUserId: input.changedByUserId ?? null,
        timestamp: input.timestamp ?? new Date(),
        metadata: this.normalizeJson(input.metadata),
      },
    });

    historyEntry = this.mapHistory(created);
    orderedHistory = await db.applicationStatusHistory.findMany({
      where: { applicationId: input.applicationId },
      orderBy: [{ timestamp: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    let nextStatus = this.normalizeStatus(application.status) ?? normalizedStatus;
    for (const entry of orderedHistory) {
      nextStatus = this.applyTransition(nextStatus, entry.status, entry.source);
    }

    const nextStage = this.mapStatusToStage(nextStatus);
    const currentStatus = this.normalizeStatus(application.status) ?? nextStatus;
    const shouldUpdateApplication =
      currentStatus !== nextStatus ||
      application.currentStage !== nextStage ||
      this.isManualSource(input.source);

    let timelineEvent: {
      id: string;
      applicationId: string;
      eventType: string;
      timestamp: Date;
      sourceEmailId: string | null;
      metadata: Prisma.JsonValue | null;
      description: string | null;
    } | null = null;

    if (shouldUpdateApplication) {
      const updatedApp = await db.jobApplication.update({
        where: { id: input.applicationId },
        data: {
          status: nextStatus,
          currentStage: nextStage,
        },
      });

      const timelineInput = applicationTimelineService.buildStatusTimelineEvent({
        applicationId: input.applicationId,
        status: nextStatus,
        timestamp: input.timestamp ?? new Date(),
        metadata: {
          source: input.source,
          sourceEmailId: input.sourceEmailId ?? null,
          changedByUserId: input.changedByUserId ?? null,
        },
      });

      if (timelineInput) {
        timelineEvent = await db.applicationTimeline.create({
          data: {
            ...timelineInput,
            occurredAt: timelineInput.timestamp,
            metadata: timelineInput.metadata === null ? Prisma.JsonNull : timelineInput.metadata,
          },
        });
      }

      return {
        application: {
          id: updatedApp.id,
          status: updatedApp.status,
          currentStage: updatedApp.currentStage,
          updatedAt: updatedApp.updatedAt,
        },
        historyEntry,
        timelineEvent: timelineEvent ? this.mapTimelineEvent(timelineEvent) : null,
      };
    }

    return {
      application: {
        id: application.id,
        status: application.status,
        currentStage: application.currentStage,
        updatedAt: new Date(),
      },
      historyEntry,
      timelineEvent: null,
    };
  }

  private applyTransition(
    currentStatus: ApplicationStatus,
    nextStatusRaw: string,
    source: string,
  ): ApplicationStatus {
    const nextStatus = this.normalizeStatus(nextStatusRaw);
    if (!nextStatus) {
      return currentStatus;
    }

    if (this.isManualSource(source)) {
      return nextStatus;
    }

    if (currentStatus === nextStatus) {
      return currentStatus;
    }

    if (this.isTerminalStatus(currentStatus) && !this.isTerminalStatus(nextStatus)) {
      return currentStatus;
    }

    if (this.isTerminalStatus(nextStatus)) {
      return nextStatus;
    }

    if (this.statusRank(nextStatus) >= this.statusRank(currentStatus)) {
      return nextStatus;
    }

    return currentStatus;
  }

  private isTerminalStatus(status: ApplicationStatus): boolean {
    return status === ApplicationStatus.REJECTED || status === ApplicationStatus.WITHDRAWN;
  }

  private statusRank(status: ApplicationStatus): number {
    switch (status) {
      case ApplicationStatus.SAVED:
        return 0;
      case ApplicationStatus.APPLIED:
        return 1;
      case ApplicationStatus.SCREENING:
        return 2;
      case ApplicationStatus.ASSESSMENT:
        return 3;
      case ApplicationStatus.INTERVIEW:
        return 4;
      case ApplicationStatus.OFFER:
        return 5;
      case ApplicationStatus.REJECTED:
      case ApplicationStatus.WITHDRAWN:
        return 6;
      default:
        return 0;
    }
  }

  private mapStatusToStage(status: string): string {
    switch (normalizeApplicationStatus(status)) {
      case ApplicationStatus.SAVED:
        return 'Saved';
      case ApplicationStatus.APPLIED:
        return 'Applied';
      case ApplicationStatus.SCREENING:
        return 'Screening';
      case ApplicationStatus.ASSESSMENT:
        return 'Assessment';
      case ApplicationStatus.INTERVIEW:
        return 'Interview';
      case ApplicationStatus.OFFER:
        return 'Offer';
      case ApplicationStatus.REJECTED:
        return 'Rejected';
      case ApplicationStatus.WITHDRAWN:
        return 'Withdrawn';
      default:
        return status;
    }
  }

  private isManualSource(source: string): source is ApplicationStatusSource {
    return source === 'MANUAL';
  }

  private mapHistory(entry: {
    id: string;
    applicationId: string;
    previousStatus: string | null;
    status: string;
    source: string;
    sourceEmailId: string | null;
    changedByUserId: string | null;
    timestamp: Date;
    metadata: any;
    createdAt: Date;
  }): ApplicationStatusHistoryRecord {
    return {
      id: entry.id,
      applicationId: entry.applicationId,
      previousStatus: entry.previousStatus
        ? normalizeApplicationStatus(entry.previousStatus)
        : null,
      status: normalizeApplicationStatus(entry.status) ?? ApplicationStatus.SAVED,
      source: entry.source,
      sourceEmailId: entry.sourceEmailId,
      changedByUserId: entry.changedByUserId,
      timestamp: entry.timestamp.toISOString(),
      metadata: entry.metadata,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.createdAt.toISOString(),
    };
  }

  private normalizeStatus(status: string): ApplicationStatus | null {
    return normalizeApplicationStatus(status);
  }

  private mapTimelineEvent(entry: {
    id: string;
    applicationId: string;
    eventType: string;
    timestamp: Date;
    sourceEmailId: string | null;
    metadata: Prisma.JsonValue | null;
    description: string | null;
  }): NonNullable<StatusChangeResult['timelineEvent']> {
    return {
      id: entry.id,
      applicationId: entry.applicationId,
      eventType: entry.eventType,
      timestamp: entry.timestamp.toISOString(),
      sourceEmailId: entry.sourceEmailId,
      metadata: entry.metadata,
      description: entry.description,
    };
  }

  private normalizeJson(
    value: Prisma.InputJsonValue | null | undefined,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (value === null) {
      return Prisma.JsonNull;
    }

    return value;
  }
}

export const statusEngine = new StatusEngine();
