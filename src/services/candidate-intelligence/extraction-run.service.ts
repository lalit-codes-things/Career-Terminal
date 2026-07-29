/**
 * ExtractionRunService — Epic 4 Prompt 3
 *
 * Manages the full lifecycle of extraction runs and their paired provenance
 * records.  This is the authoritative entry-point for all candidate
 * intelligence processing attempts.
 *
 * Invariants enforced here:
 *  1. Every run is scoped to a user and their authoritative home cell.
 *  2. Cross-user ownership is rejected before any DB write.
 *  3. A run without an identifiable source (sourceType + sourceId) is rejected.
 *  4. Completed and failed runs are terminal — no further mutation is allowed.
 *  5. Provenance is created atomically with the run in one transaction.
 *  6. Multiple runs for the same source are explicitly supported.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { logger } from '../../lib/logger';
import { cellRoutingService } from '../routing/cell-routing.service';
import {
  type CreateExtractionRunInput,
  type ExtractionRunRecord,
  type StartExtractionRunInput,
  type CompleteExtractionRunInput,
  type FailExtractionRunInput,
  type ExtractionContext,
  ExtractionRunStatus,
  CrossUserOwnershipError,
  CellBoundaryViolationError,
  ExtractionRunNotFoundError,
  ImmutabilityViolationError,
  InvalidSourceReferenceError,
} from '../../domain/candidate-intelligence';

type DbClient = PrismaClient | Prisma.TransactionClient;

/** Terminal statuses that must never be re-entered. */
const TERMINAL_STATUSES = new Set<string>([
  ExtractionRunStatus.COMPLETED,
  ExtractionRunStatus.FAILED,
]);

export class ExtractionRunService {
  constructor(private readonly db: DbClient = prisma) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Create
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Create a new extraction run and its paired provenance record atomically.
   *
   * The source (sourceType + sourceId) must exist and belong to the requesting
   * user.  Cross-user ownership and cell-boundary violations are rejected before
   * any write.
   *
   * Multiple runs for the same source are explicitly allowed — this is the
   * mechanism that supports re-runs after parser or model upgrades.
   *
   * Returns the extraction context (runId, provenanceId, cellId) to be passed
   * to every subsequent fact-recording call.
   */
  async createRun(input: CreateExtractionRunInput): Promise<ExtractionContext> {
    // 1. Resolve the authoritative home cell for this user.
    const routing = await cellRoutingService.resolveUserRouting(input.userId);
    const cellId = input.cellId ?? routing.cellId;

    // 2. If the caller supplied a cellId it must match the routed cell.
    if (input.cellId && input.cellId !== routing.cellId) {
      throw new CellBoundaryViolationError(input.userId, routing.cellId, input.cellId);
    }

    // 3. Validate the source reference is non-empty.
    if (!input.sourceId || !input.sourceType) {
      throw new InvalidSourceReferenceError(input.sourceType ?? '', input.sourceId ?? '');
    }

    // 4. Verify source ownership (best-effort for known source types).
    await this.assertSourceOwnership(input.userId, input.sourceType, input.sourceId);

    // 5. Create the run + provenance in one atomic transaction.
    const context = await (this.db as PrismaClient).$transaction(async (tx) => {
      const run = await tx.extractionRun.create({
        data: {
          userId: input.userId,
          cellId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceVersion: input.sourceVersion ?? null,
          sourceIdentity: input.sourceIdentity ?? null,
          modelId: input.modelId,
          parserVersion: input.parserVersion,
          modelProvider: input.modelProvider ?? null,
          modelVersion: input.modelVersion ?? null,
          promptVersion: input.promptVersion ?? null,
          schemaVersion: input.schemaVersion,
          status: ExtractionRunStatus.PENDING,
        },
      });

      const provenance = await tx.factProvenance.create({
        data: {
          userId: input.userId,
          cellId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceVersion: input.sourceVersion ?? null,
          sourceIdentity: input.sourceIdentity ?? null,
          extractionRunId: run.id,
          parserVersion: input.parserVersion,
          modelProvider: input.modelProvider ?? null,
          modelVersion: input.modelVersion ?? null,
          promptVersion: input.promptVersion ?? null,
          schemaVersion: input.schemaVersion,
        },
      });

      return { runId: run.id, provenanceId: provenance.id, cellId };
    });

    logger.info('[ExtractionRunService] Created extraction run', {
      userId: input.userId,
      runId: context.runId,
      provenanceId: context.provenanceId,
      cellId: context.cellId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      parserVersion: input.parserVersion,
      schemaVersion: input.schemaVersion,
    });

    return context;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Status transitions
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Transition a run from PENDING → RUNNING.
   * Validates ownership and rejects terminal runs.
   */
  async startRun(input: StartExtractionRunInput): Promise<ExtractionRunRecord> {
    const run = await this.assertRunOwnership(input.runId, input.userId);
    this.assertNonTerminal(run);

    const updated = await (this.db as PrismaClient).extractionRun.update({
      where: { id: input.runId },
      data: { status: ExtractionRunStatus.RUNNING, startedAt: new Date() },
    });

    logger.info('[ExtractionRunService] Run started', { runId: input.runId, userId: input.userId });
    return this.toRecord(updated);
  }

  /**
   * Transition a run to COMPLETED (terminal).
   * After this call the run record must not be mutated.
   */
  async completeRun(input: CompleteExtractionRunInput): Promise<ExtractionRunRecord> {
    const run = await this.assertRunOwnership(input.runId, input.userId);
    this.assertNonTerminal(run);

    const updated = await (this.db as PrismaClient).extractionRun.update({
      where: { id: input.runId },
      data: {
        status: ExtractionRunStatus.COMPLETED,
        completedAt: new Date(),
      },
    });

    logger.info('[ExtractionRunService] Run completed', {
      runId: input.runId,
      userId: input.userId,
    });
    return this.toRecord(updated);
  }

  /**
   * Transition a run to FAILED (terminal).
   * After this call the run record must not be mutated.
   */
  async failRun(input: FailExtractionRunInput): Promise<ExtractionRunRecord> {
    const run = await this.assertRunOwnership(input.runId, input.userId);
    this.assertNonTerminal(run);

    const updated = await (this.db as PrismaClient).extractionRun.update({
      where: { id: input.runId },
      data: {
        status: ExtractionRunStatus.FAILED,
        failureReason: input.failureReason,
        completedAt: new Date(),
      },
    });

    logger.warn('[ExtractionRunService] Run failed', {
      runId: input.runId,
      userId: input.userId,
      failureReason: input.failureReason,
    });
    return this.toRecord(updated);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Queries
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Retrieve a single run, asserting user ownership.
   */
  async getRunById(runId: string, userId: string): Promise<ExtractionRunRecord> {
    const run = await this.assertRunOwnership(runId, userId);
    return this.toRecord(run);
  }

  /**
   * List all extraction runs for a given source document.
   * Supports the "multiple runs per source" requirement — returns oldest first
   * so callers can walk the history in chronological order.
   */
  async getRunsForSource(
    userId: string,
    sourceType: string,
    sourceId: string,
  ): Promise<ExtractionRunRecord[]> {
    const runs = await (this.db as PrismaClient).extractionRun.findMany({
      where: { userId, sourceType, sourceId },
      orderBy: { startedAt: 'asc' },
    });
    return runs.map((r) => this.toRecord(r));
  }

  /**
   * List all extraction runs for a user, optionally filtered by status.
   */
  async getRunsForUser(
    userId: string,
    status?: ExtractionRunStatus | string,
  ): Promise<ExtractionRunRecord[]> {
    const runs = await (this.db as PrismaClient).extractionRun.findMany({
      where: { userId, ...(status ? { status } : {}) },
      orderBy: { startedAt: 'desc' },
    });
    return runs.map((r) => this.toRecord(r));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internal guards
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Fetch a run and verify it belongs to the given user.
   * Throws ExtractionRunNotFoundError if absent, CrossUserOwnershipError if mismatched.
   */
  private async assertRunOwnership(
    runId: string,
    userId: string,
  ): Promise<Prisma.ExtractionRunGetPayload<Record<string, never>>> {
    const run = await (this.db as PrismaClient).extractionRun.findUnique({
      where: { id: runId },
    });

    if (!run) {
      throw new ExtractionRunNotFoundError(runId);
    }

    if (run.userId !== userId) {
      throw new CrossUserOwnershipError('ExtractionRun', runId);
    }

    return run;
  }

  /**
   * Reject mutations to terminal runs.
   */
  private assertNonTerminal(
    run: Prisma.ExtractionRunGetPayload<Record<string, never>>,
  ): void {
    if (TERMINAL_STATUSES.has(run.status)) {
      throw new ImmutabilityViolationError('ExtractionRun', run.id);
    }
  }

  /**
   * Best-effort source ownership check for known source types.
   *
   * For RESUME and EMAIL sources we verify the record exists and belongs to the
   * user before allowing the run to be created.  Unknown source types (e.g.
   * future integrations) are allowed through — the database FK on extraction_run
   * → users is always enforced regardless.
   */
  private async assertSourceOwnership(
    userId: string,
    sourceType: string,
    sourceId: string,
  ): Promise<void> {
    const db = this.db as PrismaClient;

    if (sourceType === 'RESUME' || sourceType === 'LINKEDIN_PROFILE') {
      const resume = await db.resume.findFirst({
        where: { id: sourceId, userId },
        select: { id: true },
      });
      if (!resume) {
        throw new InvalidSourceReferenceError(sourceType, sourceId);
      }
      return;
    }

    if (sourceType === 'EMAIL') {
      const message = await db.emailMessage.findFirst({
        where: { id: sourceId },
        select: { id: true, userId: true },
      });
      if (!message || message.userId !== userId) {
        throw new InvalidSourceReferenceError(sourceType, sourceId);
      }
      return;
    }

    if (sourceType === 'MANUAL') {
      // MANUAL sources are always owned by the user performing the operation.
      return;
    }

    // Unknown / future source types: allow through.
    // The constraint is still enforced at the DB level via user_id FK.
    logger.debug('[ExtractionRunService] Skipping source ownership check for unknown type', {
      userId,
      sourceType,
      sourceId,
    });
  }

  /**
   * Map a raw Prisma record to the read-only ExtractionRunRecord interface.
   */
  private toRecord(
    r: Prisma.ExtractionRunGetPayload<Record<string, never>>,
  ): ExtractionRunRecord {
    return {
      id: r.id,
      userId: r.userId,
      cellId: r.cellId!,
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      sourceVersion: r.sourceVersion,
      sourceIdentity: r.sourceIdentity,
      parserVersion: r.parserVersion!,
      modelProvider: r.modelProvider,
      modelVersion: r.modelVersion,
      promptVersion: r.promptVersion,
      schemaVersion: r.schemaVersion!,
      status: r.status,
      failureReason: r.failureReason,
      startedAt: r.startedAt!,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}

export const extractionRunService = new ExtractionRunService();
