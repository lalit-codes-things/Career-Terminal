/**
 * SnapshotService — Epic 4 Prompt 10
 *
 * Manages historical candidate-state snapshots so Career Terminal can answer:
 *   "What did the system know about this user at time X?"
 *
 * Design constraints (Prompt 10):
 *  - Snapshots are read-optimised historical projections.
 *  - Do NOT duplicate the existing FactObservation history.
 *  - Do NOT implement full event sourcing.
 *  - Immutable FactObservation rows are never replaced or deleted.
 *
 * Two snapshot strategies are supported:
 *
 *  1. createSnapshot (legacy / application-context)
 *     Copies current FactObservation IDs into the snapshot via snapshotId FK.
 *     Used when a precise per-fact link is required (e.g., at application time).
 *     Existing behaviour is preserved for backward compatibility.
 *
 *  2. captureIntelligenceSnapshot (Prompt 10 canonical path)
 *     Captures the CanonicalCandidateIntelligence state as a JSON projection.
 *     Records the last FactObservation ID and a schema version.
 *     Does NOT copy FactObservation rows — the historical facts remain in the
 *     immutable FactObservation table and are queried via getFactsValidAt.
 *
 * Point-in-time reconstruction:
 *  - reconstructStateAt(userId, timestamp) returns the nearest snapshot at or
 *    before the given timestamp together with the canonical state JSON.
 *  - If no snapshot exists the caller can fall back to FactService.getFactsValidAt.
 */

import { prisma } from '../config/database';
import { FactObservation, Prisma, Snapshot } from '@prisma/client';
import { logger } from '../lib/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** A single canonical fact entry captured inside a snapshot's candidateStateJson. */
export interface CanonicalFactSnapshot {
  factType: string;
  deduplicationKey: string;
  confidence: number;
  lastObservedAt: string; // ISO-8601
  isUserCorrected: boolean;
  sourceFactId: string;
  provenanceId: string;
}

/** The shape stored in Snapshot.candidateStateJson (schemaVersion v1). */
export interface CandidateStateV1 {
  schemaVersion: 'v1';
  capturedAt: string; // ISO-8601
  userId: string;
  lastFactId: string | null;
  facts: CanonicalFactSnapshot[];
}

/** Input for captureIntelligenceSnapshot. */
export interface CaptureIntelligenceSnapshotInput {
  userId: string;
  snapshotType: string;
  referenceId?: string;
  description?: string;
}

/** Returned by reconstructStateAt. */
export interface TemporalSnapshot {
  snapshot: Snapshot;
  /** Parsed candidateStateJson if present (schemaVersion v1). */
  candidateState: CandidateStateV1 | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export class SnapshotService {
  // ───────────────────────────────────────────────────────────────────────────
  // Legacy / application-context snapshot
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Create a snapshot of all current facts for a user by copying the current
   * FactObservation rows with snapshotId set.
   *
   * This method is retained for backward compatibility with the application
   * submission flow.  For point-in-time intelligence snapshots use
   * `captureIntelligenceSnapshot` instead.
   *
   * @deprecated Prefer captureIntelligenceSnapshot for new use cases.
   *   This method duplicates FactObservation rows; use it only when a
   *   per-fact FK to the snapshot is strictly required.
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
          schemaVersion: 'legacy',
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

      // 3. For each fact, create a new observation with the snapshotId set.
      //    This freezes the values at the time of the snapshot.
      //    NOTE: This is the legacy approach; new code should use
      //    captureIntelligenceSnapshot which does not duplicate rows.
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

      logger.info('[SnapshotService] Created legacy snapshot', {
        userId,
        snapshotType,
        snapshotId: snapshot.id,
        factsCount: currentFacts.length,
      });

      return snapshot;
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Intelligence snapshot (Prompt 10 canonical path)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Capture the current CanonicalCandidateIntelligence state as a read-optimised
   * JSON projection stored in Snapshot.candidateStateJson.
   *
   * This is the Prompt 10 canonical approach:
   *  - Does NOT copy or duplicate FactObservation rows.
   *  - Records the most recent FactObservation ID at capture time as `lastFactId`.
   *  - Stores a schemaVersion so future readers can handle migration.
   *  - Captures userId and capturedAt for user isolation and chronological queries.
   *
   * The resulting snapshot can answer "What did the system know at time X?" via
   * `reconstructStateAt()` without re-joining live fact tables.
   */
  async captureIntelligenceSnapshot(input: CaptureIntelligenceSnapshotInput): Promise<Snapshot> {
    const { userId, snapshotType, referenceId, description } = input;
    const capturedAt = new Date();

    return prisma.$transaction(async (tx) => {
      // 1. Find the most recent active FactObservation ID at capture time.
      //    This is the "last included event/fact" required by Prompt 10.
      const lastFact = await tx.factObservation.findFirst({
        where: { userId, isCurrent: true, deletedAt: null },
        orderBy: { observedAt: 'desc' },
        select: { id: true },
      });

      // 2. Read the current canonical intelligence state.
      //    We select only the fields we need — raw factData is NOT included
      //    because it lives in the immutable FactObservation history.
      const canonicalFacts = await (
        tx as unknown as typeof prisma
      ).canonicalCandidateIntelligence.findMany({
        where: { userId, isActive: true },
        include: {
          sourceFact: {
            select: {
              isUserCorrected: true,
            },
          },
        },
        orderBy: { factType: 'asc' },
      });

      // 3. Build the v1 candidate state projection.
      const candidateState: CandidateStateV1 = {
        schemaVersion: 'v1',
        capturedAt: capturedAt.toISOString(),
        userId,
        lastFactId: lastFact?.id ?? null,
        facts: canonicalFacts.map((c) => ({
          factType: c.factType,
          deduplicationKey: c.deduplicationKey,
          confidence: c.confidence,
          lastObservedAt: c.lastObservedAt.toISOString(),
          isUserCorrected: c.sourceFact.isUserCorrected,
          sourceFactId: c.sourceFactId,
          provenanceId: c.provenanceId,
        })),
      };

      // 4. Persist the snapshot — no FactObservation rows are created.
      const snapshot = await tx.snapshot.create({
        data: {
          userId,
          snapshotType,
          referenceId,
          description,
          capturedAt,
          lastFactId: lastFact?.id ?? null,
          schemaVersion: 'v1',
          candidateStateJson: candidateState as unknown as Prisma.InputJsonValue,
        },
      });

      logger.info('[SnapshotService] Captured intelligence snapshot', {
        userId,
        snapshotType,
        snapshotId: snapshot.id,
        canonicalFactsCount: canonicalFacts.length,
        lastFactId: lastFact?.id ?? null,
      });

      return snapshot;
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Point-in-time reconstruction
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Reconstruct the candidate state at a given point in time.
   *
   * Returns the most recent intelligence snapshot (schemaVersion v1) that was
   * captured at or before `timestamp`, together with its parsed candidateStateJson.
   *
   * Returns null if no snapshot exists at or before the given timestamp.
   * In that case callers should fall back to FactService.getFactsValidAt to
   * reconstruct state from the immutable FactObservation history.
   *
   * Snapshot isolation is enforced by userId — never returns another user's data.
   */
  async reconstructStateAt(userId: string, timestamp: Date): Promise<TemporalSnapshot | null> {
    const snapshot = await prisma.snapshot.findFirst({
      where: {
        userId,
        schemaVersion: 'v1',
        capturedAt: { lte: timestamp },
      },
      orderBy: { capturedAt: 'desc' },
    });

    if (!snapshot) {
      return null;
    }

    const candidateState = this.parseCandidateState(snapshot.candidateStateJson);

    return { snapshot, candidateState };
  }

  /**
   * Find all intelligence snapshots for a user in chronological order (oldest first).
   * Useful for walking the history of what the system knew over time.
   *
   * Snapshot isolation is enforced by userId.
   */
  async getSnapshotHistory(userId: string): Promise<Snapshot[]> {
    return prisma.snapshot.findMany({
      where: { userId, schemaVersion: 'v1' },
      orderBy: { capturedAt: 'asc' },
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Existing read methods (unchanged)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Get all facts for a snapshot (legacy snapshots that copied FactObservation rows).
   */
  async getSnapshotFacts(snapshotId: string): Promise<FactObservation[]> {
    return prisma.factObservation.findMany({
      where: { snapshotId },
      orderBy: { factType: 'asc' },
    });
  }

  /**
   * Get the snapshot at the time of an application (for historical analysis).
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
   * Get all snapshots for a user of a specific type, newest first.
   */
  async getSnapshotsByType(userId: string, snapshotType: string): Promise<Snapshot[]> {
    return prisma.snapshot.findMany({
      where: { userId, snapshotType },
      orderBy: { capturedAt: 'desc' },
    });
  }

  /**
   * Get a specific snapshot by ID.
   */
  async getSnapshot(snapshotId: string): Promise<Snapshot | null> {
    return prisma.snapshot.findUnique({
      where: { id: snapshotId },
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  private parseCandidateState(json: unknown): CandidateStateV1 | null {
    if (!json || typeof json !== 'object') return null;
    const obj = json as Record<string, unknown>;
    if (obj['schemaVersion'] !== 'v1') return null;
    return obj as unknown as CandidateStateV1;
  }
}

export const snapshotService = new SnapshotService();
