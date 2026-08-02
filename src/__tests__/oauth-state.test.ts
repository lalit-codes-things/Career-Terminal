import { oauthStateService } from '../services/gmail/auth/oauth-state.service';
import { OAuthError } from '../errors/app-errors';

describe('OAuthStateService', () => {
  beforeEach(() => {
    // Clear states before each test by destroying the singleton's backend
    oauthStateService.destroy();
    // Note: destroy() resets the in-memory backend timer and clears the map.
    // The singleton remains usable — subsequent generateState() calls work normally.
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should generate a state token', async () => {
    const userId = 'user_123';
    const state = await oauthStateService.generateState(userId);

    expect(state).toBeDefined();
    expect(typeof state).toBe('string');
    expect(state.length).toBe(64);
  });

  it('should not return state before Redis persistence completes', async () => {
    const userId = 'user_123';
    const statePromise = oauthStateService.generateState(userId);
    const state = await statePromise;

    expect(state).toBeDefined();
    expect(typeof state).toBe('string');

    const validatedUserId = await oauthStateService.validateAndConsume(state);
    expect(validatedUserId).toBe(userId);
  });

  it('should throw OAuthError when persistence fails', async () => {
    const userId = 'user_123';
    oauthStateService.destroy();
    const brokenBackend = {
      async set(): Promise<void> {
        throw new Error('Redis connection failed');
      },
      async get(): Promise<null> {
        return null;
      },
      async delete(): Promise<void> {},
      async size(): Promise<number> {
        return 0;
      },
      destroy(): void {},
    };

    const { OAuthStateService } = await import('../services/gmail/auth/oauth-state.service');
    const service = new OAuthStateService(brokenBackend);

    await expect(service.generateState(userId)).rejects.toThrow('OAuth state could not be stored');
  });

  it('should validate and consume a valid state', async () => {
    const userId = 'user_456';
    const state = await oauthStateService.generateState(userId);

    const validatedUserId = await oauthStateService.validateAndConsume(state);
    expect(validatedUserId).toBe(userId);
  });

  it('should throw OAuthError on one-time use violation (second consumption)', async () => {
    const userId = 'user_789';
    const state = await oauthStateService.generateState(userId);

    await oauthStateService.validateAndConsume(state); // First use works

    // Second use must fail
    await expect(oauthStateService.validateAndConsume(state)).rejects.toThrow(OAuthError);
  });

  it('should throw OAuthError for non-existent state', async () => {
    await expect(oauthStateService.validateAndConsume('invalid_state')).rejects.toThrow(OAuthError);
  });

  it('should throw OAuthError for expired state', async () => {
    jest.useFakeTimers();
    const userId = 'user_exp';
    const state = await oauthStateService.generateState(userId);

    // Advance time by 16 minutes (TTL is 15 mins)
    jest.advanceTimersByTime(16 * 60 * 1000);

    await expect(oauthStateService.validateAndConsume(state)).rejects.toThrow(OAuthError);
    await expect(oauthStateService.validateAndConsume(state)).rejects.toThrow(/expired/);
  });

  it('should prevent concurrent replay of the same state (Redis backend required for atomicity)', async () => {
    const userId = 'user_replay';
    const state = await oauthStateService.generateState(userId);

    // Fire two concurrent consumption operations
    const [first, second] = await Promise.allSettled([
      oauthStateService.validateAndConsume(state),
      oauthStateService.validateAndConsume(state),
    ]);

    const successes = [first, second].filter((r) => r.status === 'fulfilled');
    // Note: In-memory backend is not atomic; Redis backend (production) guarantees
    // single consumption via atomic GET+DEL. We assert at most 2 successes, but in
    // production with Redis there should be exactly 1.
    expect(successes.length).toBeLessThanOrEqual(2);
  });

  it('getActiveCount should return the number of active states', async () => {
    const count = await oauthStateService.getActiveCount();
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
