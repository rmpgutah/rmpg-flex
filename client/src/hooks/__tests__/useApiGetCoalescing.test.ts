// ============================================================
// GET in-flight coalescing (apiFetch)
// ============================================================
// Cold app load fires ~75 requests, and several endpoints are
// requested by more than one independent consumer within the same
// tick (/settings ×4, /user/preferences ×4, /dispatch/units ×2, …
// observed in field DevTools 2026-07-31). Against the 600 req/300 s
// per-user budget in src/middleware/rateLimit.ts, that duplication
// is what turns a few hard reloads into a 429 storm.
//
// These tests pin the coalescing contract. Note what is deliberately
// NOT asserted: there is no time-based cache. Coalescing lasts only
// while a request is genuinely in flight, so no consumer can ever
// read a staler value than it would have without this optimization —
// a hard requirement for live CAD data (unit positions, GPS).
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch } from '../useApi';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A fetch mock that holds every call open until `release()` is called,
 *  so we can observe the genuinely-concurrent window. */
function deferredFetchMock(body: unknown) {
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const mock = vi.fn(async (url: any) => {
    calls.push(String(url));
    await gate;
    return jsonResponse(body);
  });
  return { mock, calls, release: () => release() };
}

describe('apiFetch GET coalescing', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    localStorage.setItem('rmpg_token', 'test-token');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    localStorage.removeItem('rmpg_token');
    vi.restoreAllMocks();
  });

  it('issues ONE network request for concurrent identical GETs', async () => {
    const { mock, calls, release } = deferredFetchMock({ system: { a: '1' } });
    global.fetch = mock as any;

    const a = apiFetch<{ system: Record<string, string> }>('/settings');
    const b = apiFetch<{ system: Record<string, string> }>('/settings');
    const c = apiFetch<{ system: Record<string, string> }>('/settings');
    release();

    const [ra, rb, rc] = await Promise.all([a, b, c]);

    expect(calls.length).toBe(1);
    // Each caller must get its own readable body — a shared Response whose
    // stream one caller already consumed throws "body stream already read".
    expect(ra.system.a).toBe('1');
    expect(rb.system.a).toBe('1');
    expect(rc.system.a).toBe('1');
  });

  it('does NOT cache across time — a GET after the first settles refetches', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ n: 1 })) as any;

    await apiFetch('/dispatch/units');
    await apiFetch('/dispatch/units');

    expect((global.fetch as any).mock.calls.length).toBe(2);
  });

  it('does not coalesce distinct URLs', async () => {
    const { mock, calls, release } = deferredFetchMock({ ok: true });
    global.fetch = mock as any;

    const a = apiFetch('/settings');
    const b = apiFetch('/announcements');
    release();
    await Promise.all([a, b]);

    expect(calls.length).toBe(2);
  });

  it('does not coalesce a GET that carries an AbortSignal', async () => {
    // A caller that aborts on unmount must never poison a sibling consumer
    // that is still mounted and waiting on the same URL.
    const { mock, calls, release } = deferredFetchMock({ ok: true });
    global.fetch = mock as any;

    const ac = new AbortController();
    const a = apiFetch('/notifications/unread-count', { signal: ac.signal });
    const b = apiFetch('/notifications/unread-count');
    release();
    await Promise.all([a, b]);

    expect(calls.length).toBe(2);
  });

  it('does not coalesce mutations to the GET map', async () => {
    const { mock, calls, release } = deferredFetchMock({ ok: true });
    global.fetch = mock as any;

    const a = apiFetch('/dispatch/gps', { method: 'POST', body: '{}' });
    const b = apiFetch('/dispatch/gps');
    release();
    await Promise.all([a, b]);

    expect(calls.length).toBe(2);
  });

  it('does not retry a network error while navigator.onLine is false', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    global.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as any;
    await expect(apiFetch('/dispatch/stats')).rejects.toThrow();
    expect((global.fetch as any).mock.calls.length).toBe(1);
  });
});
