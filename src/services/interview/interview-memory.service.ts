import { dbRouter } from '../../config/database';
import { userOwnershipFilter } from '../../utils/user-ownership';
import { logger } from '../../lib/logger';

export interface InterviewMemory {
  sessionCount: {
    total: number;
    byStatus: Record<string, number>;
    byOutcome: Record<string, number>;
  };
  competencyTrend: Array<{
    competencyId: string;
    competencyName: string;
    category: string;
    observations: Array<{
      sessionId: string;
      demonstratedLevel: number;
      observedAt: string;
    }>;
  }>;
  recentSessions: Array<{
    id: string;
    roleTitle: string;
    companyNameRaw: string | null;
    status: string;
    finalDecision: string | null;
    loopType: string;
    createdAt: string;
    roundCount: number;
  }>;
  strengths: Array<{
    competencyId: string;
    competencyName: string;
    category: string;
    averageLevel: number;
  }>;
  weaknesses: Array<{
    competencyId: string;
    competencyName: string;
    category: string;
    averageLevel: number;
  }>;
}

export class InterviewMemoryService {
  public async getInterviewMemory(userId: string): Promise<InterviewMemory> {
    const [sessionCount, competencyTrend, recentSessions, strengthsAndWeaknesses] = await Promise.all([
      this.getSessionCounts(userId),
      this.getCompetencyTrend(userId),
      this.getRecentSessions(userId),
      this.getStrengthsAndWeaknesses(userId),
    ]);

    return {
      sessionCount,
      competencyTrend,
      recentSessions,
      ...strengthsAndWeaknesses,
    };
  }

  private async getSessionCounts(userId: string) {
    const [byStatus, byOutcome] = await Promise.all([
      dbRouter.read().interviewSession.groupBy({
        by: ['status'],
        where: userOwnershipFilter(userId),
        _count: { _all: true },
      }),
      dbRouter.read().interviewSession.groupBy({
        by: ['finalDecision'],
        where: { ...userOwnershipFilter(userId), finalDecision: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const statusMap: Record<string, number> = {};
    for (const row of byStatus) {
      statusMap[row.status] = row._count._all;
    }

    const outcomeMap: Record<string, number> = {};
    for (const row of byOutcome) {
      if (row.finalDecision) {
        outcomeMap[row.finalDecision] = row._count._all;
      }
    }

    return {
      total: Object.values(statusMap).reduce((sum, count) => sum + count, 0),
      byStatus: statusMap,
      byOutcome: outcomeMap,
    };
  }

  private async getCompetencyTrend(userId: string) {
    const observations = await dbRouter.read().interviewCompetencyObservation.findMany({
      where: userOwnershipFilter(userId),
      include: {
        competency: {
          select: {
            id: true,
            name: true,
            category: true,
          },
        },
        session: {
          select: {
            createdAt: true,
          },
        },
      },
      orderBy: {
        session: {
          createdAt: 'asc',
        },
      },
    });

    const trendMap = new Map<string, {
      competencyId: string;
      competencyName: string;
      category: string;
      observations: Array<{ sessionId: string; demonstratedLevel: number; observedAt: string }>;
    }>();

    for (const obs of observations) {
      const key = obs.competencyId;
      if (!trendMap.has(key)) {
        trendMap.set(key, {
          competencyId: obs.competency.id,
          competencyName: obs.competency.name,
          category: obs.competency.category,
          observations: [],
        });
      }
      const entry = trendMap.get(key)!;
      entry.observations.push({
        sessionId: obs.sessionId,
        demonstratedLevel: obs.demonstratedLevel,
        observedAt: obs.createdAt.toISOString(),
      });
    }

    return Array.from(trendMap.values());
  }

  private async getRecentSessions(userId: string) {
    const sessions = await dbRouter.read().interviewSession.findMany({
      where: userOwnershipFilter(userId),
      include: {
        _count: {
          select: {
            rounds: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 5,
    });

    return sessions.map((session) => ({
      id: session.id,
      roleTitle: session.roleTitle,
      companyNameRaw: session.companyNameRaw,
      status: session.status,
      finalDecision: session.finalDecision,
      loopType: session.loopType,
      createdAt: session.createdAt.toISOString(),
      roundCount: session._count.rounds,
    }));
  }

  private async getStrengthsAndWeaknesses(userId: string) {
    const lastFiveSessions = await dbRouter.read().interviewSession.findMany({
      where: userOwnershipFilter(userId),
      select: { id: true },
      orderBy: {
        createdAt: 'desc',
      },
      take: 5,
    });

    const sessionIds = lastFiveSessions.map((s) => s.id);

    if (sessionIds.length === 0) {
      return {
        strengths: [],
        weaknesses: [],
      };
    }

    const observations = await dbRouter.read().interviewCompetencyObservation.findMany({
      where: {
        userId,
        sessionId: { in: sessionIds },
      },
      include: {
        competency: {
          select: {
            id: true,
            name: true,
            category: true,
          },
        },
      },
    });

    const competencyMap = new Map<string, {
      competencyId: string;
      competencyName: string;
      category: string;
      levels: number[];
    }>();

    for (const obs of observations) {
      const key = obs.competencyId;
      if (!competencyMap.has(key)) {
        competencyMap.set(key, {
          competencyId: obs.competency.id,
          competencyName: obs.competency.name,
          category: obs.competency.category,
          levels: [],
        });
      }
      competencyMap.get(key)!.levels.push(obs.demonstratedLevel);
    }

    const strengths: InterviewMemory['strengths'] = [];
    const weaknesses: InterviewMemory['weaknesses'] = [];

    for (const entry of competencyMap.values()) {
      const avg = entry.levels.reduce((sum, level) => sum + level, 0) / entry.levels.length;
      const item = {
        competencyId: entry.competencyId,
        competencyName: entry.competencyName,
        category: entry.category,
        averageLevel: avg,
      };

      if (avg > 0.7) {
        strengths.push(item);
      } else if (avg < 0.4) {
        weaknesses.push(item);
      }
    }

    return {
      strengths,
      weaknesses,
    };
  }
}

export const interviewMemoryService = new InterviewMemoryService();
