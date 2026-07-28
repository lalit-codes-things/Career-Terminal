import { ApplicationStatus } from '../domain/application-status';
import { prisma } from '../config/database';
import { cacheService } from './cache/cache.service';

const ANALYTICS_CACHE_TTL_MS = 60 * 60 * 1000;
const MIN_BENCHMARK_APPLICATIONS = 25;
const MIN_SEGMENT_APPLICATIONS = 3;

type DbClient = typeof prisma;

export interface RateInterval {
  readonly rate: number;
  readonly lower: number;
  readonly upper: number;
}

export interface PerformanceRow {
  readonly key: string;
  readonly applications: number;
  readonly interviews: number;
  readonly offers: number;
  readonly interviewRate: RateInterval;
  readonly offerRate: RateInterval;
  readonly note: string;
}

export interface FunnelSummary {
  readonly totalApplications: number;
  readonly interviews: number;
  readonly offers: number;
  readonly acceptanceRate: number;
  readonly interviewRate: RateInterval;
  readonly offerRate: RateInterval;
}

export interface BenchmarkSummary {
  readonly populationApplications: number;
  readonly populationInterviewRate: RateInterval;
  readonly populationOfferRate: RateInterval;
  readonly userInterviewRate: RateInterval | null;
  readonly userOfferRate: RateInterval | null;
  readonly note: string;
}

export class AnalyticsService {
  constructor(private readonly cache = cacheService) {}

  async getResumePerformance(userId: string, db: DbClient = prisma): Promise<PerformanceRow[]> {
    return this.cached(`resume:${userId}`, async () => {
      const applications = await db.jobApplication.findMany({
        where: { userId },
        select: {
          id: true,
          status: true,
          resumes: {
            select: {
              resumeVersionId: true,
              resumeVersion: {
                select: { version: true, id: true, legacyUserId: true },
              },
            },
          },
        },
      });

      const grouped = new Map<string, { applications: number; interviews: number; offers: number }>();
      for (const application of applications) {
        const resumeVersionKey = application.resumes[0]?.resumeVersionId ?? 'unlinked';
        const row = grouped.get(resumeVersionKey) ?? {
          applications: 0,
          interviews: 0,
          offers: 0,
        };
        row.applications += 1;
        if (this.isInterviewStatus(application.status)) row.interviews += 1;
        if (this.isOfferStatus(application.status)) row.offers += 1;
        grouped.set(resumeVersionKey, row);
      }

      return Array.from(grouped.entries()).map(([key, row]) => ({
        key,
        applications: row.applications,
        interviews: row.interviews,
        offers: row.offers,
        interviewRate: this.buildRate(row.interviews, row.applications),
        offerRate: this.buildRate(row.offers, row.applications),
        note:
          row.applications < MIN_SEGMENT_APPLICATIONS
            ? 'Small sample; use as directional signal only.'
            : 'Correlational observation based on recorded outcomes.',
      }));
    });
  }

  async getActionPerformance(userId: string, db: DbClient = prisma): Promise<PerformanceRow[]> {
    return this.cached(`action:${userId}`, async () => {
      const actions = await db.actionEvent.findMany({
        where: { userId },
        select: {
          actionType: true,
          applicationId: true,
          application: {
            select: { status: true },
          },
        },
      });

      const grouped = new Map<string, { applications: Set<string>; interviews: number; offers: number }>();

      for (const action of actions) {
        const key = action.actionType;
        const row = grouped.get(key) ?? {
          applications: new Set<string>(),
          interviews: 0,
          offers: 0,
        };
        if (action.applicationId && action.application) {
          row.applications.add(action.applicationId);
          if (this.isInterviewStatus(action.application.status)) row.interviews += 1;
          if (this.isOfferStatus(action.application.status)) row.offers += 1;
        }
        grouped.set(key, row);
      }

      return Array.from(grouped.entries()).map(([key, row]) => {
        const applications = row.applications.size;
        return {
          key,
          applications,
          interviews: row.interviews,
          offers: row.offers,
          interviewRate: this.buildRate(row.interviews, applications),
          offerRate: this.buildRate(row.offers, applications),
          note: 'Correlational observation based on applications linked to recorded actions.',
        };
      });
    });
  }

  async getStrategyPerformance(userId: string, db: DbClient = prisma): Promise<PerformanceRow[]> {
    return this.cached(`strategy:${userId}`, async () => {
      const actions = await db.actionEvent.findMany({
        where: { userId },
        select: {
          strategyTags: true,
          applicationId: true,
          application: {
            select: { status: true },
          },
        },
      });

      const grouped = new Map<string, { applications: Set<string>; interviews: number; offers: number }>();

      for (const action of actions) {
        for (const tag of action.strategyTags ?? []) {
          const row = grouped.get(tag) ?? {
            applications: new Set<string>(),
            interviews: 0,
            offers: 0,
          };
        if (action.applicationId && action.application) {
          row.applications.add(action.applicationId);
          if (this.isInterviewStatus(action.application.status)) row.interviews += 1;
          if (this.isOfferStatus(action.application.status)) row.offers += 1;
        }
          grouped.set(tag, row);
        }
      }

      return Array.from(grouped.entries()).map(([key, row]) => {
        const applications = row.applications.size;
        return {
          key,
          applications,
          interviews: row.interviews,
          offers: row.offers,
          interviewRate: this.buildRate(row.interviews, applications),
          offerRate: this.buildRate(row.offers, applications),
          note:
            applications < MIN_SEGMENT_APPLICATIONS
              ? 'Small sample; directional only.'
              : 'Associated with observed outcomes, not causal.',
        };
      });
    });
  }

  async getTimingPerformance(userId: string, db: DbClient = prisma): Promise<PerformanceRow[]> {
    return this.cached(`timing:${userId}`, async () => {
      const applications = await db.jobApplication.findMany({
        where: { userId },
        select: {
          id: true,
          appliedDate: true,
          status: true,
          outcomeEvents: {
            where: { isCurrent: true },
            orderBy: { occurredAt: 'asc' },
            select: { occurredAt: true },
            take: 1,
          },
        },
      });

      const buckets = new Map<string, { applications: number; interviews: number; offers: number }>([
        ['within_24h', { applications: 0, interviews: 0, offers: 0 }],
        ['1_to_7d', { applications: 0, interviews: 0, offers: 0 }],
        ['over_7d', { applications: 0, interviews: 0, offers: 0 }],
      ]);

      for (const application of applications) {
        const firstOutcome = application.outcomeEvents[0]?.occurredAt;
        const diffMs = firstOutcome ? firstOutcome.getTime() - application.appliedDate.getTime() : 0;
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        const bucket =
          diffDays <= 1 ? 'within_24h' : diffDays <= 7 ? '1_to_7d' : 'over_7d';
        const row = buckets.get(bucket)!;
        row.applications += 1;
        if (this.isInterviewStatus(application.status)) row.interviews += 1;
        if (this.isOfferStatus(application.status)) row.offers += 1;
      }

      return Array.from(buckets.entries()).map(([key, row]) => ({
        key,
        applications: row.applications,
        interviews: row.interviews,
        offers: row.offers,
        interviewRate: this.buildRate(row.interviews, row.applications),
        offerRate: this.buildRate(row.offers, row.applications),
        note:
          key === 'within_24h'
            ? 'Observed first outcome within 24 hours of application date.'
            : key === '1_to_7d'
              ? 'Observed first outcome within 1 to 7 days of application date.'
              : 'Observed first outcome more than 7 days after application date.',
      }));
    });
  }

  async getOverallFunnel(userId: string, db: DbClient = prisma): Promise<FunnelSummary> {
    return this.cached(`funnel:${userId}`, async () => {
      const totalApplications = await db.jobApplication.count({ where: { userId } });
      const interviews = await db.jobApplication.count({
        where: { userId, status: { in: [ApplicationStatus.INTERVIEW, ApplicationStatus.ASSESSMENT, ApplicationStatus.OFFER] } },
      });
      const offers = await db.jobApplication.count({
        where: { userId, status: ApplicationStatus.OFFER },
      });
      return {
        totalApplications,
        interviews,
        offers,
        acceptanceRate: totalApplications > 0 ? offers / totalApplications : 0,
        interviewRate: this.buildRate(interviews, totalApplications),
        offerRate: this.buildRate(offers, totalApplications),
      };
    });
  }

  async getBenchmarks(userId: string, db: DbClient = prisma): Promise<BenchmarkSummary> {
    return this.cached(`benchmarks:${userId}`, async () => {
      const populationApplications = await db.jobApplication.count();
      if (populationApplications < MIN_BENCHMARK_APPLICATIONS) {
        return {
          populationApplications,
          populationInterviewRate: this.buildRate(0, 0),
          populationOfferRate: this.buildRate(0, 0),
          userInterviewRate: null,
          userOfferRate: null,
          note: 'Not enough anonymized population data for a stable benchmark.',
        };
      }

      const populationInterviewApplications = await db.jobApplication.count({
        where: { status: { in: [ApplicationStatus.INTERVIEW, ApplicationStatus.ASSESSMENT, ApplicationStatus.OFFER] } },
      });
      const populationOfferApplications = await db.jobApplication.count({
        where: { status: ApplicationStatus.OFFER },
      });
      const userApplications = await db.jobApplication.count({ where: { userId } });
      const userInterviewApplications = await db.jobApplication.count({
        where: {
          userId,
          status: { in: [ApplicationStatus.INTERVIEW, ApplicationStatus.ASSESSMENT, ApplicationStatus.OFFER] },
        },
      });
      const userOfferApplications = await db.jobApplication.count({
        where: { userId, status: ApplicationStatus.OFFER },
      });

      return {
        populationApplications,
        populationInterviewRate: this.buildRate(populationInterviewApplications, populationApplications),
        populationOfferRate: this.buildRate(populationOfferApplications, populationApplications),
        userInterviewRate: this.buildRate(userInterviewApplications, userApplications),
        userOfferRate: this.buildRate(userOfferApplications, userApplications),
        note: 'Population benchmark is anonymized and correlational only.',
      };
    });
  }

  invalidateUser(userId: string): void {
    void this.cache.delByPrefix(`analytics:${userId}:`);
  }

  private async cached<T>(suffix: string, producer: () => Promise<T>): Promise<T> {
    const key = `analytics:${suffix}`;
    const cached = await this.cache.get<T>(key);
    if (cached) return cached;
    const result = await producer();
    await this.cache.set(key, result, ANALYTICS_CACHE_TTL_MS);
    return result;
  }

  private buildRate(successes: number, total: number): RateInterval {
    const rate = total > 0 ? successes / total : 0;
    const [lower, upper] = this.wilsonInterval(successes, total);
    return { rate, lower, upper };
  }

  private wilsonInterval(successes: number, total: number): [number, number] {
    if (total <= 0) return [0, 0];
    const z = 1.96;
    const phat = successes / total;
    const denom = 1 + (z * z) / total;
    const center = (phat + (z * z) / (2 * total)) / denom;
    const margin = (z * Math.sqrt((phat * (1 - phat)) / total + (z * z) / (4 * total * total))) / denom;
    return [Math.max(0, center - margin), Math.min(1, center + margin)];
  }

  private isInterviewStatus(status: string): boolean {
    return (
      status === ApplicationStatus.INTERVIEW ||
      status === ApplicationStatus.ASSESSMENT ||
      status === ApplicationStatus.OFFER
    );
  }

  private isOfferStatus(status: string): boolean {
    return status === ApplicationStatus.OFFER;
  }
}

export const analyticsService = new AnalyticsService();
