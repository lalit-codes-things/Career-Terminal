/**
 * ProvenanceService — Epic 4 Prompt 3
 *
 * Manages read access and ownership validation for FactProvenance records.
 *
 * Provenance records are write-once.  They are created atomically alongside
 * their ExtractionRun in ExtractionRunService.createRun().  This service
 * exposes NO create or update path — only read operations.
 *
 * Immutability contract:
 *  - No public method in this service modifies a provenance record.
 *  - Any future code path that attempts to update a FactProvenance row must be
 *    treated as an architectural violation.
 *
 * Cell boundary enforcement:
 *  - Every returned provenance record carries a cellId.
 *  - Callers that need to enforce the cell boundary should compare
 *    ProvenanceRecord.cellId against the user's routed home cell.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { NotFoundError } from '../../errors/app-errors';
import {
  type ProvenanceRecord,
  CrossUserOwnershipError,
  CellBoundaryViolationError,
} from '../../domain/candidate-intelligence';
import { cellRoutingService } from '../routing/cell-routing.service';

type DbClient = PrismaClient | Prisma.TransactionClient;

export class ProvenanceService {
  constructor(private readonly db: DbClient = prisma) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Reads (the only permitted operations on provenance)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Retrieve a single provenance record by its id.
   *
   * Ownership is always verified: the record's userId must match the supplied
   * userId or CrossUserOwnershipError is thrown.
   */
  async getById(provenanceId: string, userId: string): Promise<ProvenanceRecord> {
    const record = await (this.db as PrismaClient).factProvenance.findUnique({
      where: { id: provenanceId },
    });

    if (!record) {
      throw new NotFoundError('FactProvenance', provenanceId);
    }

    if (record.userId !== userId) {
      throw new CrossUserOwnershipError('FactProvenance', provenanceId);
    }

    return this.toRecord(record);
  }

  /**
   * Retrieve the provenance record for a given extraction run.
   *
   * Ownership is always verified.
   */
  async getByExtractionRunId(
    extractionRunId: string,
    userId: string,
  ): Promise<ProvenanceRecord> {
    const record = await (this.db as PrismaClient).factProvenance.findUnique({
      where: { extractionRunId },
    });

    if (!record) {
      throw new NotFoundError('FactProvenance for ExtractionRun', extractionRunId);
    }

    if (record.userId !== userId) {
      throw new CrossUserOwnershipError('FactProvenance', record.id);
    }

    return this.toRecord(record);
  }

  /**
   * Retrieve all provenance records for a given source document.
   * Returns oldest first so callers can walk processing history chronologically.
   *
   * Because provenance is 1-to-1 with extraction runs, this also answers
   * "how many times has this document been processed?"
   */
  async getBySource(
    userId: string,
    sourceType: string,
    sourceId: string,
  ): Promise<ProvenanceRecord[]> {
    const records = await (this.db as PrismaClient).factProvenance.findMany({
      where: { userId, sourceType, sourceId },
      orderBy: { createdAt: 'asc' },
    });

    return records.map((r) => this.toRecord(r));
  }

  /**
   * Retrieve all provenance records for a user.
   */
  async getAllForUser(userId: string): Promise<ProvenanceRecord[]> {
    const records = await (this.db as PrismaClient).factProvenance.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return records.map((r) => this.toRecord(r));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Cell boundary assertion
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Assert that a provenance record's cellId matches the user's current
   * authoritative home cell.
   *
   * Use this in any code path that needs to guarantee data did not cross a
   * cell boundary after the record was originally written.
   */
  async assertCellBoundary(provenanceId: string, userId: string): Promise<void> {
    const record = await this.getById(provenanceId, userId);
    const routing = await cellRoutingService.resolveUserRouting(userId);

    if (record.cellId !== routing.cellId) {
      throw new CellBoundaryViolationError(userId, routing.cellId, record.cellId!);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Map a raw Prisma row to the read-only ProvenanceRecord interface.
   * Using a dedicated mapper prevents accidental exposure of mutable Prisma
   * objects through the service boundary.
   */
  private toRecord(
    r: Prisma.FactProvenanceGetPayload<Record<string, never>>,
  ): ProvenanceRecord {
    return {
      id: r.id,
      userId: r.userId,
      cellId: r.cellId,
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      sourceVersion: r.sourceVersion,
      sourceIdentity: r.sourceIdentity,
      extractionRunId: r.extractionRunId,
      parserVersion: r.parserVersion,
      modelProvider: r.modelProvider,
      modelVersion: r.modelVersion,
      promptVersion: r.promptVersion,
      schemaVersion: r.schemaVersion,
      createdAt: r.createdAt,
    };
  }
}

export const provenanceService = new ProvenanceService();
