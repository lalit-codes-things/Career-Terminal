/**
 * CompanySignalService — Section 7 of the architecture directive.
 *
 * Records and queries company signals such as hiring velocity, layoffs,
 * expansion, funding, acquisition, restructuring, leadership changes,
 * product launches, revenue changes, and market announcements.
 *
 * This is an additive service stub preserving existing behaviour.
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../config/database';
import {
  type CompanySignalInput,
  type CompanySignalRecord,
  type CompanySignalType,
} from '../../domain/company-signal';

type DbClient = PrismaClient | Prisma.TransactionClient;

export class CompanySignalService {
  constructor(private readonly db: DbClient = prisma) {}

  async recordSignal(
    input: CompanySignalInput,
    db: DbClient = this.db,
  ): Promise<CompanySignalRecord> {
    const record = await db.companySignal.create({
      data: {
        companyId: input.companyId,
        signalType: input.signalType,
        category: input.category,
        headline: input.headline,
        description: input.description ?? undefined,
        sourceUrl: input.sourceUrl ?? undefined,
        sourceName: input.sourceName ?? undefined,
        publicationTime: input.publicationTime ?? undefined,
        confidence: input.confidence ?? 1.0,
        affectedAreas: (input.affectedAreas ?? []) as string[],
        estimatedImpact: input.estimatedImpact ?? undefined,
      },
    });

    return this.toRecord(record);
  }

  async getCompanySignals(
    companyId: string,
    db: DbClient = this.db,
  ): Promise<readonly CompanySignalRecord[]> {
    const records = await db.companySignal.findMany({
      where: { companyId },
      orderBy: { discoveryTime: 'desc' },
    });

    return records.map((record) => this.toRecord(record));
  }

  async listSignalsByType(
    signalType: CompanySignalType,
    db: DbClient = this.db,
  ): Promise<readonly CompanySignalRecord[]> {
    const records = await db.companySignal.findMany({
      where: { signalType },
      orderBy: { discoveryTime: 'desc' },
    });

    return records.map((record) => this.toRecord(record));
  }

  private toRecord(record: {
    id: string;
    companyId: string;
    signalType: string;
    category: string;
    headline: string;
    description: string | null;
    sourceUrl: string | null;
    sourceName: string | null;
    publicationTime: Date | null;
    discoveryTime: Date;
    confidence: number;
    affectedAreas: string[];
    estimatedImpact: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): CompanySignalRecord {
    return {
      id: record.id,
      companyId: record.companyId,
      signalType: record.signalType,
      category: record.category,
      headline: record.headline,
      description: record.description,
      sourceUrl: record.sourceUrl,
      sourceName: record.sourceName,
      publicationTime: record.publicationTime,
      discoveryTime: record.discoveryTime,
      confidence: record.confidence,
      affectedAreas: record.affectedAreas,
      estimatedImpact: record.estimatedImpact,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}

export const companySignalService = new CompanySignalService();
