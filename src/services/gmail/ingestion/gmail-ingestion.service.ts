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
import { GmailClient } from '../client/gmail-client';
import { gmailOAuthService } from '../auth/gmail-oauth.service';
import { RawEmailFetcher } from './fetcher';
import { EmailNormalizer } from './normalizer';
import { GmailApiError, NotFoundError } from '../../../errors/app-errors';
import type { GmailMessageRef } from '../models/gmail.types';
import { applicationTrackingService } from '../../application-tracking/application-tracking.service';
import { jobEmailClassifier, JobEmailCategory, type ClassifiableEmail } from '../../job-intelligence';

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
    console.info(`[Sync] Starting initial sync for user ${userId}`);
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
      await this.processAndSaveBatch(
        userId,
        connectionId,
        listResult.messages,
        fetcher
      );

      totalSynced += listResult.messages.length;
      pageToken = listResult.nextPageToken;
      
      if (!pageToken) break;
    }

    // 4. Save the sync state so future syncs are incremental
    await this.updateSyncState(userId, connectionId, startingHistoryId);
    console.info(`[Sync] Initial sync completed for user ${userId}. Saved ${totalSynced} messages.`);
  }

  /**
   * Performs an incremental sync using the Gmail History API.
   * Only fetches messages that have changed since the last sync.
   */
  async syncNewEmails(userId: string): Promise<void> {
    console.info(`[Sync] Starting incremental sync for user ${userId}`);
    
    // 1. Retrieve current sync state
    const syncState = await prisma.gmailSyncState.findUnique({
      where: { userId },
    });

    if (!syncState) {
      console.warn(`[Sync] No sync state found for user ${userId}. Triggering initial sync.`);
      return this.syncInitialMailbox(userId);
    }

    const { client, connectionId } = await this.setupClient(userId);
    const fetcher = new RawEmailFetcher(client);

    let currentHistoryId = syncState.historyId;
    let pageToken: string | undefined = undefined;
    let totalNewMessages = 0;

    try {
      // 2. Loop through history API pages
      do {
        const historyResult = await client.getHistory({
          startHistoryId: currentHistoryId,
          pageToken,
        });

        const messagesToFetch = historyResult.messagesAdded.map((m) => m.message);

        if (messagesToFetch.length > 0) {
          // 3. Process new messages
          await this.processAndSaveBatch(
            userId,
            connectionId,
            messagesToFetch,
            fetcher
          );
          totalNewMessages += messagesToFetch.length;
        }

        // Move cursor forward
        currentHistoryId = historyResult.historyId;
        pageToken = historyResult.nextPageToken;
      } while (pageToken);

      // 4. Update sync state with the latest historyId
      await this.updateSyncState(userId, connectionId, currentHistoryId);
      console.info(`[Sync] Incremental sync completed for user ${userId}. Found ${totalNewMessages} new messages.`);

    } catch (error) {
      // If History API returns 404, the historyId has expired (Google drops old history)
      // We must fall back to a full sync to reconcile.
      if (error instanceof GmailApiError && error.gmailErrorCode === 404) {
        console.warn(`[Sync] History ID expired for user ${userId}. Falling back to full sync.`);
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
  private async setupClient(userId: string): Promise<{ client: GmailClient; connectionId: string }> {
    const connection = await prisma.userEmailConnection.findFirst({
      where: { userId, provider: 'GMAIL', status: 'ACTIVE' },
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
    fetcher: RawEmailFetcher
  ): Promise<void> {
    // Pipeline Step 1: Fetch raw full messages
    const rawMessages = await fetcher.fetchMessagesInBatches(messageRefs);
    
    // Pipeline Step 2: Normalize to DB schema
    const normalizedData = this.normalizer.normalizeBatch(rawMessages);

    // Pipeline Step 3: Save to database (Upsert to prevent duplicates)
    for (const data of normalizedData) {
      const existingMessage = await prisma.emailMessage.findUnique({
        where: {
          unique_user_message: {
            userId,
            providerMessageId: data.providerMessageId,
          },
        },
      });

      await prisma.emailMessage.upsert({
        where: {
          unique_user_message: {
            userId,
            providerMessageId: data.providerMessageId,
          },
        },
        create: {
          ...data,
          userId,
          connectionId,
        },
        update: {
          // If the message already exists, we might want to update labels or other mutable fields
          labels: data.labels,
          threadId: data.threadId,
        },
      });

      if (!existingMessage) {
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

  /**
   * Updates or creates the synchronization state cursor.
   */
  private async updateSyncState(userId: string, connectionId: string, historyId: string): Promise<void> {
    await prisma.gmailSyncState.upsert({
      where: { userId },
      create: {
        userId,
        connectionId,
        historyId,
        lastSyncedAt: new Date(),
      },
      update: {
        historyId,
        lastSyncedAt: new Date(),
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
