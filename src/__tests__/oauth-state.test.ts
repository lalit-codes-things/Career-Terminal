import { oauthStateService } from '../services/gmail/auth/oauth-state.service';
import { OAuthError } from '../errors/app-errors';

describe('OAuthStateService', () => {
  beforeEach(() => {
    // Clear states before each test by generating and consuming, or destroying
    oauthStateService.destroy();
    // In actual implementation, we might want to expose a clear() method for testing, 
    // but destroy() works for now. We need to re-instantiate it for tests to work properly if we destroyed it.
    // However, since it's a singleton, we shouldn't destroy the timer permanently in tests without recreating it.
    // Let's mock Date.now instead to test expiration.
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

  it('should validate and consume a valid state', () => {
    const userId = 'user_456';
    const state = oauthStateService.generateState(userId);
    
    const validatedUserId = oauthStateService.validateAndConsume(state);
    expect(validatedUserId).toBe(userId);
  });

  it('should throw OAuthError on one-time use violation (second consumption)', () => {
    const userId = 'user_789';
    const state = oauthStateService.generateState(userId);
    
    oauthStateService.validateAndConsume(state); // First use works
    
    // Second use fails
    expect(() => oauthStateService.validateAndConsume(state)).toThrow(OAuthError);
  });

  it('should throw OAuthError for non-existent state', () => {
    expect(() => oauthStateService.validateAndConsume('invalid_state')).toThrow(OAuthError);
  });

  it('should throw OAuthError for expired state', () => {
    jest.useFakeTimers();
    const userId = 'user_exp';
    const state = oauthStateService.generateState(userId);
    
    // Advance time by 16 minutes (TTL is 15 mins)
    jest.advanceTimersByTime(16 * 60 * 1000);
    
    expect(() => oauthStateService.validateAndConsume(state)).toThrow(OAuthError);
    expect(() => oauthStateService.validateAndConsume(state)).toThrow(/expired/);
  });
});
