/**
 * Unit tests for IdempotencyService.
 *
 * Uses an in-memory mock Prisma that emulates the P2002 unique-violation
 * code path so we can validate the atomicity of recordOrGet / claim /
 * commit without requiring a live Postgres.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { IdempotencyRecord, Prisma, PrismaClient } from '@prisma/client';
import { IdempotencyService } from '../services/idempotency/idempotency.service';
import {
  keyForAppFromEmail,
  keyForAppFromManual,
  keyForOutcomeFromEmail,
  keyForUserAction,
  keyForStatusTransition,
  jobIdForEmailIngestion,
  jobIdForResumeOperation,
  occurrenceHash,
  isWellFormedKey,
} from '../services/idempotency/idempotency.keys';

// ── Minimal in-memory Prisma mock that emulates a unique violation ─────────

type IdemRow = Omit<IdempotencyRecord, 'resultData'> & {
  resultData: unknown;
};

function buildMockPrisma() {
  const table = new Map<string, IdemRow>();
  const byId = new Map<string, IdemRow>();

  function uid() {
    return 'id-' + Math.random().toString(36).slice(2, 10);
  }

  const mock = {
    idempotencyRecord: {
      create: jest.fn(async ({ data }: { data: Prisma.IdempotencyRecordCreateInput }) => {
        const key = String(data.key);
        if (table.has(key)) {
          const error = new Error(`Unique constraint failed on the fields: (\`key\`)`);
          (error as { code?: string }).code = 'P2002';
          throw error;
        }
        const row: IdemRow = {
          id: typeof data.id === 'string' ? data.id : uid(),
          key,
          operationType: String(data.operationType),
          resultId: String(data.resultId),
          resultData: (data.resultData ?? null),
          createdAt: new Date(),
          expiresAt: data.expiresAt instanceof Date ? data.expiresAt : new Date(),
        };
        table.set(key, row);
        byId.set(row.id, row);
        return row;
      }),

      findUnique: jest.fn(async ({ where }: { where: { key?: string; id?: string } }) => {
        if (where.key) return table.get(where.key) ?? null;
        if (where.id) return byId.get(where.id) ?? null;
        return null;
      }),

      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = byId.get(where.id);
        if (!existing) throw new Error('Row not found');
        const updated: IdemRow = {
          ...existing,
          ...(typeof data.resultId === 'string' ? { resultId: data.resultId } : {}),
          ...(Object.prototype.hasOwnProperty.call(data, 'resultData')
            ? { resultData: (data as { resultData?: unknown }).resultData ?? null }
            : {}),
        };
        byId.set(where.id, updated);
        table.set(updated.key, updated);
        return updated;
      }),

      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        const existing = byId.get(where.id);
        if (!existing) throw new Error('Row not found');
        byId.delete(where.id);
        table.delete(existing.key);
        return existing;
      }),

      deleteMany: jest.fn(async ({ where }: { where?: { expiresAt?: { lt: Date } } }) => {
        const cutoff = where?.expiresAt?.lt ?? new Date();
        let deleted = 0;
        for (const row of [...table.values()]) {
          if (row.expiresAt.getTime() < cutoff.getTime()) {
            table.delete(row.key);
            byId.delete(row.id);
            deleted++;
          }
        }
        return { count: deleted };
      }),
    },
  };

  return { mock, table, byId };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const EMAIL_APP_KEY = (id: string) => keyForAppFromEmail(id);

// ── Key generator tests ─────────────────────────────────────────────────────

describe('Idempotency key generators', () => {
  it('are deterministic', () => {
    expect(keyForAppFromEmail('msg-abc')).toBe(keyForAppFromEmail('msg-abc'));
    expect(keyForAppFromManual('u1', 'opp1')).toBe(keyForAppFromManual('u1', 'opp1'));
    expect(keyForStatusTransition('app1', 'INTERVIEW', 'gmail', 'm1')).toBe(
      keyForStatusTransition('app1', 'INTERVIEW', 'gmail', 'm1'),
    );
    expect(jobIdForResumeOperation('sha-256', 'parse')).toBe(
      jobIdForResumeOperation('sha-256', 'parse'),
    );
    expect(occurrenceHash('2025-01-01T00:00:00Z', 'a')).toBe(
      occurrenceHash('2025-01-01T00:00:00Z', 'a'),
    );
  });

  it('prefix separate operations so they never collide even on same id', () => {
    const msg = 'msg-abc';
    const app = keyForAppFromEmail(msg);
    const out = keyForOutcomeFromEmail(msg);
    const job = jobIdForEmailIngestion(msg);
    expect(new Set([app, out, job]).size).toBe(3);
    expect(app).toMatch(/^app:email:/);
    expect(out).toMatch(/^outcome:email:/);
    expect(job).toMatch(/^job:email:/);
  });

  it('manual key includes userId + opportunityId + optional salt uniquely', () => {
    const same = keyForAppFromManual('u1', 'opp1');
    const diffUser = keyForAppFromManual('u2', 'opp1');
    const diffOpp = keyForAppFromManual('u1', 'opp2');
    const salted = keyForAppFromManual('u1', 'opp1', '2025');
    const set = new Set([same, diffUser, diffOpp, salted]);
    expect(set.size).toBe(4);
  });

  it('isWellFormedKey accepts canonical builders and rejects free-form', () => {
    expect(isWellFormedKey(keyForAppFromEmail('x'))).toBe(true);
    expect(isWellFormedKey(keyForOutcomeFromEmail('x'))).toBe(true);
    expect(isWellFormedKey(keyForStatusTransition('a', 'b', 'c'))).toBe(true);
    expect(isWellFormedKey(keyForUserAction('u', 'a', 'FOLLOW_UP', occurrenceHash(new Date().toISOString())))).toBe(true);
    expect(isWellFormedKey('free-form')).toBe(false);
    expect(isWellFormedKey('')).toBe(false);
  });

  it('truncates long keys to 255 chars with a deterministic suffix', () => {
    const longId = 'x'.repeat(1000);
    const key = keyForAppFromEmail(longId);
    expect(key.length).toBeLessThanOrEqual(255);
    // Same input → same truncated output
    expect(key).toBe(keyForAppFromEmail(longId));
    // Different input → different truncated output (high probability)
    const other = keyForAppFromEmail('y'.repeat(1000));
    expect(key).not.toBe(other);
  });
});

// ── IdempotencyService.recordOrGet (single-statement path) ──────────────────

describe('IdempotencyService.recordOrGet', () => {
  let svc: IdempotencyService;
  let db: ReturnType<typeof buildMockPrisma>;

  beforeEach(() => {
    db = buildMockPrisma();
    svc = new IdempotencyService(db.mock as unknown as PrismaClient);
  });

  it('first call records, returns alreadyExecuted=false + caller resultId', async () => {
    const key = EMAIL_APP_KEY('msg-1');
    const res = await svc.recordOrGet(key, 'create_application', 'app-1', {
      resultData: { company: 'Acme', matched: false },
    });
    expect(res.alreadyExecuted).toBe(false);
    expect(res.resultId).toBe('app-1');
    expect(res.resultData).toEqual({ company: 'Acme', matched: false });
  });

  it('second call returns stored result without re-running the caller', async () => {
    const key = EMAIL_APP_KEY('msg-1');
    const first = await svc.recordOrGet(key, 'create_application', 'app-1', {
      resultData: { v: 1 },
    });
    const second = await svc.recordOrGet(key, 'create_application', 'app-2', {
      resultData: { v: 999 }, // different payload on replay
    });

    expect(first.alreadyExecuted).toBe(false);
    expect(second.alreadyExecuted).toBe(true);
    expect(second.resultId).toBe('app-1'); // original, NOT app-2
    expect(second.resultData).toEqual({ v: 1 });
  });

  it('refuses malformed keys when strictKeyValidation is on (default)', async () => {
    await expect(svc.recordOrGet('not-a-prefix', 'x', 'y')).rejects.toThrow(/does not match any canonical scheme/);
    await expect(svc.recordOrGet('', 'x', 'y')).rejects.toThrow(/cannot be empty/);
  });

  it('allows free-form keys with strictKeyValidation=false for legacy callers', async () => {
    const res = await svc.recordOrGet('legacy:abc', 'x', 'result-1', { strictKeyValidation: false });
    expect(res.alreadyExecuted).toBe(false);
    expect(res.resultId).toBe('result-1');
  });

  it('survives concurrent races: only ONE of N concurrent recordOrGet calls writes (P2002 replay path)', async () => {
    const key = EMAIL_APP_KEY('race-1');
    const N = 20;
    const calls = Array.from({ length: N }, (_, i) =>
      svc.recordOrGet(key, 'create_application', `app-${i}`, {
        resultData: { i },
      }),
    );
    const results = await Promise.all(calls);
    // Exactly one winner; N-1 losers return the winner's data.
    const winners = results.filter((r: { alreadyExecuted: boolean }) => !r.alreadyExecuted);
    const losers = results.filter((r: { alreadyExecuted: boolean }) => r.alreadyExecuted);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(N - 1);
    const winningId = winners[0]!.resultId!;
    for (const r of results) expect(r.resultId).toBe(winningId);
  });
});

// ── IdempotencyService claim / commit / abort ───────────────────────────────

describe('IdempotencyService claim → commit / abort', () => {
  let svc: IdempotencyService;
  let db: ReturnType<typeof buildMockPrisma>;

  beforeEach(() => {
    db = buildMockPrisma();
    svc = new IdempotencyService(db.mock as unknown as PrismaClient);
  });

  it('second concurrent claimer observes the committed data from the first', async () => {
    const key = EMAIL_APP_KEY('two-phase');

    const c1 = await svc.claim(key, 'create_application');
    expect(c1.claimed).toBe(true);
    const c2 = await svc.claim(key, 'create_application');
    expect(c2.claimed).toBe(false);
    // c1 hasn't committed yet, so c2 sees resultId=null
    expect((c2 as { claimed: false; existing: { resultId: string | null; resultData: unknown } }).existing.resultId).toBeNull();

    await svc.commit((c1 as { claimed: true; recordId: string }).recordId, 'final-app-42', {
      classification: 'application',
    });

    // A third claim attempt after commit returns the stored resultId
    const c3 = await svc.claim(key, 'create_application');
    expect(c3.claimed).toBe(false);
    const c3Existing = (c3 as { claimed: false; existing: { resultId: string | null; resultData: unknown } }).existing;
    expect(c3Existing.resultId).toBe('final-app-42');
    expect(c3Existing.resultData).toEqual({ classification: 'application' });
  });

  it('abort removes the placeholder so a later claimer succeeds fresh', async () => {
    const key = EMAIL_APP_KEY('abort');
    const c1 = await svc.claim(key, 'create_application');
    expect(c1.claimed).toBe(true);
    await svc.abort((c1 as { claimed: true; recordId: string }).recordId);

    const c2 = await svc.claim(key, 'create_application');
    expect(c2.claimed).toBe(true);
    await svc.commit((c2 as { claimed: true; recordId: string }).recordId, 'post-abort');

    const after = await svc.check<unknown>(key);
    expect(after.resultId).toBe('post-abort');
  });
});

// ── check + cleanupExpired ──────────────────────────────────────────────────

describe('IdempotencyService check / cleanupExpired', () => {
  it('check returns alreadyExecuted=false before any write, true after recordOrGet', async () => {
    const { mock } = buildMockPrisma();
    const svc = new IdempotencyService(mock as unknown as PrismaClient);
    const key = EMAIL_APP_KEY('c-1');
    const before = await svc.check(key);
    expect(before.alreadyExecuted).toBe(false);
    expect(before.resultId).toBeNull();

    await svc.recordOrGet(key, 'create_application', 'res-1', { resultData: { ok: 1 } });

    const after = await svc.check<{ ok: number }>(key);
    expect(after.alreadyExecuted).toBe(true);
    expect(after.resultId).toBe('res-1');
    expect(after.resultData).toEqual({ ok: 1 });
  });

  it('cleanupExpired deletes rows with expiresAt < before, keeps others', async () => {
    const { mock, table } = buildMockPrisma();
    const svc = new IdempotencyService(mock as unknown as PrismaClient);

    const past = new Date();
    past.setUTCDate(past.getUTCDate() - 10);
    const future = new Date();
    future.setUTCFullYear(future.getUTCFullYear() + 1);

    // Bypass recordOrGet so we can hand-craft the expiresAt timestamp.
    await mock.idempotencyRecord.create({
      data: { key: EMAIL_APP_KEY('old'), operationType: 'x', resultId: 'r1', expiresAt: past },
    });
    await mock.idempotencyRecord.create({
      data: { key: EMAIL_APP_KEY('new'), operationType: 'x', resultId: 'r2', expiresAt: future },
    });
    expect(table.size).toBe(2);

    const deleted = await svc.cleanupExpired();
    expect(deleted).toBe(1);
    expect(table.has(EMAIL_APP_KEY('old'))).toBe(false);
    expect(table.has(EMAIL_APP_KEY('new'))).toBe(true);

    const secondPass = await svc.cleanupExpired();
    expect(secondPass).toBe(0);
  });
});
