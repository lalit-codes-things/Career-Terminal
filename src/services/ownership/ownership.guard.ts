import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { NotFoundError } from '../../errors/app-errors';
import { userOwnershipFilter } from '../../utils/user-ownership';

type DbClient = PrismaClient | Prisma.TransactionClient;

export class OwnershipGuard {
  public async ensureApplicationAccess(
    userId: string,
    applicationId: string,
    db: DbClient = prisma,
  ): Promise<{ id: string; userId: string | null; legacyUserId: string }> {
    const application = await db.jobApplication.findFirst({
      where: {
        id: applicationId,
        ...userOwnershipFilter(userId),
      },
      select: { id: true, userId: true, legacyUserId: true },
    });

    if (!application) {
      throw new NotFoundError('Application', applicationId);
    }

    return application;
  }

  public async ensureTimelineAccess(
    userId: string,
    eventId: string,
    db: DbClient = prisma,
  ): Promise<{ id: string; applicationId: string }> {
    const event = await db.applicationTimeline.findFirst({
      where: {
        id: eventId,
        application: userOwnershipFilter(userId),
      },
      select: {
        id: true,
        applicationId: true,
      },
    });

    if (!event) {
      throw new NotFoundError('Timeline event', eventId);
    }

    return event;
  }

  public async ensureCompanyAccess(
    userId: string,
    companyId: string,
    db: DbClient = prisma,
  ): Promise<{ id: string }> {
    const company = await db.company.findFirst({
      where: {
        id: companyId,
        applications: {
          some: userOwnershipFilter(userId),
        },
      },
      select: { id: true },
    });

    if (!company) {
      throw new NotFoundError('Company', companyId);
    }

    return company;
  }

  public async ensureRecruiterAccess(
    userId: string,
    recruiterId: string,
    db: DbClient = prisma,
  ): Promise<{ id: string }> {
    const recruiter = await db.recruiter.findFirst({
      where: {
        id: recruiterId,
        applications: {
          some: userOwnershipFilter(userId),
        },
      },
      select: { id: true },
    });

    if (!recruiter) {
      throw new NotFoundError('Recruiter', recruiterId);
    }

    return recruiter;
  }
}

export const ownershipGuard = new OwnershipGuard();
