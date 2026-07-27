import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { NotFoundError } from '../../errors/app-errors';
import { companyService } from '../company';
import { ownershipGuard } from '../ownership/ownership.guard';
import { resolvePagination, type PaginationInput } from '../../domain/pagination';

type DbClient = PrismaClient | Prisma.TransactionClient;

type CompanyRecord = {
  id: string;
  name: string;
  domain: string;
};

type RecruiterBaseRecord = {
  id: string;
  companyId: string;
  name: string;
  email: string;
  title: string;
  createdAt: Date;
  company: CompanyRecord;
};

type RecruiterListQueryRecord = RecruiterBaseRecord & {
  applications: Array<{ id: string }>;
  emails: Array<{ id: string; receivedAt: Date }>;
};

type RecruiterInsightQueryRecord = RecruiterBaseRecord & {
  applications: Array<{
    id: string;
    appliedDate: Date;
    status: string;
    roleTitle: string;
    companyName: string;
  }>;
  emails: Array<{
    id: string;
    applicationId: string | null;
    providerMessageId: string;
    subject: string;
    sender: string;
    threadId: string | null;
    receivedAt: Date;
  }>;
};

export interface RecruiterSyncCompanyInput {
  readonly name: string;
  readonly domain: string;
}

export interface RecruiterSyncApplicationInput {
  readonly id: string;
  readonly userId: string;
  readonly companyId?: string | null;
  readonly companyName: string;
  readonly companyDomain: string;
  readonly roleTitle: string;
  readonly recruiterName: string;
  readonly recruiterEmail: string;
}

export interface RecruiterSyncEmailInput {
  readonly emailId: string;
  readonly sender: string;
  readonly subject: string;
  readonly bodyText?: string | null;
  readonly receivedAt?: Date;
  readonly threadId?: string | null;
}

export interface RecruiterProfile {
  readonly id: string;
  readonly companyId: string;
  readonly company: {
    readonly id: string;
    readonly name: string;
    readonly domain: string;
  };
  readonly name: string;
  readonly email: string;
  readonly title: string;
  readonly createdAt: string;
}

export interface LinkedEmailConversation {
  readonly id: string;
  readonly applicationId: string | null;
  readonly providerMessageId: string;
  readonly subject: string;
  readonly sender: string;
  readonly threadId: string | null;
  readonly receivedAt: string;
}

export interface RecruiterInsight {
  readonly recruiter: RecruiterProfile;
  readonly firstContactAt: string | null;
  readonly lastContactAt: string | null;
  readonly totalEmails: number;
  readonly averageResponseTimeMinutes: number;
  readonly applicationCount: number;
  readonly linkedEmailConversations: readonly LinkedEmailConversation[];
}

export interface RecruiterListItem extends RecruiterProfile {
  readonly applicationCount: number;
  readonly totalEmails: number;
  readonly lastContactAt: string | null;
}

export interface RecruiterListFilters {
  readonly company?: string;
  readonly name?: string;
}

export class RecruiterService {
  public async syncRecruiterFromEmail(
    input: {
      userId: string;
      application: RecruiterSyncApplicationInput;
      email: RecruiterSyncEmailInput;
      company: RecruiterSyncCompanyInput;
      recruiter: { name?: string; email?: string };
      title?: string;
    },
    db: DbClient = prisma,
  ): Promise<RecruiterProfile | null> {
    await ownershipGuard.ensureApplicationAccess(input.userId, input.application.id, db);

    const recruiterEmail = input.recruiter.email ?? input.email.sender;
    if (!recruiterEmail) {
      return null;
    }

    const company = await companyService.resolveCompany(
      {
        name: input.company.name,
        domain: input.company.domain,
      },
      db,
    );

    const recruiter = (await db.recruiter.upsert({
      where: {
        unique_company_recruiter_email: {
          companyId: company.id,
          email: recruiterEmail,
        },
      },
      create: {
        companyId: company.id,
        name: input.recruiter.name?.trim() || this.inferNameFromEmail(recruiterEmail),
        email: recruiterEmail,
        title: this.normalizeTitle(
          input.title ?? this.inferTitle(input.email, input.application.roleTitle),
        ),
      },
      update: {
        name: input.recruiter.name?.trim() || this.inferNameFromEmail(recruiterEmail),
        title: this.normalizeTitle(
          input.title ?? this.inferTitle(input.email, input.application.roleTitle),
        ),
      },
      include: {
        company: true,
      },
    })) as RecruiterBaseRecord;

    await db.jobApplication.update({
      where: { id: input.application.id },
      data: {
        recruiterId: recruiter.id,
        recruiterName: recruiter.name,
        recruiterEmail: recruiter.email,
      },
    });

    await db.emailMessage.update({
      where: {
        unique_user_message: {
          legacyUserId: input.userId,
          providerMessageId: input.email.emailId,
        },
      },
      data: {
        application: {
          connect: {
            id: input.application.id,
          },
        },
        recruiter: {
          connect: {
            id: recruiter.id,
          },
        },
      },
    });

    return this.mapRecruiter(recruiter);
  }

  public async listRecruiters(
    userId: string,
    filters: RecruiterListFilters = {},
    pagination?: PaginationInput,
  ): Promise<readonly RecruiterListItem[]> {
    const paging = resolvePagination(pagination);
    const searchConditions: Prisma.RecruiterWhereInput[] = [
      ...(filters.name
        ? [{ name: { contains: filters.name, mode: Prisma.QueryMode.insensitive } }]
        : []),
      ...(filters.company
        ? [
            {
              company: {
                is: { name: { contains: filters.company, mode: Prisma.QueryMode.insensitive } },
              },
            },
            {
              company: {
                is: { domain: { contains: filters.company, mode: Prisma.QueryMode.insensitive } },
              },
            },
          ]
        : []),
    ];

    const recruiters = (await prisma.recruiter.findMany({
      where: {
        ...(searchConditions.length > 0 ? { OR: searchConditions } : {}),
        applications: {
          some: { userId },
        },
      },
      include: {
        company: true,
        applications: {
          where: { userId },
          select: { id: true },
        },
        emails: {
          where: { userId },
          select: {
            id: true,
            receivedAt: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      ...(paging ? { skip: paging.skip, take: paging.take } : {}),
    })) as RecruiterListQueryRecord[];

    return recruiters.map((recruiter) => ({
      ...this.mapRecruiter(recruiter),
      applicationCount: recruiter.applications.length,
      totalEmails: recruiter.emails.length,
      lastContactAt:
        recruiter.emails.length > 0
          ? new Date(
              Math.max(...recruiter.emails.map((email) => email.receivedAt.getTime())),
            ).toISOString()
          : null,
    }));
  }

  public async getRecruiter(userId: string, recruiterId: string): Promise<RecruiterInsight> {
    await ownershipGuard.ensureRecruiterAccess(userId, recruiterId, prisma);

    const recruiter = (await prisma.recruiter.findFirst({
      where: { id: recruiterId },
      include: {
        company: true,
        applications: {
          where: { userId },
          select: {
            id: true,
            appliedDate: true,
            status: true,
            roleTitle: true,
            companyName: true,
          },
        },
        emails: {
          where: { userId },
          orderBy: { receivedAt: 'asc' },
          select: {
            id: true,
            providerMessageId: true,
            subject: true,
            sender: true,
            threadId: true,
            receivedAt: true,
          },
        },
      },
    })) as RecruiterInsightQueryRecord | null;

    if (!recruiter) {
      throw new NotFoundError('Recruiter', recruiterId);
    }

    return this.buildInsight(recruiter);
  }

  public async getRecruiterByApplication(
    userId: string,
    applicationId: string,
  ): Promise<RecruiterInsight | null> {
    const application = await prisma.jobApplication.findFirst({
      where: {
        id: applicationId,
        userId,
      },
      select: {
        recruiterId: true,
      },
    });

    if (!application?.recruiterId) {
      return null;
    }

    return this.getRecruiter(userId, application.recruiterId);
  }

  public async getRecruiterInsights(
    userId: string,
    recruiterId: string,
  ): Promise<RecruiterInsight> {
    return this.getRecruiter(userId, recruiterId);
  }

  private buildInsight(recruiter: {
    id: string;
    companyId: string;
    name: string;
    email: string;
    title: string;
    createdAt: Date;
    company: CompanyRecord;
    applications: RecruiterInsightQueryRecord['applications'];
    emails: RecruiterInsightQueryRecord['emails'];
  }): RecruiterInsight {
    const averageResponseTimeMinutes = this.calculateAverageResponseTimeMinutes(recruiter.emails);

    return {
      recruiter: this.mapRecruiter(recruiter),
      firstContactAt:
        recruiter.emails.length > 0 ? recruiter.emails[0]!.receivedAt.toISOString() : null,
      lastContactAt:
        recruiter.emails.length > 0
          ? recruiter.emails[recruiter.emails.length - 1]!.receivedAt.toISOString()
          : null,
      totalEmails: recruiter.emails.length,
      averageResponseTimeMinutes,
      applicationCount: recruiter.applications.length,
      linkedEmailConversations: recruiter.emails.map((email) => ({
        id: email.id,
        applicationId: email.applicationId,
        providerMessageId: email.providerMessageId,
        subject: email.subject,
        sender: email.sender,
        threadId: email.threadId,
        receivedAt: email.receivedAt.toISOString(),
      })),
    };
  }

  private calculateAverageResponseTimeMinutes(
    emails: ReadonlyArray<{
      threadId: string | null;
      receivedAt: Date;
    }>,
  ): number {
    const byThread = new Map<string, Date[]>();

    for (const email of emails) {
      const key = email.threadId ?? `__threadless_${email.receivedAt.toISOString()}`;
      const bucket = byThread.get(key) ?? [];
      bucket.push(email.receivedAt);
      byThread.set(key, bucket);
    }

    const deltas: number[] = [];
    for (const times of byThread.values()) {
      const sorted = [...times].sort((left, right) => left.getTime() - right.getTime());
      for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1]!;
        const current = sorted[index]!;
        deltas.push((current.getTime() - previous.getTime()) / (1000 * 60));
      }
    }

    if (deltas.length === 0) {
      return 0;
    }

    const average = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
    return Math.round(average * 10) / 10;
  }

  private inferNameFromEmail(email: string): string {
    const localPart = email.split('@')[0] ?? '';
    if (!localPart) {
      return 'Recruiter';
    }

    return localPart
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private inferTitle(email: RecruiterSyncEmailInput, roleTitle: string): string {
    const searchText = `${email.subject}\n${email.bodyText ?? ''}`.toLowerCase();
    if (/(senior\s+)?recruiter|talent acquisition|talent partner/.test(searchText)) {
      return 'Recruiter';
    }
    if (/hiring manager/.test(searchText)) {
      return 'Hiring Manager';
    }
    if (/sourcer/.test(searchText)) {
      return 'Sourcer';
    }
    if (/people operations|people partner|hr/.test(searchText)) {
      return 'People Operations';
    }

    if (roleTitle.toLowerCase().includes('intern')) {
      return 'Recruiter';
    }

    return 'Recruiter';
  }

  private normalizeTitle(title: string): string {
    return title.trim().length > 0 ? title.trim() : 'Recruiter';
  }

  private mapRecruiter(recruiter: {
    id: string;
    companyId: string;
    name: string;
    email: string;
    title: string;
    createdAt: Date;
    company: {
      id: string;
      name: string;
      domain: string;
    };
  }): RecruiterProfile {
    return {
      id: recruiter.id,
      companyId: recruiter.companyId,
      company: recruiter.company,
      name: recruiter.name,
      email: recruiter.email,
      title: recruiter.title,
      createdAt: recruiter.createdAt.toISOString(),
    };
  }
}

export const recruiterService = new RecruiterService();
