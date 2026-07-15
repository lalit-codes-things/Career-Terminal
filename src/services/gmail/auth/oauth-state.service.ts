/**
 * OAuth State Service — CSRF protection for OAuth2 flows.
 *
 * Generates, validates, and expires temporary state tokens that are passed
 * through the OAuth authorization redirect. This prevents CSRF attacks by
 * ensuring the callback was initiated by a legitimate authorization request
 * from our application.
 *
 * Design decisions:
 * - In-memory Map for simplicity (single-instance deployment).
 * - 15-minute TTL — states expire if the user doesn't complete OAuth quickly.
 * - One-time use — state is consumed (deleted) upon validation.
 * - Periodic cleanup via setInterval to prevent memory leaks.
 * - Interface-ready for Redis/DB swap when scaling horizontally.
 */
import { v4 as uuidv4 } from 'uuid';
import { OAuthError } from '../../../errors/app-errors';
import type { OAuthStateEntry } from '../models/gmail.types';

/** How long an OAuth state is valid (15 minutes). */
const STATE_TTL_MS = 15 * 60 * 1000;

/** How often to run the cleanup sweep (5 minutes). */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export class OAuthStateService {
  private readonly states = new Map<string, OAuthStateEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startCleanup();
  }

  /**
   * Generates a unique, time-limited OAuth state parameter.
   *
   * @param userId - The user ID to associate with this state
   * @returns A UUID state string to include in the OAuth authorization URL
   */
  generateState(userId: string): string {
    const state = uuidv4();
    this.states.set(state, {
      userId,
      createdAt: Date.now(),
    });
    return state;
  }

  /**
   * Validates and consumes an OAuth state parameter.
   * This is a one-time operation — the state is deleted after validation.
   *
   * @param state - The state parameter from the OAuth callback
   * @returns The userId associated with the state
   * @throws {OAuthError} If the state is missing, invalid, or expired
   */
  validateAndConsume(state: string): string {
    const entry = this.states.get(state);

    if (!entry) {
      throw new OAuthError(
        'Invalid or expired OAuth state. Please initiate the connection again.',
        'INVALID_OAUTH_STATE',
      );
    }

    // Check expiry
    const age = Date.now() - entry.createdAt;
    if (age > STATE_TTL_MS) {
      this.states.delete(state);
      throw new OAuthError(
        'OAuth state has expired. Please initiate the connection again.',
        'EXPIRED_OAUTH_STATE',
      );
    }

    // Consume (one-time use)
    this.states.delete(state);
    return entry.userId;
  }

  /**
   * Returns the number of active (non-expired) states.
   * Useful for monitoring and testing.
   */
  getActiveCount(): number {
    return this.states.size;
  }

  /**
   * Starts the periodic cleanup of expired states.
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.purgeExpired();
    }, CLEANUP_INTERVAL_MS);

    // Don't let the timer prevent process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Removes all expired state entries.
   */
  private purgeExpired(): void {
    const now = Date.now();
    for (const [state, entry] of this.states.entries()) {
      if (now - entry.createdAt > STATE_TTL_MS) {
        this.states.delete(state);
      }
    }
  }

  /**
   * Stops the cleanup timer. Call during graceful shutdown.
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.states.clear();
  }
}

/**
 * Singleton instance of the OAuth state service.
 * Used across the application for state management.
 */
export const oauthStateService = new OAuthStateService();
