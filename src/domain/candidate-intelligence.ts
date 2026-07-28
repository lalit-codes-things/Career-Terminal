/**
 * Candidate Intelligence Domain Contracts — Epic 4 Prompt 3
 *
 * These types form the authoritative domain model for:
 *   A. Extraction runs        – one processing attempt against a source
 *   B. Versioned facts        – traceable, ownership-aware extracted observations
 *   C. Provenance             – immutable "why does this fact exist?" record
 *
 * Design constraints:
 *  - Every extraction run carries cell ownership so the cell boundary
 *    established by Prompt 2 can be enforced at the domain layer.
 *  - Provenance records are write-once; no update path is exported.
 *  - Facts are never silently mutated; a new version supersedes the old.
 *  - Cross-user ownership is a domain error, not an access-control detail.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Extraction Run
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Status values for an extraction run.
 * Transitions: pending → running → completed | failed
 * Completed and failed runs are terminal and must not be mutated.
 */
export enum ExtractionRunStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * The category of document or resource that was the extraction source.
 */
export enum ExtractionSourceType {
  RESUME = 'RESUME',
  EMAIL = 'EMAIL',
  MANUAL = 'MANUAL',
  LINKEDIN_PROFILE = 'LINKEDIN_PROFILE',
  GITHUB_PROFILE = 'GITHUB_PROFILE',
}

/**
 * Input required to begin a new extraction run.
 * All fields that influence extraction output must be captured here so
 * that a replay can reproduce the same configuration exactly.
 */
export interface CreateExtractionRunInput {
  /** Owning user — must match the source document's owner. */
  userId: string;

  /**
   * The resolved home cell for this user.
   * If not supplied the service resolves it via the routing contract.
   */
  cellId?: string;

  /** Category of the source document. */
  sourceType: ExtractionSourceType | string;

  /**
   * Stable identifier for the source document (e.g. Resume.id, EmailMessage.id).
   * Must reference a real, user-owned record.
   */
  sourceId: string;

  /**
   * Logical version of the source if the source itself is versioned
   * (e.g. UserResume.version as a string).
   */
  sourceVersion?: string;

  /**
   * Content-addressable identity of the source at extraction time
   * (e.g. SHA-256 hash of the file content).
   * Allows detecting when a re-run uses the same binary content.
   */
  sourceIdentity?: string;

  /** Semver or named version of the parser/extraction code. */
  parserVersion: string;

  /** Provider name if an external model was used (e.g. "openai", "anthropic"). */
  modelProvider?: string | null;

  /** Specific model version (e.g. "gpt-4-0613"). */
  modelVersion?: string | null;

  /** Version of the prompt template used during extraction. */
  promptVersion?: string | null;

  /** Version of the output schema the run was expected to conform to. */
  schemaVersion: string;
}

/**
 * The persisted extraction run record as returned from the service layer.
 * This is a read-only projection; the service never returns mutable references.
 */
export interface ExtractionRunRecord {
  readonly id: string;
  readonly userId: string;
  readonly cellId: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceVersion: string | null;
  readonly sourceIdentity: string | null;
  readonly parserVersion: string;
  readonly modelProvider: string | null;
  readonly modelVersion: string | null;
  readonly promptVersion: string | null;
  readonly schemaVersion: string;
  readonly status: ExtractionRunStatus | string;
  readonly failureReason: string | null;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Transitions an extraction run to RUNNING.
 * Only valid from PENDING state.
 */
export interface StartExtractionRunInput {
  runId: string;
  userId: string;
}

/**
 * Transitions an extraction run to COMPLETED.
 * Terminal — no further status changes are permitted.
 */
export interface CompleteExtractionRunInput {
  runId: string;
  userId: string;
}

/**
 * Transitions an extraction run to FAILED.
 * Terminal — no further status changes are permitted.
 */
export interface FailExtractionRunInput {
  runId: string;
  userId: string;
  failureReason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Versioned Extracted Facts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fact types currently recognised by the domain.
 * This list is open for extension; use a string literal when a new type
 * has not yet been added here to avoid blocking extraction.
 */
export enum FactType {
  SKILL = 'SKILL',
  EXPERIENCE = 'EXPERIENCE',
  EDUCATION = 'EDUCATION',
  PROJECT = 'PROJECT',
  CERTIFICATION = 'CERTIFICATION',
  CONTACT = 'CONTACT',
  LANGUAGE = 'LANGUAGE',
  SUMMARY = 'SUMMARY',
}

/**
 * Input for recording a new extracted fact.
 *
 * Every fact is immutably linked to an extraction run and a provenance record.
 * The fact's userId must match the extraction run's userId.
 */
export interface RecordExtractedFactInput {
  /** Must match ExtractionRun.userId. */
  userId: string;

  /** The run that produced this fact. Must exist and belong to userId. */
  extractionRunId: string;

  /** The provenance record for this run. Must exist and belong to userId. */
  provenanceId: string;

  /** Semantic category of the fact. */
  factType: FactType | string;

  /**
   * Structured payload for the fact.
   * Each factType should use a consistent schema; avoid untyped blobs.
   */
  factData: Record<string, unknown>;

  /** Category of the source document (mirrors ExtractionRun.sourceType). */
  sourceType: string;

  /** Identifier of the source document (mirrors ExtractionRun.sourceId). */
  sourceId: string;

  /** Content version of the source at extraction time. */
  sourceVersion?: string;

  /** Name/version of the extraction method (e.g. "llm-v2", "regex-v1"). */
  extractionMethod: string;

  /** Model version if an LLM produced this fact. */
  modelVersion?: string | null;

  /**
   * Extraction confidence [0, 1].
   * 1.0 is used for manually entered or rule-certain facts.
   */
  confidence: number;

  /**
   * Human-readable pointer into the source text from which the fact was derived
   * (e.g. a paragraph quote, a bounding box reference for OCR output).
   */
  evidenceReference?: string;

  /** The time the extraction was observed, not the time it was stored. */
  observedAt: Date;

  /** Inclusive start of temporal validity for the fact (e.g. employment start date). */
  validFrom?: Date;

  /** Inclusive end of temporal validity for the fact (e.g. employment end date). */
  validTo?: Date;

  /** Optional snapshot this fact was captured as part of. */
  snapshotId?: string;
}

/**
 * A versioned extracted fact record as returned from the service layer.
 */
export interface ExtractedFactRecord {
  readonly id: string;
  readonly userId: string;
  readonly extractionRunId: string;
  readonly provenanceId: string;
  readonly factType: string;
  readonly factData: Record<string, unknown>;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceVersion: string | null;
  readonly extractionMethod: string;
  readonly modelVersion: string | null;
  readonly confidence: number;
  readonly evidenceReference: string | null;
  readonly validFrom: Date | null;
  readonly validTo: Date | null;
  readonly observedAt: Date;
  readonly snapshotId: string | null;
  readonly version: number;
  readonly isCurrent: boolean;
  readonly supersededById: string | null;
  readonly supersededAt: Date | null;
  readonly createdAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provenance
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input for creating a provenance record.
 *
 * Provenance is created atomically alongside the extraction run.
 * It is write-once; the domain never updates a provenance record after creation.
 */
export interface CreateProvenanceInput {
  userId: string;
  cellId: string;
  sourceType: string;
  sourceId: string;
  sourceVersion?: string;
  /** Content hash of the source at the time of extraction. */
  sourceIdentity?: string;
  extractionRunId: string;
  parserVersion: string;
  modelProvider?: string | null;
  modelVersion?: string | null;
  promptVersion?: string | null;
  schemaVersion: string;
}

/**
 * The immutable provenance record.
 *
 * This record answers: "Why does this candidate fact exist?"
 *   - source         → what document was processed
 *   - sourceIdentity → exact content version at extraction time
 *   - extractionRunId→ which run produced it
 *   - parserVersion  → which parser ran
 *   - modelVersion   → which model was used (if any)
 *   - schemaVersion  → which output schema was expected
 *   - createdAt      → when the extraction occurred
 *
 * Immutability contract: once created this record must never be updated.
 * The service layer exposes no update path.
 */
export interface ProvenanceRecord {
  readonly id: string;
  readonly userId: string;
  readonly cellId: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceVersion: string | null;
  readonly sourceIdentity: string | null;
  readonly extractionRunId: string;
  readonly parserVersion: string;
  readonly modelProvider: string | null;
  readonly modelVersion: string | null;
  readonly promptVersion: string | null;
  readonly schemaVersion: string;
  readonly createdAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ownership and Cell Boundary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown when an operation targets a record whose userId does not match
 * the authenticated userId in the current request context.
 */
export class CrossUserOwnershipError extends Error {
  public readonly code = 'CROSS_USER_OWNERSHIP_DENIED';
  public readonly statusCode = 403;

  constructor(resourceType: string, resourceId: string) {
    super(
      `Cross-user access denied: resource "${resourceType}" (${resourceId}) does not belong to the requesting user.`,
    );
    this.name = 'CrossUserOwnershipError';
  }
}

/**
 * Thrown when the cell context on a record does not match the user's
 * authoritative home cell as resolved by the routing contract.
 */
export class CellBoundaryViolationError extends Error {
  public readonly code = 'CELL_BOUNDARY_VIOLATION';
  public readonly statusCode = 403;

  constructor(userId: string, expectedCell: string, actualCell: string) {
    super(
      `Cell boundary violation for user ${userId}: ` +
        `expected cell "${expectedCell}" but found "${actualCell}".`,
    );
    this.name = 'CellBoundaryViolationError';
  }
}

/**
 * Thrown when an extraction run is referenced in a context that
 * requires it to exist but it could not be found.
 */
export class ExtractionRunNotFoundError extends Error {
  public readonly code = 'EXTRACTION_RUN_NOT_FOUND';
  public readonly statusCode = 404;

  constructor(runId: string) {
    super(`ExtractionRun not found: ${runId}`);
    this.name = 'ExtractionRunNotFoundError';
  }
}

/**
 * Thrown when an attempt is made to mutate a terminal extraction run
 * (COMPLETED or FAILED) or a write-once provenance record.
 */
export class ImmutabilityViolationError extends Error {
  public readonly code = 'IMMUTABILITY_VIOLATION';
  public readonly statusCode = 409;

  constructor(resourceType: string, resourceId: string) {
    super(
      `Immutability violation: "${resourceType}" (${resourceId}) is in a terminal ` +
        `state and must not be mutated.`,
    );
    this.name = 'ImmutabilityViolationError';
  }
}

/**
 * Thrown when an extraction run is missing a required source reference.
 */
export class InvalidSourceReferenceError extends Error {
  public readonly code = 'INVALID_SOURCE_REFERENCE';
  public readonly statusCode = 422;

  constructor(sourceType: string, sourceId: string) {
    super(
      `Invalid source reference: sourceType="${sourceType}" sourceId="${sourceId}" ` +
        `could not be resolved to a user-owned document.`,
    );
    this.name = 'InvalidSourceReferenceError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Context bundle used across the candidate intelligence layer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal context carried by every candidate intelligence operation.
 * Services use this to enforce ownership and cell-boundary invariants
 * without needing the full HTTP request context.
 */
export interface CandidateIntelligenceContext {
  /** Authenticated user performing the operation. */
  userId: string;
  /** Resolved home cell for the user. Populated by the service layer if absent. */
  cellId?: string;
}

/**
 * The combined context returned after an extraction run + provenance are
 * created atomically.  Passed to every subsequent fact-recording call.
 */
export interface ExtractionContext {
  readonly runId: string;
  readonly provenanceId: string;
  readonly cellId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Candidate Intelligence — Epic 4 Prompt 4
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The read-only projection of one canonical intelligence record.
 *
 * A canonical record represents the CURRENT best-known value for a
 * (userId, factType, deduplicationKey) triple.  It never holds raw document
 * content — it points to the winning FactObservation via sourceFactId.
 */
export interface CanonicalIntelligenceRecord {
  readonly id: string;
  readonly userId: string;
  readonly cellId: string;
  readonly factType: string;
  /** Stable discriminator within a factType — e.g. normalised skill name or content hash. */
  readonly deduplicationKey: string;
  /** FK to the winning FactObservation.  Raw fact data lives there. */
  readonly sourceFactId: string;
  /** FK to the FactProvenance of the winning run. */
  readonly provenanceId: string;
  readonly confidence: number;
  readonly lastObservedAt: Date;
  readonly sourceVersion: string | null;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Input passed to the materialisation service when promoting a validated
 * extracted fact into canonical intelligence.
 */
export interface MaterialiseFactInput {
  /** Owning user — must match the FactObservation's userId. */
  userId: string;
  /** Resolved home cell — populated by the service if omitted. */
  cellId?: string;
  /** The FactObservation being promoted. */
  sourceFactId: string;
  /** Provenance of the extraction run that produced the fact. */
  provenanceId: string;
  /** Semantic category matching FactObservation.factType. */
  factType: string;
  /**
   * Stable key computed from the fact's semantic identity.
   * The service computes this via computeDeduplicationKey() when not supplied.
   */
  deduplicationKey?: string;
  confidence: number;
  observedAt: Date;
  sourceVersion?: string | null;
}

/**
 * Result returned by a materialise call.
 *
 * promoted = true  → the incoming fact became the new canonical record.
 * promoted = false → an existing record with equal or higher precedence was
 *                    retained; the caller's fact is kept as history only.
 */
export interface MaterialiseResult {
  readonly canonicalId: string;
  readonly promoted: boolean;
  /** The run / fact that is now canonical (may differ from the caller's fact). */
  readonly winningFactId: string;
  readonly winningProvenanceId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Materialisation rules (deterministic, documented)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Precedence ordering used when two extractions compete for the same
 * canonical slot (same userId + factType + deduplicationKey).
 *
 * Rule 1 — Confidence first:
 *   The candidate with the higher confidence value wins.
 *
 * Rule 2 — Recency on tie:
 *   If confidence values are equal (within CONFIDENCE_TIE_EPSILON), the
 *   candidate with the more-recent observedAt timestamp wins.
 *
 * Rule 3 — Never downgrade:
 *   A candidate that would reduce both confidence AND recency is rejected.
 *   The existing canonical record is preserved.
 *
 * Rule 4 — User corrections always win:
 *   Facts flagged as isUserCorrected=true beat any machine-extracted fact
 *   regardless of confidence (handled at the service layer before scoring).
 *
 * Rule 5 — Idempotency:
 *   Processing the same (sourceFactId) twice produces the same canonical
 *   result; the second call is a no-op.
 */
export const MATERIALISATION_RULES = {
  /** Confidence difference smaller than this is treated as a tie. */
  CONFIDENCE_TIE_EPSILON: 0.001,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Materialisation-specific errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown when a fact presented for materialisation does not belong to the
 * requesting user, or its userId mismatches the canonical record's userId.
 */
export class MaterialisationOwnershipError extends Error {
  public readonly code = 'MATERIALISATION_OWNERSHIP_DENIED';
  public readonly statusCode = 403;

  constructor(factId: string) {
    super(
      `Materialisation rejected: FactObservation (${factId}) does not belong to the requesting user.`,
    );
    this.name = 'MaterialisationOwnershipError';
  }
}

/**
 * Thrown when a fact is not eligible for materialisation — e.g. it is
 * superseded (isCurrent=false), deleted, or flagged needsReview=true
 * with an unresolved review.
 */
export class FactNotEligibleError extends Error {
  public readonly code = 'FACT_NOT_ELIGIBLE';
  public readonly statusCode = 422;

  constructor(factId: string, reason: string) {
    super(`FactObservation (${factId}) is not eligible for materialisation: ${reason}`);
    this.name = 'FactNotEligibleError';
  }
}

/**
 * Thrown when a canonical intelligence record is not found.
 */
export class CanonicalIntelligenceNotFoundError extends Error {
  public readonly code = 'CANONICAL_INTELLIGENCE_NOT_FOUND';
  public readonly statusCode = 404;

  constructor(id: string) {
    super(`CanonicalCandidateIntelligence not found: ${id}`);
    this.name = 'CanonicalIntelligenceNotFoundError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Read-model query types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parameters for querying the canonical intelligence read model.
 * All queries are scoped to a userId — never unbounded.
 */
export interface GetCanonicalIntelligenceQuery {
  userId: string;
  /** Filter to a single factType. Omit to return all types. */
  factType?: string;
  /** When true, include records with isActive=false (retired entries). */
  includeInactive?: boolean;
  /** Include the full FactObservation payload in the response. Default false. */
  includeFactData?: boolean;
  /** Include the FactProvenance record in the response. Default false. */
  includeProvenance?: boolean;
}

/**
 * A canonical intelligence record optionally enriched with the raw fact
 * payload and/or provenance.  Raw extraction data is never returned by
 * default — callers must opt in via includeFactData / includeProvenance.
 */
export interface EnrichedCanonicalRecord {
  canonical: CanonicalIntelligenceRecord;
  /** Present only when includeFactData=true. */
  factData?: Record<string, unknown>;
  /** Present only when includeProvenance=true. */
  provenance?: ProvenanceRecord;
}
