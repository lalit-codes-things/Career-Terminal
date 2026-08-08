import { ApplicationTimelineEventType, PrismaClient, Prisma } from '@prisma/client';
import { dbRouter } from '../../config/database';
import { NotFoundError } from '../../errors/app-errors';
import { ApplicationStatus, normalizeApplicationStatus } from '../../domain/application-status';
import { resolvePagination, type PaginationInput } from '../../domain/pagination';
import {
  JobEmailCategory,
  type ClassifiableEmail,
  type JobEmailClassification,
} from '../job-intelligence';
import { ownershipGuard } from '../ownership/ownership.guard';

type DbClient = PrismaClient | Prisma.TransactionClient;

export { ApplicationTimelineEventType };

export interface ApplicationTimelineRecord {
  readonly id: string;
  readonly applicationId: string;
  readonly eventType: ApplicationTimelineEventType;
  readonly timestamp: string;
  readonly sourceEmailId: string | null;
  readonly metadata: Prisma.JsonValue | null;
  readonly description: string | null;
}

export interface CreateTimelineEventInput {
  readonly applicationId: string;
  readonly eventType: ApplicationTimelineEventType;
  readonly timestamp: Date;
  readonly occurredAt?: Date;
  readonly sourceEmailId?: string | null;
  readonly metadata?: Prisma.InputJsonValue | null | undefined;
  readonly description?: string | null;
}

export interface UpdateTimelineEventInput {
  readonly eventType?: ApplicationTimelineEventType;
  readonly timestamp?: Date;
  readonly sourceEmailId?: string | null;
  readonly metadata?: Prisma.InputJsonValue | null;
  readonly description?: string | null;
}

export interface EmailTimelineContext {
  readonly applicationId: string;
  readonly email: ClassifiableEmail;
  readonly classification: JobEmailClassification;
  readonly metadata?: Record<string, unknown>;
}

export interface StatusTimelineContext {
  readonly applicationId: string;
  readonly status: string;
  readonly timestamp?: Date;
  readonly metadata?: Record<string, unknown>;
}

export class ApplicationTimelineService {
  public async listTimeline(
    applicationId: string,
    db: DbClient = dbRouter.read(),
    userId?: string,
    pagination?: PaginationInput,
  ): Promise<readonly ApplicationTimelineRecord[]> {
    if (userId) {
      await ownershipGuard.ensureApplicationAccess(userId, applicationId, db);
    }

    const paging = resolvePagination(pagination);

    const events = await db.applicationTimeline.findMany({
      where: { applicationId },
      orderBy: [{ timestamp: 'asc' }, { createdAt: 'asc' }],
      skip: paging.skip,
      take: paging.take,
    });

    return [...events]
      .sort(
        (left, right) =>
          left.timestamp.getTime() - right.timestamp.getTime() ||
          left.createdAt.getTime() - right.createdAt.getTime() ||
          left.id.localeCompare(right.id),
      )
      .map((event) => this.mapRecord(event));
  }

  public async getTimelineEvent(
    eventId: string,
    db: DbClient = dbRouter.read(),
    userId?: string,
  ): Promise<ApplicationTimelineRecord> {
    const event = userId
      ? await db.applicationTimeline.findFirst({
          where: {
            id: eventId,
            application: {
              userId,
            },
          },
        })
      : await db.applicationTimeline.findUnique({
          where: { id: eventId },
        });

    if (!event) {
      throw new NotFoundError('Timeline event', eventId);
    }

    return this.mapRecord(event);
  }

  public async createTimelineEvent(
    input: CreateTimelineEventInput,
    db: DbClient = dbRouter.read(),
    userId?: string,
  ): Promise<ApplicationTimelineRecord> {
    if (userId) {
      await ownershipGuard.ensureApplicationAccess(userId, input.applicationId, db);
    }

    const event = await db.applicationTimeline.create({
      data: {
        applicationId: input.applicationId,
        eventType: input.eventType,
        timestamp: input.timestamp,
        occurredAt: input.timestamp,
        sourceEmailId: input.sourceEmailId ?? null,
        metadata: this.normalizeJson(input.metadata),
        description: input.description ?? null,
      },
    });

    return this.mapRecord(event);
  }

  public async patchTimelineEvent(
    eventId: string,
    input: UpdateTimelineEventInput,
    db: DbClient = dbRouter.read(),
    userId?: string,
  ): Promise<ApplicationTimelineRecord> {
    const existingEvent = userId
      ? await db.applicationTimeline.findFirst({
          where: {
            id: eventId,
            application: {
              userId,
            },
          },
        })
      : await db.applicationTimeline.findUnique({
          where: { id: eventId },
        });

    if (!existingEvent) {
      throw new NotFoundError('Timeline event', eventId);
    }

    const event = await db.applicationTimeline.update({
      where: { id: eventId },
      data: {
        eventType: input.eventType,
        timestamp: input.timestamp,
        occurredAt: input.timestamp,
        sourceEmailId: input.sourceEmailId,
        metadata: this.normalizeJson(input.metadata),
        description: input.description,
      },
    });

    return this.mapRecord(event);
  }

  public buildEmailTimelineEvent(input: EmailTimelineContext): CreateTimelineEventInput | null {
    const eventType = this.resolveEmailEventType(input.email, input.classification);

    if (!eventType) {
      return null;
    }

    const text = this.buildSearchText(input.email);
    const metadata = {
      ...(input.metadata ?? {}),
      sourceEmailId: input.email.emailId,
      sender: input.email.sender,
      subject: input.email.subject,
      threadId: input.email.threadId ?? null,
      classification: {
        category: input.classification.category,
        confidence: input.classification.confidence,
        detectedCompany: input.classification.detectedCompany,
        detectedRole: input.classification.detectedRole,
      },
      matchedText: text.slice(0, 500),
    };

    return {
      applicationId: input.applicationId,
      eventType,
      timestamp: input.email.receivedAt ?? new Date(),
      sourceEmailId: input.email.emailId,
      metadata,
      description: this.describeEmailEvent(eventType, input.email.subject),
    };
  }

  public buildStatusTimelineEvent(input: StatusTimelineContext): CreateTimelineEventInput | null {
    const eventType = this.mapStatusToEventType(input.status);

    if (!eventType) {
      return null;
    }

    return {
      applicationId: input.applicationId,
      eventType,
      timestamp: input.timestamp ?? new Date(),
      metadata: {
        ...(input.metadata ?? {}),
        newStatus: input.status,
      },
      description: `Application status updated to ${input.status}`,
    };
  }

  public resolveEmailEventType(
    email: ClassifiableEmail,
    classification: JobEmailClassification,
  ): ApplicationTimelineEventType | null {
    const searchText = this.buildSearchText(email);

    switch (classification.category) {
      case JobEmailCategory.JOB_APPLICATION:
        return this.hasAny(searchText, [
          'received',
          'confirmed',
          'thank you for applying',
          'application confirmation',
        ])
          ? ApplicationTimelineEventType.APPLICATION_CONFIRMED
          : ApplicationTimelineEventType.APPLICATION_SUBMITTED;
      case JobEmailCategory.RECRUITER_OUTREACH:
        return ApplicationTimelineEventType.RECRUITER_CONTACT;
      case JobEmailCategory.ASSESSMENT_TEST:
        return this.hasAny(searchText, [
          'completed',
          'completion',
          'submitted',
          'finished',
          'passed',
        ])
          ? ApplicationTimelineEventType.ASSESSMENT_COMPLETED
          : ApplicationTimelineEventType.ASSESSMENT;
      case JobEmailCategory.INTERVIEW_INVITATION:
        if (
          this.hasAny(searchText, [
            'final interview',
            'final round',
            'onsite',
            'on-site',
            'panel',
            'loop',
          ])
        ) {
          return ApplicationTimelineEventType.FINAL_INTERVIEW;
        }
        if (
          this.hasAny(searchText, [
            'phone screen',
            'phone interview',
            'screening call',
            'screening',
          ])
        ) {
          return ApplicationTimelineEventType.PHONE_SCREEN;
        }
        return ApplicationTimelineEventType.INTERVIEW;
      case JobEmailCategory.OFFER:
        return ApplicationTimelineEventType.OFFER;
      case JobEmailCategory.REJECTION:
        return ApplicationTimelineEventType.REJECTION;
      default:
        return null;
    }
  }

  public mapStatusToEventType(status: string): ApplicationTimelineEventType | null {
    const normalizedStatus = normalizeApplicationStatus(status);

    switch (normalizedStatus) {
      case ApplicationStatus.APPLIED:
        return ApplicationTimelineEventType.APPLICATION_CONFIRMED;
      case ApplicationStatus.SCREENING:
        return ApplicationTimelineEventType.RECRUITER_CONTACT;
      case ApplicationStatus.ASSESSMENT:
        return ApplicationTimelineEventType.ASSESSMENT;
      case ApplicationStatus.INTERVIEW:
        return ApplicationTimelineEventType.INTERVIEW;
      case ApplicationStatus.OFFER:
        return ApplicationTimelineEventType.OFFER;
      case ApplicationStatus.REJECTED:
        return ApplicationTimelineEventType.REJECTION;
      case ApplicationStatus.WITHDRAWN:
        return ApplicationTimelineEventType.WITHDRAWN;
      default:
        return null;
    }
  }

  private mapRecord(record: {
    id: string;
    applicationId: string;
    eventType: string;
    timestamp: Date;
    sourceEmailId: string | null;
    metadata: Prisma.JsonValue | null;
    description: string | null;
  }): ApplicationTimelineRecord {
    return {
      id: record.id,
      applicationId: record.applicationId,
      eventType: record.eventType as ApplicationTimelineEventType,
      timestamp: record.timestamp.toISOString(),
      sourceEmailId: record.sourceEmailId,
      metadata: record.metadata,
      description: record.description,
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

  private buildSearchText(email: ClassifiableEmail): string {
    const textBody = email.bodyText?.trim() ?? '';
    const htmlBody = email.bodyHtml?.trim() ?? '';
    const body = textBody || htmlBody;
    return `${email.subject}\n${body}`.toLowerCase();
  }

  private hasAny(searchText: string, patterns: readonly string[]): boolean {
    return patterns.some((pattern) => searchText.includes(pattern.toLowerCase()));
  }

  private describeEmailEvent(eventType: ApplicationTimelineEventType, subject: string): string {
    return `${eventType.replace(/_/g, ' ')} from ${subject || 'Unknown Subject'}`;
  }
}

export const applicationTimelineService = new ApplicationTimelineService();
