import { PrismaClient, Prisma } from '@prisma/client';
import { dbRouter } from '../../config/database';
import { NotFoundError } from '../../errors/app-errors';
import { userOwnershipFilter } from '../../utils/user-ownership';
import { cellRoutingService } from '../routing/cell-routing.service';
import {
  CrossUserOwnershipError,
  CellBoundaryViolationError,
  ExtractionRunNotFoundError,
  ImmutabilityViolationError,
  ExtractionRunStatus,
  CanonicalIntelligenceNotFoundError,
} from '../../domain/candidate-intelligence';

type DbClient = PrismaClient | Prisma.TransactionClient;

export class OwnershipGuard {
  public async ensureApplicationAccess(
    userId: string,
    applicationId: string,
    db: DbClient = dbRouter.write(),
  ): Promise<{ id: string; userId: string | null; legacyUserId: string | null }> {
    const application = await db.jobApplication.findFirst({
      where: {
        id: applicationId,
        ...userOwnershipFilter(userId),
      },
      select: { id: true, userId: true, legacyUserId: true },
    });

    if (!application) {
      throw new NotFoundError('Application', applicationId);
    }

    return application;
  }

  public async ensureTimelineAccess(
    userId: string,
    eventId: string,
    db: DbClient = dbRouter.write(),
  ): Promise<{ id: string; applicationId: string }> {
    const event = await db.applicationTimeline.findFirst({
      where: {
        id: eventId,
        application: userOwnershipFilter(userId),
      },
      select: {
        id: true,
        applicationId: true,
      },
    });

    if (!event) {
      throw new NotFoundError('Timeline event', eventId);
    }

    return event;
  }

  public async ensureCompanyAccess(
    userId: string,
    companyId: string,
    db: DbClient = dbRouter.write(),
  ): Promise<{ id: string }> {
    const company = await db.company.findFirst({
      where: {
        id: companyId,
        applications: {
          some: userOwnershipFilter(userId),
        },
      },
      select: { id: true },
    });

    if (!company) {
      throw new NotFoundError('Company', companyId);
    }

    return company;
  }

  public async ensureRecruiterAccess(
    userId: string,
    recruiterId: string,
    db: DbClient = dbRouter.write(),
  ): Promise<{ id: string }> {
    const recruiter = await db.recruiter.findFirst({
      where: {
        id: recruiterId,
        applications: {
          some: userOwnershipFilter(userId),
        },
      },
      select: { id: true },
    });

    if (!recruiter) {
      throw new NotFoundError('Recruiter', recruiterId);
    }

    return recruiter;
  }

  public async ensureCellAccess(userId: string, cellId: string): Promise<void> {
    await cellRoutingService.ensureCellMatchesUser(userId, cellId);
  }

  // ── Candidate Intelligence guards ─────────────────────────────────────────

  /**
   * Verify the requesting user owns the extraction run.
   *
   * Returns a minimal projection of the run (id, userId, cellId, status) so
   * callers can perform further checks without a second DB round-trip.
   *
   * Throws:
   *  - ExtractionRunNotFoundError if the run does not exist.
   *  - CrossUserOwnershipError if the run belongs to a different user.
   */
  public async ensureExtractionRunAccess(
    userId: string,
    runId: string,
    db: DbClient = dbRouter.write(),
  ): Promise<{ id: string; userId: string; cellId: string | null; status: string }> {
    const run = await db.extractionRun.findUnique({
      where: { id: runId },
      select: { id: true, userId: true, cellId: true, status: true },
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
   * Verify the requesting user owns the provenance record.
   *
   * Returns a minimal projection (id, userId, cellId, extractionRunId).
   *
   * Throws:
   *  - NotFoundError if the provenance record does not exist.
   *  - CrossUserOwnershipError if it belongs to a different user.
   */
  public async ensureProvenanceAccess(
    userId: string,
    provenanceId: string,
    db: DbClient = dbRouter.write(),
  ): Promise<{ id: string; userId: string; cellId: string | null; extractionRunId: string }> {
    const record = await db.factProvenance.findUnique({
      where: { id: provenanceId },
      select: { id: true, userId: true, cellId: true, extractionRunId: true },
    });

    if (!record) {
      throw new NotFoundError('FactProvenance', provenanceId);
    }

    if (record.userId !== userId) {
      throw new CrossUserOwnershipError('FactProvenance', provenanceId);
    }

    return record;
  }

  /**
   * Verify the requesting user owns the fact observation.
   *
   * Returns a minimal projection (id, userId, extractionRunId, provenanceId).
   *
   * Throws:
   *  - NotFoundError if the fact does not exist.
   *  - CrossUserOwnershipError if it belongs to a different user.
   */
  public async ensureFactAccess(
    userId: string,
    factId: string,
    db: DbClient = dbRouter.write(),
  ): Promise<{
    id: string;
    userId: string;
    extractionRunId: string | null;
    provenanceId: string | null;
  }> {
    const fact = await db.factObservation.findUnique({
      where: { id: factId },
      select: { id: true, userId: true, extractionRunId: true, provenanceId: true },
    });

    if (!fact) {
      throw new NotFoundError('FactObservation', factId);
    }

    if (fact.userId !== userId) {
      throw new CrossUserOwnershipError('FactObservation', factId);
    }

    return fact;
  }

  /**
   * Assert that the cell recorded on an extraction run matches the user's
   * current authoritative home cell.
   *
   * Uses the run's persisted cellId (not a request header) so the check
   * is always grounded in server-side state.
   *
   * Throws:
   *  - ExtractionRunNotFoundError if the run is absent.
   *  - CrossUserOwnershipError if ownership is mismatched.
   *  - CellBoundaryViolationError if the cells do not match.
   */
  public async ensureExtractionRunCellBoundary(
    userId: string,
    runId: string,
    db: DbClient = dbRouter.write(),
  ): Promise<void> {
    const run = await this.ensureExtractionRunAccess(userId, runId, db);
    const routing = await cellRoutingService.resolveUserRouting(userId);

    if (run.cellId !== routing.cellId) {
      throw new CellBoundaryViolationError(userId, routing.cellId, run.cellId ?? 'unknown');
    }
  }

  /**
   * Assert that a terminal extraction run (COMPLETED | FAILED) is not being
   * mutated by the caller.
   *
   * Fetch the run first with ensureExtractionRunAccess, then pass the result
   * here to avoid a second DB hit.
   *
   * Throws ImmutabilityViolationError if the run is in a terminal state.
   */
  public assertExtractionRunMutable(run: { id: string; status: string }): void {
    const TERMINAL = new Set<string>([ExtractionRunStatus.COMPLETED, ExtractionRunStatus.FAILED]);

    if (TERMINAL.has(run.status)) {
      throw new ImmutabilityViolationError('ExtractionRun', run.id);
    }
  }

  // ── Canonical Intelligence guard ───────────────────────────────────────────

  /**
   * Verify the requesting user owns the canonical intelligence record.
   *
   * Returns a minimal projection (id, userId, cellId, factType,
   * deduplicationKey, isActive) for further inline checks without a
   * second round-trip.
   *
   * Throws:
   *  - CanonicalIntelligenceNotFoundError if the record is absent.
   *  - CrossUserOwnershipError if it belongs to a different user.
   */
  public async ensureCanonicalIntelligenceAccess(
    userId: string,
    canonicalId: string,
    db: DbClient = dbRouter.write(),
  ): Promise<{
    id: string;
    userId: string;
    cellId: string;
    factType: string;
    deduplicationKey: string;
    isActive: boolean;
  }> {
    const record = await db.canonicalCandidateIntelligence.findUnique({
      where: { id: canonicalId },
      select: {
        id: true,
        userId: true,
        cellId: true,
        factType: true,
        deduplicationKey: true,
        isActive: true,
      },
    });

    if (!record) {
      throw new CanonicalIntelligenceNotFoundError(canonicalId);
    }

    if (record.userId !== userId) {
      throw new CrossUserOwnershipError('CanonicalCandidateIntelligence', canonicalId);
    }

    return record;
  }
}

export const ownershipGuard = new OwnershipGuard();
