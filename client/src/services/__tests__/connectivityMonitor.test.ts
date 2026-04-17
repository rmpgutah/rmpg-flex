import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrowserConnectivityMonitor } from '../connectivityMonitor';

// ─── Harness ────────────────────────────────────────────────
// Mock navigator.onLine and global fetch so we can drive the monitor
// through scenarios without an actual network.

type FetchMock = ReturnType<typeof vi.fn>;

function setNavigatorOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

function mockFetchReachable(): FetchMock {
  const fn = vi.fn(async () => new Response('{"status":"ok"}', { status: 200 }));
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

function mockFetchUnreachable(): FetchMock {
  const fn = vi.fn(async () => {
    throw new TypeError('Failed to fetch');
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('BrowserConnectivityMonitor', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // Regression test for the "false offline" bug: if navigator.onLine lies
  // and reports `false` while the server is actually reachable, the monitor
  // must still be able to discover we're online by actually hitting /api/health.
  // Before the fix, doHealthCheck short-circuited on !navigator.onLine and
  // never attempted the fetch, trapping the UI in "offline" forever.
  it('recovers to online when navigator.onLine lies false but /api/health succeeds', async () => {
    setNavigatorOnline(false); // navigator says offline (lying)
    const fetchMock = mockFetchReachable(); // but server is actually reachable

    const transitions: boolean[] = [];
    const monitor = new BrowserConnectivityMonitor('http://example.com', {
      pollInterval: 10_000,
      stableCount: 3,
      requestTimeout: 1_000,
    });
    monitor.onChange((isOnline) => transitions.push(isOnline));
    monitor.start();

    // Wait for the initial check kicked off by start()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Let the async chain inside check() resolve
    await new Promise((r) => setTimeout(r, 0));

    // Fix: the first check fast-paths to online when bootstrap state (offline
    // from lying navigator) disagrees with the real health check result.
    expect(monitor.isOnline).toBe(true);
    expect(transitions).toEqual([true]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://example.com/api/health',
      expect.objectContaining({ method: 'GET' }),
    );

    monitor.stop();
  });

  it('transitions online→offline only after stableCount consecutive failures', async () => {
    setNavigatorOnline(true);
    let succeed = true;
    const fetchMock = vi.fn(async () => {
      if (succeed) return new Response('{"status":"ok"}', { status: 200 });
      throw new TypeError('Failed to fetch');
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const transitions: boolean[] = [];
    const monitor = new BrowserConnectivityMonitor('http://example.com', {
      pollInterval: 10_000,
      stableCount: 3,
      requestTimeout: 1_000,
    });
    monitor.onChange((isOnline) => transitions.push(isOnline));
    monitor.start();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(monitor.isOnline).toBe(true);

    // First check passed — fast-path already fired; no transition since state
    // already matched. Flip the fetch to fail.
    transitions.length = 0;
    succeed = false;

    // Three consecutive failures should be required to drop to offline.
    await monitor.checkNow(); // 1st failure — doesn't transition
    await monitor.checkNow(); // 2nd failure — doesn't transition
    // checkNow() only runs doHealthCheck; debounce runs in check(). Drive it
    // through the real check() path manually.
    await (monitor as unknown as { check: () => Promise<void> }).check();
    await (monitor as unknown as { check: () => Promise<void> }).check();
    await (monitor as unknown as { check: () => Promise<void> }).check();

    expect(monitor.isOnline).toBe(false);
    // Only ONE transition should fire — the online→offline one.
    expect(transitions).toEqual([false]);

    monitor.stop();
  });

  it('does not need navigator.onLine to be true for health check to attempt fetch', async () => {
    setNavigatorOnline(false); // lying
    const fetchMock = mockFetchUnreachable(); // server is also unreachable

    const monitor = new BrowserConnectivityMonitor('http://example.com', {
      pollInterval: 10_000,
      stableCount: 3,
      requestTimeout: 1_000,
    });
    monitor.start();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    // Even though navigator.onLine is false, the monitor still performed
    // the fetch. This is the authoritative signal — if the fetch had
    // succeeded (as in the first test), we'd correctly transition online.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(monitor.isOnline).toBe(false); // fetch failed, so offline (correct)

    monitor.stop();
  });
});
