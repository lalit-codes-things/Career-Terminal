/**
 * Minimal environment variable stubs for Jest.
 * These provide the values required by config/index.ts and token.service.ts
 * at module load time during tests.  They do NOT represent real credentials.
 */
process.env.NODE_ENV = 'test';
process.env.ALLOW_TEST_AUTH_BYPASS = 'true';
process.env.JWT_SECRET = 'test-jwt-secret-minimum-32-chars-padding-ok';
process.env.ENCRYPTION_KEY = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/integrations/gmail/callback';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb';
process.env.INTERNAL_API_KEY = 'test-internal-api-key-32-chars-ok';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';
process.env.S3_BUCKET = 'test-bucket';
process.env.AWS_REGION = 'us-east-1';

jest.mock('uuid', () => ({
  v4: () => 'mock-uuid-v4',
  v7: () => 'mock-uuid-v7',
}));

jest.mock('bullmq', () => {
  const mockQueue = {
    add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
    close: jest.fn().mockResolvedValue(undefined),
    getJobCounts: jest.fn().mockResolvedValue({ waiting: 0, active: 0, delayed: 0 }),
  };
  return {
    Queue: jest.fn(() => mockQueue),
    Worker: jest.fn(() => ({
      close: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    })),
  };
});

jest.mock('ioredis', () => {
  const store = new Map();
  const mockRedis = {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue('PONG'),
    on: jest.fn(),
    duplicate: jest.fn().mockReturnValue({
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    }),
    get: jest.fn((key) => Promise.resolve(store.has(key) ? store.get(key).value : null)),
    set: jest.fn((key, value) => {
      store.set(key, { value });
      return Promise.resolve('OK');
    }),
    setex: jest.fn((key, _ttl, value) => {
      store.set(key, { value });
      return Promise.resolve('OK');
    }),
    del: jest.fn((...keys) => {
      let count = 0;
      for (const key of keys) {
        if (store.has(key)) {
          store.delete(key);
          count++;
        }
      }
      return Promise.resolve(count);
    }),
    keys: jest.fn((pattern) => {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return Promise.resolve(Array.from(store.keys()).filter((k) => regex.test(k)));
    }),
    dbsize: jest.fn(() => Promise.resolve(store.size)),
    scan: jest.fn((_cursor, _match) => Promise.resolve(['0', Array.from(store.keys())])),
    exists: jest.fn((...keys) => Promise.resolve(keys.filter((k) => store.has(k)).length)),
    expire: jest.fn(() => Promise.resolve(1)),
  };
  return jest.fn(() => mockRedis);
});

