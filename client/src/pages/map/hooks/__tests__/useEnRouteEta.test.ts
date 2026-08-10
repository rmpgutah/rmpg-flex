import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useEnRouteEta } from '../useEnRouteEta';
import type { MapUnit, ActiveCall } from '../../utils/mapConstants';

vi.mock('../../../../utils/mapboxRouting', () => ({
  fetchMapboxRoute: vi.fn(),
}));
import { fetchMapboxRoute } from '../../../../utils/mapboxRouting';

const enrouteUnit: MapUnit = {
  id: 'u1', call_sign: 'D190', officer_name: '', status: 'enroute',
  vehicle: '', current_call_id: null, current_call_type: null, current_call_location: null, call_number: 'CFS-1',
  latitude: 40.7, longitude: -111.9,
} as MapUnit;

const availableUnit: MapUnit = {
  ...enrouteUnit, id: 'u2', status: 'available', call_number: null,
} as MapUnit;

const call: ActiveCall = {
  id: 'c1', call_number: 'CFS-1', incident_type: 'welfare_check', priority: 'P1',
  status: 'dispatched', location_address: '123 Main St', latitude: 40.76, longitude: -111.89,
  property_name: null,
} as ActiveCall;

beforeEach(() => {
  vi.mocked(fetchMapboxRoute).mockReset();
});

describe('useEnRouteEta', () => {
  it('fetches a route for an en-route unit matched to its call, and returns eta/distance keyed by call_number', async () => {
    vi.mocked(fetchMapboxRoute).mockResolvedValue({ durationSec: 192, distanceMeters: 2317 } as any);

    const { result } = renderHook(() => useEnRouteEta([enrouteUnit], [call]));

    await waitFor(() => {
      expect(result.current['CFS-1']).toBeDefined();
    });

    expect(result.current['CFS-1'].etaSeconds).toBe(192);
    expect(result.current['CFS-1'].distanceMiles).toBeCloseTo(1.44, 1);
    expect(fetchMapboxRoute).toHaveBeenCalledWith(
      { lng: -111.9, lat: 40.7 },
      { lng: -111.89, lat: 40.76 },
    );
  });

  it('does not fetch a route for a unit that is not en route', async () => {
    renderHook(() => useEnRouteEta([availableUnit], [call]));
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMapboxRoute).not.toHaveBeenCalled();
  });

  it('returns an empty object when no units are en route', () => {
    const { result } = renderHook(() => useEnRouteEta([availableUnit], [call]));
    expect(result.current).toEqual({});
  });

  it('does not refetch on prop-reference churn, only on mount + the 30s interval', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchMapboxRoute).mockResolvedValue({ durationSec: 192, distanceMeters: 2317 } as any);

      const { rerender } = renderHook(
        ({ units, calls }: { units: MapUnit[]; calls: ActiveCall[] }) => useEnRouteEta(units, calls),
        { initialProps: { units: [enrouteUnit], calls: [call] } },
      );

      // Flush the initial mount-time fetch (its internal await needs a microtask tick).
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMapboxRoute).toHaveBeenCalledTimes(1);

      // Re-render several times with brand-new array/object references but
      // identical data — this mirrors every GPS poll in the real app.
      for (let i = 0; i < 5; i++) {
        rerender({ units: [{ ...enrouteUnit }], calls: [{ ...call }] });
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMapboxRoute).toHaveBeenCalledTimes(1);

      // Advancing past the refresh cadence should trigger exactly one more fetch.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetchMapboxRoute).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('isolates a rejected fetch to its own pair, leaving other en-route units unaffected', async () => {
    const call2: ActiveCall = { ...call, id: 'c2', call_number: 'CFS-2', latitude: 40.77, longitude: -111.88 } as ActiveCall;
    const unit2: MapUnit = {
      ...enrouteUnit, id: 'u3', call_sign: 'D191', call_number: 'CFS-2',
      latitude: 40.71, longitude: -111.91,
    } as MapUnit;

    vi.mocked(fetchMapboxRoute).mockImplementation(async (origin: any) => {
      if (origin.lat === enrouteUnit.latitude && origin.lng === enrouteUnit.longitude) {
        throw new Error('network error');
      }
      return { durationSec: 300, distanceMeters: 4000 } as any;
    });

    const { result } = renderHook(() => useEnRouteEta([enrouteUnit, unit2], [call, call2]));

    await waitFor(() => {
      expect(result.current['CFS-2']).toBeDefined();
    });

    expect(result.current['CFS-2'].etaSeconds).toBe(300);
    expect(result.current['CFS-1']).toBeUndefined();
  });
});
