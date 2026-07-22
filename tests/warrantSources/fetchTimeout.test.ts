import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithTimeout } from '../../src/utils/warrantSources/fetchTimeout';

describe('fetchWithTimeout', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('resolves normally when fetch settles before the timeout', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 })) as unknown as typeof fetch;
    const res = await fetchWithTimeout('https://example.test/fast', {}, 5000);
    expect(res.status).toBe(200);
  });

  it('aborts and rejects when fetch never settles (the 2026-07-22 hang signature)', async () => {
    // A fetch() that never resolves/rejects on its own — exactly the failure
    // mode that silently stalled the cron-driven full-list scan for 2+ weeks
    // with zero errors ever logged. Without an AbortController, `await
    // fetch(...)` here would hang this test (and the real cron invocation)
    // forever; fetchWithTimeout must abort it within the given timeout.
    global.fetch = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })) as unknown as typeof fetch;

    await expect(fetchWithTimeout('https://example.test/hangs-forever', {}, 25)).rejects.toThrow();
  });

  it('passes the abort signal through so fetch receives it', async () => {
    let receivedSignal: AbortSignal | undefined;
    global.fetch = vi.fn((_url: string, init?: RequestInit) => {
      receivedSignal = init?.signal ?? undefined;
      return Promise.resolve(new Response('ok', { status: 200 }));
    }) as unknown as typeof fetch;

    await fetchWithTimeout('https://example.test/fast', {}, 5000);
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });
});
