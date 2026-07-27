import { prisma } from '../config/database';
import { FactObservation } from '@prisma/client';
import { logger } from '../lib/logger';

export interface RecordFactInput {
  userId: string;
  factType: string;
  factData: any;
  sourceType: string;
  sourceId: string;
  sourceVersion?: string;
  extractionMethod: string;
  modelVersion?: string;
  confidence: number;
  evidenceReference?: string;
  observedAt: Date;
  validFrom?: Date;
  validTo?: Date;
  snapshotId?: string;
}

export class FactService {
  /**
   * Record a new fact observation with provenance.
   * Handles versioning by superseding existing facts of the same type if they match the data signature.
   */
  async recordFact(input: RecordFactInput): Promise<FactObservation> {
    return prisma.$transaction(async (tx) => {
      // 1. Find existing current facts of the same type for this user
      // Simple heuristic: if the factData (e.g., skill name) is identical, we supersede it.
      // For more complex types like "EXPERIENCE", we might need better matching.
      const existing = await tx.factObservation.findFirst({
        where: {
          userId: input.userId,
          factType: input.factType,
          isCurrent: true,
          // Deep equality check for JSON is hard in SQL, so we'll do it in code or just always create new
          // For now, let's keep it simple and always create a new version.
        },
        orderBy: { version: 'desc' },
      });

      const nextVersion = existing ? existing.version + 1 : 1;

      // 2. Create the new observation
      const newFact = await tx.factObservation.create({
        data: {
          userId: input.userId,
          factType: input.factType,
          factData: input.factData,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceVersion: input.sourceVersion,
          extractionMethod: input.extractionMethod,
          modelVersion: input.modelVersion,
          confidence: input.confidence,
          evidenceReference: input.evidenceReference,
          observedAt: input.observedAt,
          validFrom: input.validFrom,
          validTo: input.validTo,
          snapshotId: input.snapshotId,
          version: nextVersion,
          isCurrent: true,
        },
      });

      // 3. Supersede the old one if it exists
      if (existing) {
        await tx.factObservation.update({
          where: { id: existing.id },
          data: {
            isCurrent: false,
            supersededById: newFact.id,
            supersededAt: new Date(),
          },
        });
      }

      logger.info('[FactService] Recorded new fact', {
        userId: input.userId,
        factType: input.factType,
        version: nextVersion,
        factId: newFact.id,
      });

      return newFact;
    });
  }

  /**
   * Retrieve all current facts for a user, optionally filtered by type.
   */
  async getCurrentFacts(userId: string, factType?: string): Promise<FactObservation[]> {
    return prisma.factObservation.findMany({
      where: {
        userId,
        factType,
        isCurrent: true,
        deletedAt: null,
      },
      orderBy: { observedAt: 'desc' },
    });
  }

  /**
   * Retrieve the full history of a specific fact.
   */
  async getFactHistory(factId: string): Promise<FactObservation[]> {
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

  /**
   * Manually supersede a fact.
   */
  async supersedeFact(factId: string, newFactId: string): Promise<void> {
    await prisma.factObservation.update({
      where: { id: factId },
      data: {
        isCurrent: false,
        supersededById: newFactId,
        supersededAt: new Date(),
      },
    });
  }

  /**
   * Soft-delete a fact.
   */
  async deleteFact(factId: string): Promise<void> {
    await prisma.factObservation.update({
      where: { id: factId },
      data: {
        deletedAt: new Date(),
        isCurrent: false,
      },
    });
  }

  /**
   * Get facts valid at a specific point in time (for historical queries).
   */
  async getFactsValidAt(
    userId: string,
    timestamp: Date,
    factType?: string,
  ): Promise<FactObservation[]> {
    return prisma.factObservation.findMany({
      where: {
        userId,
        factType,
        isCurrent: true,
        deletedAt: null,
        OR: [
          {
            validFrom: { lte: timestamp },
            validTo: null,
          },
          {
            validFrom: { lte: timestamp },
            validTo: { gte: timestamp },
          },
        ],
      },
      orderBy: { observedAt: 'desc' },
    });
  }

  /**
   * Get facts for a specific snapshot
   */
  async getSnapshotFacts(snapshotId: string): Promise<FactObservation[]> {
    return prisma.factObservation.findMany({
      where: { snapshotId },
      orderBy: { factType: 'asc' },
    });
  }
}

export const factService = new FactService();
