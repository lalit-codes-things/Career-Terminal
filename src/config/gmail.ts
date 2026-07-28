/**
 * Centralized Gmail client configuration.
 *
 * Keep operational limits in one place so sync behavior can be tuned without
 * scattering magic numbers across ingestion and client code.
 */

export const GMAIL_CLIENT_DEFAULT_TIMEOUT_MS = Number(process.env.GMAIL_CLIENT_TIMEOUT_MS ?? 30_000);
export const GMAIL_LIST_MESSAGES_MAX_RESULTS = Number(
  process.env.GMAIL_LIST_MESSAGES_MAX_RESULTS ?? 100,
);
export const GMAIL_HISTORY_MAX_RESULTS = Number(process.env.GMAIL_HISTORY_MAX_RESULTS ?? 100);
export const GMAIL_CLIENT_MAX_RETRIES = Number(process.env.GMAIL_CLIENT_MAX_RETRIES ?? 3);
export const GMAIL_CLIENT_INITIAL_RETRY_DELAY_MS = Number(
  process.env.GMAIL_CLIENT_INITIAL_RETRY_DELAY_MS ?? 1_000,
);
export const GMAIL_INITIAL_SYNC_MESSAGE_CAP = Number(
  process.env.GMAIL_INITIAL_SYNC_MESSAGE_CAP ?? 1_000,
);
