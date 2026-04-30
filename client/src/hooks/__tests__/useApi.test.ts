import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithTimeout, TimeoutError, DEFAULT_FETCH_TIMEOUT_MS } from '../useApi';

describe('fetchWithTimeout', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('exports a sane default timeout', () => {
    expect(DEFAULT_FETCH_TIMEOUT_MS).toBe(60_000);
  });

  it('throws TimeoutError when the request exceeds timeoutMs', async () => {
    // fetch that respects abort signal but otherwise never resolves
    global.fetch = vi.fn((_url: any, init?: any) => {
      return new Promise((_resolve, reject) => {
        const signal: AbortSignal | undefined = init?.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new DOMException('Aborted', 'AbortError');
            reject(err);
          });
        }
        // never resolves
      });
    }) as any;

    const start = Date.now();
    await expect(
      fetchWithTimeout('https://example.test/slow', { timeoutMs: 50 }),
    ).rejects.toBeInstanceOf(TimeoutError);
    const elapsed = Date.now() - start;
    // sanity: aborted reasonably quickly (allow generous slack for CI)
    expect(elapsed).toBeLessThan(2000);
  });

  it('TimeoutError carries the timeoutMs and url', async () => {
    global.fetch = vi.fn((_url: any, init?: any) => {
      return new Promise((_resolve, reject) => {
        const signal: AbortSignal | undefined = init?.signal;
        if (signal) {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }
      });
    }) as any;

    try {
      await fetchWithTimeout('https://example.test/x', { timeoutMs: 25 });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TimeoutError);
      const te = err as TimeoutError;
      expect(te.timeoutMs).toBe(25);
      expect(te.url).toBe('https://example.test/x');
      expect(te.name).toBe('TimeoutError');
    }
  });

  it('returns the response normally when fetch resolves before timeout', async () => {
    global.fetch = vi.fn(async () => new Response('ok', { status: 200 })) as any;
    const res = await fetchWithTimeout('https://example.test/fast', { timeoutMs: 1000 });
    expect(res.status).toBe(200);
  });

  it('propagates external AbortError without converting it to TimeoutError', async () => {
    global.fetch = vi.fn((_url: any, init?: any) => {
      return new Promise((_resolve, reject) => {
        const signal: AbortSignal | undefined = init?.signal;
        if (signal) {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }
      });
    }) as any;

    const ctrl = new AbortController();
    const promise = fetchWithTimeout('https://example.test/x', {
      signal: ctrl.signal,
      timeoutMs: 10_000,
    });
    setTimeout(() => ctrl.abort(), 25);
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});
