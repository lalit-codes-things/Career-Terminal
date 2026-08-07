import type { Prisma, PrismaClient } from '@prisma/client';
import { dbRouter } from '../../../config/database';
import type { CursorPaginationOptions, RepositoryTransactionContext } from './interfaces';

export type RecruiterPrismaClient = PrismaClient | Prisma.TransactionClient;

export interface RecruiterTransactionContext extends RepositoryTransactionContext {
  readonly kind: 'write-transaction';
  readonly client: Prisma.TransactionClient;
}

export abstract class BaseRecruiterRepository<TEntity> {
  protected constructor(protected readonly db: RecruiterPrismaClient = dbRouter.write()) {}

  protected async withTransaction<T>(
    work: (tx: RecruiterTransactionContext) => Promise<T>,
  ): Promise<T> {
    const run = (tx: Prisma.TransactionClient) => work({ kind: 'write-transaction', client: tx });

    if ('$transaction' in this.db && typeof this.db.$transaction === 'function') {
      return (
        this.db.$transaction as (fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>
      )(run);
    }

    return run(this.db);
  }

  protected buildCursorQuery(options: CursorPaginationOptions): {
    cursor?: { id: string };
    skip?: number;
    take: number;
    orderBy: Record<string, 'asc' | 'desc'>;
  } {
    return {
      cursor: options.cursor ? { id: options.cursor } : undefined,
      skip: options.cursor ? 1 : undefined,
      take: options.take ?? 25,
      orderBy: options.orderBy ?? { createdAt: 'asc' },
    };
  }

  protected async bulkUpsertMany(
    upsertFn: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<void> {
    await this.withTransaction(async (tx) => {
      await upsertFn(tx.client);
    });
  }

  abstract create(input: TEntity): Promise<TEntity>;
  abstract update(
    id: string,
    input: Partial<TEntity> & { expectedUpdatedAt?: Date },
  ): Promise<TEntity>;
  abstract findById(id: string): Promise<TEntity | null>;
  abstract list(
    where?: Record<string, unknown>,
    options?: CursorPaginationOptions,
  ): Promise<TEntity[]>;
}
