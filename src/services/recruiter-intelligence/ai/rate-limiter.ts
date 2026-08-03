import type { CostBudget, RateLimitState, RateLimiter } from './types';

/**
 * TokenBucketRateLimiter — simple sliding-window rate limiter.
 * Tracks calls and tokens per minute window.
 * Thread-safe within a single Node.js process.
 */
export class TokenBucketRateLimiter implements RateLimiter {
  private state: RateLimitState = {
    windowStartMs: Date.now(),
    callsInWindow: 0,
    tokensInWindow: 0,
  };

  constructor(private readonly budget: CostBudget) {}

  isAllowed(tokens: number): boolean {
    this.maybeReset();
    return (
      this.state.callsInWindow < this.budget.maxCallsPerMinute &&
      this.state.tokensInWindow + tokens <= this.budget.maxTokensPerCall * this.budget.maxCallsPerMinute
    );
  }

  async acquire(tokens: number): Promise<void> {
    const maxWaitMs = 60_000;
    const pollIntervalMs = 100;
    let waited = 0;

    while (!this.isAllowed(tokens)) {
      if (waited >= maxWaitMs) {
        throw new RateLimitExceededError(
          `Rate limit exceeded: ${this.state.callsInWindow}/${this.budget.maxCallsPerMinute} calls this minute`,
        );
      }
      await sleep(pollIntervalMs);
      waited += pollIntervalMs;
    }

    this.maybeReset();
    this.state.callsInWindow++;
    this.state.tokensInWindow += tokens;
  }

  reset(): void {
    this.state = {
      windowStartMs: Date.now(),
      callsInWindow: 0,
      tokensInWindow: 0,
    };
  }

  getState(): Readonly<RateLimitState> {
    this.maybeReset();
    return { ...this.state };
  }

  private maybeReset(): void {
    const nowMs = Date.now();
    if (nowMs - this.state.windowStartMs >= 60_000) {
      this.state = {
        windowStartMs: nowMs,
        callsInWindow: 0,
        tokensInWindow: 0,
      };
    }
  }
}

export class RateLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitExceededError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
