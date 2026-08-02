import { gmailSyncWorker } from '../src/workers/gmail-sync.worker';
import { jobQueueService } from '../src/workers/job-queue.service';

/**
 * Helper script to manually verify the database-backed worker loop.
 * Run this via: npx ts-node scripts/diagnostics/verify-worker.ts
 */
async function run() {
  console.log('--- Gmail Sync Worker Verification ---');

  // Enqueue dummy jobs for a fake user
  const dummyUserId = 'test-user-123';
  await jobQueueService.enqueueInitialSync(dummyUserId);
  console.log('✅ Enqueued initial sync job');

  // Start the worker to watch it pick up the job and execute (or fail gracefully)
  gmailSyncWorker.start(2000); // Poll every 2 seconds

  // Stop after 10 seconds for the demo
  setTimeout(() => {
    gmailSyncWorker.stop();
    console.log('✅ Verification complete. Check your database for sync_jobs table updates.');
    process.exit(0);
  }, 10000);
}

run().catch(console.error);
