import { Request, Response, NextFunction } from 'express';
import { requireAuth, UnauthorizedError } from '../middleware/auth';
import { createRateLimiter, RateLimitError } from '../middleware/rate-limiter';

describe('Security Middlewares', () => {
  describe('Authentication Middleware', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let mockNext: jest.Mock;

    beforeEach(() => {
      mockReq = { headers: {} };
      mockRes = {};
      mockNext = jest.fn();
    });

    it('should reject requests without authentication', () => {
      requireAuth(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith(expect.any(UnauthorizedError));
      expect(mockNext.mock.calls[0][0].message).toContain('Missing x-user-id');
    });

    it('should allow requests with x-user-id header', () => {
      mockReq.headers = { 'x-user-id': 'user-123' };
      
      requireAuth(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith(); // Called without errors
      expect((mockReq as any).user.id).toBe('user-123');
    });

    it('should allow requests with Bearer token', () => {
      mockReq.headers = { authorization: 'Bearer user-token-123' };
      
      requireAuth(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith();
      expect((mockReq as any).user.id).toBe('user-token-123');
    });
  });

  describe('Rate Limiter Middleware', () => {
    it('should allow requests under the limit and block those over', () => {
      const windowMs = 1000;
      const maxRequests = 2;
      const limiter = createRateLimiter(windowMs, maxRequests);
      
      const mockReq = { ip: '127.0.0.1' } as unknown as Request;
      const mockRes = { setHeader: jest.fn() } as unknown as Response;
      const mockNext = jest.fn();

      // Request 1: Allowed
      limiter(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledWith();

      mockNext.mockClear();

      // Request 2: Allowed
      limiter(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledWith();

      mockNext.mockClear();

      // Request 3: Blocked
      limiter(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledWith(expect.any(RateLimitError));
      expect(mockRes.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
    });
  });
});
