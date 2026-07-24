/**
 * Raw Email Fetcher
 *
 * Responsible for efficiently fetching message bodies from the Gmail API.
 * Uses batching to prevent rate limits and handles extracting detailed
 * message data from lightweight message references.
 */
import { GmailClient } from '../client/gmail-client';
import type { GmailMessage, GmailMessageRef } from '../models/gmail.types';
import { logger } from '../../../lib/logger';

export class RawEmailFetcher {
  private client: GmailClient;

  constructor(client: GmailClient) {
    this.client = client;
  }

  /**
   * Fetches full message details for a list of message references.
   * Processes them in small batches to avoid hitting API rate limits.
   *
   * @param messageRefs - Array of message references (id, threadId)
   * @param batchSize - Number of messages to fetch concurrently (default: 10)
   * @returns Array of fully parsed GmailMessages
   */
  async fetchMessagesInBatches(
    messageRefs: GmailMessageRef[],
    batchSize = 10,
  ): Promise<GmailMessage[]> {
    const results: GmailMessage[] = [];

    // Process in chunks
    for (let i = 0; i < messageRefs.length; i += batchSize) {
      const batch = messageRefs.slice(i, i + batchSize);

      // Fetch batch concurrently
      const promises = batch.map((ref) =>
        this.client.getMessage(ref.id).catch((err) => {
          // If a single message fails, log it but don't crash the whole batch
          logger.warn('[Fetcher] Failed to fetch message', {
            messageId: ref.id,
            error: err instanceof Error ? err.message : String(err),
          });
          return null;
        }),
      );

      const batchResults = await Promise.all(promises);

      // Filter out failures
      for (const msg of batchResults) {
        if (msg) results.push(msg);
      }
    }

    return results;
  }
}
