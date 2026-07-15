/**
 * TypeScript interfaces and types for the Gmail ingestion module.
 *
 * These types provide a provider-agnostic abstraction layer.
 * When adding Outlook support, create similar types and map them
 * to these shared interfaces where possible.
 */

// ============================================================
// OAuth Types
// ============================================================

/** Tokens returned by Google's OAuth2 token exchange. */
export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiryDate: number; // Unix timestamp in milliseconds
  scope: string;
}

/** Minimal user profile from Google's userinfo endpoint. */
export interface GoogleUserProfile {
  email: string;
  name?: string;
  picture?: string;
}

/** Internal representation of an OAuth state entry. */
export interface OAuthStateEntry {
  userId: string;
  createdAt: number; // Unix timestamp in milliseconds
}

/** Result of a successful OAuth callback. */
export interface OAuthCallbackResult {
  connectionId: string;
  emailAddress: string;
  provider: 'GMAIL';
}

// ============================================================
// Gmail API Types
// ============================================================

/** Options for listing messages. */
export interface ListMessagesOptions {
  /** Gmail search query (e.g., "is:unread", "from:user@example.com"). */
  query?: string;
  /** Maximum number of messages to return (default: 100, max: 500). */
  maxResults?: number;
  /** Page token for pagination. */
  pageToken?: string;
  /** Label IDs to filter by. */
  labelIds?: string[];
}

/** Paginated list of message references. */
export interface ListMessagesResult {
  messages: GmailMessageRef[];
  nextPageToken?: string;
  resultSizeEstimate: number;
}

/** Lightweight message reference (from list endpoint). */
export interface GmailMessageRef {
  id: string;
  threadId: string;
}

/** Parsed email recipients structure. */
export interface EmailRecipients {
  to: string[];
  cc: string[];
  bcc: string[];
}

/** Fully parsed Gmail message. */
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  sender: string;
  recipients: EmailRecipients;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  hasAttachments: boolean;
  receivedAt: Date;
  headers: Record<string, string>;
}

/** Gmail thread with its messages. */
export interface GmailThread {
  id: string;
  historyId: string;
  messages: GmailMessage[];
}

/** Gmail attachment metadata and data. */
export interface GmailAttachment {
  attachmentId: string;
  messageId: string;
  filename: string;
  mimeType: string;
  size: number;
  data?: string; // Base64-encoded attachment data
}

/** Gmail label. */
export interface GmailLabel {
  id: string;
  name: string;
  type: 'system' | 'user';
  messagesTotal?: number;
  messagesUnread?: number;
}

/** Gmail Profile (used for fetching global historyId). */
export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

/** Options for fetching history. */
export interface GetHistoryOptions {
  startHistoryId: string;
  maxResults?: number;
  pageToken?: string;
}

/** Result of a history list operation. */
export interface GmailHistoryResult {
  historyId: string;
  nextPageToken?: string;
  messagesAdded: { message: GmailMessageRef }[];
  // Other fields like messagesDeleted, labelsAdded etc can be added later if needed
}

// ============================================================
// Service Configuration Types
// ============================================================

/** Configuration for the Gmail client. */
export interface GmailClientConfig {
  accessToken: string;
  /** Optional timeout in milliseconds (default: 30000). */
  timeout?: number;
}

/** Result of a token refresh operation. */
export interface TokenRefreshResult {
  accessToken: string;
  expiryDate: number;
}
