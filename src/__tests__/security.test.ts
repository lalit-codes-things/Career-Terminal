/**
 * Security middleware tests.
 *
 * Tests run under NODE_ENV=test (set by jest.config.js / ts-jest).
 * Under test, requireAuth accepts x-user-id as a bypass header.
 * Real JWT verification is tested via the UnauthorizedError path.
 */
import { Request, Response } from 'express';
import { requireAuth, UnauthorizedError } from '../middleware/auth';
import { createRateLimiter, RateLimitError } from '../middleware/rate-limiter';

describe('Security Middlewares', () => {
  describe('Authentication Middleware (NODE_ENV=test)', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let mockNext: jest.Mock;

    beforeEach(() => {
      mockReq = { headers: {} };
      mockRes = {};
      mockNext = jest.fn();
    });

    it('should reject requests with no Authorization header', () => {
      requireAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(UnauthorizedError));
      const err = mockNext.mock.calls[0]?.[0] as UnauthorizedError;
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe('UNAUTHORIZED');
    });

    it('should reject a malformed Authorization header (Basic scheme)', () => {
      mockReq.headers = { authorization: 'Basic dXNlcjpwYXNz' };
      requireAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });

    it('should reject an invalid JWT Bearer token', () => {
      mockReq.headers = { authorization: 'Bearer not-a-real-jwt' };
      requireAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });

    it('should allow requests with x-user-id header (test escape-hatch)', () => {
      // The x-user-id bypass is only active when NODE_ENV === 'test'
      mockReq.headers = { 'x-user-id': 'user-123' };
      requireAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(); // called with no arguments = success
      expect((mockReq as Request & { user?: { id: string } }).user?.id).toBe('user-123');
    });
  });

  describe('Rate Limiter Middleware', () => {
    it('should allow requests under the limit and block those over', async () => {
      const windowMs = 60_000;
      const maxRequests = 2;
      const limiter = createRateLimiter(windowMs, maxRequests);

      // Use a unique IP per test run to avoid cross-test interference
      const testIp = `10.0.0.${Math.floor(Math.random() * 200) + 10}`;
      const mockReq = {
        ip: testIp,
        socket: { remoteAddress: testIp },
      } as unknown as Request;
      const mockRes = { setHeader: jest.fn() } as unknown as Response;
      const mockNext = jest.fn();

      // Request 1 — allowed
      await limiter(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenNthCalledWith(1); // called with no error

      // Request 2 — allowed
      await limiter(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenNthCalledWith(2);

      // Request 3 — blocked
      await limiter(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenNthCalledWith(3, expect.any(RateLimitError));
      expect(mockRes.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
    });
  });
});
