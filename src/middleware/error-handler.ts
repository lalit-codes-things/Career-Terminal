/**
 * Global error handling middleware for Express.
 *
 * Catches all errors thrown during request processing, formats them,
 * and returns consistent JSON responses to the client.
 */
import { type Request, type Response, type NextFunction } from 'express';
import { AppError } from '../errors/app-errors';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // If it's our custom AppError, we have structured data
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      console.error(`[SERVER ERROR] ${err.code}: ${err.message}`, err.stack);
    } else {
      console.warn(`[CLIENT ERROR] ${err.code}: ${err.message}`);
    }

    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        // @ts-expect-error Validation details are specific to ValidationError
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }

  // Handle generic / unexpected errors
  console.error('[UNHANDLED ERROR]', err);

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message:
        process.env.NODE_ENV === 'production'
          ? 'An unexpected error occurred'
          : err.message,
    },
  });
}
