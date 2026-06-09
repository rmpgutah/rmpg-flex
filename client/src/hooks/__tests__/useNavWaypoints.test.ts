import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useNavWaypoints } from '../useNavWaypoints';

describe('useNavWaypoints', () => {
  it('adds in order and derives [lng,lat] coords', () => {
    const { result } = renderHook(() => useNavWaypoints());
    act(() => { result.current.addWaypoint({ label: 'A', lat: 1, lng: 10 }); });
    act(() => { result.current.addWaypoint({ label: 'B', lat: 2, lng: 20 }); });
    expect(result.current.waypoints.map((w) => w.label)).toEqual(['A', 'B']);
    expect(result.current.coords).toEqual([[10, 1], [20, 2]]);
  });

  it('removes by id', () => {
    const { result } = renderHook(() => useNavWaypoints());
    let idB = '';
    act(() => { result.current.addWaypoint({ label: 'A', lat: 1, lng: 1 }); });
    act(() => { idB = result.current.addWaypoint({ label: 'B', lat: 2, lng: 2 }); });
    act(() => { result.current.removeWaypoint(idB); });
    expect(result.current.waypoints.map((w) => w.label)).toEqual(['A']);
  });

  it('reorders from->to and ignores out-of-range', () => {
    const { result } = renderHook(() =>
      useNavWaypoints([
        { id: 'a', label: 'A', lat: 0, lng: 0 },
        { id: 'b', label: 'B', lat: 0, lng: 0 },
        { id: 'c', label: 'C', lat: 0, lng: 0 },
      ]),
    );
    act(() => { result.current.reorder(0, 2); });
    expect(result.current.waypoints.map((w) => w.label)).toEqual(['B', 'C', 'A']);
    act(() => { result.current.reorder(5, 0); }); // no-op
    expect(result.current.waypoints.map((w) => w.label)).toEqual(['B', 'C', 'A']);
  });

  it('clears all', () => {
    const { result } = renderHook(() => useNavWaypoints());
    act(() => { result.current.addWaypoint({ label: 'A', lat: 1, lng: 1 }); });
    act(() => { result.current.clearWaypoints(); });
    expect(result.current.waypoints).toEqual([]);
  });
});
