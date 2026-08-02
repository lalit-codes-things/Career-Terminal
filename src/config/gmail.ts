import { config } from './index';

export const GMAIL_CLIENT_DEFAULT_TIMEOUT_MS = config.timeouts.http;
export const GMAIL_LIST_MESSAGES_MAX_RESULTS = 100;
export const GMAIL_HISTORY_MAX_RESULTS = 100;
export const GMAIL_CLIENT_MAX_RETRIES = 3;
export const GMAIL_CLIENT_INITIAL_RETRY_DELAY_MS = 1_000;
export const GMAIL_INITIAL_SYNC_MESSAGE_CAP = 1_000;
