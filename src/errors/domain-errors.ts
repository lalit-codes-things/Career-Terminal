import { AppError } from './app-errors';

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code = 'FORBIDDEN') {
    super(message, 403, code);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT') {
    super(message, 409, code);
  }
}

export class DomainValidationError extends AppError {
  constructor(message: string, code = 'DOMAIN_VALIDATION_ERROR') {
    super(message, 400, code);
  }
}
