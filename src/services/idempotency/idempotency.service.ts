/**
 * IdempotencyService — atomic "check-or-create" guard for every write path.
 *
 * ── Design (why ON CONFLICT DO NOTHING + RETURNING) ────────────────────────
 *
 * A naive "SELECT first; INSERT second" pattern has a classic TOCTOU race:
 * two concurrent workers both see "no row exists" and both proceed to run
 * the side-effect.  Postgres gives us a single atomic primitive that
 * eliminates the race entirely:
 *
 *   INSERT INTO idempotency_records (...)
 *   VALUES (...)
 *   ON CONFLICT (key) DO NOTHING
 *   RETURNING result_id, result_data;
 *
 * If the INSERT inserts a row → first runner → caller executes the effect
 * and records the final result in a second step.
 *
 * If the INSERT inserts nothing → replay → caller reads the existing row
 * via a follow-up SELECT and returns the stored result without running
 * the effect.
 *
 * Callers that can compute the resultId BEFORE executing the effect (most
 * create operations, where the id is a deterministic or pre-generated
 * UUID) can supply it up-front — this collapses the protocol into a
 * SINGLE statement, fully atomic.  We expose that via `recordOrGet`.
 *
 * Callers that need to see the effect result first (e.g. the status
 * transition's timeline event id is generated inside a DB trigger) use the
 * two-phase protocol: `claim` → execute effect → `commit`.
 *
 * ── TTL ───────────────────────────────────────────────────────────────────
 *
 * Every row gets an expires_at timestamp (default: 60 days).  Old rows are
 * purged lazily by `cleanupExpired()`, which the worker scheduler should
 * invoke periodically (once a day is plenty).
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../config/database';
import { logger } from '../../lib/logger';
import { isWellFormedKey } from './idempotency.keys';
import { ValidationError } from '../../errors/app-errors';

type DbClient = PrismaClient | Prisma.TransactionClient;

export const DEFAULT_IDEMPOTENCY_TTL_DAYS = 60;

export type IdempotencyResult<TData = unknown> = {
  /** True when the operation has already been executed (replay path). */
  alreadyExecuted: boolean;
  /** The stored `result_id` from the first run. */
  resultId: string | null;
  /** The (optional) stored JSON snapshot from the first run. */
  resultData: TData | null;
};

export type ClaimResult =
  | { claimed: true; recordId: string }
  | { claimed: false; existing: { resultId: string | null; resultData: unknown } };

export class IdempotencyService {
  constructor(private readonly db: DbClient = prisma) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Single-call convenience API (prefer this)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Atomically check or create an idempotency record.
   *
   * If the caller already knows the resultId (true for most create flows
   * where ids are pre-generated / deterministic), pass it here.  The
   * protocol collapses into a single INSERT...ON CONFLICT RETURNING and the
   * caller reads `alreadyExecuted` to decide whether to run the effect.
   */
  async recordOrGet<TData = unknown>(
    key: string,
    operationType: string,
    resultId: string,
    options: { resultData?: TData; ttlDays?: number; strictKeyValidation?: boolean } = {},
  ): Promise<IdempotencyResult<TData>> {
    this.validateKeyOrThrow(key, options.strictKeyValidation);

    const expiresAt = computeExpiresAt(options.ttlDays ?? DEFAULT_IDEMPOTENCY_TTL_DAYS);
    const createInput: Prisma.IdempotencyRecordCreateInput = {
      key,
      operationType,
      resultId,
      resultData: (options.resultData ?? null) as unknown as Prisma.InputJsonValue,
      expiresAt,
    };

    // Atomic attempt to insert first.  We do this inside a try/catch because
    // some Prisma versions don't expose ON CONFLICT natively — we instead
    // attempt create, catch the unique violation, and then query for the
    // existing row.  Prisma's `create` can be combined with Postgres's ON
    // CONFLICT via raw SQL when available; the fallback below is correct
    // but slightly slower under contention.
    try {
      await this.db.idempotencyRecord.create({
        data: createInput,
        select: { id: true },
      });
      return { alreadyExecuted: false, resultId, resultData: options.resultData ?? null };
    } catch (err) {
      if (isUniqueViolation(err)) {
        const existing = await this.db.idempotencyRecord.findUnique({
          where: { key },
          select: { resultId: true, resultData: true },
        });
        return {
          alreadyExecuted: true,
          resultId: existing?.resultId ?? null,
          resultData: (existing?.resultData ?? null) as TData | null,
        };
      }
      throw err;
    }
  }

  /**
   * Two-phase variant: claim a key, run the effect, commit the result.
   *
   * Useful when the caller doesn't know `resultId` until after the DB
   * mutation runs (e.g. trigger-generated ids, complex multi-row effects).
   *
   * Between `claim` and `commit`, the row sits in the idempotency table
   * with `result_id = '00000000-0000-0000-0000-000000000000'` as a
   * sentinel "in-progress" value.  A failing caller MUST call `abort()`
   * (or let the claimer clean it up via TTL + a future replay).
   */
  async claim(
    key: string,
    operationType: string,
    options: { ttlDays?: number; strictKeyValidation?: boolean } = {},
  ): Promise<ClaimResult> {
    this.validateKeyOrThrow(key, options.strictKeyValidation);

    const IN_PROGRESS = '00000000-0000-0000-0000-000000000000';
    const expiresAt = computeExpiresAt(options.ttlDays ?? DEFAULT_IDEMPOTENCY_TTL_DAYS);

    try {
      const created = await this.db.idempotencyRecord.create({
        data: {
          key,
          operationType,
          resultId: IN_PROGRESS,
          expiresAt,
        },
        select: { id: true },
      });
      return { claimed: true, recordId: created.id };
    } catch (err) {
      if (isUniqueViolation(err)) {
        const existing = await this.db.idempotencyRecord.findUnique({
          where: { key },
          select: { resultId: true, resultData: true },
        });
        if (existing?.resultId === IN_PROGRESS) {
          // Another process is mid-claim.  Retry semantics are left to the caller;
          // for now we surface this as unclaimed with an in-progress sentinel so
          // callers can apply their own backoff / TTL.
          return {
            claimed: false,
            existing: { resultId: null, resultData: { __inProgress: true } },
          };
        }
        return {
          claimed: false,
          existing: {
            resultId:
              existing?.resultId && existing.resultId !== IN_PROGRESS ? existing.resultId : null,
            resultData: existing?.resultData ?? null,
          },
        };
      }
      throw err;
    }
  }

  async commit(recordId: string, resultId: string, resultData?: unknown): Promise<void> {
    await this.db.idempotencyRecord.update({
      where: { id: recordId },
      data: {
        resultId,
        resultData: (resultData ?? null) as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
  }

  async abort(recordId: string): Promise<void> {
    // Remove the in-progress placeholder so a later retry can claim it fresh.
    try {
      await this.db.idempotencyRecord.delete({ where: { id: recordId } });
    } catch {
      // Row may already be gone; that's fine for "abort".
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Read-only utilities
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Read-only check.  Does NOT claim the key.  Intended for warm-path
   * optimizations (skip expensive work early), never as the sole guard
   * against duplicate execution.
   */
  async check<TData = unknown>(key: string): Promise<IdempotencyResult<TData>> {
    const row = await this.db.idempotencyRecord.findUnique({
      where: { key },
      select: { resultId: true, resultData: true },
    });

    const IN_PROGRESS = '00000000-0000-0000-0000-000000000000';
    const finalResultId = row?.resultId && row.resultId !== IN_PROGRESS ? row.resultId : null;

    return {
      alreadyExecuted: Boolean(row) && finalResultId !== null,
      resultId: finalResultId,
      resultData: (row?.resultData ?? null) as TData | null,
    };
  }

  /**
   * Periodic TTL cleanup.  Safe to run on any worker, safe to re-run.
   * @returns number of rows purged
   */
  async cleanupExpired(before: Date = new Date()): Promise<number> {
    const result = await this.db.idempotencyRecord.deleteMany({
      where: { expiresAt: { lt: before } },
    });
    logger.info('[IdempotencyService] cleanup', { deleted: result.count });
    return result.count;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal
  // ─────────────────────────────────────────────────────────────────────────

  private validateKeyOrThrow(key: string, strict = true): void {
    if (strict && !isWellFormedKey(key)) {
      throw new ValidationError(
        `Idempotency key "${key}" does not match any canonical scheme. Import a key builder from idempotency.keys.ts.`,
      );
    }
    if (!key || key.length === 0) {
      throw new ValidationError('Idempotency key cannot be empty.');
    }
  }
}

function computeExpiresAt(ttlDays: number): Date {
  const ttl = Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : DEFAULT_IDEMPOTENCY_TTL_DAYS;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ttl);
  return d;
}

function isUniqueViolation(err: unknown): boolean {
  // Prisma P2002 = Unique constraint failed on the fields
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: string }).code;
    return code === 'P2002';
  }
  return false;
}

export const idempotencyService = new IdempotencyService();
