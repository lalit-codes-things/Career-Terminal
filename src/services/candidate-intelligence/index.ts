/**
 * Candidate Intelligence service layer — barrel export.
 *
 * Exposes the two primary services that implement the
 * domain contracts:
 *
 *   ExtractionRunService  — create / transition extraction runs,
 *                           atomically paired with provenance records.
 *
 *   ProvenanceService     — read-only access to immutable provenance records;
 *                           cell-boundary assertion helper.
 *
 * Domain types, errors, and enums are re-exported from the domain layer for
 * consumers that prefer a single import path.
 */

export { ExtractionRunService, extractionRunService } from './extraction-run.service';

export { ProvenanceService, provenanceService } from './provenance.service';

export {
  CanonicalIntelligenceService,
  canonicalIntelligenceService,
  computeDeduplicationKey,
} from './canonical-intelligence.service';

export {
  ExtractionRunStatus,
  ExtractionSourceType,
  FactType,
  CrossUserOwnershipError,
  CellBoundaryViolationError,
  ExtractionRunNotFoundError,
  ImmutabilityViolationError,
  InvalidSourceReferenceError,
  MaterialisationOwnershipError,
  FactNotEligibleError,
  CanonicalIntelligenceNotFoundError,
  MATERIALISATION_RULES,
  type CreateExtractionRunInput,
  type ExtractionRunRecord,
  type StartExtractionRunInput,
  type CompleteExtractionRunInput,
  type FailExtractionRunInput,
  type ExtractionContext,
  type RecordExtractedFactInput,
  type ExtractedFactRecord,
  type CreateProvenanceInput,
  type ProvenanceRecord,
  type CandidateIntelligenceContext,
  type CanonicalIntelligenceRecord,
  type MaterialiseFactInput,
  type MaterialiseResult,
  type GetCanonicalIntelligenceQuery,
  type EnrichedCanonicalRecord,
} from '../../domain/candidate-intelligence';
