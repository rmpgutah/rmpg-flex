import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// client/public/sw.js is a CLASSIC worker script (no imports/exports), so it can
// be evaluated directly with its globals injected as function parameters. That
// lets us exercise the real fetch handler instead of a copy that could drift.
const SW_SOURCE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'sw.js'),
  'utf-8'
);

const ORIGIN = 'https://rmpgutah.us';

type Listener = (event: unknown) => void;

/**
 * Evaluate sw.js with stubbed `self`, `caches` and `fetch`, and return the
 * registered listeners.
 *
 * `setTimeout` is deliberately NOT injected — the script body resolves it from
 * the ambient global at call time, so vi.useFakeTimers() can control the retry
 * delay. Injecting it would bind the real timer at load time and hang the test.
 */
function loadServiceWorker(fetchMock: ReturnType<typeof vi.fn>, cachedResponse?: Response) {
  const listeners: Record<string, Listener> = {};

  const swSelf = {
    addEventListener: (type: string, fn: Listener) => { listeners[type] = fn; },
    location: { origin: ORIGIN },
    skipWaiting: vi.fn(),
    clients: { matchAll: vi.fn().mockResolvedValue([]), claim: vi.fn().mockResolvedValue(undefined) },
    registration: { update: vi.fn(), unregister: vi.fn(), sync: undefined },
  };

  const cacheEntry = {
    addAll: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  };

  const cachesStub = {
    open: vi.fn().mockResolvedValue(cacheEntry),
    keys: vi.fn().mockResolvedValue([]),
    match: vi.fn().mockResolvedValue(cachedResponse),
    delete: vi.fn().mockResolvedValue(true),
  };

  // eslint-disable-next-line no-new-func
  const factory = new Function('self', 'caches', 'fetch', SW_SOURCE);
  factory(swSelf, cachesStub, fetchMock);

  return { listeners, cachesStub };
}

/** Minimal FetchEvent stand-in that records whether respondWith was called. */
function makeFetchEvent(url: string, init: { mode?: string; method?: string } = {}) {
  const state: { responded?: Promise<Response> } = {};
  return {
    request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'no-cors' },
    respondWith(promise: Promise<Response>) { state.responded = promise; },
    get responded() { return state.responded; },
  };
}

/** Dispatch a fetch event, let the retry timer elapse, and resolve the response. */
async function dispatchAndSettle(listeners: Record<string, Listener>, event: ReturnType<typeof makeFetchEvent>) {
  listeners.fetch(event);
  // Comfortably past RETRY_DELAY_MS so a pending retry fires.
  await vi.advanceTimersByTimeAsync(1000);
  return event.responded;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('service worker fetch handler — transient failure vs. genuine offline', () => {
  it('recovers a page request that fails once then succeeds (worker-replacement window)', async () => {
    // This is the regression under test. When a new SW takes over via
    // skipWaiting() + clients.claim(), in-flight requests from the outgoing
    // worker are cancelled and reject with the same TypeError as a real
    // network loss. Before the retry, that turned every deploy into a
    // synthetic 503 with an EMPTY body for the page the user was loading.
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('<!doctype html>intake', { status: 200 }));

    const { listeners } = loadServiceWorker(fetchMock);
    const response = await dispatchAndSettle(listeners, makeFetchEvent(`${ORIGIN}/serve-intake`));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response?.status).toBe(200);
    expect(await response?.text()).toContain('intake');
  });

  it('still reports 503 Offline when both attempts fail', async () => {
    // The retry must not paper over a device that is genuinely offline.
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const { listeners } = loadServiceWorker(fetchMock);
    const response = await dispatchAndSettle(listeners, makeFetchEvent(`${ORIGIN}/serve-intake`));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response?.status).toBe(503);
    expect(response?.statusText).toBe('Offline');
  });

  it('retries a failed navigation before showing the Connection Lost card', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('<!doctype html>app shell', { status: 200 }));

    const { listeners } = loadServiceWorker(fetchMock);
    const response = await dispatchAndSettle(
      listeners,
      makeFetchEvent(`${ORIGIN}/serve-intake`, { mode: 'navigate' })
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response?.status).toBe(200);
    expect(await response?.text()).not.toContain('Connection Lost');
  });

  it('falls back to the Connection Lost card when a navigation is truly offline', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const { listeners } = loadServiceWorker(fetchMock);
    const response = await dispatchAndSettle(
      listeners,
      makeFetchEvent(`${ORIGIN}/serve-intake`, { mode: 'navigate' })
    );

    expect(response?.status).toBe(503);
    expect(await response?.text()).toContain('Connection Lost');
  });

  it('serves a cached hashed asset without touching the network', async () => {
    // Cache-first assets must not pay the retry cost — or any network cost.
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    const { listeners } = loadServiceWorker(fetchMock, new Response('cached js', { status: 200 }));

    const response = await dispatchAndSettle(
      listeners,
      makeFetchEvent(`${ORIGIN}/assets/index-B9MzRPV4.js`)
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await response?.text()).toBe('cached js');
  });
});

describe('service worker fetch handler — requests it must decline', () => {
  // These document the finding from the 2026-07-26 console-log investigation:
  // the cross-origin FetchEvent rejections seen for static.cloudflareinsights.com
  // and dialer.rmpgutah.us CANNOT originate from this handler, because it never
  // calls respondWith for them. Locking that in prevents a future "helpful"
  // refactor from quietly taking ownership of third-party requests.
  it.each([
    ['cross-origin telemetry', 'https://static.cloudflareinsights.com/beacon.min.js'],
    ['cross-origin dialer iframe', 'https://dialer.rmpgutah.us/dialer'],
  ])('does not respond to %s', async (_label, url) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    const { listeners } = loadServiceWorker(fetchMock);

    const event = makeFetchEvent(url, { mode: 'navigate' });
    listeners.fetch(event);

    expect(event.responded).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not respond to API calls', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    const { listeners } = loadServiceWorker(fetchMock);

    const event = makeFetchEvent(`${ORIGIN}/api/dispatch/calls`);
    listeners.fetch(event);

    expect(event.responded).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('short-circuits blocked Mapbox telemetry with a 204', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    const { listeners } = loadServiceWorker(fetchMock);

    const event = makeFetchEvent('https://events.mapbox.com/events/v2', { method: 'POST' });
    listeners.fetch(event);

    expect(event.responded).toBeDefined();
    expect((await event.responded)?.status).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
