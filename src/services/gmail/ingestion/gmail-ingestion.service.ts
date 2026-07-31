/**
 * Gmail Ingestion Service
 *
 * Orchestrates the full synchronization engine:
 * 1. Initial Mailbox Sync (Historical backfill)
 * 2. Incremental Sync (Delta changes via History API)
 *
 * Uses DurableCheckpointService for resumable sync with:
 *   - Atomic checkpoint advancement with optimistic locking
 *   - Per-item batch tracking (processed/skipped/failed/retryable)
 *   - Page token persistence for pagination resumability
 *   - Recovery on worker restart or queue retry
 *   - Concurrent worker protection via SELECT ... FOR UPDATE
 */
import { prisma } from '../../../config/database';
import { config } from '../../../config';
import { ConnectionStatus, EmailProvider } from '@prisma/client';
import { GmailClient } from '../client/gmail-client';
import { gmailOAuthService } from '../auth/gmail-oauth.service';
import { RawEmailFetcher } from './fetcher';
import { EmailNormalizer } from './normalizer';
import { GmailApiError, NotFoundError } from '../../../errors/app-errors';
import { logger } from '../../../lib/logger';
import type { GmailMessageRef } from '../models/gmail.types';
import { applicationTrackingService } from '../../application-tracking/application-tracking.service';
import {
  jobEmailClassifier,
  JobEmailCategory,
  type ClassifiableEmail,
} from '../../job-intelligence';
import { userOwnershipFilter } from '../../../utils/user-ownership';
import { userService } from '../../user';
import { features } from '../../../config/features';
import { queueService } from '../../queue/queue.service';
import { durableCheckpointService } from '../durable-checkpoint.service';
import { placementService } from '../../placement/placement.service';
import { v4 as uuidv4 } from 'uuid';

export interface IngestionService {
  syncInitialMailbox(userId: string, correlationId?: string): Promise<void>;
  syncNewEmails(userId: string, correlationId?: string): Promise<void>;
}

export class GmailIngestionService implements IngestionService {
  private readonly normalizer = new EmailNormalizer();

  /**
   * Performs the first-time synchronization of a user's mailbox.
   *
   * Durable checkpoint behaviour:
   *   1. Create sync operation + batch atomically
   *   2. Fetch a bounded page of messages
   *   3. Process items with per-item tracking (processed/failed)
   *   4. Atomically advance checkpoint with pageToken for resume
   *   5. Continue to next page; on crash, resume from last committed pageToken
   */
  async syncInitialMailbox(userId: string, correlationId?: string): Promise<void> {
    const corrId = correlationId ?? uuidv4();
    logger.info('[Sync] Starting initial sync', { userId, correlationId: corrId });

    await this.ensureUserIsActive(userId);
    const { client, connectionId } = await this.setupClient(userId);
    const fetcher = new RawEmailFetcher(client);
    const profile = await client.getProfile();
    const startingHistoryId = profile.historyId;

    // Check for resumeable initial sync
    const resume = await durableCheckpointService.determineResumeStrategy(userId);
    let currentPageToken: string | undefined;
    let syncOpId: string | null = null;
    let batchId: string | null = null;
    let totalSynced = 0;

    if (resume.canResume && resume.state.checkpoint?.syncMode === 'INITIAL_SYNC') {
      // Resume from last committed checkpoint
      currentPageToken = resume.state.checkpoint.pageToken ?? undefined;
      syncOpId = resume.state.syncOpId;
      batchId = resume.state.pendingBatch?.id ?? null;

      logger.info('[Sync] Resuming initial sync from checkpoint', {
        userId,
        pageToken: currentPageToken,
        checkpointVersion: resume.state.checkpoint.version,
        batchId,
      });
    }

    // If no resumeable sync, initialize a new one
    if (!syncOpId || !batchId) {
      const op = await durableCheckpointService.initializeSyncOp(
        userId, connectionId, 'INITIAL_SYNC', corrId, startingHistoryId ?? '0', 'server-' + process.pid, currentPageToken,
      );
      syncOpId = op.syncOpId;
      batchId = op.batchId;
    }

    const MAX_INITIAL_SYNC = 1000;

    try {
      while (totalSynced < MAX_INITIAL_SYNC) {
        const listResult = await client.listMessages({
          maxResults: 100,
          pageToken: currentPageToken,
        });

        if (listResult.messages.length === 0) break;

        // Process items with per-item tracking
        await this.processAndSaveBatch(userId, connectionId, listResult.messages, fetcher, batchId);

        totalSynced += listResult.messages.length;
        currentPageToken = listResult.nextPageToken;

        // Atomically advance checkpoint after each page
        await durableCheckpointService.advanceCheckpoint(
          userId,
          batchId,
          startingHistoryId,
          currentPageToken,
        );

        if (!currentPageToken) break;
      }

      // Mark sync operation as completed
      await durableCheckpointService.completeSyncOp(syncOpId);

      // Update GmailSyncState for backward compatibility
      await this.updateBackwardCompatState(userId, connectionId, startingHistoryId);

      logger.info('[Sync] Initial sync completed', {
        userId, savedMessages: totalSynced, syncOpId,
      });
    } catch (error) {
      await durableCheckpointService.failSyncOp(
        syncOpId,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Performs an incremental sync using the Gmail History API.
   *
   * Durable checkpoint behaviour:
   *   1. Check for resumeable incremental sync from last checkpoint
   *   2. Start new batch with target historyId
   *   3. Process history pages with per-item tracking
   *   4. Advance checkpoint only after successful processing
   *   5. Never advance cursor before data is durably stored
   *   6. Handle expired history by falling back to full sync
   */
  async syncNewEmails(userId: string, correlationId?: string): Promise<void> {
    const corrId = correlationId ?? uuidv4();
    logger.info('[Sync] Starting incremental sync', { userId, correlationId: corrId });

    await this.ensureUserIsActive(userId);

    // Check for resumeable incremental sync
    const resume = await durableCheckpointService.determineResumeStrategy(userId);
    if (resume.canResume && resume.action === 'restart_batch' && resume.state.pendingBatch) {
      logger.info('[Sync] Resuming interrupted incremental batch', {
        userId,
        batchId: resume.state.pendingBatch.id,
        checkpointVersion: resume.state.checkpoint?.version,
      });
      // Re-process uncompleted emails from the interrupted batch
      await this.resumeInterruptedBatch(userId, resume);
      return;
    }

    if (resume.action === 'fallback_to_initial') {
      logger.warn('[Sync] Expired checkpoint; falling back to initial sync', { userId });
      await this.syncInitialMailbox(userId, corrId);
      return;
    }

    // Retrieve current sync state for the history cursor
    const syncState = await prisma.gmailSyncState.findUnique({
      where: { userId },
    });

    if (!syncState) {
      logger.warn('[Sync] No sync state found; falling back to initial sync', { userId });
      await this.syncInitialMailbox(userId, corrId);
      return;
    }

    const { client, connectionId } = await this.setupClient(userId);
    const fetcher = new RawEmailFetcher(client);

    const profile = await client.getProfile();
    const targetHistoryId = profile.historyId;

    if (targetHistoryId === syncState.historyId) {
      logger.info('[Sync] Mailbox already up to date', { userId, historyId: targetHistoryId });
      return;
    }

    // Initialize sync operation + batch for incremental sync
    const { syncOpId, batchId } = await durableCheckpointService.initializeSyncOp(
      userId, connectionId, 'INCREMENTAL_SYNC', corrId, targetHistoryId,
      'server-' + process.pid, syncState.historyId,
    );

    let currentHistoryId = syncState.historyId;
    let pageToken: string | undefined = undefined;
    let totalNewMessages = 0;

    try {
      do {
        const historyResult = await client.getHistory({
          startHistoryId: currentHistoryId,
          pageToken,
        });

        const messagesToFetch = historyResult.messagesAdded.map((m) => m.message);

        if (messagesToFetch.length > 0) {
          await this.processAndSaveBatch(userId, connectionId, messagesToFetch, fetcher, batchId);
          totalNewMessages += messagesToFetch.length;
        }

        currentHistoryId = historyResult.historyId;
        pageToken = historyResult.nextPageToken;
      } while (pageToken);

      // Atomically advance checkpoint — only after ALL processing succeeded
      await durableCheckpointService.advanceCheckpoint(
        userId, batchId, currentHistoryId,
      );

      // Update backward-compatible sync state
      await this.updateBackwardCompatState(userId, connectionId, currentHistoryId);

      await durableCheckpointService.completeSyncOp(syncOpId);

      logger.info('[Sync] Incremental sync completed', {
        userId, newMessages: totalNewMessages, batchId,
      });
    } catch (error) {
      await durableCheckpointService.failSyncOp(
        syncOpId,
        error instanceof Error ? error.message : String(error),
      );

      if (error instanceof GmailApiError && error.gmailErrorCode === 404) {
        logger.warn('[Sync] History ID expired; falling back to full sync', { userId });
        await this.syncInitialMailbox(userId, corrId);
        return;
      }
      throw error;
    }
  }

  /**
   * Resume an interrupted batch by reprocessing emails that weren't completed.
   * This is safe because processAndSaveBatch uses upsert (idempotent).
   */
  private async resumeInterruptedBatch(userId: string, resume: any): Promise<void> {
    const batch = resume.state.pendingBatch;
    const { client, connectionId } = await this.setupClient(userId);
    const fetcher = new RawEmailFetcher(client);

    logger.info('[Sync] Resuming interrupted batch', {
      userId,
      batchId: batch.id,
      historyId: batch.historyId,
    });

    // Re-fetch history from the batch's history cursor
    const historyResult = await client.getHistory({
      startHistoryId: batch.historyId,
    });

    const messagesToFetch = historyResult.messagesAdded.map((m) => m.message);

    if (messagesToFetch.length > 0) {
      await this.processAndSaveBatch(userId, connectionId, messagesToFetch, fetcher, batch.id);

      // Advance checkpoint after successful reprocessing
      await durableCheckpointService.advanceCheckpoint(
        userId, batch.id, historyResult.historyId,
      );

      await this.updateBackwardCompatState(userId, connectionId, historyResult.historyId);
    }

    logger.info('[Sync] Interrupted batch resumed successfully', {
      userId,
      batchId: batch.id,
    });
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  private async setupClient(
    userId: string,
  ): Promise<{ client: GmailClient; connectionId: string }> {
    const connection = await prisma.userEmailConnection.findFirst({
      where: {
        ...userOwnershipFilter(userId),
        provider: EmailProvider.GMAIL,
        status: ConnectionStatus.ACTIVE,
      },
    });

    if (!connection) {
      throw new NotFoundError('Active UserEmailConnection', userId);
    }

    const accessToken = await gmailOAuthService.getValidAccessToken(connection.id);

    return {
      client: new GmailClient({ accessToken }),
      connectionId: connection.id,
    };
  }

  private async ensureUserIsActive(userId: string): Promise<void> {
    const resolvedUserId = await userService.resolveUserId(userId);
    const user = await prisma.user.findUnique({
      where: { id: resolvedUserId },
      select: { deletionStatus: true },
    });

    if (!user || user.deletionStatus !== 'active') {
      throw new Error(`User ${userId} is not active`);
    }
  }

  private async isBackpressured(): Promise<boolean> {
    const limit = config.ingestionQueueDepthLimit;
    const depths = await queueService.getDepths();
    return Object.values(depths).some((depth) => depth >= limit);
  }

  /**
   * Core pipeline: Fetch raw bodies → Normalize → Upsert → Per-item tracking.
   * Uses upsert for idempotency and tracks each email via DurableCheckpointService.
   */
  private async processAndSaveBatch(
    userId: string,
    connectionId: string,
    messageRefs: GmailMessageRef[],
    fetcher: RawEmailFetcher,
    batchId?: string,
  ): Promise<void> {
    const rawMessages = await fetcher.fetchMessagesInBatches(messageRefs);
    const normalizedData = this.normalizer.normalizeBatch(rawMessages);
    const userScope = await userService.userScopeFor(userId);

    for (const data of normalizedData) {
      let emailDbId: string | undefined;
      let jobStatus: 'processed' | 'failed' = 'processed';

      try {
        const existingMessage = await prisma.emailMessage.findUnique({
          where: {
            unique_user_message: {
              legacyUserId: userId,
              providerMessageId: data.providerMessageId,
            },
          },
        });

        const saved = await prisma.emailMessage.upsert({
          where: {
            unique_user_message: {
              legacyUserId: userId,
              providerMessageId: data.providerMessageId,
            },
          },
          create: {
            ...data,
            userId: userScope.userId,
            legacyUserId: userScope.legacyUserId,
            connectionId,
          },
          update: {
            labels: data.labels,
            threadId: data.threadId,
          },
        });

        emailDbId = saved.id;

        if (!existingMessage) {
          if (features.asyncEmailProcessing) {
            const placement = await placementService.resolvePlacementContext(userScope.userId);
            if (!(await this.isBackpressured())) {
              await queueService.addApplicationTrackingJob({
                type: 'PROCESS_EMAIL',
                userId,
                cellId: placement.cellId,
                emailMessageId: saved.id,
                metadata: batchId ? { batchId } : undefined,
              });
            }
          } else {
            const classifiableEmail: ClassifiableEmail = {
              emailId: data.providerMessageId,
              sender: data.sender,
              subject: data.subject,
              bodyText: data.bodyText,
              bodyHtml: data.bodyHtml,
              receivedAt: data.receivedAt,
              threadId: data.threadId,
            };
            const classification = jobEmailClassifier.classify(classifiableEmail);
            if (classification.category !== JobEmailCategory.NOT_JOB_RELATED) {
              await applicationTrackingService.processEmailForJobApplication(
                classifiableEmail,
                classification,
                userId,
              );
            }
          }
        }
      } catch (err) {
        jobStatus = 'failed';
        logger.error('[Sync] Failed to process email', {
          userId,
          providerMessageId: data.providerMessageId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Track per-item status in the batch
      if (batchId && emailDbId) {
        await durableCheckpointService.trackEmailJob(
          batchId,
          emailDbId,
          data.providerMessageId,
          jobStatus,
        );
      }
    }
  }

  /**
   * Update backward-compatible sync state (GmailSyncState + connection lastSyncAt).
   * This is called after checkpoint is durably advanced.
   */
  private async updateBackwardCompatState(
    userId: string,
    connectionId: string,
    historyId: string,
  ): Promise<void> {
    const userScope = await userService.userScopeFor(userId);

    await prisma.gmailSyncState.upsert({
      where: { legacyUserId: userId },
      create: {
        userId: userScope.userId,
        legacyUserId: userScope.legacyUserId,
        connectionId,
        historyId,
        lastSyncedAt: new Date(),
      },
      update: {
        userId: userScope.userId,
        historyId,
        lastSyncedAt: new Date(),
      },
    });

    await prisma.userEmailConnection.update({
      where: { id: connectionId },
      data: { lastSyncAt: new Date() },
    });
  }
}

export const gmailIngestionService = new GmailIngestionService();
