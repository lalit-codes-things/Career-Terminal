/**
 * RecommendationService — Section 17 of the architecture directive.
 *
 * Recommendations must be structured, versioned, explainable, and measurable.
 *
 * This is an additive service stub preserving existing behaviour.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { NotFoundError } from '../../errors/app-errors';
import { type RecommendationInput, type RecommendationRecord } from '../../domain/recommendation';

type DbClient = PrismaClient | Prisma.TransactionClient;

export class RecommendationService {
  constructor(private readonly db: DbClient = prisma) {}

  async createRecommendation(
    input: RecommendationInput,
    db: DbClient = this.db,
  ): Promise<RecommendationRecord> {
    const record = await db.recommendation.create({
      data: {
        userId: input.userId,
        recommendationType: input.recommendationType,
        targetType: input.targetType,
        targetId: input.targetId ?? undefined,
        overallScore: input.overallScore ?? undefined,
        scoreBreakdown: (input.scoreBreakdown ?? undefined) as Prisma.InputJsonValue | undefined,
        explanation: input.explanation ?? undefined,
        confidence: input.confidence ?? undefined,
        modelVersion: input.modelVersion ?? undefined,
        rankingPosition: input.rankingPosition ?? undefined,
        feedback: (input.feedback ?? undefined) as Prisma.InputJsonValue | undefined,
        eventualOutcome: (input.eventualOutcome ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    return this.toRecord(record);
  }

  async getRecommendationsForUser(
    userId: string,
    recommendationType?: string,
    db: DbClient = this.db,
  ): Promise<readonly RecommendationRecord[]> {
    const where: Prisma.RecommendationWhereInput = { userId };

    if (recommendationType) {
      where.recommendationType = recommendationType;
    }

    const records = await db.recommendation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return records.map((record) => this.toRecord(record));
  }

  async getRecommendation(
    id: string,
    userId: string,
    db: DbClient = this.db,
  ): Promise<RecommendationRecord> {
    const record = await db.recommendation.findFirst({
      where: { id, userId },
    });

    if (!record) {
      throw new NotFoundError('Recommendation', id);
    }

    return this.toRecord(record);
  }

  async recordFeedback(
    id: string,
    userId: string,
    feedback: Record<string, unknown>,
    db: DbClient = this.db,
  ): Promise<RecommendationRecord> {
    const existing = await db.recommendation.findFirst({
      where: { id, userId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundError('Recommendation', id);
    }

    const record = await db.recommendation.update({
      where: { id },
      data: { feedback: feedback as Prisma.InputJsonValue },
    });

    return this.toRecord(record);
  }

  private toRecord(record: {
    id: string;
    userId: string;
    recommendationType: string;
    targetType: string;
    targetId: string | null;
    overallScore: number | null;
    scoreBreakdown: Prisma.JsonValue;
    explanation: string | null;
    confidence: number | null;
    modelVersion: string | null;
    rankingPosition: number | null;
    feedback: Prisma.JsonValue;
    eventualOutcome: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }): RecommendationRecord {
    return {
      id: record.id,
      userId: record.userId,
      recommendationType: record.recommendationType,
      targetType: record.targetType,
      targetId: record.targetId,
      overallScore: record.overallScore,
      scoreBreakdown: record.scoreBreakdown as Record<string, unknown>,
      explanation: record.explanation,
      confidence: record.confidence,
      modelVersion: record.modelVersion,
      rankingPosition: record.rankingPosition,
      feedback: record.feedback as Record<string, unknown>,
      eventualOutcome: record.eventualOutcome as Record<string, unknown>,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}

export const recommendationService = new RecommendationService();
