/**
 * Global error handling middleware for Express.
 *
 * Catches all errors thrown during request processing, formats them,
 * and returns consistent JSON responses to the client.
 */
import { randomUUID } from 'crypto';
import { type Request, type Response, type NextFunction } from 'express';
import { AppError, ValidationError } from '../errors/app-errors';
import { logger } from '../lib/logger';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const errorId = randomUUID();

  // If it's our custom AppError, we have structured data
  if (err instanceof AppError) {
    const logLevel = err.isOperational ? 'warn' : 'error';
    logger[logLevel]('[SERVER ERROR]', {
      errorId,
      code: err.code,
      message: err.message,
      stack: err.stack,
      requestId: req.requestId,
      correlationId: req.correlationId,
      isOperational: err.isOperational,
    });

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
  logger.error('[UNHANDLED ERROR]', {
    errorId,
    name: err.name,
    message: err.message,
    stack: err.stack,
    requestId: req.requestId,
    correlationId: req.correlationId,
  });

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}
