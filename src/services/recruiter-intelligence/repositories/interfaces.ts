export interface RecruiterPersistencePort<T> {
  create(input: T): Promise<T>;
  update(id: string, input: Partial<T>): Promise<T>;
  findById(id: string): Promise<T | null>;
  list(where?: Record<string, unknown>, options?: { cursor?: string; take?: number; orderBy?: Record<string, 'asc' | 'desc'> }): Promise<T[]>;
}

export interface RecruiterBulkOperationPort<T> {
  bulkUpsert(items: T[]): Promise<void>;
}

export interface RecruiterTransactionalPort<T> {
  executeInTransaction(work: (tx: unknown) => Promise<T>): Promise<T>;
}
