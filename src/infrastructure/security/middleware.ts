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

    if (!config.http.methodOverrideEnabled) {
      const overrideHeaders = ['x-http-method-override', 'x-http-method', 'x-method-override'];
      for (const header of overrideHeaders) {
        if (req.headers[header]) {
          throw new ValidationError('Method override is not permitted');
        }
      }
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

    // Host header validation
    const host = req.headers.host;
    if (host && !/^[a-zA-Z0-9.-]+(:\d+)?$/.test(host)) {
      throw new ValidationError('Invalid Host header format');
    }

    next();
  };
}

/**
 * Check structural limits of parsed request bodies
 */
function checkStructureLimits(
  obj: unknown,
  depth: number,
  maxDepth: number,
  maxArray: number,
  maxString: number,
): void {
  if (depth > maxDepth) {
    throw new ValidationError('Request body exceeds maximum nesting depth');
  }

  if (typeof obj === 'string' && obj.length > maxString) {
    throw new ValidationError('String length exceeds maximum allowed');
  }

  if (Array.isArray(obj)) {
    if (obj.length > maxArray) {
      throw new ValidationError('Array size exceeds maximum allowed');
    }
    for (const item of obj) {
      checkStructureLimits(item, depth + 1, maxDepth, maxArray, maxString);
    }
  } else if (obj !== null && typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      checkStructureLimits(record[key], depth + 1, maxDepth, maxArray, maxString);
    }
  }
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

    // Limit structural depth and size of request body
    if (req.body) {
      checkStructureLimits(
        req.body,
        0,
        config.limits.maxObjectDepth,
        config.limits.maxArraySize,
        config.limits.maxStringLength,
      );
    }

    // Sanitize request body
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
      req.body = sanitizeObject(req.body);
    }

    // Also sanitize query params just in case
    if (req.query && typeof req.query === 'object') {
      req.query = sanitizeObject(req.query);
    }

    next();
  };
}

/**
 * Request timeout middleware
 */
export function requestTimeout(): RequestHandler {
  return (req, res, next) => {
    const controller = new AbortController();
    req.abortController = controller;

    const timer = setTimeout(() => {
      controller.abort();
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
    res.on('close', () => {
      clearTimeout(timer);
      controller.abort();
    });

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

    // Permissions-Policy
    if (config.security.permissionsPolicy) {
      res.setHeader('Permissions-Policy', config.security.permissionsPolicy);
    }

    // Header Splitting Protection (intercept setHeader)
    const originalSetHeader = res.setHeader;
    res.setHeader = function (name: string, value: string | number | readonly string[]) {
      if (typeof value === 'string' && /[\r\n]/.test(value)) {
        throw new Error('CRLF injection detected in header value');
      }
      if (Array.isArray(value)) {
        for (const v of value) {
          if (typeof v === 'string' && /[\r\n]/.test(v)) {
            throw new Error('CRLF injection detected in header value array');
          }
        }
      }
      return originalSetHeader.call(this, name, value);
    };

    // X-Content-Type-Options is already set by helmet
    next();
  };
}
