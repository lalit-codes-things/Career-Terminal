import { Prisma, type PrismaClient } from '@prisma/client';
import { dbRouter } from '../../config/database';
import { logger } from '../../lib/logger';

type DbClient = PrismaClient;

const MIN_COHORT_SIZE = 20;
const WINDOW_DAYS = 90;

interface PatternGroupKey {
  canonicalCompanyId: string | null;
  normalizedRoleTitle: string;
}

interface CompetencyFrequency {
  competencyId: string;
  count: number;
  distinctUsers: Set<string>;
  distinctSessions: Set<string>;
  belowThresholdCount: number;
}

interface SegmentStats {
  totalDistinctUsers: Set<string>;
  totalDistinctSessions: Set<string>;
  competencies: Map<string, CompetencyFrequency>;
}

function groupKey(canonicalCompanyId: string | null, normalizedRoleTitle: string): PatternGroupKey {
  return { canonicalCompanyId, normalizedRoleTitle };
}

export class PatternMiningService {
  constructor(private readonly db: DbClient = dbRouter.write()) {}

  public async mineFrequentCompetencySets(): Promise<void> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const windowEnd = now;

    const observations = await this.db.interviewCompetencyObservation.findMany({
      where: {
        session: {
          shareForGlobalIntelligence: true,
          finalDecision: 'HIRE',
          createdAt: { gte: windowStart, lte: windowEnd },
        },
      },
      select: {
        id: true,
        userId: true,
        sessionId: true,
        competencyId: true,
        demonstratedLevel: true,
        session: {
          select: {
            canonicalCompanyId: true,
            normalizedRoleTitle: true,
          },
        },
      },
    });

    const groups = new Map<string, SegmentStats>();

    for (const obs of observations) {
      if (!obs.session) continue;
      const key = groupKey(obs.session.canonicalCompanyId, obs.session.normalizedRoleTitle);
      const groupKeyStr = `${key.canonicalCompanyId ?? 'null'}:${key.normalizedRoleTitle}`;

      if (!groups.has(groupKeyStr)) {
        groups.set(groupKeyStr, {
          totalDistinctUsers: new Set<string>(),
          totalDistinctSessions: new Set<string>(),
          competencies: new Map(),
        });
      }
      const segment = groups.get(groupKeyStr)!;
      segment.totalDistinctUsers.add(obs.userId);
      segment.totalDistinctSessions.add(obs.sessionId);

      if (!segment.competencies.has(obs.competencyId)) {
        segment.competencies.set(obs.competencyId, {
          competencyId: obs.competencyId,
          count: 0,
          distinctUsers: new Set<string>(),
          distinctSessions: new Set<string>(),
          belowThresholdCount: 0,
        });
      }
      const entry = segment.competencies.get(obs.competencyId)!;
      entry.count += 1;
      entry.distinctUsers.add(obs.userId);
      entry.distinctSessions.add(obs.sessionId);
    }

    for (const [groupKeyStr, segment] of groups) {
      const [canonicalCompanyId, normalizedRoleTitle] = groupKeyStr.split(':');
      const companyId = canonicalCompanyId === 'null' ? null : canonicalCompanyId;
      const totalDistinctUsers = segment.totalDistinctUsers.size;

      for (const [competencyId, stats] of segment.competencies) {
        const distinctUserCount = stats.distinctUsers.size;
        const isPublished = distinctUserCount >= MIN_COHORT_SIZE;
        const prevalencePercent = totalDistinctUsers > 0
          ? Math.round((distinctUserCount / totalDistinctUsers) * 100)
          : 0;

        await this.db.interviewKnowledgePattern.create({
          data: {
            patternType: 'FREQUENT_COMPETENCY_SET',
            scope: 'GLOBAL',
            canonicalCompanyId: companyId,
            roleTitleNormalized: normalizedRoleTitle,
            competencyId,
            patternData: {
              frequency: stats.count,
              distinctUserCount,
              distinctSessionCount: stats.distinctSessions.size,
              totalDistinctUsers,
              prevalencePercent,
            },
            distinctUserCount,
            distinctSessionCount: stats.distinctSessions.size,
            statisticalConfidence: Math.min(stats.count / 100, 1),
            windowStart,
            windowEnd,
            isPublished,
          },
        });

        const previousPatterns = await this.db.interviewKnowledgePattern.findMany({
          where: {
            patternType: 'FREQUENT_COMPETENCY_SET',
            canonicalCompanyId: companyId,
            roleTitleNormalized: normalizedRoleTitle,
            competencyId,
            isPublished: true,
          },
          orderBy: { windowEnd: 'desc' },
          take: 2,
        });

        const previousPattern = previousPatterns[1];
        if (previousPattern) {
          const previousData = previousPattern.patternData as Record<string, unknown>;
          const previousPrevalence = previousData?.prevalencePercent as number | undefined;
          if (previousPrevalence !== undefined) {
            const drift = prevalencePercent - previousPrevalence;
            await this.db.interviewKnowledgePattern.create({
              data: {
                patternType: 'COMPETENCY_DRIFT',
                scope: 'GLOBAL',
                canonicalCompanyId: companyId,
                roleTitleNormalized: normalizedRoleTitle,
                competencyId,
                patternData: {
                  driftPercent: drift,
                  currentPrevalencePercent: prevalencePercent,
                  previousPrevalencePercent: previousPrevalence,
                  currentWindowStart: windowStart,
                  currentWindowEnd: windowEnd,
                  previousWindowStart: previousPattern.windowStart,
                  previousWindowEnd: previousPattern.windowEnd,
                },
                distinctUserCount,
                distinctSessionCount: stats.distinctSessions.size,
                statisticalConfidence: Math.min(stats.count / 100, 1),
                windowStart,
                windowEnd,
                isPublished,
              },
            });
          }
        }
      }
    }

    logger.info('[PatternMining] mineFrequentCompetencySets completed', {
      groupCount: groups.size,
    });
  }

  public async mineFailureModes(): Promise<void> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const windowEnd = now;

    const observations = await this.db.interviewCompetencyObservation.findMany({
      where: {
        session: {
          shareForGlobalIntelligence: true,
          finalDecision: 'NO_HIRE',
          createdAt: { gte: windowStart, lte: windowEnd },
        },
        demonstratedLevel: { lt: 0.4 },
      },
      select: {
        id: true,
        userId: true,
        sessionId: true,
        competencyId: true,
        demonstratedLevel: true,
        session: {
          select: {
            canonicalCompanyId: true,
            normalizedRoleTitle: true,
          },
        },
      },
    });

    const groups = new Map<string, SegmentStats>();

    for (const obs of observations) {
      if (!obs.session) continue;
      const key = groupKey(obs.session.canonicalCompanyId, obs.session.normalizedRoleTitle);
      const groupKeyStr = `${key.canonicalCompanyId ?? 'null'}:${key.normalizedRoleTitle}`;

      if (!groups.has(groupKeyStr)) {
        groups.set(groupKeyStr, {
          totalDistinctUsers: new Set<string>(),
          totalDistinctSessions: new Set<string>(),
          competencies: new Map(),
        });
      }
      const segment = groups.get(groupKeyStr)!;
      segment.totalDistinctUsers.add(obs.userId);
      segment.totalDistinctSessions.add(obs.sessionId);

      if (!segment.competencies.has(obs.competencyId)) {
        segment.competencies.set(obs.competencyId, {
          competencyId: obs.competencyId,
          count: 0,
          distinctUsers: new Set<string>(),
          distinctSessions: new Set<string>(),
          belowThresholdCount: 0,
        });
      }
      const entry = segment.competencies.get(obs.competencyId)!;
      entry.count += 1;
      entry.distinctUsers.add(obs.userId);
      entry.distinctSessions.add(obs.sessionId);
      entry.belowThresholdCount += 1;
    }

    for (const [groupKeyStr, segment] of groups) {
      const [canonicalCompanyId, normalizedRoleTitle] = groupKeyStr.split(':');
      const companyId = canonicalCompanyId === 'null' ? null : canonicalCompanyId;

      for (const [competencyId, stats] of segment.competencies) {
        const distinctUserCount = stats.distinctUsers.size;
        const isPublished = distinctUserCount >= MIN_COHORT_SIZE;

        await this.db.interviewKnowledgePattern.create({
          data: {
            patternType: 'FAILURE_MODE',
            scope: 'GLOBAL',
            canonicalCompanyId: companyId,
            roleTitleNormalized: normalizedRoleTitle,
            competencyId,
            patternData: {
              belowThresholdCount: stats.belowThresholdCount,
              frequency: stats.count,
              distinctUserCount,
              distinctSessionCount: stats.distinctSessions.size,
              totalDistinctUsers: segment.totalDistinctUsers.size,
            },
            distinctUserCount,
            distinctSessionCount: stats.distinctSessions.size,
            statisticalConfidence: Math.min(stats.count / 100, 1),
            windowStart,
            windowEnd,
            isPublished,
          },
        });
      }
    }

    logger.info('[PatternMining] mineFailureModes completed', {
      groupCount: groups.size,
    });
  }

  public async computeDrift(
    competencyId: string,
    canonicalCompanyId: string | null,
    roleTitleNormalized?: string,
  ): Promise<number | null> {
    const where: Prisma.InterviewKnowledgePatternWhereInput = {
      patternType: 'FREQUENT_COMPETENCY_SET',
      competencyId,
      canonicalCompanyId,
      isPublished: true,
      ...(roleTitleNormalized ? { roleTitleNormalized } : {}),
    };

    const recentPatterns = await this.db.interviewKnowledgePattern.findMany({
      where,
      orderBy: { windowEnd: 'desc' },
      take: 2,
    });

    if (recentPatterns.length < 2) return null;

    const current = recentPatterns[0]!;
    const previous = recentPatterns[1]!;
    const currentData = current.patternData as Record<string, unknown>;
    const previousData = previous.patternData as Record<string, unknown>;
    const currentPrevalence = currentData?.prevalencePercent as number | undefined;
    const previousPrevalence = previousData?.prevalencePercent as number | undefined;

    if (currentPrevalence === undefined || previousPrevalence === undefined) return null;

    return currentPrevalence - previousPrevalence;
  }

  public async findPublishedPatterns(input: {
    canonicalCompanyId: string | null;
    normalizedRoleTitle: string | null;
  }): Promise<
    Array<{
      id: string;
      patternType: string;
      scope: string;
      canonicalCompanyId: string | null;
      roleTitleNormalized: string | null;
      competencyId: string | null;
      patternData: Prisma.JsonValue;
      distinctUserCount: number;
      distinctSessionCount: number;
      statisticalConfidence: number | null;
      windowStart: Date;
      windowEnd: Date;
      computedAt: Date;
      isPublished: boolean;
    }>
  > {
    const where: Prisma.InterviewKnowledgePatternWhereInput = {
      isPublished: true,
      ...(input.canonicalCompanyId ? { canonicalCompanyId: input.canonicalCompanyId } : {}),
      ...(input.normalizedRoleTitle ? { roleTitleNormalized: input.normalizedRoleTitle } : {}),
    };

    return this.db.interviewKnowledgePattern.findMany({
      where,
      orderBy: { computedAt: 'desc' },
      select: {
        id: true,
        patternType: true,
        scope: true,
        canonicalCompanyId: true,
        roleTitleNormalized: true,
        competencyId: true,
        patternData: true,
        distinctUserCount: true,
        distinctSessionCount: true,
        statisticalConfidence: true,
        windowStart: true,
        windowEnd: true,
        computedAt: true,
        isPublished: true,
      },
    });
  }
}

export const patternMiningService = new PatternMiningService();
