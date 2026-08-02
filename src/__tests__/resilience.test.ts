import { CircuitBreaker, CircuitState } from '../lib/circuit-breaker';
import { executeWithTransientRetry } from '../db/transaction-utils';
import { PrismaClient, Prisma } from '@prisma/client';

describe('Resilience Utilities', () => {
  describe('CircuitBreaker', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should open after failure threshold and fallback to half-open after reset timeout', async () => {
      const breaker = new CircuitBreaker('test', {
        failureThreshold: 2,
        resetTimeout: 1000,
        requestTimeout: 100,
      });

      const failingAction = jest.fn().mockRejectedValue(new Error('fail'));

      await expect(breaker.fire(failingAction)).rejects.toThrow('fail');
      await expect(breaker.fire(failingAction)).rejects.toThrow('fail');

      expect(breaker.getState()).toBe(CircuitState.OPEN);

      // Fast-fail
      await expect(breaker.fire(failingAction)).rejects.toThrow(/Circuit \[test\] is OPEN/);

      // Advance time
      jest.advanceTimersByTime(1100);

      // Should attempt again
      const successAction = jest.fn().mockResolvedValue('success');
      await expect(breaker.fire(successAction)).resolves.toBe('success');

      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('executeWithTransientRetry', () => {
    it('should retry on P2034 and succeed', async () => {
      const mockPrisma = {
        $transaction: jest.fn(),
      } as unknown as PrismaClient;

      const p2034Error = new Prisma.PrismaClientKnownRequestError('Deadlock', {
        code: 'P2034',
        clientVersion: '6.19.3',
      });

      (mockPrisma.$transaction as jest.Mock)
        .mockRejectedValueOnce(p2034Error)
        .mockResolvedValueOnce('success');

      const action = jest.fn();

      const result = await executeWithTransientRetry(mockPrisma, action, {
        maxRetries: 2,
        baseDelayMs: 1,
      });

      expect(result).toBe('success');
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-transient errors', async () => {
      const mockPrisma = {
        $transaction: jest.fn(),
      } as unknown as PrismaClient;

      const fatalError = new Error('Fatal');

      (mockPrisma.$transaction as jest.Mock).mockRejectedValueOnce(fatalError);

      const action = jest.fn();

      await expect(executeWithTransientRetry(mockPrisma, action)).rejects.toThrow('Fatal');
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
