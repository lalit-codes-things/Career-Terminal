/**
 * Express middleware for request validation using Zod.
 */
import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema, ZodError } from 'zod';
import { ValidationError } from '../errors/app-errors';

export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (error: any) {
      next(formatZodError(error));
    }
  };
}

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error: any) {
      next(formatZodError(error));
    }
  };
}

function formatZodError(error: ZodError): ValidationError {
  const details: Record<string, string[]> = {};
  
  if (error.errors) {
    for (const err of error.errors) {
      const path = err.path.join('.') || 'root';
      if (!details[path]) {
        details[path] = [];
      }
      details[path].push(err.message);
    }
  }

  return new ValidationError('Invalid request parameters', details);
}
