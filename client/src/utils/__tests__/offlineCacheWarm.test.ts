import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  warmOfflineCache,
  resetWarmThrottle,
  _warmEndpointsForTest,
} from '../offlineCacheWarm';

describe('warmOfflineCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetWarmThrottle();
    localStorage.setItem('rmpg_token', 'test-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('hits same-origin /api paths, not api.rmpgutah.us, and does not send X-Offline-Warm', async () => {
    warmOfflineCache();
    await vi.advanceTimersByTimeAsync(20_000);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.length).toBe(_warmEndpointsForTest().length);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).toMatch(/^\/api\//);
      expect(String(url)).not.toContain('api.rmpgutah.us');
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers['X-Offline-Warm']).toBeUndefined();
      expect(headers.Authorization).toBe('Bearer test-token');
    }
  });

  it('does not fetch while navigator.onLine is false', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    warmOfflineCache();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not fetch without a token', async () => {
    localStorage.removeItem('rmpg_token');
    warmOfflineCache();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stops the remaining warm GETs after the first 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    warmOfflineCache();
    await vi.advanceTimersByTimeAsync(20_000);
    // First request 401s; later timeouts see aborted=true.
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
});
