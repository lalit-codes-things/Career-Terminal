/**
 * HTTP data source with retry + rate limiting.
 *
 * Providers that source company data from HTTP/API backends (Companies House
 * REST, India MCA data.gov.in, SEC EDGAR) share this client so retry policy
 * and rate limiting are applied uniformly and configured per provider.
 */

import type { RetryPolicy } from '../config/retry-policy';

export interface HttpDataSourceOptions {
  baseUrl: string;
  timeoutMs: number;
  rateLimitPerSec: number;
  headers?: Record<string, string>;
  retry?: Partial<RetryPolicy>;
  maxBodyBytes?: number;
}

export interface HttpDataSourceDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface HttpRequestOptions {
  method?: 'GET' | 'POST';
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Override the number of retries for this request (undefined = use default). */
  retries?: number;
}

export class HttpDataSourceError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(status: number, message: string, retryable = false) {
    super(message);
    this.name = 'HttpDataSourceError';
    this.status = status;
    this.retryable = retryable;
  }
}

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Token-bucket rate limiter with a burst capacity equal to the rate. */
class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly ratePerSec: number,
    private readonly now: () => number,
  ) {
    this.tokens = Math.max(ratePerSec, 1);
    this.lastRefillMs = now();
  }

  async acquire(sleep: (ms: number) => Promise<void>): Promise<void> {
    const elapsedMs = Math.max(this.now() - this.lastRefillMs, 0);
    this.tokens = Math.min(this.ratePerSec, this.tokens + (elapsedMs / 1000) * this.ratePerSec);
    this.lastRefillMs = this.now();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    const waitMs = ((1 - this.tokens) / this.ratePerSec) * 1000;
    await sleep(waitMs);
    this.tokens = 0;
    this.lastRefillMs = this.now();
  }
}

export class HttpDataSource {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly bucket: TokenBucket;

  constructor(
    private readonly options: HttpDataSourceOptions,
    deps: HttpDataSourceDeps = {},
  ) {
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = deps.now ?? (() => Date.now());
    this.bucket = new TokenBucket(Math.max(options.rateLimitPerSec, 1), this.now);
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const base = this.options.baseUrl.replace(/\/+$/, '');
    const withPath = path.startsWith('http') ? path : `${base}/${path.replace(/^\/+/, '')}`;
    if (!query) {
      return withPath;
    }
    const url = new URL(withPath);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  async request(path: string, opts: HttpRequestOptions = {}): Promise<Response> {
    const retries = opts.retries ?? this.options.retry?.maxRetries ?? 3;
    const initialDelayMs = this.options.retry?.initialDelayMs ?? 1000;
    const maxDelayMs = this.options.retry?.maxDelayMs ?? 30000;
    const backoffMultiplier = this.options.retry?.backoffMultiplier ?? 2;
    const url = this.buildUrl(path, opts.query);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      await this.bucket.acquire(this.sleep);

      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: opts.method ?? 'GET',
          headers: {
            'User-Agent': 'CareerTerminal/1.0',
            ...this.options.headers,
            ...opts.headers,
          },
          body: opts.body,
          signal: AbortSignal.timeout(opts.timeoutMs ?? this.options.timeoutMs),
        });
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt >= retries) {
          throw lastError;
        }
        await this.delay(attempt, initialDelayMs, maxDelayMs, backoffMultiplier);
        continue;
      }

      if (response.ok) {
        return response;
      }

      const retryable = RETRYABLE_STATUS_CODES.has(response.status);
      if (retryable && attempt < retries) {
        const retryAfter = response.headers.get('retry-after');
        const waitMs = retryAfter
          ? Math.min(Number(retryAfter) * 1000, maxDelayMs)
          : this.backoffMs(attempt, initialDelayMs, maxDelayMs, backoffMultiplier);
        await this.sleep(waitMs);
        continue;
      }

      throw new HttpDataSourceError(
        response.status,
        `HTTP ${response.status} for GET ${path}`,
        retryable,
      );
    }

    throw lastError ?? new Error(`HttpDataSource: request failed for ${path}`);
  }

  async getJson<T>(path: string, opts: HttpRequestOptions = {}): Promise<T> {
    const response = await this.request(path, opts);
    const body = await response.text();
    return JSON.parse(body) as T;
  }

  async getText(path: string, opts: HttpRequestOptions = {}): Promise<string> {
    const response = await this.request(path, opts);
    return response.text();
  }

  /** Stream a response body (used for Companies House streaming API). */
  async getStream(
    path: string,
    opts: HttpRequestOptions = {},
  ): Promise<ReadableStream<Uint8Array>> {
    const response = await this.request(path, opts);
    if (!response.body) {
      throw new HttpDataSourceError(0, 'Response has no body stream', false);
    }
    return response.body;
  }

  private async delay(
    attempt: number,
    initialDelayMs: number,
    maxDelayMs: number,
    backoffMultiplier: number,
  ): Promise<void> {
    const wait = this.backoffMs(attempt, initialDelayMs, maxDelayMs, backoffMultiplier);
    await this.sleep(wait);
  }

  private backoffMs(
    attempt: number,
    initialDelayMs: number,
    maxDelayMs: number,
    backoffMultiplier: number,
  ): number {
    const delay = initialDelayMs * Math.pow(backoffMultiplier, attempt);
    return Math.min(delay, maxDelayMs);
  }
}
