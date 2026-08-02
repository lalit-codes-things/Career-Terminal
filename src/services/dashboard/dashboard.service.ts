import { ApplicationTimelineEventType, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { ApplicationStatus } from '../../domain/application-status';
import { DEFAULT_ACTIVITY_LIMIT, DEFAULT_UPCOMING_LIMIT } from '../../lib/constants';
import { InMemoryCacheStore, type CacheStore } from '../../lib/cache';
import { resolvePagination, type PaginationInput } from '../../domain/pagination';
import { userOwnershipFilter } from '../../utils/user-ownership';

type DbClient = typeof prisma;

export interface DashboardSummary {
  readonly totalApplications: number;
  readonly activeApplications: number;
  readonly interviews: number;
  readonly offers: number;
  readonly rejections: number;
  readonly pendingAssessments: number;
  readonly responseRate: number;
}

export interface DashboardActivityItem {
  readonly id: string;
  readonly applicationId: string;
  readonly companyName: string | null;
  readonly roleTitle: string | null;
  readonly eventType: ApplicationTimelineEventType;
  readonly timestamp: string;
  readonly sourceEmailId: string | null;
  readonly description: string | null;
  readonly metadata: Prisma.JsonValue | null;
}

export interface DashboardUpcomingInterviewItem {
  readonly id: string;
  readonly applicationId: string;
  readonly companyName: string | null;
  readonly roleTitle: string | null;
  readonly eventType: ApplicationTimelineEventType;
  readonly timestamp: string;
  readonly sourceEmailId: string | null;
  readonly description: string | null;
  readonly metadata: Prisma.JsonValue | null;
}

const SUMMARY_CACHE_TTL_MS = 30_000;
const ACTIVITY_CACHE_TTL_MS = 15_000;
const UPCOMING_CACHE_TTL_MS = 15_000;

export class DashboardService {
  constructor(private readonly cache: CacheStore = new InMemoryCacheStore()) {}

  public async getDashboard(userId: string, db: DbClient = prisma): Promise<DashboardSummary> {
    const cached = this.getCache<DashboardSummary>(this.cacheKey('summary', userId));
    if (cached) {
      return cached;
    }

    const grouped = await db.jobApplication.groupBy({
      by: ['status'],
      where: userOwnershipFilter(userId),
      _count: { _all: true },
    });

    const counts = new Map<string, number>(
      grouped.map((row) => [row.status.toUpperCase(), row._count._all]),
    );
    const totalApplications = grouped.reduce((sum, row) => sum + row._count._all, 0);
    const interviews = counts.get(ApplicationStatus.INTERVIEW) ?? 0;
    const offers = counts.get(ApplicationStatus.OFFER) ?? 0;
    const rejections = counts.get(ApplicationStatus.REJECTED) ?? 0;
    const pendingAssessments = counts.get(ApplicationStatus.ASSESSMENT) ?? 0;
    const activeApplications =
      totalApplications - rejections - (counts.get(ApplicationStatus.WITHDRAWN) ?? 0);
    const responseStatuses = new Set<string>([
      ApplicationStatus.SCREENING,
      ApplicationStatus.ASSESSMENT,
      ApplicationStatus.INTERVIEW,
      ApplicationStatus.OFFER,
      ApplicationStatus.REJECTED,
      ApplicationStatus.WITHDRAWN,
    ]);
    const responses = grouped
      .filter((row) => responseStatuses.has(row.status.toUpperCase()))
      .reduce((sum, row) => sum + row._count._all, 0);

    const summary: DashboardSummary = {
      totalApplications,
      activeApplications,
      interviews,
      offers,
      rejections,
      pendingAssessments,
      responseRate: totalApplications > 0 ? responses / totalApplications : 0,
    };

    this.setCache(this.cacheKey('summary', userId), summary, SUMMARY_CACHE_TTL_MS);
    return summary;
  }

  public async getActivity(
    userId: string,
    limitOrPagination: number | PaginationInput = DEFAULT_ACTIVITY_LIMIT,
    db: DbClient = prisma,
  ): Promise<readonly DashboardActivityItem[]> {
    const pagination =
      typeof limitOrPagination === 'number'
        ? { page: 1, pageSize: limitOrPagination, skip: 0, take: limitOrPagination }
        : (resolvePagination(limitOrPagination) ?? {
            page: 1,
            pageSize: DEFAULT_ACTIVITY_LIMIT,
            skip: 0,
            take: DEFAULT_ACTIVITY_LIMIT,
          });
    const cacheKey = this.cacheKey('activity', userId, pagination.page, pagination.pageSize);
    const cached = this.getCache<readonly DashboardActivityItem[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const events = await db.applicationTimeline.findMany({
      where: {
        application: userOwnershipFilter(userId),
      },
      orderBy: [{ timestamp: 'desc' }, { createdAt: 'desc' }],
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        applicationId: true,
        eventType: true,
        timestamp: true,
        sourceEmailId: true,
        metadata: true,
        description: true,
        application: {
          select: {
            companyName: true,
            roleTitle: true,
          },
        },
      },
    });

    const activity = events.map((event) => ({
      id: event.id,
      applicationId: event.applicationId,
      companyName: event.application.companyName,
      roleTitle: event.application.roleTitle,
      eventType: event.eventType,
      timestamp: event.timestamp.toISOString(),
      sourceEmailId: event.sourceEmailId,
      description: event.description,
      metadata: event.metadata,
    }));

    this.setCache(cacheKey, activity, ACTIVITY_CACHE_TTL_MS);
    return activity;
  }

  public async getUpcomingInterviews(
    userId: string,
    limitOrPagination: number | PaginationInput = DEFAULT_UPCOMING_LIMIT,
    db: DbClient = prisma,
  ): Promise<readonly DashboardUpcomingInterviewItem[]> {
    const pagination =
      typeof limitOrPagination === 'number'
        ? { page: 1, pageSize: limitOrPagination, skip: 0, take: limitOrPagination }
        : (resolvePagination(limitOrPagination) ?? {
            page: 1,
            pageSize: DEFAULT_UPCOMING_LIMIT,
            skip: 0,
            take: DEFAULT_UPCOMING_LIMIT,
          });
    const cacheKey = this.cacheKey('upcoming', userId, pagination.page, pagination.pageSize);
    const cached = this.getCache<readonly DashboardUpcomingInterviewItem[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const events = await db.applicationTimeline.findMany({
      where: {
        timestamp: {
          gte: new Date(),
        },
        eventType: {
          in: [
            ApplicationTimelineEventType.PHONE_SCREEN,
            ApplicationTimelineEventType.INTERVIEW,
            ApplicationTimelineEventType.FINAL_INTERVIEW,
          ],
        },
        application: userOwnershipFilter(userId),
      },
      orderBy: [{ timestamp: 'asc' }, { createdAt: 'asc' }],
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        applicationId: true,
        eventType: true,
        timestamp: true,
        sourceEmailId: true,
        metadata: true,
        description: true,
        application: {
          select: {
            companyName: true,
            roleTitle: true,
          },
        },
      },
    });

    const upcoming = events.map((event) => ({
      id: event.id,
      applicationId: event.applicationId,
      companyName: event.application.companyName,
      roleTitle: event.application.roleTitle,
      eventType: event.eventType,
      timestamp: event.timestamp.toISOString(),
      sourceEmailId: event.sourceEmailId,
      description: event.description,
      metadata: event.metadata,
    }));

    this.setCache(cacheKey, upcoming, UPCOMING_CACHE_TTL_MS);
    return upcoming;
  }

  public invalidateUser(userId: string): void {
    this.cache.deletePrefix(`${userId}:`);
  }

  private cacheKey(
    kind: 'summary' | 'activity' | 'upcoming',
    userId: string,
    page?: number,
    pageSize?: number,
  ): string {
    return `${userId}:${kind}:${page ?? 'default'}:${pageSize ?? 'default'}`;
  }

  private getCache<T>(key: string): T | null {
    return this.cache.get<T>(key);
  }

  private setCache<T>(key: string, value: T, ttlMs: number): void {
    this.cache.set(key, value, ttlMs);
  }
}

export const dashboardService = new DashboardService();
