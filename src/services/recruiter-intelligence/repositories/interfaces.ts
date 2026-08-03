export interface CursorPaginationOptions {
  cursor?: string;
  take?: number;
  orderBy?: Record<string, 'asc' | 'desc'>;
}

export interface RepositoryTransactionContext {
  readonly kind: 'write-transaction';
}

export interface RecruiterPersistencePort<T> {
  create(input: T): Promise<T>;
  update(id: string, input: Partial<T> & { expectedUpdatedAt?: Date }): Promise<T>;
  findById(id: string): Promise<T | null>;
  list(where?: Record<string, unknown>, options?: CursorPaginationOptions): Promise<T[]>;
}

export interface RecruiterBulkOperationPort<T> {
  bulkUpsert(items: T[]): Promise<void>;
}

export interface RecruiterTransactionalPort {
  executeInTransaction<T>(work: (tx: RepositoryTransactionContext) => Promise<T>): Promise<T>;
}
