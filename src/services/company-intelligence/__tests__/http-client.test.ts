import { HttpDataSource, HttpDataSourceError } from '../storage/http-client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('HttpDataSource', () => {
  it('returns JSON on success', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const http = new HttpDataSource(
      { baseUrl: 'https://api.example.com', timeoutMs: 1000, rateLimitPerSec: 1000 },
      { fetchImpl, sleep: async () => {} },
    );

    const result = await http.getJson<{ ok: boolean }>('/v1/thing');
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toBe('https://api.example.com/v1/thing');
  });

  it('retries transient HTTP errors with backoff', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(200, { retried: true }));
    const http = new HttpDataSource(
      {
        baseUrl: 'https://api.example.com',
        timeoutMs: 1000,
        rateLimitPerSec: 1000,
        retry: { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 5, backoffMultiplier: 2, jitter: false },
      },
      { fetchImpl, sleep: async () => {} },
    );

    const result = await http.getJson<{ retried: boolean }>('/v1/thing');
    expect(result).toEqual({ retried: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('respects retry-after headers', async () => {
    const fetchImpl = jest.fn().mockImplementation(() =>
      Promise.resolve(
        new Response('{}', { status: 429, headers: { 'retry-after': '0' } }),
      ),
    );
    const http = new HttpDataSource(
      {
        baseUrl: 'https://api.example.com',
        timeoutMs: 1000,
        rateLimitPerSec: 1000,
        retry: { maxRetries: 1, initialDelayMs: 1, maxDelayMs: 5, backoffMultiplier: 2, jitter: false },
      },
      { fetchImpl, sleep: async () => {} },
    );

    await expect(http.getJson('/v1/thing')).rejects.toBeInstanceOf(HttpDataSourceError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('throws HttpDataSourceError on permanent errors without retrying', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(404, {}));
    const http = new HttpDataSource(
      { baseUrl: 'https://api.example.com', timeoutMs: 1000, rateLimitPerSec: 1000 },
      { fetchImpl, sleep: async () => {} },
    );

    await expect(http.getJson('/v1/thing')).rejects.toMatchObject({
      status: 404,
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rate limits requests per second', async () => {
    const fetchImpl = jest
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(200, {})));
    const sleeps: number[] = [];
    const http = new HttpDataSource(
      { baseUrl: 'https://api.example.com', timeoutMs: 1000, rateLimitPerSec: 2 },
      { fetchImpl, sleep: async (ms) => { sleeps.push(ms); } },
    );

    await http.getJson('/a');
    await http.getJson('/b');
    await http.getJson('/c');

    // Burst capacity (2) covers the first two calls; the third waits.
    expect(sleeps.length).toBeGreaterThan(0);
  });
});
