/**
 * BaseRepository — partition-key-enforced data access layer.
 *
 * Golden rule: every findMany / findFirst / update / delete MUST be scoped
 * to the table's partition key. Missing it causes full-table scans that
 * will kill the database at scale.
 *
 * Partition key map:
 *   users              → userId
 *   job_applications   → userId
 *   email_messages     → userId
 *   sync_jobs          → userId
 *   jobs               → location_hash
 *
 * Any repository that extends BaseRepository declares its required
 * partition key at construction time. The base class enforces the rule
 * before every query and throws a MissingPartitionKeyError (HTTP 500,
 * non-operational) if the caller forgets it.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../config/database';
import { MissingPartitionKeyError } from '../errors/app-errors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A plain object whose keys map to Prisma filter values. */
export type WhereClause = Record<string, unknown>;

/**
 * Options for paginated list queries.
 */
export interface FindManyOptions {
  /** Maximum number of records to return (default: 25). */
  take?: number;
  /** Number of records to skip (for cursor/offset pagination). */
  skip?: number;
  /** Prisma-compatible orderBy clause. */
  orderBy?: Record<string, 'asc' | 'desc'>;
}

// ---------------------------------------------------------------------------
// Prisma Model Delegate Types
// ---------------------------------------------------------------------------

type PrismaModelDelegates = {
  jobApplication: Prisma.JobApplicationDelegate;
  emailMessage: Prisma.EmailMessageDelegate;
  syncJob: Prisma.SyncJobDelegate;
  userEmailConnection: Prisma.UserEmailConnectionDelegate;
  applicationTimeline: Prisma.ApplicationTimelineDelegate;
  applicationStatusHistory: Prisma.ApplicationStatusHistoryDelegate;
  applicationSource: Prisma.ApplicationSourceDelegate;
  company: Prisma.CompanyDelegate;
  recruiter: Prisma.RecruiterDelegate;
  resumeHash: Prisma.ResumeHashDelegate;
};

type ModelName = keyof PrismaModelDelegates;

// ---------------------------------------------------------------------------
// BaseRepository
// ---------------------------------------------------------------------------

/**
 * Abstract base repository.
 *
 * Subclasses must call super(modelName, partitionKey) to declare which
 * column is the partition key for their table. The base class will then
 * enforce its presence on every mutating or list query.
 *
 * @example
 * class ApplicationRepository extends BaseRepository<'jobApplication'> {
 *   constructor() {
 *     super('jobApplication', 'userId');
 *   }
 * }
 */
export abstract class BaseRepository<TModel extends ModelName> {
  protected readonly db: PrismaClient;
  protected readonly delegate: PrismaModelDelegates[TModel];

  constructor(
    /** Prisma model name — used for delegate access. */
    protected readonly modelName: TModel,
    /** The column that MUST appear in every where clause for this table. */
    protected readonly partitionKey: string,
    /** Optionally inject a different Prisma client (e.g. read replica). */
    db: PrismaClient = prisma,
  ) {
    this.db = db;
    this.delegate = db[modelName] as PrismaModelDelegates[TModel];
  }

  // -------------------------------------------------------------------------
  // Partition key enforcement
  // -------------------------------------------------------------------------

  /**
   * Throws MissingPartitionKeyError if the where clause does not contain
   * the declared partition key (or contains it with a null/undefined value).
   */
  protected assertPartitionKey(where: WhereClause): void {
    const value = where[this.partitionKey];
    if (value === undefined || value === null) {
      throw new MissingPartitionKeyError(this.modelName, this.partitionKey);
    }
  }

  // -------------------------------------------------------------------------
  // Generic CRUD helpers
  // -------------------------------------------------------------------------

  /**
   * Returns a list of records scoped to the partition key.
   *
   * @param where   - Filter object. MUST include the partition key.
   * @param options - Pagination and sort options.
   */
  async findMany<
    TArgs extends Parameters<PrismaModelDelegates[TModel]['findMany']>[0],
  >(where: WhereClause, options: FindManyOptions = {}): Promise<unknown[]> {
    this.assertPartitionKey(where);

    const { take = 25, skip = 0, orderBy } = options;

    return this.delegate.findMany({
      where: where as TArgs extends { where?: infer W } ? W : never,
      take,
      skip,
      ...(orderBy ? { orderBy } : {}),
    } as TArgs);
  }

  /**
   * Returns the first record matching the where clause.
   * The partition key is still required to prevent cross-partition reads.
   */
  async findFirst<
    TArgs extends Parameters<PrismaModelDelegates[TModel]['findFirst']>[0],
  >(where: WhereClause): Promise<unknown> {
    this.assertPartitionKey(where);

    return this.delegate.findFirst({
      where: where as TArgs extends { where?: infer W } ? W : never,
    } as TArgs);
  }

  /**
   * Creates a new record. No partition key check here — the caller must
   * include it in `data`; Prisma's type system enforces required fields.
   */
  async create<
    TArgs extends Parameters<PrismaModelDelegates[TModel]['create']>[0],
  >(data: Record<string, unknown>): Promise<unknown> {
    return this.delegate.create({
      data: data as TArgs extends { data?: infer D } ? D : never,
    } as TArgs);
  }

  /**
   * Updates records that match the where clause.
   * The partition key MUST be present — prevents accidental cross-partition updates.
   */
  async update(where: WhereClause, data: Record<string, unknown>): Promise<unknown> {
    this.assertPartitionKey(where);

    return this.delegate.updateMany({
      where: where as Prisma.Args<PrismaModelDelegates[TModel], 'updateMany'>['where'],
      data: data as Prisma.Args<PrismaModelDelegates[TModel], 'updateMany'>['data'],
    });
  }

  /**
   * Deletes records matching the where clause.
   * The partition key MUST be present — prevents accidental cross-partition deletes.
   */
  async delete(where: WhereClause): Promise<Prisma.BatchPayload> {
    this.assertPartitionKey(where);

    return this.delegate.deleteMany({
      where: where as Prisma.Args<PrismaModelDelegates[TModel], 'deleteMany'>['where'],
    });
  }

  /**
   * Counts records matching the where clause.
   * The partition key MUST be present.
   */
  async count(where: WhereClause): Promise<number> {
    this.assertPartitionKey(where);

    return this.delegate.count({
      where: where as Prisma.Args<PrismaModelDelegates[TModel], 'count'>['where'],
    });
  }
}

// ---------------------------------------------------------------------------
// Concrete repository examples — extend these for each domain entity
// ---------------------------------------------------------------------------

/**
 * Repository for job_applications — partitioned by userId.
 */
export class ApplicationRepository extends BaseRepository<'jobApplication'> {
  constructor(db?: PrismaClient) {
    super('jobApplication', 'userId', db);
  }
}

/**
 * Repository for email_messages — partitioned by userId.
 */
export class EmailMessageRepository extends BaseRepository<'emailMessage'> {
  constructor(db?: PrismaClient) {
    super('emailMessage', 'userId', db);
  }
}

/**
 * Repository for sync_jobs — partitioned by userId.
 */
export class SyncJobRepository extends BaseRepository<'syncJob'> {
  constructor(db?: PrismaClient) {
    super('syncJob', 'userId', db);
  }
}
