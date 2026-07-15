/**
 * Email Processor — Placeholder.
 *
 * This module will handle post-ingestion processing of emails:
 * - Content extraction and normalization
 * - Attachment processing
 * - Classification and tagging
 * - Preparing data for AI analysis
 *
 * Implementation will be added when AI processing is built.
 */

/**
 * Future processor interface.
 */
export interface EmailProcessor {
  /** Processes a single email message for AI consumption. */
  processMessage(messageId: string): Promise<void>;

  /** Batch processes multiple messages. */
  processBatch(messageIds: string[]): Promise<void>;
}

// Placeholder — will be implemented when AI processing is built
export class GmailEmailProcessor implements EmailProcessor {
  async processMessage(_messageId: string): Promise<void> {
    throw new Error('GmailEmailProcessor.processMessage() not yet implemented');
  }

  async processBatch(_messageIds: string[]): Promise<void> {
    throw new Error('GmailEmailProcessor.processBatch() not yet implemented');
  }
}
