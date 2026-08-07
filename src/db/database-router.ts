/**
 * DatabaseRouter — read/write splitting with automatic replica fallback.
 *
 * Rules:
 *   dbRouter.write() → always returns the master PrismaClient.
 *                      Use for INSERT, UPDATE, DELETE, and any SELECT that
 *                      must read your own writes (e.g. immediately after
 *                      an INSERT inside the same request).
 *
 *   dbRouter.read()  → returns the replica client when healthy.
 *                      Falls back to master if the replica is marked unhealthy
 *                      so the application never returns errors just because
 *                      the replica is down.
 *
 * Health tracking:
 *   The router uses a simple circuit-breaker pattern:
 *   - Every replica query failure increments an internal failure counter.
 *   - Once the counter exceeds `FAILURE_THRESHOLD` within `RESET_WINDOW_MS`,
 *     the replica is marked unhealthy and all reads fall back to master.
 *   - After `RESET_WINDOW_MS` the circuit resets and the replica is retried.
 *
 * Transactions:
 *   Always use dbRouter.write() for the entire transaction — never mix
 *   master and replica inside a single $transaction() call.
 *
 * Usage:
 *   import { dbRouter } from '../config/database';
 *
 *   // Read (goes to replica, falls back to master on failure)
 *   const apps = await dbRouter.read().jobApplication.findMany({ where: { userId } });
 *
 *   // Write
 *   const app = await dbRouter.write().jobApplication.create({ data: { ... } });
 *
 *   // Transaction (always master)
 *   await dbRouter.write().$transaction(async (tx) => {
 *     await tx.jobApplication.create({ ... });
 *     await tx.applicationTimeline.create({ ... });
 *   });
 */
import { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Circuit-breaker config
// ---------------------------------------------------------------------------

/** Number of failures within RESET_WINDOW_MS before the replica is bypassed. */
const FAILURE_THRESHOLD = 3;

/** Window in ms over which failures are counted. After this, the counter resets. */
const RESET_WINDOW_MS = 60_000; // 1 minute

// ---------------------------------------------------------------------------
// DatabaseRouter
// ---------------------------------------------------------------------------

export class DatabaseRouter {
  private replicaHealthy = true;
  private failureCount = 0;
  private lastFailureAt = 0;

  constructor(
    private readonly master: PrismaClient,
    private readonly replica: PrismaClient,
  ) {
    // If replica === master (no replica URL configured) we never need
    // health-check logic — reads and writes hit the same client.
    if (master === replica) {
      logger.info('[DatabaseRouter] No replica configured — all queries route to master.');
    } else {
      logger.info('[DatabaseRouter] Read/write splitting active.');
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Returns the master client for all writes.
   * Always safe to call — never throws.
   */
  write(): PrismaClient {
    return this.master;
  }

  /**
   * Returns the replica client for reads, with automatic fallback to master.
   *
   * Wrap the Prisma call in `withReplicaFallback()` when you want the router
   * to automatically record failures and fall back mid-request. For plain
   * usage just call `dbRouter.read()` and let the caller handle errors.
   */
  read(): PrismaClient {
    if (this.master === this.replica) {
      // No replica configured — always master
      return this.master;
    }

    if (!this.replicaHealthy) {
      // Check if the reset window has elapsed
      if (Date.now() - this.lastFailureAt >= RESET_WINDOW_MS) {
        logger.info('[DatabaseRouter] Reset window elapsed — retrying replica.');
        this.replicaHealthy = true;
        this.failureCount = 0;
      } else {
        logger.debug('[DatabaseRouter] Replica unhealthy — routing read to master.');
        return this.master;
      }
    }

    return this.replica;
  }

  /**
   * Executes a read callback against the replica and automatically falls back
   * to master if the replica throws. Records the failure for circuit-breaker
   * tracking.
   *
   * @example
   * const result = await dbRouter.withReplicaFallback(
   *   (db) => db.jobApplication.findMany({ where: { userId } })
   * );
   */
  async withReplicaFallback<T>(queryFn: (db: PrismaClient) => Promise<T>): Promise<T> {
    // No replica — skip the try/catch overhead entirely
    if (this.master === this.replica) {
      return queryFn(this.master);
    }

    const replicaClient = this.read();

    // If already falling back, go straight to master
    if (replicaClient === this.master) {
      return queryFn(this.master);
    }

    try {
      const result = await queryFn(replicaClient);
      // Success — reset failure counter (sliding window)
      if (this.failureCount > 0) {
        this.failureCount = 0;
      }
      return result;
    } catch (err) {
      this.recordReplicaFailure(err as Error);

      logger.warn('[DatabaseRouter] Replica query failed — falling back to master.', {
        error: (err as Error).message,
        failureCount: this.failureCount,
        replicaHealthy: this.replicaHealthy,
      });

      // Retry the same query on master
      return queryFn(this.master);
    }
  }

  /**
   * Force-marks the replica as unhealthy (e.g. after an external health check
   * determines the replica is lagging or unreachable).
   */
  markReplicaUnhealthy(): void {
    this.replicaHealthy = false;
    this.lastFailureAt = Date.now();
    logger.warn('[DatabaseRouter] Replica manually marked unhealthy.');
  }

  /**
   * Force-marks the replica as healthy (e.g. after an external health check
   * confirms the replica has caught up).
   */
  markReplicaHealthy(): void {
    this.replicaHealthy = true;
    this.failureCount = 0;
    logger.info('[DatabaseRouter] Replica manually marked healthy.');
  }

  /** Returns current health state — useful for /health endpoint reporting. */
  getHealth(): { replicaConfigured: boolean; replicaHealthy: boolean; failureCount: number } {
    return {
      replicaConfigured: this.master !== this.replica,
      replicaHealthy: this.replicaHealthy,
      failureCount: this.failureCount,
    };
  }

  async disconnect(): Promise<void> {
    await Promise.allSettled([
      this.master.$disconnect(),
      this.replica.$disconnect(),
    ]);
    logger.info('[DatabaseRouter] All database connections closed');
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private recordReplicaFailure(err: Error): void {
    const now = Date.now();

    // Reset counter if outside the window
    if (now - this.lastFailureAt >= RESET_WINDOW_MS) {
      this.failureCount = 0;
    }

    this.failureCount += 1;
    this.lastFailureAt = now;

    if (this.failureCount >= FAILURE_THRESHOLD) {
      this.replicaHealthy = false;
      logger.error(
        '[DatabaseRouter] Replica failure threshold reached — bypassing replica for ' +
          `${RESET_WINDOW_MS / 1000}s.`,
        { threshold: FAILURE_THRESHOLD, error: err.message },
      );
    }
  }
}
