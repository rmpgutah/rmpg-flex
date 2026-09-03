import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useRadar360 } from '../useRadar360';

// ── Mock apiFetch ────────────────────────────────────────
vi.mock('../useApi', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '../useApi';
const mockApiFetch = vi.mocked(apiFetch);

const MOCK_RESULT = {
  contacts: [
    {
      kind: 'call' as const,
      id: 1,
      label: 'CFS-2026-001',
      sublabel: 'Disturbance',
      flags: [],
      bearing: 45,
      distanceMi: 0.3,
      lat: 40.77,
      lng: -111.89,
      priority: 'P2',
      status: 'dispatched',
    },
    {
      kind: 'person' as const,
      id: 5,
      label: 'John Doe',
      flags: ['WARRANT', 'OFFICER SAFETY'],
      bearing: 270,
      distanceMi: 0.12,
      lat: 40.76,
      lng: -111.90,
    },
  ],
  radiusMi: 1,
  centerLat: 40.76,
  centerLng: -111.89,
  scannedAt: '2026-08-20T14:00:00.000Z',
};

describe('useRadar360', () => {
  beforeEach(() => {
    mockApiFetch.mockResolvedValue(MOCK_RESULT);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('does not scan when lat/lng is null', async () => {
    renderHook(() => useRadar360({ lat: null, lng: null }));
    await act(async () => {});
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('scans on mount when lat/lng are provided', async () => {
    const { result } = renderHook(() => useRadar360({ lat: 40.76, lng: -111.89 }));
    await act(async () => {});
    expect(mockApiFetch).toHaveBeenCalledOnce();
    expect(result.current.contacts).toHaveLength(2);
    expect(result.current.error).toBe(false);
    expect(result.current.scannedAt).toBeInstanceOf(Date);
  });

  it('all kinds visible by default', async () => {
    const { result } = renderHook(() => useRadar360({ lat: 40.76, lng: -111.89 }));
    await act(async () => {});
    expect(result.current.visibleKinds.size).toBe(5);
    expect(result.current.filtered).toHaveLength(2);
  });

  it('toggleKind filters the filtered list', async () => {
    const { result } = renderHook(() => useRadar360({ lat: 40.76, lng: -111.89 }));
    await act(async () => {});
    act(() => { result.current.toggleKind('call'); });
    // call hidden → only person remains
    expect(result.current.filtered).toHaveLength(1);
    expect(result.current.filtered[0].kind).toBe('person');
    act(() => { result.current.toggleKind('call'); });
    expect(result.current.filtered).toHaveLength(2);
  });

  it('flaggedOnly filter shows only flagged contacts', async () => {
    const { result } = renderHook(() => useRadar360({ lat: 40.76, lng: -111.89 }));
    await act(async () => {});
    act(() => { result.current.setFlaggedOnly(true); });
    // Only the person has flags
    expect(result.current.filtered).toHaveLength(1);
    expect(result.current.filtered[0].kind).toBe('person');
  });

  it('setRadiusMi updates radiusMi and re-scans', async () => {
    const { result } = renderHook(() => useRadar360({ lat: 40.76, lng: -111.89 }));
    await act(async () => {});
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    act(() => { result.current.setRadiusMi(3); });
    await act(async () => {});
    expect(result.current.radiusMi).toBe(3);
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
  });

  it('sets error=true on fetch failure', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('network error'));
    const { result } = renderHook(() => useRadar360({ lat: 40.76, lng: -111.89 }));
    await act(async () => {});
    expect(result.current.error).toBe(true);
    expect(result.current.contacts).toHaveLength(0);
  });

  it('auto-refreshes on interval', async () => {
    renderHook(() => useRadar360({ lat: 40.76, lng: -111.89, refreshMs: 5000 }));
    await act(async () => {});
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
  });
});
