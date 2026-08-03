import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../../config/database';
import type { RecruiterCreateInput, RecruiterAliasInput } from '../domain/recruiter-data.types';
import {
  validateRecruiterCreate,
  validateRecruiterAlias,
} from '../validation/recruiter.validation';
import { BaseRecruiterRepository } from './base-recruiter.repository';
import type {
  RecruiterPersistencePort,
  RecruiterBulkOperationPort,
  RecruiterTransactionalPort,
} from './interfaces';

export interface RecruiterRecord {
  id: string;
  companyId: string;
  name: string;
  email: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecruiterRepositoryContract
  extends
    RecruiterPersistencePort<RecruiterRecord>,
    RecruiterBulkOperationPort<{ id?: string; canonicalName: string; source: string }>,
    RecruiterTransactionalPort {
  createRecruiter(input: RecruiterCreateInput): Promise<{ id: string }>;
  createAlias(recruiterId: string, input: RecruiterAliasInput): Promise<{ id: string }>;
  findByEmail(email: string): Promise<unknown>;
  listByCompany(companyId: string, cursor?: string): Promise<unknown[]>;
}

export class RecruiterRepository
  extends BaseRecruiterRepository<RecruiterRecord>
  implements RecruiterRepositoryContract
{
  constructor(protected readonly db: PrismaClient | Prisma.TransactionClient = prisma) {
    super(db);
  }

  async createRecruiter(input: RecruiterCreateInput): Promise<{ id: string }> {
    const validation = validateRecruiterCreate(input);
    if (!validation.isValid) {
      throw new Error(validation.errors.join(', '));
    }

    const record = await this.db.recruiter.create({
      data: {
        name: input.canonicalName,
        companyId: input.companyId ?? '00000000-0000-0000-0000-000000000000',
        email: '',
        title: '',
      },
    });

    return { id: record.id };
  }

  async createAlias(recruiterId: string, input: RecruiterAliasInput): Promise<{ id: string }> {
    const validation = validateRecruiterAlias(input);
    if (!validation.isValid) {
      throw new Error(validation.errors.join(', '));
    }

    const record = await this.db.recruiter.update({
      where: { id: recruiterId },
      data: {
        name: input.alias,
      },
    });

    return { id: record.id };
  }

  async create(input: RecruiterRecord): Promise<RecruiterRecord> {
    return this.db.recruiter.create({
      data: {
        name: input.name,
        companyId: input.companyId,
        email: input.email,
        title: input.title,
      },
    });
  }

  async update(
    id: string,
    input: Partial<RecruiterRecord> & { expectedUpdatedAt?: Date },
  ): Promise<RecruiterRecord> {
    if (input.expectedUpdatedAt) {
      const result = await this.db.recruiter.updateMany({
        where: { id, updatedAt: input.expectedUpdatedAt },
        data: {
          name: input.name,
          companyId: input.companyId,
          email: input.email,
          title: input.title,
        },
      });

      if (result.count !== 1) {
        throw new Error('Optimistic lock conflict while updating recruiter');
      }

      const updated = await this.findById(id);
      if (!updated) {
        throw new Error('Recruiter disappeared after optimistic update');
      }
      return updated;
    }

    return this.db.recruiter.update({
      where: { id },
      data: {
        name: input.name,
        companyId: input.companyId,
        email: input.email,
        title: input.title,
      },
    });
  }

  async findById(id: string): Promise<RecruiterRecord | null> {
    return this.db.recruiter.findUnique({ where: { id } });
  }

  async list(
    where: Record<string, unknown> = {},
    options: { cursor?: string; take?: number; orderBy?: Record<string, 'asc' | 'desc'> } = {},
  ): Promise<RecruiterRecord[]> {
    return this.db.recruiter.findMany({
      where,
      ...this.buildCursorQuery(options),
    });
  }

  async findByEmail(email: string): Promise<unknown> {
    return this.db.recruiter.findFirst({ where: { email } });
  }

  async listByCompany(companyId: string, cursor?: string): Promise<unknown[]> {
    return this.db.recruiter.findMany({
      where: { companyId },
      ...this.buildCursorQuery({ cursor, take: 25, orderBy: { createdAt: 'asc' } }),
    });
  }

  async bulkUpsert(
    records: Array<{ id?: string; canonicalName: string; source: string }>,
  ): Promise<void> {
    await this.bulkUpsertMany(async (tx) => {
      for (const record of records) {
        await tx.recruiter.upsert({
          where: { id: record.id ?? '' },
          update: { name: record.canonicalName },
          create: {
            id: record.id ?? undefined,
            name: record.canonicalName,
            companyId: '00000000-0000-0000-0000-000000000000',
            email: '',
            title: '',
          },
        });
      }
    });
  }

  async executeInTransaction<T>(
    work: (tx: { readonly kind: 'write-transaction' }) => Promise<T>,
  ): Promise<T> {
    return this.withTransaction(work);
  }
}
