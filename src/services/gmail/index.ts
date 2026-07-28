/**
 * Gmail Service — Top-level barrel export.
 *
 * This is the single entry point for the entire Gmail ingestion module.
 * All consumers should import from here, not from internal submodules.
 *
 * Usage:
 *   import { gmailOAuthService, GmailClient } from './services/gmail';
 */

// Auth
export { GmailOAuthService, gmailOAuthService } from './auth/gmail-oauth.service';
export { OAuthStateService, oauthStateService } from './auth/oauth-state.service';

// Client
export { GmailClient } from './client/gmail-client';

// Types
export type {
  GoogleTokens,
  GoogleUserProfile,
  OAuthCallbackResult,
  OAuthStateEntry,
  ListMessagesOptions,
  ListMessagesResult,
  GmailMessageRef,
  GmailMessage,
  GmailThread,
  GmailAttachment,
  GmailLabel,
  GmailClientConfig,
  EmailRecipients,
  TokenRefreshResult,
} from './models/gmail.types';

// Ingestion
export { GmailIngestionService } from './ingestion/gmail-ingestion.service';

// Processors
export { GmailEmailProcessor } from './processors/email-processor';
