import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMapWeatherRadar } from '../useMapWeatherRadar';

function makeMap() {
  return {
    style: {},
    getLayer: vi.fn().mockReturnValue(null),
    getSource: vi.fn().mockReturnValue(null),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    removeSource: vi.fn(),
    setPaintProperty: vi.fn(),
  } as any;
}

const FRAMES_RESPONSE = {
  host: 'https://tilecache.rainviewer.com',
  radar: {
    past: [
      { time: 1700000000, path: '/v2/radar/1700000000' },
      { time: 1700000600, path: '/v2/radar/1700000600' },
    ],
  },
};

describe('useMapWeatherRadar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(FRAMES_RESPONSE),
    }) as any;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does nothing while disabled — no fetch, no map calls', () => {
    const map = makeMap();
    renderHook(() => useMapWeatherRadar(map, true));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(map.addSource).not.toHaveBeenCalled();
  });

  it('fetches RainViewer frames and adds the latest frame as a raster layer when enabled', async () => {
    const map = makeMap();
    const { result } = renderHook(() => useMapWeatherRadar(map, true));

    await act(async () => {
      result.current.setEnabled(true);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.rainviewer.com/public/weather-maps.json',
      expect.anything(),
    );
    expect(map.addSource).toHaveBeenCalledWith('rmpg-weather-radar', expect.objectContaining({
      type: 'raster',
      tiles: ['https://tilecache.rainviewer.com/v2/radar/1700000600/256/{z}/{x}/{y}/2/1_1.png'],
    }));
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: 'rmpg-weather-radar-layer',
      source: 'rmpg-weather-radar',
    }));
  });

  it('polls again after 5 minutes and swaps in a newer frame', async () => {
    const map = makeMap();
    const { result } = renderHook(() => useMapWeatherRadar(map, true));
    await act(async () => {
      result.current.setEnabled(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(map.addSource).toHaveBeenCalledTimes(1);

    const nextFrames = {
      host: 'https://tilecache.rainviewer.com',
      radar: { past: [...FRAMES_RESPONSE.radar.past, { time: 1700001200, path: '/v2/radar/1700001200' }] },
    };
    (global.fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve(nextFrames) });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(map.addSource).toHaveBeenCalledTimes(2);
    expect(map.addSource).toHaveBeenLastCalledWith('rmpg-weather-radar', expect.objectContaining({
      tiles: ['https://tilecache.rainviewer.com/v2/radar/1700001200/256/{z}/{x}/{y}/2/1_1.png'],
    }));
  });

  it('removes the layer and source when disabled again', async () => {
    const map = makeMap();
    const { result } = renderHook(() => useMapWeatherRadar(map, true));
    await act(async () => {
      result.current.setEnabled(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(map.addLayer).toHaveBeenCalled();

    // Simulate the layer/source now being registered on the map.
    map.getLayer.mockReturnValue({ id: 'rmpg-weather-radar-layer' });
    map.getSource.mockReturnValue({ id: 'rmpg-weather-radar' });

    act(() => result.current.setEnabled(false));

    expect(map.removeLayer).toHaveBeenCalledWith('rmpg-weather-radar-layer');
    expect(map.removeSource).toHaveBeenCalledWith('rmpg-weather-radar');
  });

  it('swallows a fetch failure without throwing and without adding a layer', async () => {
    const map = makeMap();
    (global.fetch as any).mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useMapWeatherRadar(map, true));

    await act(async () => {
      result.current.setEnabled(true);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(map.addSource).not.toHaveBeenCalled();
  });

  it('updates opacity in place without triggering a refetch', async () => {
    const map = makeMap();
    const { result } = renderHook(() => useMapWeatherRadar(map, true));
    await act(async () => {
      result.current.setEnabled(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(map.addSource).toHaveBeenCalledTimes(1);

    // Simulate the layer now being registered on the map (as it would be
    // after the addLayer call above), so the opacity effect's hasLayer
    // guard passes.
    map.getLayer.mockReturnValue({ id: 'rmpg-weather-radar-layer' });

    act(() => result.current.setOpacity(0.9));

    expect(global.fetch).toHaveBeenCalledTimes(1); // no refetch
    expect(map.addSource).toHaveBeenCalledTimes(1); // no re-add
    expect(map.setPaintProperty).toHaveBeenCalledWith('rmpg-weather-radar-layer', 'raster-opacity', 0.9);
  });
});
