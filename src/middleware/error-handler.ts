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
import { Prisma } from '@prisma/client';

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

    const errorResponse: { code: string; message: string; details?: unknown; errorId: string } = {
      code: err.code,
      message: err.message,
      errorId,
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

  // Handle Prisma errors securely without leaking internals
  if (
    err instanceof Prisma.PrismaClientKnownRequestError ||
    err instanceof Prisma.PrismaClientUnknownRequestError ||
    err instanceof Prisma.PrismaClientValidationError ||
    err instanceof Prisma.PrismaClientInitializationError
  ) {
    logger.error('[DATABASE ERROR]', {
      errorId,
      name: err.name,
      message: err.message,
      stack: err.stack,
      requestId: req.requestId,
      correlationId: req.correlationId,
      code: err instanceof Prisma.PrismaClientKnownRequestError ? err.code : undefined,
    });

    let statusCode = 500;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected database error occurred';

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        statusCode = 409;
        code = 'CONFLICT';
        message = 'A record with this value already exists.';
      } else if (err.code === 'P2025') {
        statusCode = 404;
        code = 'NOT_FOUND';
        message = 'The requested resource was not found.';
      } else if (err.code.startsWith('P20')) {
        statusCode = 400;
        code = 'BAD_REQUEST';
        message = 'Invalid database request.';
      }
    }

    res.status(statusCode).json({
      success: false,
      error: { code, message, errorId },
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

  // Sanitize message for production — don't expose internal paths or details
  const isProduction = process.env.NODE_ENV === 'production';
  const safeMessage = isProduction ? 'An unexpected error occurred' : err.message;

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: safeMessage,
      errorId,
    },
  });
}
