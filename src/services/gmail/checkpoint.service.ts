import { prisma } from '../../config/database';
import { logger } from '../../lib/logger';
import { Prisma, SyncBatch, GmailCheckpoint } from '@prisma/client';

export class GmailCheckpointService {
  /**
   * Get the current checkpoint for a user.
   */
  async getCurrentCheckpoint(userId: string): Promise<GmailCheckpoint | null> {
    return prisma.gmailCheckpoint.findUnique({
      where: { userId },
    });
  }

  /**
   * Start a new sync batch: sets pendingHistoryId and status to 'syncing'.
   */
  async startBatch(userId: string, newHistoryId: string): Promise<{ batchId: string; checkpoint: GmailCheckpoint }> {
    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1. Create the SyncBatch record
      const batch = await tx.syncBatch.create({
        data: {
          userId,
          historyId: newHistoryId,
          status: 'pending',
        },
      });

      // 2. Update the GmailCheckpoint
      const checkpoint = await tx.gmailCheckpoint.upsert({
        where: { userId },
        create: {
          userId,
          pendingHistoryId: newHistoryId,
          status: 'syncing',
        },
        update: {
          pendingHistoryId: newHistoryId,
          status: 'syncing',
          lastSyncAt: new Date(),
        },
      });

      logger.info('[Checkpoint] Started new sync batch', { userId, batchId: batch.id, historyId: newHistoryId });

      return { batchId: batch.id, checkpoint };
    });
  }

  /**
   * Mark a single email as processed within a batch.
   */
  async markEmailProcessed(
    batchId: string,
    emailId: string,
    providerMessageId: string,
    status: 'completed' | 'failed',
    error?: string
  ): Promise<void> {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1. Upsert the BatchEmailJob record
      await tx.batchEmailJob.upsert({
        where: { id: `job:${batchId}:${emailId}` }, // Use a deterministic ID for idempotency if needed, or just create
        create: {
          batchId,
          emailId,
          providerMessageId,
          status,
          lastError: error,
          processedAt: status === 'completed' ? new Date() : null,
          attempts: 1,
        },
        update: {
          status,
          lastError: error,
          processedAt: status === 'completed' ? new Date() : null,
          attempts: { increment: 1 },
        },
      });

      // 2. Increment counters in SyncBatch
      await tx.syncBatch.update({
        where: { id: batchId },
        data: {
          processedCount: status === 'completed' ? { increment: 1 } : undefined,
          failedCount: status === 'failed' ? { increment: 1 } : undefined,
          status: 'processing',
        },
      });
    });
  }

  /**
   * Complete a batch: if all emails processed, advance currentHistoryId to pendingHistoryId.
   */
  async completeBatch(batchId: string): Promise<void> {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const batch = await tx.syncBatch.findUnique({
        where: { id: batchId },
        include: { user: { include: { checkpoint: true } } },
      });

      if (!batch || !batch.user.checkpoint) {
        throw new Error(`Batch ${batchId} or associated checkpoint not found`);
      }

      const totalEmails = batch.totalEmails ?? 0;
      const totalProcessed = batch.processedCount + batch.failedCount;

      if (totalProcessed < totalEmails) {
        logger.warn('[Checkpoint] Attempted to complete incomplete batch', {
          batchId,
          processed: totalProcessed,
          total: totalEmails,
        });
        return;
      }

      // If all succeeded, advance the checkpoint
      if (batch.failedCount === 0) {
        await tx.gmailCheckpoint.update({
          where: { userId: batch.userId },
          data: {
            currentHistoryId: batch.user.checkpoint.pendingHistoryId,
            pendingHistoryId: null,
            status: 'idle',
            lastSyncAt: new Date(),
          },
        });
        logger.info('[Checkpoint] Advanced checkpoint after successful batch', {
          userId: batch.userId,
          historyId: batch.user.checkpoint.pendingHistoryId,
        });
      } else {
        // If some failed, we do NOT advance currentHistoryId
        await tx.gmailCheckpoint.update({
          where: { userId: batch.userId },
          data: {
            status: 'failed',
            lastError: `${batch.failedCount} emails failed in batch ${batchId}`,
          },
        });
        logger.warn('[Checkpoint] Batch completed with failures; checkpoint NOT advanced', {
          batchId,
          failedCount: batch.failedCount,
        });
      }

      await tx.syncBatch.update({
        where: { id: batchId },
        data: {
          status: batch.failedCount === 0 ? 'completed' : 'failed',
          completedAt: new Date(),
        },
      });
    });
  }

  /**
   * Fail a batch: set status to 'failed', record error.
   */
  async failBatch(batchId: string, error: string): Promise<void> {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const batch = await tx.syncBatch.update({
        where: { id: batchId },
        data: {
          status: 'failed',
          error,
          completedAt: new Date(),
        },
      });

      await tx.gmailCheckpoint.update({
        where: { userId: batch.userId },
        data: {
          status: 'failed',
          lastError: error,
        },
      });

      logger.error('[Checkpoint] Batch failed', { batchId, error });
    });
  }

  /**
   * Get pending batch for a user.
   */
  async getPendingBatch(userId: string): Promise<SyncBatch | null> {
    return prisma.syncBatch.findFirst({
      where: {
        userId,
        status: { in: ['pending', 'processing'] },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Update total emails count for a batch.
   */
  async setBatchTotal(batchId: string, totalEmails: number): Promise<void> {
    await prisma.syncBatch.update({
      where: { id: batchId },
      data: { totalEmails },
    });
  }
}

export const gmailCheckpointService = new GmailCheckpointService();
