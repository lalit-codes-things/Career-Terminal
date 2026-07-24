import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { NotFoundError } from '../../errors/app-errors';

type DbClient = PrismaClient | Prisma.TransactionClient;

export class OwnershipGuard {
  public async ensureApplicationAccess(
    userId: string,
    applicationId: string,
    db: DbClient = prisma,
  ): Promise<{ id: string; userId: string }> {
    const application = await db.jobApplication.findFirst({
      where: {
        id: applicationId,
        userId,
      },
      select: { id: true, userId: true },
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
        application: {
          userId,
        },
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
          some: { userId },
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
          some: { userId },
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
