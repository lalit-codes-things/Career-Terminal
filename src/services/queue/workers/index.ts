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
import { startMalwareScanWorker } from './malware-scan.worker';
import { startResumeParsingWorker } from './resume-parsing.worker';
import { startApplicationTrackingWorker } from './application-tracking.worker';
import { startGmailSyncWorker } from './gmail-sync.worker';
import { startIntelligenceWorker } from './intelligence.worker';
import { startEconomicDocumentWorker } from './economic.worker';
import { outboxDispatcher } from '../../event/outbox-dispatcher.service';
import { logger } from '../../../lib/logger';
import { config } from '../../../config';

let workers: Worker[] = [];

const workerFactories = {
  email: startEmailWorker,
  'malware-scan': startMalwareScanWorker,
  'resume-parsing': startResumeParsingWorker,
  'application-tracking': startApplicationTrackingWorker,
  'gmail-sync': startGmailSyncWorker,
  intelligence: startIntelligenceWorker,
  'economic-document': startEconomicDocumentWorker,
  'outbox-dispatcher': () => {
    outboxDispatcher.start();
    return { close: async () => outboxDispatcher.stop() } as unknown as Worker;
  },
} as const;

export type WorkerQueue = keyof typeof workerFactories;

export function startAllWorkers(queueNames = config.worker.queues): void {
  const requested = (queueNames ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const selected = requested.length === 0 ? Object.keys(workerFactories) : requested;
  const invalid = selected.filter((name) => !(name in workerFactories));
  if (invalid.length > 0) {
    throw new Error(`Unknown worker queue(s): ${invalid.join(', ')}`);
  }

  workers = (selected as WorkerQueue[]).map((name) => workerFactories[name]());

  logger.info('[Workers] Workers started', { queues: selected, count: workers.length });
}

let isShuttingDown = false;

export async function stopAllWorkers(): Promise<void> {
  if (isShuttingDown) {
    logger.warn('[Workers] Shutdown already in progress.');
    return;
  }
  isShuttingDown = true;
  logger.info('[Workers] Shutting down workers…');

  const timeoutId = setTimeout(() => {
    logger.error('[Workers] Shutdown timed out, forcing exit');
    process.exit(1);
  }, config.worker.shutdownTimeoutMs);

  try {
    await Promise.allSettled(workers.map((w) => w.close()));
    logger.info('[Workers] All workers stopped');
    clearTimeout(timeoutId);
  } catch (err) {
    logger.error('[Workers] Error shutting down workers', {
      message: err instanceof Error ? err.message : String(err),
    });
    clearTimeout(timeoutId);
    throw err;
  }
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
    void stopAllWorkers()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });

  process.on('SIGINT', () => {
    void stopAllWorkers()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}
