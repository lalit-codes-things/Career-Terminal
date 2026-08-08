/**
 * Test-only authentication helpers.
 *
 * This module is imported ONLY from test files. It is excluded from the
 * production build via the tsconfig / bundler configuration.
 *
 * DO NOT import from this module in production source code.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UnauthorizedError } from '../../src/middleware/auth';

export interface AuthenticatedUser {
  id: string;
  jti?: string;
}

export function applyTestUser(req: Request, userId: string): void {
  req.user = { id: userId };
}

export function requireTestAuth(req: Request, _res: Response, next: NextFunction): void {
  const xUserId = req.headers['x-user-id'];
  const testUserId = Array.isArray(xUserId) ? xUserId[0] : xUserId;
  if (!testUserId) {
    return next(new UnauthorizedError('Missing x-user-id test header'));
  }
  applyTestUser(req, testUserId);
  next();
}

const TEST_JWT_SECRET = 'test-jwt-secret-minimum-32-chars-padding-ok';

export function createTestToken(userId: string): string {
  return jwt.sign({ sub: userId, jti: `test-jti-${userId}` }, TEST_JWT_SECRET, {
    expiresIn: '15m',
    algorithm: 'HS256',
  });
}

export function authHeader(userId: string): Record<string, string> {
  return { Authorization: `Bearer ${createTestToken(userId)}` };
}
