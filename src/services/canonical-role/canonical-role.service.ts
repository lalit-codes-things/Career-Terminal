/**
 * CanonicalRoleService — Section 8 of the architecture directive.
 *
 * Role titles must eventually be canonicalised. This service provides
 * the abstraction for canonical roles, synonyms, required skills,
 * preferred skills, salary information, and labour-market demand.
 *
 * This is an additive service stub preserving existing behaviour.
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../config/database';
import {
  type CanonicalRoleInput,
  type CanonicalRoleRecord,
} from '../../domain/canonical-role';

type DbClient = PrismaClient | Prisma.TransactionClient;

export class CanonicalRoleService {
  constructor(private readonly db: DbClient = prisma) {}

  async createRole(input: CanonicalRoleInput, db: DbClient = this.db): Promise<CanonicalRoleRecord> {
    const record = await db.canonicalRole.create({
      data: {
        canonicalName: input.canonicalName,
        category: input.category ?? undefined,
        seniority: input.seniority ?? undefined,
        synonyms: (input.synonyms ?? []) as string[],
        requiredSkills: (input.requiredSkills ?? []) as string[],
        preferredSkills: (input.preferredSkills ?? []) as string[],
        salaryInfo: (input.salaryInfo ?? undefined) as Prisma.InputJsonValue | undefined,
        demandTrend: input.demandTrend ?? 'stable',
      },
    });

    return this.toRecord(record);
  }

  async upsertRole(input: CanonicalRoleInput, db: DbClient = this.db): Promise<CanonicalRoleRecord> {
    const record = await db.canonicalRole.upsert({
      where: { canonicalName: input.canonicalName },
      create: {
        canonicalName: input.canonicalName,
        category: input.category ?? undefined,
        seniority: input.seniority ?? undefined,
        synonyms: (input.synonyms ?? []) as string[],
        requiredSkills: (input.requiredSkills ?? []) as string[],
        preferredSkills: (input.preferredSkills ?? []) as string[],
        salaryInfo: (input.salaryInfo ?? undefined) as Prisma.InputJsonValue | undefined,
        demandTrend: input.demandTrend ?? 'stable',
      },
      update: {
        category: input.category ?? undefined,
        seniority: input.seniority ?? undefined,
        synonyms: (input.synonyms ?? []) as string[],
        requiredSkills: (input.requiredSkills ?? []) as string[],
        preferredSkills: (input.preferredSkills ?? []) as string[],
        salaryInfo: (input.salaryInfo ?? undefined) as Prisma.InputJsonValue | undefined,
        demandTrend: input.demandTrend ?? 'stable',
      },
    });

    return this.toRecord(record);
  }

  async getRole(canonicalName: string, db: DbClient = this.db): Promise<CanonicalRoleRecord | null> {
    const record = await db.canonicalRole.findUnique({
      where: { canonicalName },
    });

    if (!record) return null;
    return this.toRecord(record);
  }

  async listRoles(
    category?: string,
    seniority?: string,
    db: DbClient = this.db,
  ): Promise<readonly CanonicalRoleRecord[]> {
    const where: Prisma.CanonicalRoleWhereInput = {};

    if (category) {
      where.category = category;
    }
    if (seniority) {
      where.seniority = seniority;
    }

    const records = await db.canonicalRole.findMany({
      where,
      orderBy: { canonicalName: 'asc' },
    });

    return records.map((record) => this.toRecord(record));
  }

  private toRecord(record: {
    id: string;
    canonicalName: string;
    category: string | null;
    seniority: string | null;
    synonyms: string[];
    requiredSkills: string[];
    preferredSkills: string[];
    salaryInfo: Prisma.JsonValue;
    demandTrend: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): CanonicalRoleRecord {
    return {
      id: record.id,
      canonicalName: record.canonicalName,
      category: record.category,
      seniority: record.seniority,
      synonyms: record.synonyms,
      requiredSkills: record.requiredSkills,
      preferredSkills: record.preferredSkills,
      salaryInfo: record.salaryInfo as Record<string, unknown>,
      demandTrend: record.demandTrend,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}

export const canonicalRoleService = new CanonicalRoleService();
