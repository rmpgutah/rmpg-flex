import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the API layer — the hook fetches the assigned unit on mount and
// batch/immediate-sends points; none of that should hit the network here.
vi.mock('../useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue(null),
}));

import { useGpsTracking } from '../useGpsTracking';

// Flush the permissions.query().then() microtask chain that auto-starts tracking.
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function fix(lat: number, lng: number, accuracy = 8): GeolocationPosition {
  return {
    coords: {
      latitude: lat, longitude: lng, accuracy,
      heading: null, speed: null, altitude: null, altitudeAccuracy: null,
    },
    timestamp: Date.now(),
  } as unknown as GeolocationPosition;
}

// Regression guard for the "Track 0 pts" bug: the browser navigator.geolocation
// watchPosition path used to push accepted fixes onto the upload queue but NEVER
// onto the exportable capture track (only the Toughbook internal-GPS path did),
// so capturedCount — the HUD's "Track N pts" + the CSV/GeoJSON export — stayed 0
// on every cellular/WiFi device even with perfectly healthy GPS.
describe('useGpsTracking — browser path captures the exportable session track', () => {
  let lastSuccessCb: PositionCallback | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    lastSuccessCb = null;

    Object.defineProperty(navigator, 'geolocation', {
      writable: true,
      configurable: true,
      value: {
        watchPosition: vi.fn((ok: PositionCallback) => { lastSuccessCb = ok; return 1; }),
        clearWatch: vi.fn(),
        getCurrentPosition: vi.fn(),
      },
    });
    Object.defineProperty(navigator, 'permissions', {
      writable: true,
      configurable: true,
      value: { query: vi.fn().mockResolvedValue({ state: 'granted' }) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('increments capturedCount on accepted browser fixes when capture is enabled', async () => {
    const { result, unmount } = renderHook(() => useGpsTracking({ capture: true }));
    await flushMicrotasks();

    expect(result.current.capturedCount).toBe(0);

    // First good fix — no prior point, well within the accuracy gate → accepted.
    await act(async () => { lastSuccessCb!(fix(40.6900, -111.8800)); });
    expect(result.current.capturedCount).toBe(1);

    // Second fix ~22m away (> the 3m stationary-jitter floor) → accepted, captured.
    await act(async () => { lastSuccessCb!(fix(40.6902, -111.8800)); });
    expect(result.current.capturedCount).toBe(2);

    unmount();
  });

  it('does NOT capture when capture is disabled (default consumer)', async () => {
    const { result, unmount } = renderHook(() => useGpsTracking());
    await flushMicrotasks();

    await act(async () => { lastSuccessCb!(fix(40.6900, -111.8800)); });
    await act(async () => { lastSuccessCb!(fix(40.6902, -111.8800)); });

    // Position still flows to the UI, but the opt-in export track stays empty.
    expect(result.current.latitude).toBeCloseTo(40.6902, 4);
    expect(result.current.capturedCount).toBe(0);

    unmount();
  });
});
