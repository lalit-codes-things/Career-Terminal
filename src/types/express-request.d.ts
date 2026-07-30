import 'express';

declare global {
  namespace Express {
    interface Request {
      abortController?: AbortController;
    }
  }
}

export {};
