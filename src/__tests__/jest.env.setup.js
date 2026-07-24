/**
 * Minimal environment variable stubs for Jest.
 * These provide the values required by config/index.ts and token.service.ts
 * at module load time during tests.  They do NOT represent real credentials.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-minimum-32-chars-padding-ok';
process.env.ENCRYPTION_KEY = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/integrations/gmail/callback';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb';
process.env.INTERNAL_API_KEY = 'test-internal-api-key-32-chars-ok';
// No REDIS_HOST — keeps rate limiter in memory mode during tests
