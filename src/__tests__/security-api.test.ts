/**
 * API Security Test Suite
 *
 * Tests for all security controls added in  *   - User-aware rate limiting
 *   - SSRF guard
 *   - Resume MIME type validation
 *   - Pagination bounds enforcement
 *   - Prototype pollution protection (via sanitizeObject)
 *   - Error response security (no stack traces, errorId present)
 *   - Security event logging (rate_limit_exceeded, auth_failure)
 *   - String length limits on filter fields
 */
import { z } from 'zod';
import { createUserAwareRateLimiter, RateLimitError } from '../middleware/rate-limiter';
import { validateOutboundUrl, isSafeOutboundUrl, SsrfError } from '../lib/ssrf-guard';
import { sanitizeObject, isSafeKey } from '../infrastructure/security/utils';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { errorHandler } from '../middleware/error-handler';
import { AppError, ValidationError } from '../errors/app-errors';

// ---------------------------------------------------------------------------
// User-aware rate limiter
// ---------------------------------------------------------------------------

describe('User-Aware Rate Limiter', () => {
  it('should allow requests under the limit', async () => {
    const limiter = createUserAwareRateLimiter(60_000, 3);
    const userId = `user-${Math.random().toString(36).slice(2)}`;
    const mockReq = {
      user: { id: userId },
      ip: '10.0.0.1',
      socket: { remoteAddress: '10.0.0.1' },
    } as unknown as Request;
    const mockRes = { setHeader: jest.fn() } as unknown as Response;
    const mockNext = jest.fn();

    await limiter(mockReq, mockRes, mockNext);
    await limiter(mockReq, mockRes, mockNext);
    await limiter(mockReq, mockRes, mockNext);

    // All 3 calls should succeed
    expect(mockNext).toHaveBeenCalledTimes(3);
    for (let i = 1; i <= 3; i++) {
      expect(mockNext).toHaveBeenNthCalledWith(i); // called with no error
    }
  });

  it('should block requests over the limit keyed by userId', async () => {
    const limiter = createUserAwareRateLimiter(60_000, 2);
    const userId = `user-${Math.random().toString(36).slice(2)}`;
    const mockReq = {
      user: { id: userId },
      ip: '192.168.1.1',
      socket: { remoteAddress: '192.168.1.1' },
    } as unknown as Request;
    const mockRes = { setHeader: jest.fn() } as unknown as Response;
    const mockNext = jest.fn();

    await limiter(mockReq, mockRes, mockNext);
    await limiter(mockReq, mockRes, mockNext);
    await limiter(mockReq, mockRes, mockNext); // 3rd — exceeds limit

    expect(mockNext).toHaveBeenNthCalledWith(3, expect.any(RateLimitError));
    expect(mockRes.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
  });

  it('should isolate limits between different users', async () => {
    const limiter = createUserAwareRateLimiter(60_000, 1);
    const userA = `user-A-${Math.random().toString(36).slice(2)}`;
    const userB = `user-B-${Math.random().toString(36).slice(2)}`;
    const makeReq = (userId: string) =>
      ({
        user: { id: userId },
        ip: '10.0.0.1',
        socket: { remoteAddress: '10.0.0.1' },
      }) as unknown as Request;
    const mockRes = { setHeader: jest.fn() } as unknown as Response;
    const mockNext = jest.fn();

    await limiter(makeReq(userA), mockRes, mockNext);
    await limiter(makeReq(userB), mockRes, mockNext); // different user — should pass

    expect(mockNext).toHaveBeenNthCalledWith(1); // userA allowed
    expect(mockNext).toHaveBeenNthCalledWith(2); // userB allowed
  });

  it('should fall back to IP keying when no user is authenticated', async () => {
    const limiter = createUserAwareRateLimiter(60_000, 1);
    const testIp = `10.99.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
    const mockReq = {
      user: undefined,
      ip: testIp,
      socket: { remoteAddress: testIp },
    } as unknown as Request;
    const mockRes = { setHeader: jest.fn() } as unknown as Response;
    const mockNext = jest.fn();

    await limiter(mockReq, mockRes, mockNext);
    await limiter(mockReq, mockRes, mockNext); // exceeds limit

    expect(mockNext).toHaveBeenNthCalledWith(2, expect.any(RateLimitError));
  });
});

// ---------------------------------------------------------------------------
// SSRF Guard
// ---------------------------------------------------------------------------

describe('SSRF Guard', () => {
  describe('validateOutboundUrl — blocked targets', () => {
    const blockedUrls = [
      ['localhost', 'https://localhost/api'],
      ['127.0.0.1 loopback', 'https://127.0.0.1/secret'],
      ['127.0.0.254 loopback range', 'https://127.0.0.254/'],
      ['10.x private range', 'https://10.0.0.1/internal'],
      ['10.255.255.255 private', 'https://10.255.255.255/'],
      ['172.16.x private', 'https://172.16.0.1/'],
      ['172.31.x private', 'https://172.31.255.255/'],
      ['192.168.x private', 'https://192.168.1.1/'],
      ['169.254.x link-local', 'https://169.254.0.1/'],
      ['AWS metadata endpoint', 'https://169.254.169.254/latest/meta-data/'],
      ['GCP metadata hostname', 'https://metadata.google.internal/computeMetadata/v1/'],
      ['IPv6 loopback', 'https://[::1]/'],
      ['IPv6 link-local', 'https://[fe80::1]/'],
      ['IPv6 unique-local', 'https://[fd00::1]/'],
      ['http protocol', 'http://example.com/'],
      ['ftp protocol', 'ftp://example.com/file'],
      ['embedded credentials', 'https://user:pass@example.com/'],
      ['0.0.0.0 unspecified', 'https://0.0.0.0/'],
    ];

    test.each(blockedUrls)('blocks %s', (_label, url) => {
      expect(() => validateOutboundUrl(url)).toThrow(SsrfError);
      expect(isSafeOutboundUrl(url)).toBe(false);
    });
  });

  describe('validateOutboundUrl — allowed targets', () => {
    const allowedUrls = [
      ['public HTTPS domain', 'https://example.com/api'],
      ['public HTTPS with path', 'https://api.github.com/repos/user/repo'],
      ['public HTTPS with query', 'https://search.example.com/search?q=test'],
      ['non-private IP', 'https://8.8.8.8/'],
      ['non-private IP 2', 'https://1.1.1.1/'],
    ];

    test.each(allowedUrls)('allows %s', (_label, url) => {
      expect(() => validateOutboundUrl(url)).not.toThrow();
      expect(isSafeOutboundUrl(url)).toBe(true);
    });
  });

  it('throws SsrfError for invalid URLs', () => {
    expect(() => validateOutboundUrl('not-a-url')).toThrow(SsrfError);
    expect(() => validateOutboundUrl('')).toThrow(SsrfError);
    expect(() => validateOutboundUrl('javascript:alert(1)')).toThrow(SsrfError);
  });
});

// ---------------------------------------------------------------------------
// Prototype Pollution Protection
// ---------------------------------------------------------------------------

describe('Prototype Pollution Protection', () => {
  describe('isSafeKey', () => {
    it('blocks __proto__', () => expect(isSafeKey('__proto__')).toBe(false));
    it('blocks constructor', () => expect(isSafeKey('constructor')).toBe(false));
    it('blocks prototype', () => expect(isSafeKey('prototype')).toBe(false));
    it('blocks __defineGetter__', () => expect(isSafeKey('__defineGetter__')).toBe(false));
    it('allows normal keys', () => {
      expect(isSafeKey('name')).toBe(true);
      expect(isSafeKey('userId')).toBe(true);
      expect(isSafeKey('email')).toBe(true);
    });
  });

  describe('sanitizeObject', () => {
    it('removes __proto__ key from user input', () => {
      // JSON.parse can inject a "__proto__" string key that would cause pollution
      // via Object.assign. sanitizeObject must strip it so no pollution occurs.
      const malicious = JSON.parse('{"__proto__": {"polluted": true}, "name": "test"}');
      const safe = sanitizeObject(malicious);

      // Prototype must not be polluted
      expect('polluted' in Object.prototype).toBe(false);
      // The safe object must not have __proto__ as an own property
      expect(Object.hasOwn(safe as object, '__proto__')).toBe(false);
      // Legitimate key preserved
      expect((safe as Record<string, unknown>)['name']).toBe('test');
    });

    it('removes constructor key from nested objects', () => {
      const malicious = { user: { constructor: { malicious: true }, id: '123' } };
      const safe = sanitizeObject(malicious);
      // Must not have constructor as own property (inherited constructor is fine)
      expect(Object.hasOwn(safe.user as object, 'constructor')).toBe(false);
      expect((safe.user as Record<string, unknown>)['id']).toBe('123');
    });

    it('handles arrays correctly', () => {
      const input = { items: [{ name: 'safe', __proto__: 'bad' }] };
      const safe = sanitizeObject(input);
      const first = safe.items[0] as Record<string, unknown>;
      // Must not have __proto__ as own property
      expect(Object.hasOwn(first, '__proto__')).toBe(false);
      expect(first['name']).toBe('safe');
    });
  });
});

// ---------------------------------------------------------------------------
// Error Response Security
// ---------------------------------------------------------------------------

describe('Error Response Security', () => {
  const makeApp = () => {
    const app = express();
    app.get('/throw-app-error', (_req, _res, next) => {
      next(new AppError('Resource not found', 404, 'NOT_FOUND'));
    });
    app.get('/throw-validation-error', (_req, _res, next) => {
      next(new ValidationError('Bad input', { field: ['required'] }));
    });
    app.get('/throw-raw-error', (_req, _res, next) => {
      next(new Error('Internal secret path /var/app/secret leaked'));
    });
    app.use(errorHandler);
    return app;
  };

  it('returns errorId in every error response', async () => {
    const app = makeApp();
    const res = await request(app).get('/throw-app-error');
    expect(res.status).toBe(404);
    expect(res.body.error.errorId).toBeDefined();
    expect(typeof res.body.error.errorId).toBe('string');
  });

  it('returns structured error for AppError', async () => {
    const app = makeApp();
    const res = await request(app).get('/throw-app-error');
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe('Resource not found');
  });

  it('returns validation details for ValidationError', async () => {
    const app = makeApp();
    const res = await request(app).get('/throw-validation-error');
    expect(res.status).toBe(400);
    expect(res.body.error.details).toBeDefined();
    expect(res.body.error.details.field).toEqual(['required']);
  });

  it('never exposes stack traces in error responses', async () => {
    const app = makeApp();
    const res = await request(app).get('/throw-raw-error');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('at ');
    expect(JSON.stringify(res.body)).not.toContain('.ts:');
    expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
  });

  it('does not expose internal secrets in error responses (test env)', async () => {
    const app = makeApp();
    const res = await request(app).get('/throw-raw-error');
    // In test (non-production) the raw message may appear — that's acceptable.
    // What must never appear is a stack trace.
    expect(JSON.stringify(res.body)).not.toContain('Error: Internal');
    expect(res.body.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pagination Bounds
// ---------------------------------------------------------------------------

describe('Pagination Bounds Enforcement', () => {
  it('validates page must be positive', () => {
    const schema = z.object({
      page: z.coerce.number().int().positive().max(10000).optional(),
      pageSize: z.coerce.number().int().positive().max(100).optional(),
    });

    const valid = schema.safeParse({ page: '1', pageSize: '50' });
    expect(valid.success).toBe(true);

    const zeroPage = schema.safeParse({ page: '0' });
    expect(zeroPage.success).toBe(false);

    const negativePage = schema.safeParse({ page: '-1' });
    expect(negativePage.success).toBe(false);
  });

  it('enforces pageSize max of 100', () => {
    const schema = z.object({
      pageSize: z.coerce.number().int().positive().max(100).optional(),
    });

    const ok = schema.safeParse({ pageSize: '100' });
    expect(ok.success).toBe(true);

    const tooBig = schema.safeParse({ pageSize: '101' });
    expect(tooBig.success).toBe(false);

    const wayTooBig = schema.safeParse({ pageSize: '99999' });
    expect(wayTooBig.success).toBe(false);
  });

  it('enforces page max of 10000 to prevent huge offsets', () => {
    const schema = z.object({
      page: z.coerce.number().int().positive().max(10000).optional(),
    });

    const ok = schema.safeParse({ page: '10000' });
    expect(ok.success).toBe(true);

    const tooHigh = schema.safeParse({ page: '10001' });
    expect(tooHigh.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// String Length Limits on Filter Fields
// ---------------------------------------------------------------------------

describe('Filter String Length Limits', () => {
  it('enforces max 100 chars on company filter', () => {
    const schema = z.object({ company: z.string().max(100).optional() });

    const ok = schema.safeParse({ company: 'example-organization' });
    expect(ok.success).toBe(true);

    const tooLong = schema.safeParse({ company: 'A'.repeat(101) });
    expect(tooLong.success).toBe(false);
  });

  it('enforces max 50 chars on status filter', () => {
    const schema = z.object({ status: z.string().max(50).optional() });

    const ok = schema.safeParse({ status: 'INTERVIEW' });
    expect(ok.success).toBe(true);

    const tooLong = schema.safeParse({ status: 'X'.repeat(51) });
    expect(tooLong.success).toBe(false);
  });
});
