import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMapGps } from '../useMapGps';

const nullGps = {
  latitude: null,
  longitude: null,
  heading: null,
  headingSmoothed: null,
  course: null,
  accuracy: null,
  speed: null,
};

describe('useMapGps', () => {
  it('returns selfMarkerReady=false when map is null', () => {
    const { result } = renderHook(() =>
      useMapGps({ map: null, mapLoaded: false, selfPosVisible: true, gps: nullGps })
    );
    expect(result.current.selfMarkerReady).toBe(false);
  });

  it('does not throw when gps position is null', () => {
    const { result } = renderHook(() =>
      useMapGps({ map: null, mapLoaded: true, selfPosVisible: true, gps: nullGps })
    );
    expect(result.current).toBeDefined();
  });

  it('returns selfMarkerReady=false when selfPosVisible is false', () => {
    const { result } = renderHook(() =>
      useMapGps({ map: null, mapLoaded: true, selfPosVisible: false, gps: { ...nullGps, latitude: 40.76, longitude: -111.89 } })
    );
    expect(result.current.selfMarkerReady).toBe(false);
  });
});
