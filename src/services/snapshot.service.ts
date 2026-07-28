import { prisma } from '../config/database';
import { FactObservation, Prisma, Snapshot } from '@prisma/client';
import { logger } from '../lib/logger';

export class SnapshotService {
  /**
   * Create a snapshot of all current facts for a user.
   * This captures the state of facts at a specific point in time.
   */
  async createSnapshot(
    userId: string,
    snapshotType: string,
    referenceId?: string,
    description?: string,
  ): Promise<Snapshot> {
    return prisma.$transaction(async (tx) => {
      // 1. Create the snapshot record
      const snapshot = await tx.snapshot.create({
        data: {
          userId,
          snapshotType,
          referenceId,
          description,
          capturedAt: new Date(),
        },
      });

      // 2. Get all current facts for the user
      const currentFacts = await tx.factObservation.findMany({
        where: {
          userId,
          isCurrent: true,
          deletedAt: null,
        },
      });

      // 3. For each fact, create a new observation with the snapshotId set
      // This freezes the values at the time of the snapshot
      for (const fact of currentFacts) {
        await tx.factObservation.create({
          data: {
            userId: fact.userId,
            extractionRunId: fact.extractionRunId,
            provenanceId: fact.provenanceId,
            factType: fact.factType,
            factData: fact.factData as Prisma.InputJsonValue,
            sourceType: fact.sourceType,
            sourceId: fact.sourceId,
            sourceVersion: fact.sourceVersion,
            extractionMethod: fact.extractionMethod,
            modelVersion: fact.modelVersion,
            confidence: fact.confidence,
            evidenceReference: fact.evidenceReference,
            validFrom: fact.validFrom,
            validTo: fact.validTo,
            observedAt: fact.observedAt,
            snapshotId: snapshot.id,
            version: fact.version,
            isCurrent: true,
          },
        });
      }

      logger.info('[SnapshotService] Created snapshot', {
        userId,
        snapshotType,
        snapshotId: snapshot.id,
        factsCount: currentFacts.length,
      });

      return snapshot;
    });
  }

  /**
   * Get all facts for a snapshot
   */
  async getSnapshotFacts(snapshotId: string): Promise<FactObservation[]> {
    return prisma.factObservation.findMany({
      where: { snapshotId },
      orderBy: { factType: 'asc' },
    });
  }

  /**
   * Get the snapshot at the time of an application (for historical analysis)
   */
  async getSnapshotForApplication(applicationId: string): Promise<Snapshot | null> {
    return prisma.snapshot.findFirst({
      where: {
        referenceId: applicationId,
        snapshotType: 'APPLICATION',
      },
    });
  }

  /**
   * Get all snapshots for a user of a specific type
   */
  async getSnapshotsByType(
    userId: string,
    snapshotType: string,
  ): Promise<Snapshot[]> {
    return prisma.snapshot.findMany({
      where: {
        userId,
        snapshotType,
      },
      orderBy: { capturedAt: 'desc' },
    });
  }

  /**
   * Get a specific snapshot by ID
   */
  async getSnapshot(snapshotId: string): Promise<Snapshot | null> {
    return prisma.snapshot.findUnique({
      where: { id: snapshotId },
    });
  }
}

export const snapshotService = new SnapshotService();
