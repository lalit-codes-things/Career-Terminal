import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../../../config/database';

export interface CursorPaginationOptions {
  cursor?: string;
  take?: number;
  orderBy?: Record<string, 'asc' | 'desc'>;
}

export interface RepositoryTransaction<T> {
  run: (tx: Prisma.TransactionClient) => Promise<T>;
}

export abstract class BaseRecruiterRepository<TModel, TEntity> {
  protected constructor(
    protected readonly db: PrismaClient | Prisma.TransactionClient = prisma,
    protected readonly modelName: string,
  ) {}

  protected async withTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (this.db instanceof PrismaClient) {
      return this.db.$transaction(work as never);
    }
    return work(this.db as Prisma.TransactionClient);
  }

  protected buildCursorQuery(options: CursorPaginationOptions): { cursor?: { id: string }; take?: number; orderBy?: Record<string, 'asc' | 'desc'> } {
    return {
      cursor: options.cursor ? { id: options.cursor } : undefined,
      take: options.take ?? 25,
      orderBy: options.orderBy ?? { createdAt: 'asc' },
    };
  }

  protected assertModelName(name: string): void {
    if (!name) {
      throw new Error('Repository model name is required');
    }
  }

  protected async bulkUpsertMany(
    upsertFn: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<void> {
    await this.withTransaction(async (tx) => {
      await upsertFn(tx);
    });
  }

  protected async executeInTransaction<T>(operation: RepositoryTransaction<T>): Promise<T> {
    return this.withTransaction(operation.run);
  }

  abstract create(input: TEntity): Promise<TEntity>;
  abstract update(id: string, input: Partial<TEntity>): Promise<TEntity>;
  abstract findById(id: string): Promise<TEntity | null>;
  abstract list(where?: Record<string, unknown>, options?: CursorPaginationOptions): Promise<TEntity[]>;
}
