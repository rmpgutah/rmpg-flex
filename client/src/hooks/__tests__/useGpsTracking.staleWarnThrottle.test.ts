// ============================================================
// useGpsTracking — staleness WARNING volume under intermittent GPS
// ============================================================
// The staleness log was gated on heartbeatRestartCountRef reaching
// MAX_HEARTBEAT_RESTARTS. But a successful fix RESETS that counter to 0, so
// under intermittent GPS -- fix, ~31s of silence, fix, ~31s of silence, which
// is the normal vehicle case -- the counter never reached the cap and every
// staleness event logged at warn level forever.
//
// The throttle was defeated by exactly the condition it existed to handle:
// a totally dead GPS goes quiet after 5 events, while FLAKY GPS warns
// indefinitely. Measured live: 120 identical
// "[GPS] No position callback in 31s" warnings in one session, on a CAD console
// that stays open all shift, burying real errors.
//
// These tests drive the intermittent cycle and count real console.warn calls.
// Restart/retry behaviour is NOT asserted here beyond "still happening" -- it
// is deliberately unchanged (useGpsTracking.heartbeat.test.ts owns that), and
// a vehicle CAD must keep trying to reacquire.
// ============================================================

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../useApi', () => ({ apiFetch: vi.fn().mockResolvedValue(null) }));

import { useGpsTracking } from '../useGpsTracking';

async function flushMicrotasks() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function fix(): GeolocationPosition {
  return {
    coords: {
      latitude: 40.69, longitude: -111.88, accuracy: 8,
      heading: null, speed: null, altitude: null, altitudeAccuracy: null,
    },
    timestamp: Date.now(),
  } as unknown as GeolocationPosition;
}

const staleWarns = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('No position callback')).length;

describe('useGpsTracking — stale-warning throttle under intermittent GPS', () => {
  let lastSuccessCb: PositionCallback | null = null;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    lastSuccessCb = null;
    let watchId = 0;

    Object.defineProperty(navigator, 'geolocation', {
      writable: true, configurable: true,
      value: {
        watchPosition: vi.fn((ok: PositionCallback) => { lastSuccessCb = ok; return ++watchId; }),
        clearWatch: vi.fn(),
        getCurrentPosition: vi.fn(),
      },
    });
    Object.defineProperty(navigator, 'permissions', {
      writable: true, configurable: true,
      value: { query: vi.fn().mockResolvedValue({ state: 'granted' }) },
    });

    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not warn on every cycle when a fix keeps resetting the restart counter', async () => {
    const { unmount } = renderHook(() => useGpsTracking());
    await flushMicrotasks();

    // 30 minutes of the pathological pattern: a real fix, then a stale gap.
    // Pre-fix this produced a warn on EVERY iteration, because each fix reset
    // heartbeatRestartCountRef to 0 before it could reach the cap.
    for (let i = 0; i < 30; i++) {
      await act(async () => { lastSuccessCb?.(fix()); });
      await act(async () => { vi.advanceTimersByTime(60 * 1000); });
    }

    // 30 minutes at a 5-minute warn interval => at most ~7 warnings.
    // The old behaviour would emit roughly one per cycle.
    expect(staleWarns(warnSpy)).toBeLessThanOrEqual(8);
    unmount();
  });

  it('still reports every staleness event — at debug level', async () => {
    const { unmount } = renderHook(() => useGpsTracking());
    await flushMicrotasks();

    for (let i = 0; i < 12; i++) {
      await act(async () => { lastSuccessCb?.(fix()); });
      await act(async () => { vi.advanceTimersByTime(60 * 1000); });
    }

    // Suppression must mean "quieter", never "invisible" — the diagnostic is
    // still there for anyone reading debug output.
    expect(staleWarns(warnSpy) + staleWarns(debugSpy)).toBeGreaterThan(staleWarns(warnSpy));
    unmount();
  });

  it('warns promptly the FIRST time, so a real outage is not hidden', async () => {
    const { unmount } = renderHook(() => useGpsTracking());
    await flushMicrotasks();

    await act(async () => { lastSuccessCb?.(fix()); });
    await act(async () => { vi.advanceTimersByTime(60 * 1000); });

    expect(staleWarns(warnSpy)).toBeGreaterThanOrEqual(1);
    unmount();
  });
});
