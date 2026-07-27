/**
 * OpportunityService — canonical opportunity resolution (Prompt 2 of 19).
 *
 * Implements idempotent resolution of a "job opportunity" from extracted
 * application data.  Opportunities live in the global `opportunities` table
 * keyed by `(company, title, location)` fuzzy triplets so that multiple users
 * applying to the same role get back the same `opportunity_id`.
 *
 * Resolution strategy (priority order):
 *   1. Exact URL match — if `url` is provided and exists, return that row.
 *   2. Company + normalized-title + normalized-location fuzzy match.
 *   3. Company + normalized-title fuzzy match (ignore location differences).
 *   4. Create a new opportunity row.
 *
 * On re-observation of a known opportunity we update enrichment fields
 * (description / salary / requirements / url) when the new data is richer,
 * and always bump `last_seen_at` to keep temporal signals fresh.
 *
 * Concurrency: every resolution is serialized via a mutex keyed by the
 * normalized (company, title) pair, preventing two concurrent email
 * processors from creating duplicate rows for the same opportunity.
 */
import type { Opportunity, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../config/database';
import { companyService, type CompanyResolveInput } from '../company';
import { acquireLock, releaseLock } from '../../lib/mutex';
import { logger } from '../../lib/logger';
import { executeWithTransientRetry } from '../../db/transaction-utils';

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface SalaryRange {
  readonly min: number;
  readonly max: number;
  readonly currency: string;
}

export interface OpportunityResolutionInput {
  readonly companyName: string;
  readonly roleTitle: string;
  readonly location?: string;
  readonly url?: string;
  readonly description?: string;
  readonly salaryRange?: SalaryRange;
  readonly requirements?: readonly string[];
  readonly sourceEmailId?: string;
  readonly companyDomain?: string;
  readonly sourceMetadata?: Record<string, unknown>;
}

export interface OpportunityResolutionResult {
  readonly opportunityId: string;
  readonly isNew: boolean;
}

/** Title tokens stripped during normalization. */
const TITLE_NOISE_WORDS = new Set([
  'senior',
  'sr',
  'lead',
  'principal',
  'staff',
  'junior',
  'jr',
  'entry',
  'entrylevel',
  'mid',
  'midlevel',
  'i',
  'ii',
  'iii',
  'iv',
  'v',
  'level',
  '1',
  '2',
  '3',
  '4',
  '5',
  'associate',
  'intern',
  'internship',
  'fellow',
  'director',
  'vp',
  'head',
  'chief',
  'manager',
]);

/** Simple Levenshtein-ish similarity: containment + length ratio. */
function titlesAreSimilar(a: string, b: string, threshold = 0.75): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (longer.includes(shorter)) {
    return shorter.length / longer.length >= threshold;
  }
  let matches = 0;
  const aTokens = new Set(shorter.split(/\s+/).filter(Boolean));
  const bTokens = longer.split(/\s+/).filter(Boolean);
  for (const t of bTokens) if (aTokens.has(t)) matches++;
  return bTokens.length > 0 && matches / bTokens.length >= threshold;
}

function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter((t) => t && !TITLE_NOISE_WORDS.has(t))
    .join(' ')
    .trim();
}

function normalizeLocation(raw?: string): string {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRicherText(existing: string | null | undefined, incoming: string | undefined): boolean {
  return Boolean(incoming && incoming.length > (existing?.length ?? 0));
}

export class OpportunityService {
  constructor(private readonly db: DbClient = prisma) {}

  // ── Public API ──────────────────────────────────────────────────────────

  public async resolve(
    input: OpportunityResolutionInput,
    db: DbClient = this.db,
  ): Promise<OpportunityResolutionResult> {
    const companyInput: CompanyResolveInput = {
      name: input.companyName,
      domain: input.companyDomain ?? this.inferDomain(input.companyName),
    };

    const company = await companyService.resolveCompany(companyInput, db);

    const normalizedTitle = normalizeTitle(input.roleTitle);
    const normalizedLocation = normalizeLocation(input.location);

    const lockKey = `lock:opp:${company.id}:${this.hashPair(
      normalizedTitle,
      normalizedLocation,
    )}`;
    const lockToken = await acquireLock(lockKey, 60);

    const run = async (tx: DbClient): Promise<OpportunityResolutionResult> => {
      // Step 1: exact URL match
      if (input.url) {
        const byUrl = await tx.opportunity.findFirst({
          where: {
            companyId: company.id,
            url: input.url,
          },
        });
        if (byUrl) {
          await this.touchOpportunity(byUrl.id, input, tx);
          return { opportunityId: byUrl.id, isNew: false };
        }
      }

      // Step 2: fetch opportunity candidates by company + fuzzy title
      const candidates = await tx.opportunity.findMany({
        where: {
          companyId: company.id,
        },
        select: {
          id: true,
          title: true,
          location: true,
          description: true,
          salaryRange: true,
          requirements: true,
          url: true,
        },
      });

      const matchWithLocation = candidates.find((c) => {
        const cTitle = normalizeTitle(c.title);
        const cLoc = normalizeLocation(c.location ?? undefined);
        if (!titlesAreSimilar(normalizedTitle, cTitle)) return false;
        if (!normalizedLocation || !cLoc) return false;
        return (
          normalizedLocation === cLoc ||
          cLoc.includes(normalizedLocation) ||
          normalizedLocation.includes(cLoc)
        );
      });

      if (matchWithLocation) {
        await this.touchOpportunity(matchWithLocation.id, input, tx);
        return { opportunityId: matchWithLocation.id, isNew: false };
      }

      // Step 3: company + normalized title only (ignoring location)
      const matchTitleOnly = candidates.find((c) =>
        titlesAreSimilar(normalizedTitle, normalizeTitle(c.title)),
      );

      if (matchTitleOnly) {
        await this.touchOpportunity(matchTitleOnly.id, input, tx);
        return { opportunityId: matchTitleOnly.id, isNew: false };
      }

      // Step 4: create a new canonical opportunity
      const created = await this.createOpportunity(company.id, input, tx);
      return { opportunityId: created.id, isNew: true };
    };

    try {
      // When an explicit DbClient is passed (e.g. transaction client), use it
      // directly. Otherwise wrap in retry to handle transient DB errors.
      if (db !== prisma) {
        return await run(db);
      }
      return await executeWithTransientRetry(prisma, run);
    } finally {
      if (lockToken) {
        await releaseLock(lockKey, lockToken).catch((err) =>
          logger.warn('[OpportunityService] Failed to release lock', {
            lockKey,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private async touchOpportunity(
    id: string,
    input: OpportunityResolutionInput,
    tx: DbClient,
  ): Promise<void> {
    const update: Prisma.OpportunityUpdateInput = {
      lastSeenAt: new Date(),
    };
    let shouldUpdate = false;

    const current = await tx.opportunity.findUnique({
      where: { id },
      select: {
        description: true,
        salaryRange: true,
        requirements: true,
        url: true,
        location: true,
        sourceMetadata: true,
      },
    });

    if (!current) return;

    if (isRicherText(current.description, input.description)) {
      update.description = input.description!;
      shouldUpdate = true;
    }

    if (!current.url && input.url) {
      update.url = input.url;
      shouldUpdate = true;
    }

    if (!current.location && input.location) {
      update.location = input.location;
      shouldUpdate = true;
    }

    if (!current.salaryRange && input.salaryRange) {
      update.salaryRange = input.salaryRange as unknown as Prisma.InputJsonValue;
      shouldUpdate = true;
    }

    if (!current.requirements && input.requirements && input.requirements.length > 0) {
      update.requirements = input.requirements;
      shouldUpdate = true;
    }

    if (input.sourceEmailId || input.sourceMetadata) {
      update.sourceMetadata = {
        ...((current?.sourceMetadata as Record<string, unknown> | null) ?? {}),
        ...(input.sourceMetadata ?? {}),
        ...(input.sourceEmailId ? { lastSourceEmailId: input.sourceEmailId } : {}),
      };
      shouldUpdate = true;
    }

    if (shouldUpdate) {
      await tx.opportunity.update({ where: { id }, data: update });
    } else {
      await tx.opportunity.update({
        where: { id },
        data: { lastSeenAt: new Date() },
      });
    }
  }

  private async createOpportunity(
    companyId: string,
    input: OpportunityResolutionInput,
    tx: DbClient,
  ): Promise<Opportunity> {
    const now = new Date();

    const data: Prisma.OpportunityCreateInput = {
      company: { connect: { id: companyId } },
      title: input.roleTitle,
      description: input.description ?? null,
      location: input.location ?? null,
      url: input.url ?? null,
      firstSeenAt: now,
      lastSeenAt: now,
      isCurrent: true,
    };

    if (input.salaryRange) {
      data.salaryRange = input.salaryRange as unknown as Prisma.InputJsonValue;
    }
    if (input.requirements && input.requirements.length > 0) {
      data.requirements = input.requirements;
    }
    if (input.sourceMetadata || input.sourceEmailId) {
      data.sourceMetadata = {
        ...(input.sourceMetadata ?? {}),
        ...(input.sourceEmailId ? { initialSourceEmailId: input.sourceEmailId } : {}),
      };
    }

    return tx.opportunity.create({ data });
  }

  private inferDomain(companyName: string): string {
    const base = companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .trim();
    return `${base || 'unknown'}.com`;
  }

  private hashPair(a: string, b: string): string {
    let h1 = 0;
    const s = `${a}|${b}`;
    for (let i = 0; i < s.length; i++) {
      h1 = (h1 << 5) - h1 + s.charCodeAt(i);
      h1 |= 0;
    }
    return Math.abs(h1).toString(36);
  }
}

export const opportunityService = new OpportunityService();
