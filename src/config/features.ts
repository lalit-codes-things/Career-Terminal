/**
 * Feature Flags
 * 
 * Allows toggling functionality without code changes via environment variables.
 */
export const features = {
  /**
   * When true, email classification and application tracking processing
   * happens asynchronously via BullMQ instead of on the request path.
   */
  asyncEmailProcessing: process.env.ASYNC_EMAIL_PROCESSING === 'true',
};
