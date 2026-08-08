import { Prisma, PrismaClient } from '@prisma/client';
import { dbRouter } from '../../config/database';
import { NotFoundError } from '../../errors/app-errors';
import { ownershipGuard } from '../ownership/ownership.guard';
import { applicationTimelineService } from '../application-timeline';
import { applicationReadModelService } from '../application-read-model/application-read-model.service';
import { ApplicationStatus } from '../../domain/application-status';
import { resolvePagination, type PaginationInput } from '../../domain/pagination';
import { userOwnershipFilter } from '../../utils/user-ownership';
import type {
  ApplicationDetailsView,
  ApplicationTimelineModel,
  ApplicationStatusHistoryModel,
} from '../../domain/application.models';
import { statusEngine } from '../status-engine';

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface ApplicationListFilters {
  readonly status?: string;
  readonly company?: string;
  readonly date?: string;
  readonly role?: string;
}

export class ApplicationQueryService {
  public async listApplications(
    userId: string,
    filters: ApplicationListFilters = {},
    pagination?: PaginationInput,
    db: DbClient = dbRouter.read(), // ← replica for list queries
  ): Promise<readonly ApplicationDetailsView['application'][]> {
    const where: Prisma.JobApplicationWhereInput = userOwnershipFilter(userId);

    if (filters.status) {
      where.status = filters.status.toUpperCase() as ApplicationStatus;
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

    const paging = resolvePagination(pagination);

    const applications = await db.jobApplication.findMany({
      where,
      orderBy: { appliedDate: 'desc' },
      skip: paging.skip,
      take: paging.take,
    });

    return applications.map((record) => applicationReadModelService.toApplication(record));
  }

  public async getApplication(
    userId: string,
    applicationId: string,
    db: DbClient = dbRouter.read(), // ← replica for single-record fetches too
  ): Promise<ApplicationDetailsView> {
    await ownershipGuard.ensureApplicationAccess(userId, applicationId, db);

    const applicationRecord = await db.jobApplication.findFirst({
      where: {
        id: applicationId,
        ...userOwnershipFilter(userId),
      },
      include: {
        emailMessages: {
          select: { id: true, subject: true },
          orderBy: { receivedAt: 'desc' },
        },
      },
    });

    if (!applicationRecord) {
      throw new NotFoundError('Application', applicationId);
    }

    const timeline = await this.getApplicationTimeline(userId, applicationId, undefined, db);

    return applicationReadModelService.buildDetailsView({
      application: applicationReadModelService.toApplication(applicationRecord),
      emailHistory: applicationRecord.emailMessages.map((email) => ({
        id: email.id,
        subject: email.subject || 'No Subject',
      })),
      timeline,
    });
  }

  public async getApplicationTimeline(
    userId: string,
    applicationId: string,
    pagination?: PaginationInput,
    db: DbClient = dbRouter.read(), // ← replica
  ): Promise<readonly ApplicationTimelineModel[]> {
    return applicationTimelineService.listTimeline(applicationId, db, userId, pagination);
  }

  public async getApplicationStatusHistory(
    userId: string,
    applicationId: string,
    pagination?: PaginationInput,
    db: DbClient = dbRouter.read(), // ← replica
  ): Promise<readonly ApplicationStatusHistoryModel[]> {
    await ownershipGuard.ensureApplicationAccess(userId, applicationId, db);
    const history = await statusEngine.getStatusHistory(applicationId, db, userId, pagination);
    return history.map((entry) => applicationReadModelService.toStatusHistory(entry));
  }
}

export const applicationQueryService = new ApplicationQueryService();
