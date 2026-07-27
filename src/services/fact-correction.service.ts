import { prisma } from '../config/database';
import { FactObservation, Prisma } from '@prisma/client';
import { logger } from '../lib/logger';

export class FactCorrectionService {
  /**
   * User proposes a correction to a fact.
   * This creates a new FactObservation with the corrected data,
   * linked to the original fact via a "supersedes" relationship.
   */
  async proposeCorrection(
    originalFactId: string,
    correctedData: any,
    userId: string,
    reason: string,
    evidence?: string,
  ): Promise<FactObservation> {
    return prisma.$transaction(async (tx) => {
      const originalFact = await tx.factObservation.findUnique({
        where: { id: originalFactId },
      });

      if (!originalFact) {
        throw new Error(`Fact not found: ${originalFactId}`);
      }

      const correctedFact = await tx.factObservation.create({
        data: {
          userId: originalFact.userId,
          factType: originalFact.factType,
          factData: correctedData as Prisma.InputJsonValue,
          sourceType: 'MANUAL',
          sourceId: userId,
          sourceVersion: '1',
          extractionMethod: 'USER_CORRECTION',
          modelVersion: null,
          confidence: 1.0,
          evidenceReference: evidence ?? `Corrected by user ${userId}`,
          validFrom: originalFact.validFrom,
          validTo: originalFact.validTo,
          observedAt: new Date(),
          snapshotId: originalFact.snapshotId,
          version: originalFact.version + 1,
          isCurrent: true,
          correctedBy: userId,
          correctedAt: new Date(),
          correctionReason: reason,
          isUserCorrected: true,
        },
      });

      await tx.factObservation.update({
        where: { id: originalFactId },
        data: {
          isCurrent: false,
          supersededById: correctedFact.id,
          supersededAt: new Date(),
        },
      });

      logger.info('[FactCorrectionService] Fact corrected', {
        originalFactId,
        correctedFactId: correctedFact.id,
        userId,
        factType: originalFact.factType,
      });

      return correctedFact;
    });
  }

  /**
   * User flags a fact as needing review (e.g., if they suspect it's incorrect)
   */
  async flagForReview(factId: string, userId: string, reason: string): Promise<void> {
    await prisma.factObservation.update({
      where: { id: factId },
      data: {
        needsReview: true,
        reviewStatus: 'pending',
        reviewNotes: reason,
      },
    });

    logger.info('[FactCorrectionService] Fact flagged for review', {
      factId,
      userId,
      reason,
    });
  }

  /**
   * Admin reviews a fact and approves or rejects it.
   */
  async reviewFact(
    factId: string,
    adminId: string,
    status: 'approved' | 'rejected',
    notes?: string,
  ): Promise<void> {
    await prisma.factObservation.update({
      where: { id: factId },
      data: {
        reviewStatus: status,
        reviewedAt: new Date(),
        reviewedBy: adminId,
        needsReview: false,
        reviewNotes: notes ?? undefined,
      },
    });

    logger.info('[FactCorrectionService] Fact reviewed', {
      factId,
      adminId,
      status,
      notes,
    });
  }

  /**
   * Get all facts pending review, ordered by lowest confidence first.
   */
  async getPendingReviews(limit: number = 100): Promise<FactObservation[]> {
    return prisma.factObservation.findMany({
      where: {
        needsReview: true,
        reviewStatus: 'pending',
      },
      orderBy: { confidence: 'asc' },
      take: limit,
    });
  }

  /**
   * Get facts by review status
   */
  async getFactsByReviewStatus(
    status: 'approved' | 'rejected' | 'pending',
    limit: number = 100,
  ): Promise<FactObservation[]> {
    return prisma.factObservation.findMany({
      where: {
        reviewStatus: status,
      },
      orderBy: { reviewedAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Get correction history for a fact (walks the supersededById chain)
   */
  async getCorrectionHistory(factId: string): Promise<FactObservation[]> {
    const history: FactObservation[] = [];
    let currentId: string | null = factId;

    while (currentId) {
      const fact: FactObservation | null = await prisma.factObservation.findUnique({
        where: { id: currentId },
      });

      if (!fact) break;
      history.push(fact);
      currentId = fact.supersededById;
    }

    return history;
  }
}

export const factCorrectionService = new FactCorrectionService();
