export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
  /** Maximum allowed failures before opening the circuit */
  failureThreshold: number;
  /** Milliseconds to wait before transitioning from OPEN to HALF_OPEN */
  resetTimeout: number;
  /** Milliseconds before a call times out and counts as a failure */
  requestTimeout: number;
}

export class CircuitBreakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

/**
 * A lightweight, reusable Circuit Breaker for isolating failure-prone external dependencies.
 */
export class CircuitBreaker {
  private state = CircuitState.CLOSED;
  private failureCount = 0;
  private nextAttemptAt = 0;

  constructor(
    private readonly name: string,
    private readonly options: CircuitBreakerOptions = {
      failureThreshold: 5,
      resetTimeout: 30000,
      requestTimeout: 5000,
    },
  ) {}

  public async fire<T>(action: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() > this.nextAttemptAt) {
        // Transition to HALF_OPEN to test if the dependency has recovered
        this.state = CircuitState.HALF_OPEN;
      } else {
        throw new CircuitBreakerError(`Circuit [${this.name}] is OPEN. Fast-failing request.`);
      }
    }

    try {
      const result = await this.executeWithTimeout(action);
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private async executeWithTimeout<T>(action: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Circuit breaker request timed out'));
      }, this.options.requestTimeout);

      action()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err: unknown) => {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.CLOSED;
    }
    this.failureCount = 0;
  }

  private onFailure(): void {
    this.failureCount++;
    if (
      this.state === CircuitState.HALF_OPEN ||
      this.failureCount >= this.options.failureThreshold
    ) {
      this.state = CircuitState.OPEN;
      this.nextAttemptAt = Date.now() + this.options.resetTimeout;
    }
  }

  public getState(): CircuitState {
    return this.state;
  }
}
