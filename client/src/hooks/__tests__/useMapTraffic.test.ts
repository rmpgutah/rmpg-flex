import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMapTraffic } from '../useMapTraffic';

function makeMap() {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    style: {},
    getLayer: vi.fn().mockReturnValue(null),
    getSource: vi.fn().mockReturnValue(null),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    removeSource: vi.fn(),
    on: vi.fn((event: string, cb: () => void) => {
      (listeners[event] ??= []).push(cb);
    }),
    off: vi.fn((event: string, cb: () => void) => {
      listeners[event] = (listeners[event] || []).filter((fn) => fn !== cb);
    }),
    _fire: (event: string) => {
      (listeners[event] || []).forEach((cb) => cb());
    },
  } as any;
}

describe('useMapTraffic', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adds the traffic source and layers when enabled', () => {
    const map = makeMap();
    const { result } = renderHook(() => useMapTraffic(map, true));
    act(() => result.current.setEnabled(true));

    expect(map.addSource).toHaveBeenCalledWith('rmpg-traffic', expect.objectContaining({
      type: 'vector',
      url: 'mapbox://mapbox.mapbox-traffic-v1',
    }));
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'rmpg-traffic-flow', source: 'rmpg-traffic' }));
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'rmpg-traffic-case', source: 'rmpg-traffic' }));
  });

  it('removes the traffic layers and source when disabled again', () => {
    const map = makeMap();
    const { result } = renderHook(() => useMapTraffic(map, true));
    act(() => result.current.setEnabled(true));

    map.getLayer.mockReturnValue({ id: 'rmpg-traffic-flow' });
    map.getSource.mockReturnValue({ id: 'rmpg-traffic' });
    act(() => result.current.setEnabled(false));

    expect(map.removeLayer).toHaveBeenCalledWith('rmpg-traffic-flow');
    expect(map.removeLayer).toHaveBeenCalledWith('rmpg-traffic-case');
    expect(map.removeSource).toHaveBeenCalledWith('rmpg-traffic');
  });

  it('re-adds the traffic layer after a basemap style reload while enabled', () => {
    const map = makeMap();
    const { result } = renderHook(() => useMapTraffic(map, true));
    act(() => result.current.setEnabled(true));
    expect(map.addSource).toHaveBeenCalledTimes(1);

    map.getSource.mockReturnValue(null); // simulate the style swap wiping the source
    map._fire('style.load');

    expect(map.addSource).toHaveBeenCalledTimes(2);
  });

  it('does not re-add the layer on style reload while disabled', () => {
    const map = makeMap();
    renderHook(() => useMapTraffic(map, true));
    map._fire('style.load');
    expect(map.addSource).not.toHaveBeenCalled();
  });
});
