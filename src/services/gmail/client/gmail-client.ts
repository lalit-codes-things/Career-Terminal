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
import { google } from 'googleapis';
import { GmailApiError } from '../../../errors/app-errors';
import { CircuitBreaker } from '../../../lib/circuit-breaker';
import {
  GMAIL_CLIENT_DEFAULT_TIMEOUT_MS,
  GMAIL_CLIENT_INITIAL_RETRY_DELAY_MS,
  GMAIL_CLIENT_MAX_RETRIES,
  GMAIL_HISTORY_MAX_RESULTS,
  GMAIL_LIST_MESSAGES_MAX_RESULTS,
} from '../../../config/gmail';
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
  GmailMessagePart,
  GmailMessagePartHeader,
} from '../models/gmail.types';

/** Maximum number of retries for transient API failures. */
/** HTTP status codes that are retryable. */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 503]);

export class GmailClient {
  private readonly gmail: {
    users: {
      messages: {
        list: (params: Record<string, unknown>) => Promise<{ data: Record<string, unknown> }>;
        get: (params: Record<string, unknown>) => Promise<{ data: Record<string, unknown> }>;
        attachments: {
          get: (params: Record<string, unknown>) => Promise<{ data: Record<string, unknown> }>;
        };
      };
      threads: {
        get: (params: Record<string, unknown>) => Promise<{ data: Record<string, unknown> }>;
      };
      labels: {
        list: (params: Record<string, unknown>) => Promise<{ data: Record<string, unknown> }>;
      };
      getProfile: (params: Record<string, unknown>) => Promise<{ data: Record<string, unknown> }>;
      history: {
        list: (params: Record<string, unknown>) => Promise<{ data: Record<string, unknown> }>;
      };
    };
  };
  private readonly userId = 'me'; // Authenticated user
  private readonly circuitBreaker = new CircuitBreaker('GmailAPI', {
    failureThreshold: 5,
    resetTimeout: 30000,
    requestTimeout: 5000,
  });

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
      timeout: config.timeout ?? GMAIL_CLIENT_DEFAULT_TIMEOUT_MS,
    });
  }

  /**
   * Lists messages in the user's mailbox.
   *
   * @param options - Query, pagination, and filter options
   * @returns Paginated list of message references
   */
  async listMessages(options: ListMessagesOptions = {}): Promise<ListMessagesResult> {
    return this.circuitBreaker.fire(() =>
      this.withRetry(async () => {
        const response = await this.gmail.users.messages.list({
          userId: this.userId,
          q: options.query,
          maxResults: Math.min(options.maxResults ?? GMAIL_LIST_MESSAGES_MAX_RESULTS, 500),
          pageToken: options.pageToken,
          labelIds: options.labelIds,
        });

        const data = response.data;
        const messages: GmailMessageRef[] = (
          Array.isArray(data.messages) ? (data.messages as Array<Record<string, unknown>>) : []
        ).map((msg: Record<string, unknown>) => ({
          id: this.readString(msg.id),
          threadId: this.readString(msg.threadId),
        }));

        return {
          messages,
          nextPageToken: this.readOptionalString(data.nextPageToken),
          resultSizeEstimate: this.readNumber(data.resultSizeEstimate),
        };
      }),
    );
  }

  /**
   * Fetches and parses a single message by ID.
   *
   * @param messageId - The Gmail message ID
   * @returns Fully parsed message with headers, body, and metadata
   */
  async getMessage(messageId: string): Promise<GmailMessage> {
    return this.circuitBreaker.fire(() =>
      this.withRetry(async () => {
        const response = await this.gmail.users.messages.get({
          userId: this.userId,
          id: messageId,
          format: 'full',
        });

        return this.parseMessage(response.data);
      }),
    );
  }

  /**
   * Fetches a thread and all its messages.
   *
   * @param threadId - The Gmail thread ID
   * @returns Thread with all parsed messages
   */
  async getThread(threadId: string): Promise<GmailThread> {
    return this.circuitBreaker.fire(() =>
      this.withRetry(async () => {
        const response = await this.gmail.users.threads.get({
          userId: this.userId,
          id: threadId,
          format: 'full',
        });

        const data = response.data;
        const messages = (
          Array.isArray(data.messages) ? (data.messages as Array<Record<string, unknown>>) : []
        ).map((msg: Record<string, unknown>) => this.parseMessage(msg));

        return {
          id: this.readString(data.id) || threadId,
          historyId: this.readString(data.historyId),
          messages,
        };
      }),
    );
  }

  /**
   * Fetches attachments for a message.
   *
   * @param messageId - The Gmail message ID
   * @returns Array of attachment metadata and data
   */
  async getAttachments(messageId: string): Promise<GmailAttachment[]> {
    return this.circuitBreaker.fire(() =>
      this.withRetry(async () => {
        // First, get the message to find attachment IDs
        const message = await this.gmail.users.messages.get({
          userId: this.userId,
          id: messageId,
          format: 'full',
        });

        const attachments: GmailAttachment[] = [];
        const parts = this.flattenParts(message.data.payload as GmailMessagePart | undefined);

        for (const part of parts) {
          if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
            const attachmentResponse = await this.gmail.users.messages.attachments.get({
              userId: this.userId,
              messageId,
              id: part.body.attachmentId,
            });
            const attachmentData = attachmentResponse.data;

            attachments.push({
              attachmentId: part.body.attachmentId,
              messageId,
              filename: part.filename,
              mimeType: part.mimeType ?? 'application/octet-stream',
              size: part.body.size ?? 0,
              data: this.readOptionalString(attachmentData.data),
            });
          }
        }

        return attachments;
      }),
    );
  }

  /**
   * Lists all labels in the user's mailbox.
   *
   * @returns Array of label metadata
   */
  async getLabels(): Promise<GmailLabel[]> {
    return this.circuitBreaker.fire(() =>
      this.withRetry(async () => {
        const response = await this.gmail.users.labels.list({
          userId: this.userId,
        });

        const data = response.data;
        return (
          Array.isArray(data.labels) ? (data.labels as Array<Record<string, unknown>>) : []
        ).map((label: Record<string, unknown>) => ({
          id: this.readString(label.id),
          name: this.readString(label.name),
          type: this.readString(label.type) === 'system' ? ('system' as const) : ('user' as const),
          messagesTotal: this.readOptionalNumber(label.messagesTotal),
          messagesUnread: this.readOptionalNumber(label.messagesUnread),
        }));
      }),
    );
  }

  /**
   * Fetches the user's Gmail profile, which includes their current historyId.
   */
  async getProfile(): Promise<GmailProfile> {
    return this.circuitBreaker.fire(() =>
      this.withRetry(async () => {
        const response = await this.gmail.users.getProfile({
          userId: this.userId,
        });

        const data = response.data;
        return {
          emailAddress: this.readString(data.emailAddress),
          messagesTotal: this.readNumber(data.messagesTotal),
          threadsTotal: this.readNumber(data.threadsTotal),
          historyId: this.readString(data.historyId),
        };
      }),
    );
  }

  /**
   * Fetches historical changes to the mailbox since the given historyId.
   */
  async getHistory(options: GetHistoryOptions): Promise<GmailHistoryResult> {
    return this.circuitBreaker.fire(() =>
      this.withRetry(async () => {
        const response = await this.gmail.users.history.list({
          userId: this.userId,
          startHistoryId: options.startHistoryId,
          maxResults: options.maxResults ?? GMAIL_HISTORY_MAX_RESULTS,
          pageToken: options.pageToken,
        });

        const data = response.data;
        const messagesAdded: { message: GmailMessageRef }[] = [];
        const historyEntries = Array.isArray(data.history)
          ? (data.history as Array<Record<string, unknown>>)
          : [];

        for (const historyRecord of historyEntries) {
          const addedEntries = Array.isArray(historyRecord.messagesAdded)
            ? (historyRecord.messagesAdded as Array<Record<string, unknown>>)
            : [];
          for (const added of addedEntries) {
            const message = added.message as Record<string, unknown> | undefined;
            if (message && this.readString(message.id) && this.readString(message.threadId)) {
              messagesAdded.push({
                message: {
                  id: this.readString(message.id),
                  threadId: this.readString(message.threadId),
                },
              });
            }
          }
        }

        return {
          historyId: this.readString(data.historyId) || options.startHistoryId,
          nextPageToken: this.readOptionalString(data.nextPageToken),
          messagesAdded,
        };
      }),
    );
  }

  // ============================================================
  // Private Methods
  // ============================================================

  /**
   * Parses a raw Gmail API message into our domain type.
   */
  private parseMessage(raw: Record<string, unknown>): GmailMessage {
    const payload = raw.payload as GmailMessagePart | undefined;
    const headers = Array.isArray(payload?.headers) ? payload?.headers : undefined;

    return {
      id: this.readString(raw.id),
      threadId: this.readString(raw.threadId),
      labelIds: Array.isArray(raw.labelIds)
        ? (raw.labelIds as unknown[]).map((label) => String(label))
        : [],
      sender: getHeader(headers, 'From'),
      recipients: parseRecipients(headers),
      subject: getHeader(headers, 'Subject'),
      bodyText: extractBodyText(payload),
      bodyHtml: extractBodyHtml(payload),
      hasAttachments: hasAttachments(payload),
      receivedAt: parseEmailDate(getHeader(headers, 'Date')),
      headers: this.headersToRecord(headers),
    };
  }

  /**
   * Converts Gmail's headers array to a key-value record.
   */
  private headersToRecord(headers: GmailMessagePartHeader[] | undefined): Record<string, string> {
    const record: Record<string, string> = {};
    if (!headers) return record;
    for (const header of headers) {
      if (typeof header.name === 'string' && typeof header.value === 'string') {
        record[header.name] = header.value;
      }
    }
    return record;
  }

  /**
   * Flattens the nested message parts tree into a flat array.
   * Used for finding attachments across all MIME parts.
   */
  private flattenParts(part: GmailMessagePart | null | undefined): GmailMessagePart[] {
    if (!part) return [];
    const result: GmailMessagePart[] = [part];
    if (part.parts) {
      for (const child of part.parts) {
        result.push(...this.flattenParts(child));
      }
    }
    return result;
  }

  private readString(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private readOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private readNumber(value: unknown): number {
    return typeof value === 'number' ? value : 0;
  }

  private readOptionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined;
  }

  /**
   * Wraps an API call with exponential backoff retry logic.
   * Only retries on transient errors (429, 500, 503).
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= GMAIL_CLIENT_MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if this is a retryable error
        const statusCode = this.extractStatusCode(error);
        if (
          statusCode &&
          RETRYABLE_STATUS_CODES.has(statusCode) &&
          attempt < GMAIL_CLIENT_MAX_RETRIES
        ) {
          const delay = GMAIL_CLIENT_INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
          await this.sleep(delay);
          continue;
        }

        // Non-retryable error — throw immediately
        throw new GmailApiError(`Gmail API error: ${lastError.message}`, statusCode);
      }
    }

    // Should never reach here, but TypeScript needs it
    throw new GmailApiError(
      `Gmail API error after ${GMAIL_CLIENT_MAX_RETRIES} retries: ${lastError?.message ?? 'Unknown'}`,
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
