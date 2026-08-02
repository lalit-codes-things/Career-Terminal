import { logger } from '../lib/logger';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  recoveryTimeoutMs: number;
  resetTimeoutMs: number;
}

const defaultOptions: CircuitBreakerOptions = {
  failureThreshold: 5,
  recoveryTimeoutMs: 30000,
  resetTimeoutMs: 60000,
};

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private options: CircuitBreakerOptions;
  private name: string;

  constructor(name: string, options?: Partial<CircuitBreakerOptions>) {
    this.name = name;
    this.options = { ...defaultOptions, ...options };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      const now = Date.now();
      if (now - this.lastFailureTime >= this.options.recoveryTimeoutMs) {
        this.state = 'HALF_OPEN';
        logger.info('Circuit breaker transitioning to HALF_OPEN', { name: this.name });
      } else {
        throw new Error(`Circuit breaker '${this.name}' is OPEN`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      this.failureCount = 0;
      this.successCount = 0;
      logger.info('Circuit breaker closed', { name: this.name });
    } else if (this.state === 'CLOSED') {
      this.successCount++;
      if (this.successCount > this.options.failureThreshold * 2) {
        // Reset failure count after many successful operations
        this.failureCount = 0;
        this.successCount = 0;
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    logger.warn('Circuit breaker failure recorded', {
      name: this.name,
      failureCount: this.failureCount,
      state: this.state,
    });

    if (this.state === 'CLOSED' && this.failureCount >= this.options.failureThreshold) {
      this.state = 'OPEN';
      logger.error('Circuit breaker opened', { name: this.name });
    } else if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      logger.error('Circuit breaker reopened from HALF_OPEN', { name: this.name });
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getMetrics(): { failureCount: number; successCount: number; state: CircuitState } {
    return {
      failureCount: this.failureCount,
      successCount: this.successCount,
      state: this.state,
    };
  }
}
