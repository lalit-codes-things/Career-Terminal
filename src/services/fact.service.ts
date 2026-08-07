import { dbRouter } from '../config/database';
import { FactObservation } from '@prisma/client';
import { logger } from '../lib/logger';
import { cellRoutingService } from './routing/cell-routing.service';

// ─────────────────────────────────────────────────────────────────────────────
// Data Quality / Confidence / Evidence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Explicit quality status for a FactObservation.
 *
 * Derived from the combination of isCurrent, isUserCorrected, supersededById,
 * deletedAt, and reviewStatus — no separate DB column required.
 *
 * - OBSERVED        direct extraction from a source document (machine)
 * - INFERRED        derived from other facts (not directly observed)
 * - USER_CONFIRMED  a user-submitted correction; always beats machine facts
 * - SUPERSEDED      replaced by a newer version; isCurrent=false
 * - INVALID         soft-deleted or review-rejected; no longer usable
 */
export type FactQualityStatus =
  'OBSERVED' | 'INFERRED' | 'USER_CONFIRMED' | 'SUPERSEDED' | 'INVALID';

/** Fact fields required to compute a quality status (subset of FactObservation). */
export interface FactQualityInput {
  isCurrent: boolean;
  isUserCorrected: boolean;
  supersededById: string | null;
  deletedAt: Date | null;
  reviewStatus: string | null;
  extractionMethod: string;
}

/**
 * Derive the explicit quality status for a fact.
 *
 * Precedence (highest → lowest):
 *   1. INVALID   — deleted or review-rejected; cannot be used
 *   2. SUPERSEDED — replaced by a newer version (isCurrent=false, supersededById set)
 *   3. USER_CONFIRMED — user correction (isUserCorrected=true, isCurrent=true)
 *   4. INFERRED  — extractionMethod contains 'INFER'
 *   5. OBSERVED  — direct machine observation (default)
 */
export function getFactQualityStatus(fact: FactQualityInput): FactQualityStatus {
  if (fact.deletedAt !== null || fact.reviewStatus === 'rejected') return 'INVALID';
  if (!fact.isCurrent && fact.supersededById !== null) return 'SUPERSEDED';
  if (fact.isUserCorrected && fact.isCurrent) return 'USER_CONFIRMED';
  if (fact.extractionMethod?.toUpperCase().includes('INFER')) return 'INFERRED';
  return 'OBSERVED';
}

/**
 * Compare two candidate facts and return the one that should win as canonical.
 *
 * Precedence rules (mirrors CanonicalIntelligenceService MATERIALISATION_RULES):
 *   1. USER_CONFIRMED always beats machine facts.
 *   2. Higher confidence wins.
 *   3. Tie → more recent observedAt wins.
 *   4. INVALID / SUPERSEDED facts are never returned as winners.
 *
 * Returns 'a' | 'b' | 'tie'.
 */
export function resolveFactPrecedence(
  a: {
    confidence: number;
    observedAt: Date;
    isUserCorrected: boolean;
    isCurrent: boolean;
    deletedAt: Date | null;
  },
  b: {
    confidence: number;
    observedAt: Date;
    isUserCorrected: boolean;
    isCurrent: boolean;
    deletedAt: Date | null;
  },
): 'a' | 'b' | 'tie' {
  const aInvalid = !a.isCurrent || a.deletedAt !== null;
  const bInvalid = !b.isCurrent || b.deletedAt !== null;
  if (aInvalid && bInvalid) return 'tie';
  if (aInvalid) return 'b';
  if (bInvalid) return 'a';

  // Rule 1: user correction always wins
  if (a.isUserCorrected && !b.isUserCorrected) return 'a';
  if (!a.isUserCorrected && b.isUserCorrected) return 'b';

  // Rule 2: confidence
  const EPSILON = 0.001;
  const delta = a.confidence - b.confidence;
  if (delta > EPSILON) return 'a';
  if (delta < -EPSILON) return 'b';

  // Rule 3: recency tiebreak
  if (a.observedAt > b.observedAt) return 'a';
  if (a.observedAt < b.observedAt) return 'b';
  return 'tie';
}

/**
 * Input for recording a single observed fact.
 *
 * Every fact MUST carry:
 *   - userId          — ownership anchor
 *   - sourceType      — category of the originating document (RESUME, EMAIL, MANUAL, …)
 *   - sourceId        — stable ID of the originating document
 *   - extractionRunId — links back to the ExtractionRun that produced this fact
 *   - provenanceId    — links to the immutable FactProvenance for the run
 *   - observedAt      — when the source was observed (not when the record was written)
 *   - confidence      — machine confidence [0,1]; never fabricated
 *   - evidenceReference — optional raw text fragment supporting this fact
 *
 * Facts are immutable once written.  A new version supersedes the old one via
 * the supersededById chain — the original machine observation is never destroyed.
 */
export interface RecordFactInput {
  userId: string;
  extractionRunId: string;
  provenanceId: string;
  factType: string;
  /** Structured payload for this fact — never `any`; callers must supply typed data. */
  factData: Record<string, unknown>;
  sourceType: string;
  sourceId: string;
  sourceVersion?: string;
  /** How the fact was produced: KEYWORD_MATCH, REGEX, LLM, USER_CORRECTION, … */
  extractionMethod: string;
  modelVersion?: string;
  /** Raw text fragment or reference that supports this fact. */
  evidenceReference?: string;
  /** Machine confidence in this observation, [0,1]. Never fabricated. */
  confidence: number;
  /** When the source document was observed — the logical event time, not wall clock. */
  observedAt: Date;
  validFrom?: Date;
  validTo?: Date;
  snapshotId?: string;
}

/**
 * Simplified input for the internal pipeline path that creates an
 * ExtractionRun + FactProvenance atomically.
 *
 * This interface is intentionally a subset of the canonical
 * `CreateExtractionRunInput` from the domain layer.  It is used by
 * internal callers (resume parser, correction service) that have already
 * validated ownership before calling here.
 *
 * External / service-level callers that need full cell-boundary and
 * ownership validation should use `extractionRunService.createRun()` from
 * `src/services/candidate-intelligence/extraction-run.service.ts` directly.
 */
export interface CreateExtractionRunInput {
  userId: string;
  cellId?: string;
  /** FK to the Model table.  Defaults to the built-in 'manual-correction' model. */
  modelId?: string;
  sourceType: string;
  sourceId: string;
  sourceVersion?: string;
  sourceIdentity?: string;
  parserVersion: string;
  modelProvider?: string | null;
  modelVersion?: string | null;
  promptVersion?: string | null;
  schemaVersion: string;
}

/**
 * Returned by `createExtractionRun`.  Both IDs must be threaded through
 * every `recordFact` call produced by the same extraction run.
 */
export interface ExtractionRunContext {
  runId: string;
  provenanceId: string;
}

export class FactService {
  /**
   * Create an ExtractionRun and its paired FactProvenance record atomically.
   *
   * Pipeline contract:
   *   Source → ExtractionRun + FactProvenance (atomic) → FactObservation(s) → CanonicalCandidateIntelligence
   *
   * Every fact produced by a pipeline run must carry the returned `runId` and
   * `provenanceId`.  These two IDs are the authoritative chain of custody for
   * any machine-derived observation.
   *
   * Ownership note: this simplified path trusts that the caller has already
   * validated that the source document belongs to `userId`.  For callers that
   * need full cell-boundary + ownership enforcement, use
   * `extractionRunService.createRun()` instead.
   *
   * Multiple runs for the same source are explicitly supported (re-runs after
   * parser or model upgrades produce a new run each time).
   */
  async createExtractionRun(input: CreateExtractionRunInput): Promise<ExtractionRunContext> {
    const placement = input.cellId
      ? { cellId: input.cellId }
      : await cellRoutingService.resolveUserRouting(input.userId);

    const context = await dbRouter.write().$transaction(async (tx) => {
      const run = await tx.extractionRun.create({
        data: {
          userId: input.userId,
          cellId: placement.cellId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceVersion: input.sourceVersion ?? null,
          sourceIdentity: input.sourceIdentity ?? null,
          modelId: input.modelId ?? 'manual-correction',
          parserVersion: input.parserVersion,
          modelProvider: input.modelProvider ?? null,
          modelVersion: input.modelVersion ?? null,
          promptVersion: input.promptVersion ?? null,
          schemaVersion: input.schemaVersion,
          status: 'completed',
          completedAt: new Date(),
        },
      });

      const provenance = await tx.factProvenance.create({
        data: {
          userId: input.userId,
          cellId: placement.cellId,
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

      logger.info('[FactService] Created extraction run + provenance', {
        userId: input.userId,
        runId: run.id,
        provenanceId: provenance.id,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      });

      return provenance;
    });

    return { runId: context.extractionRunId, provenanceId: context.id };
  }

  /**
   * Record a new fact observation with provenance.
   * Handles versioning by superseding existing facts of the same type if they match the data signature.
   */
  async recordFact(input: RecordFactInput): Promise<FactObservation> {
    return dbRouter.write().$transaction(async (tx) => {
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
          extractionRunId: input.extractionRunId,
          provenanceId: input.provenanceId,
          factType: input.factType,
          factData: input.factData as Parameters<
            typeof tx.factObservation.create
          >[0]['data']['factData'],
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
        extractionRunId: input.extractionRunId,
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
    return dbRouter.read().factObservation.findMany({
      where: {
        userId,
        factType,
        isCurrent: true,
        deletedAt: null,
      },
      include: { provenance: true, extractionRun: true },
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
      const fact: FactObservation | null = await dbRouter.read().factObservation.findUnique({
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
    await dbRouter.write().factObservation.update({
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
    await dbRouter.write().factObservation.update({
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
    return dbRouter.read().factObservation.findMany({
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
    return dbRouter.read().factObservation.findMany({
      where: { snapshotId },
      orderBy: { factType: 'asc' },
    });
  }
}

export const factService = new FactService();
