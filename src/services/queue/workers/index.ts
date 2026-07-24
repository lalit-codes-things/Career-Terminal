/**
 * Worker bootstrap — starts all BullMQ workers in a single process.
 *
 * Run this as a separate process from your web server so workers can be
 * scaled independently:
 *
 *   Web server : node dist/index.js          (handles HTTP, enqueues jobs)
 *   Workers    : node dist/services/queue/workers/index.js
 *
 * In development you can run both from the same process by importing this
 * module in src/index.ts, but keep them separate in production.
 */
import { type Worker } from 'bullmq';
import { startEmailWorker } from './email.worker';
import { startResumeParsingWorker } from './resume-parsing.worker';
import { startApplicationTrackingWorker } from './application-tracking.worker';
import { logger } from '../../../lib/logger';

let workers: Worker[] = [];

export function startAllWorkers(): void {
  workers = [startEmailWorker(), startResumeParsingWorker(), startApplicationTrackingWorker()];

  logger.info('[Workers] All workers started', { count: workers.length });
}

export async function stopAllWorkers(): Promise<void> {
  logger.info('[Workers] Shutting down workers…');
  await Promise.all(workers.map((w) => w.close()));
  logger.info('[Workers] All workers stopped');
}

// ── Standalone entrypoint ────────────────────────────────────────────────────
// Only runs when this file is executed directly (not when imported as a module).
if (require.main === module) {
  try {
    startAllWorkers();
  } catch (err) {
    logger.error('[Workers] Failed to start workers', {
      message: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }

  process.on('SIGTERM', () => {
    void stopAllWorkers().then(() => process.exit(0));
  });

  process.on('SIGINT', () => {
    void stopAllWorkers().then(() => process.exit(0));
  });
}
