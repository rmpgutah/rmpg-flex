import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the shared API layer so the hook never hits the network.
const apiFetchMock = vi.fn();
vi.mock('../useApi', () => ({
  apiFetch: (...args: any[]) => apiFetchMock(...args),
}));

import { useSpeedLimit, parseMaxspeedMph } from '../useSpeedLimit';

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe('parseMaxspeedMph', () => {
  it('parses numeric, mph and km/h forms; null otherwise', () => {
    expect(parseMaxspeedMph(35)).toBe(35);
    expect(parseMaxspeedMph('45 mph')).toBe(45);
    expect(parseMaxspeedMph('50 km/h')).toBe(31);
    expect(parseMaxspeedMph('none')).toBe(null);
    expect(parseMaxspeedMph(undefined)).toBe(null);
  });
});

describe('useSpeedLimit', () => {
  it('degrades to null when the endpoint has no maxspeed field', async () => {
    apiFetchMock.mockResolvedValue({ features: [{ properties: {} }] });
    const { result } = renderHook(() => useSpeedLimit({ lat: 40.76, lng: -111.89 }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    expect(result.current.limitMph).toBe(null);
  });

  it('does NOT re-query when movement is under the ~80m threshold', async () => {
    apiFetchMock.mockResolvedValue({ maxspeed: '40 mph' });
    const { result, rerender } = renderHook((p: { lat: number; lng: number }) => useSpeedLimit(p), {
      initialProps: { lat: 40.76, lng: -111.89 },
    });
    await waitFor(() => expect(result.current.limitMph).toBe(40));
    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    // ~1m away — under the 80m gate → no new query, value retained.
    rerender({ lat: 40.760009, lng: -111.89 });
    await Promise.resolve();
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.limitMph).toBe(40);
  });
});
