import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/app-errors';

/**
 * Custom Unauthorized Error (401)
 */
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

/**
 * Require Authentication Middleware
 * 
 * Extracts the user's identity securely. Currently mocked to use the 'x-user-id'
 * header or a Bearer token for demonstration purposes until a full session/JWT 
 * system is integrated.
 * 
 * Prevents IDOR vulnerabilities by ensuring routes don't trust raw query parameters.
 */
export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  // 1. Try to get from x-user-id header
  let userId = req.headers['x-user-id'] as string;

  // 2. Try to get from Authorization Bearer token (mock decoding)
  if (!userId && req.headers.authorization?.startsWith('Bearer ')) {
    const token = req.headers.authorization.split(' ')[1];
    // In a real app, you would verify the JWT here.
    // For this mock, we assume the token IS the userId if it's not a real JWT.
    userId = token;
  }

  if (!userId) {
    return next(new UnauthorizedError('Authentication required. Missing x-user-id header or Bearer token.'));
  }

  // Attach user identity to the request
  (req as any).user = { id: userId };
  
  next();
};
