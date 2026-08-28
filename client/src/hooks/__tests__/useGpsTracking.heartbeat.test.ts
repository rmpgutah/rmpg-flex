import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the API layer — the hook fetches the assigned unit on mount and
// batch-sends points; neither should hit the network in this test.
vi.mock('../useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue(null),
}));

import { useGpsTracking, _resetGpsStaleWarnForTest } from '../useGpsTracking';

// Flush the permissions.query().then() microtask chain that auto-starts tracking.
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useGpsTracking — stale-watch backoff (desktop console loop)', () => {
  let watchPositionCalls = 0;
  let lastSuccessCb: PositionCallback | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    watchPositionCalls = 0;
    lastSuccessCb = null;

    Object.defineProperty(navigator, 'geolocation', {
      writable: true,
      configurable: true,
      value: {
        watchPosition: vi.fn((ok: PositionCallback) => {
          watchPositionCalls++;
          lastSuccessCb = ok;
          return watchPositionCalls; // unique watch id
        }),
        clearWatch: vi.fn(),
        getCurrentPosition: vi.fn(),
      },
    });

    // Permissions API resolves 'granted' so the hook auto-starts without a gesture.
    Object.defineProperty(navigator, 'permissions', {
      writable: true,
      configurable: true,
      value: { query: vi.fn().mockResolvedValue({ state: 'granted' }) },
    });
    _resetGpsStaleWarnForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('backs off restarts when watchPosition never delivers a callback', async () => {
    const { unmount } = renderHook(() => useGpsTracking());
    await flushMicrotasks();

    // Tracking should have started exactly once so far.
    expect(watchPositionCalls).toBeGreaterThanOrEqual(1);

    // Simulate 20 minutes of a DEAD watch (no success callback ever fires).
    await act(async () => {
      vi.advanceTimersByTime(20 * 60 * 1000);
    });

    // A naive every-30s restart loop would call watchPosition ~40 times.
    // With backoff after MAX_HEARTBEAT_RESTARTS, the cadence stretches out and
    // total restarts stay well under that.
    expect(watchPositionCalls).toBeLessThanOrEqual(20);

    unmount();
  });

  it('resets to fast cadence after a successful fix arrives', async () => {
    const { unmount } = renderHook(() => useGpsTracking());
    await flushMicrotasks();

    // Drive into backoff.
    await act(async () => {
      vi.advanceTimersByTime(20 * 60 * 1000);
    });
    const callsAfterBackoff = watchPositionCalls;

    // A real position callback arrives → counter resets → cadence returns to base.
    await act(async () => {
      lastSuccessCb!({
        coords: {
          latitude: 40.69, longitude: -111.88, accuracy: 8,
          heading: null, speed: null, altitude: null,
          altitudeAccuracy: null,
        },
        timestamp: Date.now(),
      } as unknown as GeolocationPosition);
    });

    // After recovery, the next stale period should restart promptly again
    // (base cadence ~30s), proving the backoff collapsed.
    await act(async () => {
      vi.advanceTimersByTime(35 * 1000);
    });

    expect(watchPositionCalls).toBeGreaterThan(callsAfterBackoff);
    unmount();
  });
});
