/**
 * Global error handling middleware for Express.
 *
 * Catches all errors thrown during request processing, formats them,
 * and returns consistent JSON responses to the client.
 */
import { type Request, type Response, type NextFunction } from 'express';
import { AppError, ValidationError } from '../errors/app-errors';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // If it's our custom AppError, we have structured data
  if (err instanceof AppError) {
    // Log based on severity
    if (err.statusCode >= 500) {
      console.error(`[SERVER ERROR] ${err.code}: ${err.message}`, err.stack);
    } else {
      console.warn(`[CLIENT ERROR] ${err.code}: ${err.message}`);
    }

    const errorResponse: { code: string; message: string; details?: unknown } = {
      code: err.code,
      message: err.message,
    };

    if (err instanceof ValidationError && err.details) {
      errorResponse.details = err.details;
    }

    res.status(err.statusCode).json({
      success: false,
      error: errorResponse,
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
