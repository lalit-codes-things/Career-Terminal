/**
 * Express middleware for request validation using Zod.
 */
import { type Request, type Response, type NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ValidationError } from '../errors/app-errors';

export function validateQuery(
  schema: ZodSchema,
): (req: Request, _res: Response, next: NextFunction) => void {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse(req.query);
      Object.defineProperty(req, 'query', {
        value: parsed,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      next();
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        next(formatZodError(error));
      } else {
        next(new ValidationError('Invalid request', {}));
      }
    }
  };
}

/** Middleware to validate request body using a Zod schema. */
export function validateBody(
  schema: ZodSchema,
): (req: Request, _res: Response, next: NextFunction) => void {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      req.body = schema.parse(req.body);
      next();
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        next(formatZodError(error));
      } else {
        next(new ValidationError('Invalid request', {}));
      }
    }
  };
}

/** Convert Zod validation errors into a custom ValidationError. */
function formatZodError(error: ZodError): ValidationError {
  const details: Record<string, string[]> = {};
  for (const err of error.errors) {
    const path = err.path.join('.') || 'root';
    if (!details[path]) {
      details[path] = [];
    }
    details[path].push(err.message);
  }
  return new ValidationError('Invalid request parameters', details);
}
