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
    apiFetch.mockResolvedValueOnce({ limitMph: 35 });
    const { result, rerender } = renderHook(
      ({ lat, lng }: { lat: number; lng: number }) => useSpeedLimit(lat, lng),
      { initialProps: { lat: 40.76, lng: -111.89 } },
    );
    await waitFor(() => expect(result.current.limitMph).toBe(35));

    apiFetch.mockResolvedValueOnce({ limitMph: null });
    rerender({ lat: 41.0, lng: -112.5 }); // far enough to beat the move threshold
    await waitFor(() => expect(result.current.limitMph).toBeNull());
  });

  it('keeps the last known limit when the lookup THROWS', async () => {
    apiFetch.mockResolvedValueOnce({ limitMph: 35 });
    const { result, rerender } = renderHook(
      ({ lat, lng }: { lat: number; lng: number }) => useSpeedLimit(lat, lng),
      { initialProps: { lat: 40.76, lng: -111.89 } },
    );
    await waitFor(() => expect(result.current.limitMph).toBe(35));

    apiFetch.mockRejectedValueOnce(new Error('offline'));
    rerender({ lat: 41.0, lng: -112.5 });
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.limitMph).toBe(35);
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
