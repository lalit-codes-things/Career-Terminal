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

  it('should generate a state token', () => {
    const userId = 'user_123';
    const state = oauthStateService.generateState(userId);

    expect(state).toBeDefined();
    expect(typeof state).toBe('string');
    expect(state.length).toBeGreaterThan(0);
  });

  it('should validate and consume a valid state', async () => {
    const userId = 'user_456';
    const state = oauthStateService.generateState(userId);

    const validatedUserId = await oauthStateService.validateAndConsume(state);
    expect(validatedUserId).toBe(userId);
  });

  it('should throw OAuthError on one-time use violation (second consumption)', async () => {
    const userId = 'user_789';
    const state = oauthStateService.generateState(userId);

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
    const state = oauthStateService.generateState(userId);

    // Advance time by 16 minutes (TTL is 15 mins)
    jest.advanceTimersByTime(16 * 60 * 1000);

    await expect(oauthStateService.validateAndConsume(state)).rejects.toThrow(OAuthError);
    await expect(oauthStateService.validateAndConsume(state)).rejects.toThrow(/expired/);
  });

  it('getActiveCount should return the number of active states', async () => {
    const count = await oauthStateService.getActiveCount();
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
