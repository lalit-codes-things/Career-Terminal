/**
 * CanonicalIntelligenceService — Epic 4 Prompt 4
 *
 * Converts validated extracted facts into the canonical read model and
 * provides the query surface for product features.
 *
 * Architecture position:
 *   ExtractionRun → FactObservation (history) → materialise() → CanonicalCandidateIntelligence (current)
 *
 * Materialisation rules (see MATERIALISATION_RULES in domain contracts):
 *   1. Confidence-first: higher confidence wins.
 *   2. Recency tie-break: equal confidence → more-recent observedAt wins.
 *   3. Never-downgrade: reject if both confidence AND recency are lower.
 *   4. User-correction priority: isUserCorrected=true beats any machine fact.
 *   5. Idempotency: same sourceFactId → same result, no duplicate row.
 *
 * Invariants:
 *   - All writes are transactional.
 *   - Cross-user ownership is rejected before any DB write.
 *   - Cell boundary is enforced using the Prompt 2 routing contract.
 *   - FactObservation rows are never mutated by this service.
 *   - Raw fact data (factData JSON) is NOT copied into the canonical table.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { logger } from '../../lib/logger';
import { cellRoutingService } from '../routing/cell-routing.service';
import {
  type CanonicalIntelligenceRecord,
  type MaterialiseFactInput,
  type MaterialiseResult,
  type GetCanonicalIntelligenceQuery,
  type EnrichedCanonicalRecord,
  type ProvenanceRecord,
  MATERIALISATION_RULES,
  CrossUserOwnershipError,
  CellBoundaryViolationError,
  MaterialisationOwnershipError,
  FactNotEligibleError,
  CanonicalIntelligenceNotFoundError,
} from '../../domain/candidate-intelligence';
import { NotFoundError } from '../../errors/app-errors';

type DbClient = PrismaClient | Prisma.TransactionClient;

// ─────────────────────────────────────────────────────────────────────────────
// Deduplication key helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a stable deduplication key for a given factType + factData pair.
 *
 * Rules (deterministic, no AI):
 *   SKILL        → normalised skill name (lowercase, trimmed)
 *   CERTIFICATION → normalised certification name
 *   LANGUAGE     → normalised language name
 *   EXPERIENCE   → "<company>|<role>" normalised — identifies a single role
 *   EDUCATION    → "<institution>|<degree>" normalised
 *   PROJECT      → normalised project name
 *   SUMMARY      → literal "summary" (one per user)
 *   CONTACT      → contact field name (e.g. "email", "phone")
 *   default      → hash of JSON-stringified key fields
 */
export function computeDeduplicationKey(
  factType: string,
  factData: Record<string, unknown>,
): string {
  const norm = (v: unknown): string => (typeof v === 'string' ? v.toLowerCase().trim() : '');

  switch (factType.toUpperCase()) {
    case 'SKILL':
      return norm(factData['name']) || norm(factData['skill']) || 'unknown-skill';

    case 'CERTIFICATION':
      return norm(factData['name']) || norm(factData['certification']) || 'unknown-cert';

    case 'LANGUAGE':
      return norm(factData['name']) || norm(factData['language']) || 'unknown-lang';

    case 'EXPERIENCE': {
      const company = norm(factData['company']);
      const role = norm(factData['role']) || norm(factData['title']);
      return `${company}|${role}` || 'unknown-experience';
    }

    case 'EDUCATION': {
      const institution = norm(factData['institution']) || norm(factData['school']);
      const degree = norm(factData['degree']);
      return `${institution}|${degree}` || 'unknown-education';
    }

    case 'PROJECT':
      return norm(factData['name']) || norm(factData['project']) || 'unknown-project';

    case 'SUMMARY':
      return 'summary';

    case 'CONTACT': {
      const field = norm(factData['field']) || norm(factData['type']);
      return field || 'unknown-contact';
    }

    default: {
      // For unknown types: stable hash of sorted key fields.
      const stable = JSON.stringify(
        Object.fromEntries(
          Object.entries(factData)
            .filter(([, v]) => v !== null && v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b)),
        ),
      );
      // Simple deterministic hash: FNV-like but using built-in charCodeAt.
      let h = 2166136261;
      for (let i = 0; i < stable.length; i++) {
        h ^= stable.charCodeAt(i);
        h = (h * 16777619) >>> 0;
      }
      return `${factType.toLowerCase()}-${h.toString(16)}`;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Precedence decision
// ─────────────────────────────────────────────────────────────────────────────

type PrecedenceInput = {
  confidence: number;
  observedAt: Date;
  isUserCorrected: boolean;
};

/**
 * Returns true if `candidate` should replace `existing` as canonical.
 * Implements rules 1–4 from MATERIALISATION_RULES.
 */
function candidateWins(candidate: PrecedenceInput, existing: PrecedenceInput): boolean {
  // Rule 4: user correction always wins over machine extraction.
  if (candidate.isUserCorrected && !existing.isUserCorrected) return true;
  if (!candidate.isUserCorrected && existing.isUserCorrected) return false;

  // Rule 1: higher confidence wins.
  const delta = candidate.confidence - existing.confidence;
  if (delta > MATERIALISATION_RULES.CONFIDENCE_TIE_EPSILON) return true;
  if (delta < -MATERIALISATION_RULES.CONFIDENCE_TIE_EPSILON) return false;

  // Rule 2: tie → more recent observedAt wins.
  return candidate.observedAt > existing.observedAt;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export class CanonicalIntelligenceService {
  constructor(private readonly db: DbClient = prisma) {}

  // ── Write path ─────────────────────────────────────────────────────────────

  /**
   * Promote a validated extracted fact into canonical intelligence.
   *
   * Safe to call multiple times with the same sourceFactId (idempotent).
   * Uses an upsert keyed on (userId, factType, deduplicationKey) so
   * concurrent retries cannot create duplicate canonical rows.
   *
   * The FactObservation is never modified — historical data stays intact.
   */
  async materialise(input: MaterialiseFactInput): Promise<MaterialiseResult> {
    const db = this.db as PrismaClient;

    // 1. Resolve cell.
    const routing = await cellRoutingService.resolveUserRouting(input.userId);
    const cellId = input.cellId ?? routing.cellId;
    if (input.cellId && input.cellId !== routing.cellId) {
      throw new CellBoundaryViolationError(input.userId, routing.cellId, input.cellId);
    }

    // 2. Load the source FactObservation and validate ownership + eligibility.
    const fact = await db.factObservation.findUnique({
      where: { id: input.sourceFactId },
      select: {
        id: true,
        userId: true,
        factType: true,
        factData: true,
        confidence: true,
        observedAt: true,
        isCurrent: true,
        deletedAt: true,
        needsReview: true,
        isUserCorrected: true,
        sourceVersion: true,
        provenanceId: true,
      },
    });

    if (!fact) {
      throw new NotFoundError('FactObservation', input.sourceFactId);
    }
    if (fact.userId !== input.userId) {
      throw new MaterialisationOwnershipError(input.sourceFactId);
    }
    if (!fact.isCurrent) {
      throw new FactNotEligibleError(input.sourceFactId, 'fact is superseded (isCurrent=false)');
    }
    if (fact.deletedAt) {
      throw new FactNotEligibleError(input.sourceFactId, 'fact is soft-deleted');
    }
    if (fact.needsReview && !fact.isUserCorrected) {
      throw new FactNotEligibleError(
        input.sourceFactId,
        'fact is flagged needsReview with no user correction',
      );
    }

    // 3. Compute deduplication key (caller may supply it to override).
    const dedupKey =
      input.deduplicationKey ??
      computeDeduplicationKey(fact.factType, fact.factData as Record<string, unknown>);

    // 4. Resolve provenanceId (prefer explicit input, else use fact's provenance).
    const provenanceId = input.provenanceId || fact.provenanceId;

    return db.$transaction(async (tx) => {
      // 5. Read the existing canonical record (if any) inside the transaction.
      const existing = await tx.canonicalCandidateIntelligence.findUnique({
        where: {
          unique_canonical_per_user_type_key: {
            userId: input.userId,
            factType: fact.factType,
            deduplicationKey: dedupKey,
          },
        },
        select: {
          id: true,
          sourceFactId: true,
          confidence: true,
          lastObservedAt: true,
          sourceFact: { select: { isUserCorrected: true } },
        },
      });

      // 6. If same sourceFactId already canonical → idempotent return.
      if (existing?.sourceFactId === input.sourceFactId) {
        logger.debug('[CanonicalIntelligenceService] Idempotent materialise — no change', {
          userId: input.userId,
          canonicalId: existing.id,
          sourceFactId: input.sourceFactId,
        });
        return {
          canonicalId: existing.id,
          promoted: false,
          winningFactId: existing.sourceFactId,
          winningProvenanceId: provenanceId,
        };
      }

      const incoming: PrecedenceInput = {
        confidence: input.confidence,
        observedAt: input.observedAt,
        isUserCorrected: fact.isUserCorrected,
      };

      // 7. If an existing canonical record exists, apply precedence rules.
      if (existing) {
        const existingPrecedence: PrecedenceInput = {
          confidence: existing.confidence,
          observedAt: existing.lastObservedAt,
          isUserCorrected: existing.sourceFact?.isUserCorrected ?? false,
        };

        if (!candidateWins(incoming, existingPrecedence)) {
          // Rule 3: do not downgrade.
          logger.info(
            '[CanonicalIntelligenceService] Existing record retained (higher precedence)',
            {
              userId: input.userId,
              canonicalId: existing.id,
              existingConfidence: existingPrecedence.confidence,
              candidateConfidence: incoming.confidence,
            },
          );
          return {
            canonicalId: existing.id,
            promoted: false,
            winningFactId: existing.sourceFactId,
            winningProvenanceId: provenanceId,
          };
        }
      }

      // 8. Upsert: create or replace with the winning fact.
      const upserted = await tx.canonicalCandidateIntelligence.upsert({
        where: {
          unique_canonical_per_user_type_key: {
            userId: input.userId,
            factType: fact.factType,
            deduplicationKey: dedupKey,
          },
        },
        create: {
          userId: input.userId,
          cellId,
          factType: fact.factType,
          deduplicationKey: dedupKey,
          sourceFactId: input.sourceFactId,
          provenanceId: provenanceId!,
          confidence: input.confidence,
          lastObservedAt: input.observedAt,
          sourceVersion: input.sourceVersion ?? fact.sourceVersion ?? null,
          isActive: true,
        },
        update: {
          sourceFactId: input.sourceFactId,
          provenanceId: provenanceId!,
          confidence: input.confidence,
          lastObservedAt: input.observedAt,
          sourceVersion: input.sourceVersion ?? fact.sourceVersion ?? null,
          cellId,
          isActive: true,
          updatedAt: new Date(),
        },
        select: { id: true },
      });

      logger.info('[CanonicalIntelligenceService] Fact promoted to canonical', {
        userId: input.userId,
        canonicalId: upserted.id,
        factType: fact.factType,
        dedupKey,
        sourceFactId: input.sourceFactId,
        confidence: input.confidence,
      });

      return {
        canonicalId: upserted.id,
        promoted: true,
        winningFactId: input.sourceFactId,
        winningProvenanceId: provenanceId,
      };
    });
  }

  /**
   * Retire a canonical record (soft-disable).  Used when a fact is corrected
   * or withdrawn.  The historical FactObservation is untouched.
   */
  async retire(canonicalId: string, userId: string): Promise<void> {
    const record = await (this.db as PrismaClient).canonicalCandidateIntelligence.findUnique({
      where: { id: canonicalId },
      select: { id: true, userId: true },
    });
    if (!record) throw new CanonicalIntelligenceNotFoundError(canonicalId);
    if (record.userId !== userId)
      throw new CrossUserOwnershipError('CanonicalCandidateIntelligence', canonicalId);

    await (this.db as PrismaClient).canonicalCandidateIntelligence.update({
      where: { id: canonicalId },
      data: { isActive: false, updatedAt: new Date() },
    });

    logger.info('[CanonicalIntelligenceService] Canonical record retired', { canonicalId, userId });
  }

  // ── Read model ──────────────────────────────────────────────────────────────

  /**
   * Query canonical intelligence for a user.
   *
   * By default returns only active records without raw fact data or
   * provenance — the safe default for product feature queries.
   * Callers that need raw data or provenance must opt in explicitly.
   *
   * Enforces ownership: all rows are scoped to userId.
   * Enforces cell boundary: rejects queries where the user's current home
   * cell differs from the canonical record's cellId.
   */
  async getForUser(query: GetCanonicalIntelligenceQuery): Promise<EnrichedCanonicalRecord[]> {
    const db = this.db as PrismaClient;

    const rows = await db.canonicalCandidateIntelligence.findMany({
      where: {
        userId: query.userId,
        ...(query.factType ? { factType: query.factType } : {}),
        ...(query.includeInactive ? {} : { isActive: true }),
      },
      include: {
        sourceFact: query.includeFactData ? { select: { factData: true } } : false,
        provenance: query.includeProvenance ? true : false,
      },
      orderBy: [{ factType: 'asc' }, { lastObservedAt: 'desc' }],
    });

    return rows.map((row) => this.toEnriched(row, query));
  }

  /**
   * Retrieve a single canonical intelligence record by id.
   * Ownership is verified against userId.
   */
  async getById(
    canonicalId: string,
    userId: string,
    opts: { includeFactData?: boolean; includeProvenance?: boolean } = {},
  ): Promise<EnrichedCanonicalRecord> {
    const row = await (this.db as PrismaClient).canonicalCandidateIntelligence.findUnique({
      where: { id: canonicalId },
      include: {
        sourceFact: opts.includeFactData ? { select: { factData: true } } : false,
        provenance: opts.includeProvenance ? true : false,
      },
    });

    if (!row) throw new CanonicalIntelligenceNotFoundError(canonicalId);
    if (row.userId !== userId)
      throw new CrossUserOwnershipError('CanonicalCandidateIntelligence', canonicalId);

    return this.toEnriched(row, opts);
  }

  /**
   * Return the provenance record for a canonical intelligence entry.
   * Ownership is verified. Raw extraction internals are not exposed —
   * only the provenance traceability record.
   */
  async getProvenanceForCanonical(canonicalId: string, userId: string): Promise<ProvenanceRecord> {
    const row = await (this.db as PrismaClient).canonicalCandidateIntelligence.findUnique({
      where: { id: canonicalId },
      include: { provenance: true },
    });

    if (!row) throw new CanonicalIntelligenceNotFoundError(canonicalId);
    if (row.userId !== userId)
      throw new CrossUserOwnershipError('CanonicalCandidateIntelligence', canonicalId);

    const p = row.provenance;
    return {
      id: p.id,
      userId: p.userId,
      cellId: p.cellId,
      sourceType: p.sourceType,
      sourceId: p.sourceId,
      sourceVersion: p.sourceVersion,
      sourceIdentity: p.sourceIdentity,
      extractionRunId: p.extractionRunId,
      parserVersion: p.parserVersion,
      modelProvider: p.modelProvider,
      modelVersion: p.modelVersion,
      promptVersion: p.promptVersion,
      schemaVersion: p.schemaVersion,
      createdAt: p.createdAt,
    };
  }

  // ── Cell boundary enforcement ───────────────────────────────────────────────

  /**
   * Assert that a canonical record's cellId matches the user's current
   * authoritative home cell.
   */
  async assertCellBoundary(canonicalId: string, userId: string): Promise<void> {
    const row = await (this.db as PrismaClient).canonicalCandidateIntelligence.findUnique({
      where: { id: canonicalId },
      select: { userId: true, cellId: true },
    });
    if (!row) throw new CanonicalIntelligenceNotFoundError(canonicalId);
    if (row.userId !== userId)
      throw new CrossUserOwnershipError('CanonicalCandidateIntelligence', canonicalId);

    const routing = await cellRoutingService.resolveUserRouting(userId);
    if (row.cellId !== routing.cellId) {
      throw new CellBoundaryViolationError(userId, routing.cellId, row.cellId);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private toCanonicalRecord(
    row: Prisma.CanonicalCandidateIntelligenceGetPayload<Record<string, never>>,
  ): CanonicalIntelligenceRecord {
    return {
      id: row.id,
      userId: row.userId,
      cellId: row.cellId,
      factType: row.factType,
      deduplicationKey: row.deduplicationKey,
      sourceFactId: row.sourceFactId,
      provenanceId: row.provenanceId,
      confidence: row.confidence,
      lastObservedAt: row.lastObservedAt,
      sourceVersion: row.sourceVersion,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toEnriched(
    row: any,
    opts: { includeFactData?: boolean; includeProvenance?: boolean },
  ): EnrichedCanonicalRecord {
    const canonical = this.toCanonicalRecord(row);

    const factData =
      opts.includeFactData && row.sourceFact
        ? (row.sourceFact.factData as Record<string, unknown>)
        : undefined;

    const provenance: ProvenanceRecord | undefined =
      opts.includeProvenance && row.provenance
        ? {
            id: row.provenance.id,
            userId: row.provenance.userId,
            cellId: row.provenance.cellId,
            sourceType: row.provenance.sourceType,
            sourceId: row.provenance.sourceId,
            sourceVersion: row.provenance.sourceVersion,
            sourceIdentity: row.provenance.sourceIdentity,
            extractionRunId: row.provenance.extractionRunId,
            parserVersion: row.provenance.parserVersion,
            modelProvider: row.provenance.modelProvider,
            modelVersion: row.provenance.modelVersion,
            promptVersion: row.provenance.promptVersion,
            schemaVersion: row.provenance.schemaVersion,
            createdAt: row.provenance.createdAt,
          }
        : undefined;

    return { canonical, ...(factData ? { factData } : {}), ...(provenance ? { provenance } : {}) };
  }
}

export const canonicalIntelligenceService = new CanonicalIntelligenceService();
