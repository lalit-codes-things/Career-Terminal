/**
 * RecruiterMemoryService
 *
 * Connects the memory module to the RecruiterMemoryObservation Prisma table.
 * Read/write path only — no new tables.
 *
 * write(recruiterId, fact)   — upsert into recruiter_memory_observations,
 *                              superseding the current observation of the same
 *                              factType when the incoming value differs.
 * read(recruiterId, query)   — query recruiter_memory_observations by factType
 *                              and optional point-in-time asOf.
 * timeline(recruiterId)      — ordered list of all observations + supersessions.
 *
 * The in-memory consolidate/retrieve/reconstructTimeline helpers are kept as
 * pure utility functions for unit-testing; they are no longer the live path.
 */

import { dbRouter } from '../../../config/database';
import { Prisma } from '@prisma/client';

export interface MemoryWriteInput {
  recruiterId: string;
  factType: string;
  factValue: Record<string, unknown>;
  confidence: number;
  validFrom: Date;
  validTo?: Date;
  provenanceJson?: Record<string, unknown>;
  evidenceJson?: unknown[];
}

export interface MemoryObservation {
  id: string;
  recruiterId: string;
  factType: string;
  factValue: Record<string, unknown>;
  confidence: number;
  validFrom: Date;
  validTo: Date | null;
  supersededById: string | null;
  supersededAt: Date | null;
  provenanceJson: Record<string, unknown>;
  evidenceJson: unknown[];
  createdAt: Date;
  version: number;
}

export interface MemoryReadQuery {
  factType?: string;
  /** Point-in-time: return facts valid at this moment. Defaults to now (current facts). */
  asOf?: Date;
  /** Include superseded facts (default: false — live facts only). */
  includeSuperseded?: boolean;
}

export class RecruiterMemoryService {
  // ── Write path ─────────────────────────────────────────────────────────────

  /**
   * Write a memory observation.  If a current (non-superseded) observation of
   * the same factType already exists with a different value, supersede it first.
   * If the value is identical, bump confidence if the incoming value is higher
   * (idempotent upsert semantics).
   */
  async write(input: MemoryWriteInput): Promise<MemoryObservation> {
    return dbRouter.write().$transaction(async (tx) => {
      const existing = await tx.recruiterMemoryObservation.findFirst({
        where: {
          recruiterId: input.recruiterId,
          factType: input.factType,
          supersededAt: null,
          validTo: null,
        },
        orderBy: { createdAt: 'desc' },
      });

      const now = new Date();
      const isSameValue =
        existing &&
        JSON.stringify(existing.factValue) === JSON.stringify(input.factValue);

      if (isSameValue && existing) {
        // Same value — only update confidence if incoming is higher
        if (input.confidence > existing.confidence) {
          const updated = await tx.recruiterMemoryObservation.update({
            where: { id: existing.id },
            data: {
              confidence: input.confidence,
              version: { increment: 1 },
            },
          });
          return this.map(updated);
        }
        return this.map(existing);
      }

      // Different value or first observation — create new, supersede old
      const created = await tx.recruiterMemoryObservation.create({
        data: {
          recruiterId: input.recruiterId,
          factType: input.factType,
           factValue: input.factValue as unknown as Prisma.InputJsonValue,
           confidence: Math.max(0, Math.min(1, input.confidence)),
           validFrom: input.validFrom,
           validTo: input.validTo ?? null,
           provenanceJson: (input.provenanceJson ?? {}) as unknown as Prisma.InputJsonValue,
           evidenceJson: (input.evidenceJson ?? []) as unknown as Prisma.InputJsonValue,
          version: 1,
        },
      });

      if (existing) {
        await tx.recruiterMemoryObservation.update({
          where: { id: existing.id },
          data: {
            validTo: input.validFrom,
            supersededById: created.id,
            supersededAt: now,
          },
        });
      }

      return this.map(created);
    });
  }

  // ── Read path ──────────────────────────────────────────────────────────────

  /**
   * Read memory observations for a recruiter.
   * Defaults to live (non-superseded) facts unless asOf or includeSuperseded
   * are specified.
   */
  async read(recruiterId: string, query: MemoryReadQuery = {}): Promise<MemoryObservation[]> {
    const asOf = query.asOf ?? new Date();
    const includeSuperseded = query.includeSuperseded ?? false;

    const rows = await dbRouter.read().recruiterMemoryObservation.findMany({
      where: {
        recruiterId,
        ...(query.factType ? { factType: query.factType } : {}),
        validFrom: { lte: asOf },
        ...(includeSuperseded
          ? {}
          : {
              supersededAt: null,
              OR: [{ validTo: null }, { validTo: { gt: asOf } }],
            }),
      },
      orderBy: [{ factType: 'asc' }, { validFrom: 'desc' }],
    });

    return rows.map((r) => this.map(r));
  }

  /**
   * Ordered timeline of all observations (including superseded) for audit / UI.
   */
  async timeline(
    recruiterId: string,
  ): Promise<Array<{ occurredAt: Date; type: string; observationId: string; confidence: number }>> {
    const rows = await dbRouter.read().recruiterMemoryObservation.findMany({
      where: { recruiterId },
      orderBy: { validFrom: 'asc' },
    });

    return rows.flatMap((r) => [
      {
        occurredAt: r.validFrom,
        type: `fact.observed.${r.factType}`,
        observationId: r.id,
        confidence: r.confidence,
      },
      ...(r.supersededAt
        ? [
            {
              occurredAt: r.supersededAt,
              type: `fact.superseded.${r.factType}`,
              observationId: r.id,
              confidence: r.confidence,
            },
          ]
        : []),
    ]);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private map(row: {
    id: string;
    recruiterId: string;
    factType: string;
    factValue: unknown;
    confidence: number;
    validFrom: Date;
    validTo: Date | null;
    supersededById: string | null;
    supersededAt: Date | null;
    provenanceJson: unknown;
    evidenceJson: unknown;
    createdAt: Date;
    version: number;
  }): MemoryObservation {
    return {
      id: row.id,
      recruiterId: row.recruiterId,
      factType: row.factType,
      factValue: (row.factValue ?? {}) as Record<string, unknown>,
      confidence: row.confidence,
      validFrom: row.validFrom,
      validTo: row.validTo,
      supersededById: row.supersededById,
      supersededAt: row.supersededAt,
      provenanceJson: (row.provenanceJson ?? {}) as Record<string, unknown>,
      evidenceJson: (row.evidenceJson ?? []) as unknown[],
      createdAt: row.createdAt,
      version: row.version,
    };
  }
}

export const recruiterMemoryService = new RecruiterMemoryService();
