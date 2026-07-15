/**
 * Gmail API Client Wrapper.
 *
 * Provides a clean abstraction over the Gmail API via the `googleapis` library.
 * All Gmail API interactions MUST go through this client — never call the
 * Gmail API directly from other parts of the codebase.
 *
 * Features:
 * - Type-safe return values (mapped to our domain types)
 * - Automatic error wrapping (GmailApiError)
 * - Retry logic for transient failures (429, 500, 503)
 * - Centralized logging
 *
 * Usage:
 *   const client = new GmailClient({ accessToken: 'ya29...' });
 *   const messages = await client.listMessages({ maxResults: 10 });
 */
import { google, type gmail_v1 } from 'googleapis';
import { GmailApiError } from '../../../errors/app-errors';
import {
  getHeader,
  parseRecipients,
  extractBodyText,
  extractBodyHtml,
  hasAttachments,
  parseEmailDate,
} from '../utils/gmail.utils';
import type {
  GmailClientConfig,
  ListMessagesOptions,
  ListMessagesResult,
  GmailMessage,
  GmailThread,
  GmailAttachment,
  GmailLabel,
  GmailMessageRef,
  GmailProfile,
  GetHistoryOptions,
  GmailHistoryResult,
} from '../models/gmail.types';

/** Maximum number of retries for transient API failures. */
const MAX_RETRIES = 3;

/** Initial retry delay in milliseconds (doubles on each retry). */
const INITIAL_RETRY_DELAY_MS = 1000;

/** HTTP status codes that are retryable. */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 503]);

export class GmailClient {
  private readonly gmail: gmail_v1.Gmail;
  private readonly userId = 'me'; // Authenticated user

  /**
   * Creates a new Gmail client instance.
   *
   * @param config - Must include a valid access token
   */
  constructor(config: GmailClientConfig) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: config.accessToken });

    this.gmail = google.gmail({
      version: 'v1',
      auth,
      timeout: config.timeout ?? 30_000,
    });
  }

  /**
   * Lists messages in the user's mailbox.
   *
   * @param options - Query, pagination, and filter options
   * @returns Paginated list of message references
   */
  async listMessages(options: ListMessagesOptions = {}): Promise<ListMessagesResult> {
    return this.withRetry(async () => {
      const response = await this.gmail.users.messages.list({
        userId: this.userId,
        q: options.query,
        maxResults: Math.min(options.maxResults ?? 100, 500),
        pageToken: options.pageToken,
        labelIds: options.labelIds,
      });

      const messages: GmailMessageRef[] = (response.data.messages ?? []).map((msg) => ({
        id: msg.id ?? '',
        threadId: msg.threadId ?? '',
      }));

      return {
        messages,
        nextPageToken: response.data.nextPageToken ?? undefined,
        resultSizeEstimate: response.data.resultSizeEstimate ?? 0,
      };
    });
  }

  /**
   * Fetches and parses a single message by ID.
   *
   * @param messageId - The Gmail message ID
   * @returns Fully parsed message with headers, body, and metadata
   */
  async getMessage(messageId: string): Promise<GmailMessage> {
    return this.withRetry(async () => {
      const response = await this.gmail.users.messages.get({
        userId: this.userId,
        id: messageId,
        format: 'full',
      });

      return this.parseMessage(response.data);
    });
  }

  /**
   * Fetches a thread and all its messages.
   *
   * @param threadId - The Gmail thread ID
   * @returns Thread with all parsed messages
   */
  async getThread(threadId: string): Promise<GmailThread> {
    return this.withRetry(async () => {
      const response = await this.gmail.users.threads.get({
        userId: this.userId,
        id: threadId,
        format: 'full',
      });

      const messages = (response.data.messages ?? []).map((msg) =>
        this.parseMessage(msg),
      );

      return {
        id: response.data.id ?? threadId,
        historyId: response.data.historyId ?? '',
        messages,
      };
    });
  }

  /**
   * Fetches attachments for a message.
   *
   * @param messageId - The Gmail message ID
   * @returns Array of attachment metadata and data
   */
  async getAttachments(messageId: string): Promise<GmailAttachment[]> {
    return this.withRetry(async () => {
      // First, get the message to find attachment IDs
      const message = await this.gmail.users.messages.get({
        userId: this.userId,
        id: messageId,
        format: 'full',
      });

      const attachments: GmailAttachment[] = [];
      const parts = this.flattenParts(message.data.payload);

      for (const part of parts) {
        if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
          const attachmentResponse = await this.gmail.users.messages.attachments.get({
            userId: this.userId,
            messageId,
            id: part.body.attachmentId,
          });

          attachments.push({
            attachmentId: part.body.attachmentId,
            messageId,
            filename: part.filename,
            mimeType: part.mimeType ?? 'application/octet-stream',
            size: part.body.size ?? 0,
            data: attachmentResponse.data.data ?? undefined,
          });
        }
      }

      return attachments;
    });
  }

  /**
   * Lists all labels in the user's mailbox.
   *
   * @returns Array of label metadata
   */
  async getLabels(): Promise<GmailLabel[]> {
    return this.withRetry(async () => {
      const response = await this.gmail.users.labels.list({
        userId: this.userId,
      });

      return (response.data.labels ?? []).map((label) => ({
        id: label.id ?? '',
        name: label.name ?? '',
        type: label.type === 'system' ? ('system' as const) : ('user' as const),
        messagesTotal: label.messagesTotal ?? undefined,
        messagesUnread: label.messagesUnread ?? undefined,
      }));
    });
  }

  /**
   * Fetches the user's Gmail profile, which includes their current historyId.
   */
  async getProfile(): Promise<GmailProfile> {
    return this.withRetry(async () => {
      const response = await this.gmail.users.getProfile({
        userId: this.userId,
      });

      return {
        emailAddress: response.data.emailAddress ?? '',
        messagesTotal: response.data.messagesTotal ?? 0,
        threadsTotal: response.data.threadsTotal ?? 0,
        historyId: response.data.historyId ?? '',
      };
    });
  }

  /**
   * Fetches historical changes to the mailbox since the given historyId.
   */
  async getHistory(options: GetHistoryOptions): Promise<GmailHistoryResult> {
    return this.withRetry(async () => {
      const response = await this.gmail.users.history.list({
        userId: this.userId,
        startHistoryId: options.startHistoryId,
        maxResults: options.maxResults ?? 100,
        pageToken: options.pageToken,
      });

      const messagesAdded: { message: GmailMessageRef }[] = [];
      
      if (response.data.history) {
        for (const historyRecord of response.data.history) {
          if (historyRecord.messagesAdded) {
            for (const added of historyRecord.messagesAdded) {
              if (added.message?.id && added.message?.threadId) {
                messagesAdded.push({
                  message: {
                    id: added.message.id,
                    threadId: added.message.threadId,
                  }
                });
              }
            }
          }
        }
      }

      return {
        historyId: response.data.historyId ?? options.startHistoryId,
        nextPageToken: response.data.nextPageToken ?? undefined,
        messagesAdded,
      };
    });
  }

  // ============================================================
  // Private Methods
  // ============================================================

  /**
   * Parses a raw Gmail API message into our domain type.
   */
  private parseMessage(raw: gmail_v1.Schema$Message): GmailMessage {
    const headers = raw.payload?.headers;

    return {
      id: raw.id ?? '',
      threadId: raw.threadId ?? '',
      labelIds: raw.labelIds ?? [],
      sender: getHeader(headers, 'From'),
      recipients: parseRecipients(headers),
      subject: getHeader(headers, 'Subject'),
      bodyText: extractBodyText(raw.payload ?? undefined),
      bodyHtml: extractBodyHtml(raw.payload ?? undefined),
      hasAttachments: hasAttachments(raw.payload ?? undefined),
      receivedAt: parseEmailDate(getHeader(headers, 'Date')),
      headers: this.headersToRecord(headers),
    };
  }

  /**
   * Converts Gmail's headers array to a key-value record.
   */
  private headersToRecord(
    headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  ): Record<string, string> {
    const record: Record<string, string> = {};
    if (!headers) return record;
    for (const header of headers) {
      if (header.name && header.value) {
        record[header.name] = header.value;
      }
    }
    return record;
  }

  /**
   * Flattens the nested message parts tree into a flat array.
   * Used for finding attachments across all MIME parts.
   */
  private flattenParts(
    part: gmail_v1.Schema$MessagePart | null | undefined,
  ): gmail_v1.Schema$MessagePart[] {
    if (!part) return [];
    const result: gmail_v1.Schema$MessagePart[] = [part];
    if (part.parts) {
      for (const child of part.parts) {
        result.push(...this.flattenParts(child));
      }
    }
    return result;
  }

  /**
   * Wraps an API call with exponential backoff retry logic.
   * Only retries on transient errors (429, 500, 503).
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if this is a retryable error
        const statusCode = this.extractStatusCode(error);
        if (statusCode && RETRYABLE_STATUS_CODES.has(statusCode) && attempt < MAX_RETRIES) {
          const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
          await this.sleep(delay);
          continue;
        }

        // Non-retryable error — throw immediately
        throw new GmailApiError(
          `Gmail API error: ${lastError.message}`,
          statusCode,
        );
      }
    }

    // Should never reach here, but TypeScript needs it
    throw new GmailApiError(
      `Gmail API error after ${MAX_RETRIES} retries: ${lastError?.message ?? 'Unknown'}`,
    );
  }

  /**
   * Extracts HTTP status code from a googleapis error.
   */
  private extractStatusCode(error: unknown): number | undefined {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof (error as Record<string, unknown>).code === 'number'
    ) {
      return (error as Record<string, unknown>).code as number;
    }
    return undefined;
  }

  /**
   * Promise-based sleep utility for retry delays.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
