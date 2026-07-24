import { type RequestHandler } from 'express';
import { config } from '../../config';
import { ValidationError } from '../../errors/app-errors';
import { sanitizeObject } from './utils';

/**
 * HTTP method protection middleware
 */
export function httpMethodProtection(): RequestHandler {
  const allowedMethods = config.http.allowedMethods.map((m) => m.toUpperCase());
  return (req, _res, next) => {
    if (!allowedMethods.includes(req.method)) {
      throw new ValidationError(`HTTP method ${req.method} is not allowed`);
    }
    next();
  };
}

/**
 * Request size and limits middleware
 */
export function requestLimits(): RequestHandler {
  return (req, _res, next) => {
    // Check URL length
    if (req.originalUrl.length > config.limits.maxUrlLength) {
      throw new ValidationError('URL too long');
    }

    // Check query parameter count
    const queryParamCount = Object.keys(req.query).length;
    if (queryParamCount > config.limits.maxQueryParams) {
      throw new ValidationError('Too many query parameters');
    }

    next();
  };
}

/**
 * Parameter pollution protection middleware
 */
export function parameterPollutionProtection(): RequestHandler {
  return (req, _res, next) => {
    // Check query params for duplicates
    for (const key in req.query) {
      const value = req.query[key];
      if (Array.isArray(value)) {
        throw new ValidationError(`Duplicate query parameter: ${key}`);
      }
    }

    // Sanitize request body
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
      req.body = sanitizeObject(req.body);
    }

    next();
  };
}

/**
 * Request timeout middleware
 */
export function requestTimeout(): RequestHandler {
  return (_req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({
          success: false,
          error: {
            code: 'REQUEST_TIMEOUT',
            message: 'Request timed out',
          },
        });
      }
    }, config.limits.requestTimeoutMs);

    res.on('finish', () => clearTimeout(timer));
    next();
  };
}

/**
 * Security headers middleware (extra headers beyond helmet)
 */
export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    // Cache control for sensitive responses
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // COOP, COEP, CORP headers
    res.setHeader('Cross-Origin-Opener-Policy', config.security.coop);
    res.setHeader('Cross-Origin-Embedder-Policy', config.security.coep);
    res.setHeader('Cross-Origin-Resource-Policy', config.security.corp);

    // X-Content-Type-Options is already set by helmet
    next();
  };
}
