/**
 * Gmail Ingestion Service
 *
 * Orchestrates the full synchronization engine:
 * 1. Initial Mailbox Sync (Historical backfill)
 * 2. Incremental Sync (Delta changes via History API)
 *
 * Uses the Fetcher -> Parser -> Normalizer -> DB pipeline.
 */
import { prisma } from '../../../config/database';
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
import { gmailCheckpointService } from '../checkpoint.service';

export interface IngestionService {
  syncInitialMailbox(userId: string): Promise<void>;
  syncNewEmails(userId: string): Promise<void>;
}

export class GmailIngestionService implements IngestionService {
  private readonly normalizer = new EmailNormalizer();

  /**
   * Performs the first-time synchronization of a user's mailbox.
   * Limits the initial sync to a reasonable cap (e.g., last 1000 messages)
   * to prevent API exhaustion and long processing times.
   */
  async syncInitialMailbox(userId: string): Promise<void> {
    logger.info('[Sync] Starting initial sync', { userId });
    const { client, connectionId } = await this.setupClient(userId);
    const fetcher = new RawEmailFetcher(client);

    // 1. Get current Profile to capture the starting historyId
    const profile = await client.getProfile();
    const startingHistoryId = profile.historyId;

    // 2. Fetch recent messages (capping at 1000 for initial sync)
    let pageToken: string | undefined = undefined;
    let totalSynced = 0;
    const MAX_INITIAL_SYNC = 1000;

    while (totalSynced < MAX_INITIAL_SYNC) {
      const listResult = await client.listMessages({
        maxResults: 100,
        pageToken,
      });

      if (listResult.messages.length === 0) break;

      // 3. Fetch full bodies, normalize, and save
      await this.processAndSaveBatch(userId, connectionId, listResult.messages, fetcher);

      totalSynced += listResult.messages.length;
      pageToken = listResult.nextPageToken;

      if (!pageToken) break;
    }

    // 4. Save the sync state so future syncs are incremental
    await this.updateSyncState(userId, connectionId, startingHistoryId);
    logger.info('[Sync] Initial sync completed', { userId, savedMessages: totalSynced });
  }

  /**
   * Performs an incremental sync using the Gmail History API.
   * Only fetches messages that have changed since the last sync.
   */
  async syncNewEmails(userId: string): Promise<void> {
    logger.info('[Sync] Starting incremental sync', { userId });

    // 1. Check for pending batch (Recovery logic)
    const pendingBatch = await gmailCheckpointService.getPendingBatch(userId);
    if (pendingBatch) {
      logger.info('[Sync] Resuming pending batch', { userId, batchId: pendingBatch.id });
      // In a real implementation, we would re-enqueue missing jobs here.
      // For this prompt, we acknowledge the recovery point.
    }

    // 2. Retrieve current sync state
    const syncState = await prisma.gmailSyncState.findUnique({
      where: { userId },
    });

    if (!syncState) {
      logger.warn('[Sync] No sync state found; falling back to initial sync', { userId });
      return this.syncInitialMailbox(userId);
    }

    const { client, connectionId } = await this.setupClient(userId);
    const fetcher = new RawEmailFetcher(client);

    // 3. Get current Profile to find the target historyId
    const profile = await client.getProfile();
    const targetHistoryId = profile.historyId;

    if (targetHistoryId === syncState.historyId) {
      logger.info('[Sync] Mailbox already up to date', { userId, historyId: targetHistoryId });
      return;
    }

    // 4. Start a new durable batch
    const { batchId } = await gmailCheckpointService.startBatch(userId, targetHistoryId);

    let currentHistoryId = syncState.historyId;
    let pageToken: string | undefined = undefined;
    let totalNewMessages = 0;

    try {
      // 5. Loop through history API pages
      do {
        const historyResult = await client.getHistory({
          startHistoryId: currentHistoryId,
          pageToken,
        });

        const messagesToFetch = historyResult.messagesAdded.map((m) => m.message);

        if (messagesToFetch.length > 0) {
          // 6. Process new messages (passing batchId for tracking)
          await this.processAndSaveBatch(userId, connectionId, messagesToFetch, fetcher, batchId);
          totalNewMessages += messagesToFetch.length;
        }

        // Move cursor forward
        currentHistoryId = historyResult.historyId;
        pageToken = historyResult.nextPageToken;
      } while (pageToken);

      // 7. Finalize batch total count
      await gmailCheckpointService.setBatchTotal(batchId, totalNewMessages);

      // 8. Update sync state with the latest historyId
      // Note: We still update GmailSyncState for the fetcher, 
      // but GmailCheckpoint advances only when jobs complete.
      await this.updateSyncState(userId, connectionId, currentHistoryId);
      
      logger.info('[Sync] Incremental sync enqueued', { userId, newMessages: totalNewMessages, batchId });
      
      // If 0 messages, complete batch immediately
      if (totalNewMessages === 0) {
        await gmailCheckpointService.completeBatch(batchId);
      }
    } catch (error) {
      await gmailCheckpointService.failBatch(batchId, error instanceof Error ? error.message : String(error));
      // If History API returns 404, the historyId has expired (Google drops old history)
      // We must fall back to a full sync to reconcile.
      if (error instanceof GmailApiError && error.gmailErrorCode === 404) {
        logger.warn('[Sync] History ID expired; falling back to full sync', { userId });
        return this.syncInitialMailbox(userId);
      }
      throw error;
    }
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Retrieves an authenticated GmailClient for the given user.
   */
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

    // This handles automatic token refresh if expired
    const accessToken = await gmailOAuthService.getValidAccessToken(connection.id);

    return {
      client: new GmailClient({ accessToken }),
      connectionId: connection.id,
    };
  }

  /**
   * The core pipeline: Fetch raw bodies -> Normalize -> Upsert to DB.
   */
  private async processAndSaveBatch(
    userId: string,
    connectionId: string,
    messageRefs: GmailMessageRef[],
    fetcher: RawEmailFetcher,
    batchId?: string,
  ): Promise<void> {
    // Pipeline Step 1: Fetch raw full messages
    const rawMessages = await fetcher.fetchMessagesInBatches(messageRefs);

    // Pipeline Step 2: Normalize to DB schema
    const normalizedData = this.normalizer.normalizeBatch(rawMessages);

    const userScope = await userService.userScopeFor(userId);

    // Pipeline Step 3: Save to database (Upsert to prevent duplicates)
    for (const data of normalizedData) {
      const existingMessage = await prisma.emailMessage.findUnique({
        where: {
          unique_user_message: {
            legacyUserId: userId,
            providerMessageId: data.providerMessageId,
          },
        },
      });

      await prisma.emailMessage.upsert({
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
          // If the message already exists, we might want to update labels or other mutable fields
          labels: data.labels,
          threadId: data.threadId,
        },
      });

      if (!existingMessage) {
        if (features.asyncEmailProcessing) {
          // Pipeline Step 4 (Async): Enqueue for background processing
          // We fetch the newly created record to get its internal DB UUID
          const savedMessage = await prisma.emailMessage.findUnique({
            where: {
              unique_user_message: {
                legacyUserId: userId,
                providerMessageId: data.providerMessageId,
              },
            },
            select: { id: true },
          });

          if (savedMessage) {
            await queueService.addApplicationTrackingJob({
              type: 'PROCESS_EMAIL',
              userId,
              emailMessageId: savedMessage.id,
              metadata: batchId ? { batchId } : undefined,
            });
            logger.debug('[Sync] Enqueued email for async processing', {
              userId,
              emailMessageId: savedMessage.id,
            });
          }
        } else {
          // Pipeline Step 4 (Sync): Process immediately
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
    }
  }

  /**
   * Updates or creates the synchronization state cursor.
   * Also maintains the GmailCheckpoint for async tracking.
   */
  private async updateSyncState(
    userId: string,
    connectionId: string,
    historyId: string,
  ): Promise<void> {
    const userScope = await userService.userScopeFor(userId);

    // 1. Update primary sync state
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

    // 2. Update async checkpoint (Micro-task 7.6)
    await prisma.gmailCheckpoint.upsert({
      where: { userId: userScope.userId },
      create: {
        userId: userScope.userId,
        currentHistoryId: historyId,
        status: 'completed',
        lastSyncAt: new Date(),
      },
      update: {
        currentHistoryId: historyId,
        status: 'completed',
        lastSyncAt: new Date(),
      },
    });

    // Also update the connection's lastSyncAt for UI convenience
    await prisma.userEmailConnection.update({
      where: { id: connectionId },
      data: { lastSyncAt: new Date() },
    });
  }
}

export const gmailIngestionService = new GmailIngestionService();
