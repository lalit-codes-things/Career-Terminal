import { ZodError } from 'zod';
import { acquireLock, releaseLock } from '../lib/mutex';
import { processEmailJob } from '../services/queue/workers/email.worker';
import { processResumeParsingJob } from '../services/queue/workers/resume-parsing.worker';
import { processApplicationTrackingJob } from '../services/queue/workers/application-tracking.worker';

// Mock the Redis client for Mutex testing
jest.mock('ioredis', () => {
  const store = new Map<string, string>();
  return jest.fn().mockImplementation(() => ({
    set: jest.fn(async (key, value, _mode, _ttl, nx) => {
      if (nx === 'NX' && !store.has(key)) {
        store.set(key, value);
        return 'OK';
      }
      return null;
    }),
    eval: jest.fn(async (_script, _numKeys, key, arg) => {
      if (store.get(key) === arg) {
        store.delete(key);
        return 1;
      }
      return 0;
    }),
    get: jest.fn(async (key) => store.get(key) || null),
    on: jest.fn(),
    // Expose store for test assertions
    __store: store,
  }));
});

describe('Epic 0.6: Security Data Layer', () => {
  describe('Mutex (Safe Redis Lock)', () => {
    let mockRedis: any;

    beforeEach(() => {
      // Get the mocked instance by importing normally, then pulling the mock
      const RedisMock = require('ioredis');
      mockRedis = new RedisMock();
      mockRedis.__store.clear();
    });

    it('should successfully acquire and release a lock', async () => {
      const lockKey = 'test_lock';
      const token = await acquireLock(lockKey, 30);
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(mockRedis.__store.get(lockKey)).toBe(token);

      await releaseLock(lockKey, token!);
      expect(mockRedis.__store.has(lockKey)).toBe(false);
    });

    it('should safely NOT delete a lock if token does not match (Lua script behavior)', async () => {
      const lockKey = 'stolen_lock';
      mockRedis.__store.set(lockKey, 'someone_elses_token');

      // Attempt to release with a different token
      await releaseLock(lockKey, 'my_expired_token');

      // The lock should still exist and belong to someone else
      expect(mockRedis.__store.get(lockKey)).toBe('someone_elses_token');
    });

    it('should return null when trying to acquire an existing lock', async () => {
      const lockKey = 'busy_lock';
      mockRedis.__store.set(lockKey, 'first_token');

      const secondAttempt = await acquireLock(lockKey, 30);
      expect(secondAttempt).toBeNull();
    });
  });

  describe('BullMQ Poison Payload Validation', () => {
    it('EmailWorker should throw ZodError on malformed payload', async () => {
      const maliciousJob: any = {
        data: {
          type: 'SEND_NOTIFICATION',
          // missing userId
          subject: 'Test',
          bodyText: 'Hello',
        },
      };

      await expect(processEmailJob(maliciousJob)).rejects.toThrow(ZodError);
    });

    it('ResumeParsingWorker should throw ZodError on missing storageKey', async () => {
      const maliciousJob: any = {
        data: {
          userId: 'user_1',
          mimeType: 'application/pdf',
          originalFilename: 'resume.pdf',
          // missing storageKey and fileHash
        },
      };

      await expect(processResumeParsingJob(maliciousJob)).rejects.toThrow(ZodError);
    });

    it('ApplicationTrackingWorker should throw ZodError on unknown job type', async () => {
      const maliciousJob: any = {
        data: {
          type: 'INJECT_SQL', // invalid enum
          userId: 'user_1',
          applicationId: 'app_1',
        },
      };

      await expect(processApplicationTrackingJob(maliciousJob)).rejects.toThrow(ZodError);
    });
  });
});
