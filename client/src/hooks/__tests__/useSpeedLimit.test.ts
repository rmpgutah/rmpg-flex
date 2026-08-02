import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../useApi', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { useSpeedLimit, shouldFireOverSpeedAlert, OVER_SPEED_COOLDOWN_MS } from '../useSpeedLimit';

beforeEach(() => { apiFetch.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('useSpeedLimit', () => {
  it('starts with no known limit', () => {
    apiFetch.mockResolvedValue({ limitMph: null });
    const { result } = renderHook(() => useSpeedLimit(40.76, -111.89));
    expect(result.current.limitMph).toBeNull();
  });

  it('exposes the posted limit from the road-speed endpoint', async () => {
    apiFetch.mockResolvedValue({ limitMph: 35, roadName: 'S Main St' });
    const { result } = renderHook(() => useSpeedLimit(40.76, -111.89));
    await waitFor(() => expect(result.current.limitMph).toBe(35));
  });

  it('queries the road-speed endpoint, NOT overpass', async () => {
    apiFetch.mockResolvedValue({ limitMph: 35 });
    renderHook(() => useSpeedLimit(40.76, -111.89));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const url = String(apiFetch.mock.calls[0][0]);
    expect(url).toContain('/dispatch/geography/road-speed');
    expect(url).not.toContain('overpass');
  });

  it('clears the limit when a SUCCESSFUL lookup reports none', async () => {
    // Driving from a posted road onto an unposted one must clear the badge --
    // keeping the old value would red-line the HUD against the wrong road.
    // Advance the wall clock past the 4s interval gate (via Date.now spy,
    // not a real wait) so the second render's query isn't throttled.
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    apiFetch.mockResolvedValueOnce({ limitMph: 35 });
    const { result, rerender } = renderHook(
      ({ lat, lng }: { lat: number; lng: number }) => useSpeedLimit(lat, lng),
      { initialProps: { lat: 40.76, lng: -111.89 } },
    );
    await waitFor(() => expect(result.current.limitMph).toBe(35));

    dateSpy.mockReturnValue(1_000_000 + 5000); // >4s later
    apiFetch.mockResolvedValueOnce({ limitMph: null });
    rerender({ lat: 41.0, lng: -112.5 }); // far enough to beat the move threshold
    await waitFor(() => expect(result.current.limitMph).toBeNull());
    dateSpy.mockRestore();
  });

  it('keeps the last known limit when the lookup THROWS', async () => {
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    apiFetch.mockResolvedValueOnce({ limitMph: 35 });
    const { result, rerender } = renderHook(
      ({ lat, lng }: { lat: number; lng: number }) => useSpeedLimit(lat, lng),
      { initialProps: { lat: 40.76, lng: -111.89 } },
    );
    await waitFor(() => expect(result.current.limitMph).toBe(35));

    dateSpy.mockReturnValue(1_000_000 + 5000); // >4s later
    apiFetch.mockRejectedValueOnce(new Error('offline'));
    rerender({ lat: 41.0, lng: -112.5 });
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.limitMph).toBe(35);
    dateSpy.mockRestore();
  });

  it('does not re-query within the 4s interval gate even past the move threshold', async () => {
    // Two renders far enough apart to pass the distance gate, but with the
    // clock advanced LESS than 4s, must produce only one apiFetch call --
    // this is the GPS-jitter / tunnel-reacquisition guard.
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(2_000_000);
    apiFetch.mockResolvedValueOnce({ limitMph: 35 });
    const { rerender } = renderHook(
      ({ lat, lng }: { lat: number; lng: number }) => useSpeedLimit(lat, lng),
      { initialProps: { lat: 40.76, lng: -111.89 } },
    );
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));

    dateSpy.mockReturnValue(2_000_000 + 3999); // <4s later
    rerender({ lat: 41.0, lng: -112.5 }); // well past the 80m distance gate
    await new Promise((r) => setTimeout(r, 10));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    dateSpy.mockRestore();
  });

  it('does NOT discard an in-flight lookup when a small GPS tick arrives before it resolves', async () => {
    // Regression test: the server lookup can take a while (up to 9 sequential
    // R2 range reads), and GPS ticks arrive ~1Hz. A small tick (a few metres --
    // NOT past the 80m move gate) must not abandon the pending request. The
    // old effect-scoped `let cancelled = true` cleanup fired on every re-render
    // (including ones that don't pass the move gate), permanently discarding
    // the result once it landed.
    let resolveFetch!: (v: { limitMph: number | null; roadName?: string | null }) => void;
    apiFetch.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    );
    const { result, rerender } = renderHook(
      ({ lat, lng }: { lat: number; lng: number }) => useSpeedLimit(lat, lng),
      { initialProps: { lat: 40.76, lng: -111.89 } },
    );
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));

    // A few metres of drift -- well under the 80m MOVE_THRESHOLD_M, so this is
    // just an ordinary GPS tick re-rendering the hook while the request is
    // still pending.
    rerender({ lat: 40.76001, lng: -111.89 });

    resolveFetch({ limitMph: 35, roadName: 'S Main St' });
    await waitFor(() => expect(result.current.limitMph).toBe(35));
  });

  it('does not query when disabled', async () => {
    renderHook(() => useSpeedLimit(40.76, -111.89, { enabled: false }));
    await new Promise((r) => setTimeout(r, 10));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('does not query for a null fix', async () => {
    renderHook(() => useSpeedLimit(null, null));
    await new Promise((r) => setTimeout(r, 10));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('exposes a redline buffer', () => {
    apiFetch.mockResolvedValue({ limitMph: null });
    const { result } = renderHook(() => useSpeedLimit(40.76, -111.89));
    expect(result.current.buffer).toBe(7);
  });
});

describe('shouldFireOverSpeedAlert', () => {
  it('does not fire without a known limit', () => {
    expect(shouldFireOverSpeedAlert(80, null, 10, null, 1000)).toBe(false);
  });
  it('does not fire below limit + threshold', () => {
    expect(shouldFireOverSpeedAlert(40, 35, 10, null, 1000)).toBe(false);
  });
  it('fires at or above limit + threshold', () => {
    expect(shouldFireOverSpeedAlert(45, 35, 10, null, 1000)).toBe(true);
  });
  it('respects the cooldown', () => {
    expect(shouldFireOverSpeedAlert(45, 35, 10, 1000, 1000 + OVER_SPEED_COOLDOWN_MS - 1)).toBe(false);
    expect(shouldFireOverSpeedAlert(45, 35, 10, 1000, 1000 + OVER_SPEED_COOLDOWN_MS)).toBe(true);
  });
});
