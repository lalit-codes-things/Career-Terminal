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
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../config/database';
import { MissingPartitionKeyError } from '../errors/app-errors';
import { logger } from '../lib/logger';

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

/**
 * Supported model names — extend this union as new Prisma models are added.
 * Used purely for logging / error messages; not a Prisma delegate type.
 */
export type ModelName =
  | 'jobApplication'
  | 'emailMessage'
  | 'syncJob'
  | 'userEmailConnection'
  | 'applicationTimeline'
  | 'applicationStatusHistory'
  | 'applicationSource'
  | 'company'
  | 'recruiter'
  | 'resumeHash';

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

  constructor(
    /** Prisma model name — used for delegate access and logging. */
    protected readonly modelName: TModel,
    /** The column that MUST appear in every where clause for this table. */
    protected readonly partitionKey: string,
    /** Optionally inject a different Prisma client (e.g. read replica). */
    db: PrismaClient = prisma,
  ) {
    this.db = db;
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
  async findMany(where: WhereClause, options: FindManyOptions = {}): Promise<unknown[]> {
    this.assertPartitionKey(where);

    const { take = 25, skip = 0, orderBy } = options;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const delegate = (this.db as any)[this.modelName] as {
      findMany(args: unknown): Promise<unknown[]>;
    };

    logger.debug(`[${this.modelName}] findMany`, {
      partitionValue: String(where[this.partitionKey]),
      take,
      skip,
    });

    return delegate.findMany({
      where,
      take,
      skip,
      ...(orderBy ? { orderBy } : {}),
    });
  }

  /**
   * Returns the first record matching the where clause.
   * The partition key is still required to prevent cross-partition reads.
   */
  async findFirst(where: WhereClause): Promise<unknown> {
    this.assertPartitionKey(where);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const delegate = (this.db as any)[this.modelName] as {
      findFirst(args: unknown): Promise<unknown>;
    };

    logger.debug(`[${this.modelName}] findFirst`, {
      partitionValue: String(where[this.partitionKey]),
    });

    return delegate.findFirst({ where });
  }

  /**
   * Creates a new record. No partition key check here — the caller must
   * include it in `data`; Prisma's type system enforces required fields.
   */
  async create(data: Record<string, unknown>): Promise<unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const delegate = (this.db as any)[this.modelName] as {
      create(args: unknown): Promise<unknown>;
    };

    logger.debug(`[${this.modelName}] create`);
    return delegate.create({ data });
  }

  /**
   * Updates records that match the where clause.
   * The partition key MUST be present — prevents accidental cross-partition updates.
   */
  async update(where: WhereClause, data: Record<string, unknown>): Promise<unknown> {
    this.assertPartitionKey(where);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const delegate = (this.db as any)[this.modelName] as {
      updateMany(args: unknown): Promise<Prisma.BatchPayload>;
    };

    logger.debug(`[${this.modelName}] update`, {
      partitionValue: String(where[this.partitionKey]),
    });

    return delegate.updateMany({ where, data });
  }

  /**
   * Deletes records matching the where clause.
   * The partition key MUST be present — prevents accidental cross-partition deletes.
   */
  async delete(where: WhereClause): Promise<Prisma.BatchPayload> {
    this.assertPartitionKey(where);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const delegate = (this.db as any)[this.modelName] as {
      deleteMany(args: unknown): Promise<Prisma.BatchPayload>;
    };

    logger.debug(`[${this.modelName}] delete`, {
      partitionValue: String(where[this.partitionKey]),
    });

    return delegate.deleteMany({ where });
  }

  /**
   * Counts records matching the where clause.
   * The partition key MUST be present.
   */
  async count(where: WhereClause): Promise<number> {
    this.assertPartitionKey(where);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const delegate = (this.db as any)[this.modelName] as {
      count(args: unknown): Promise<number>;
    };

    return delegate.count({ where });
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

// Singletons — reuse across the application
export const applicationRepository = new ApplicationRepository();
export const emailMessageRepository = new EmailMessageRepository();
export const syncJobRepository = new SyncJobRepository();
