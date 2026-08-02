import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMapWeatherRadar } from '../useMapWeatherRadar';

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
    setPaintProperty: vi.fn(),
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

  it('re-adds the current frame after a basemap style reload without re-fetching', async () => {
    const map = makeMap();
    const { result } = renderHook(() => useMapWeatherRadar(map, true));
    await act(async () => {
      result.current.setEnabled(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(map.addSource).toHaveBeenCalledTimes(1);

    map.getSource.mockReturnValue(null); // simulate the style swap wiping the source
    map._fire('style.load');

    expect(global.fetch).toHaveBeenCalledTimes(1); // reused the cached frame, no refetch
    expect(map.addSource).toHaveBeenCalledTimes(2); // re-added after the style reload
  });

  it('does not re-add anything on style reload while disabled', () => {
    const map = makeMap();
    renderHook(() => useMapWeatherRadar(map, true));
    map._fire('style.load');
    expect(map.addSource).not.toHaveBeenCalled();
  });

  describe('timeline playback', () => {
    const WITH_NOWCAST = {
      host: 'https://tilecache.rainviewer.com',
      radar: {
        past: [
          { time: 1700000000, path: '/v2/radar/1700000000' },
          { time: 1700000600, path: '/v2/radar/1700000600' },
        ],
        nowcast: [{ time: 1700001200, path: '/v2/radar/nowcast/1700001200' }],
      },
    };

    async function enabledWithNowcast() {
      (global.fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve(WITH_NOWCAST) });
      const map = makeMap();
      const hook = renderHook(() => useMapWeatherRadar(map, true));
      await act(async () => {
        hook.result.current.setEnabled(true);
        await vi.advanceTimersByTimeAsync(0);
      });
      return { map, ...hook };
    }

    it('exposes past and nowcast frames but renders the newest OBSERVED frame', async () => {
      const { map, result } = await enabledWithNowcast();

      expect(result.current.frames).toHaveLength(3);
      expect(result.current.frames[2].kind).toBe('nowcast');
      // A forecast frame must never be what the map shows by default —
      // an operator would read it as an observation.
      expect(result.current.frameIndex).toBe(1);
      expect(result.current.activeFrame?.kind).toBe('past');
      expect(result.current.live).toBe(true);
      expect(map.addSource).toHaveBeenLastCalledWith('rmpg-weather-radar', expect.objectContaining({
        tiles: ['https://tilecache.rainviewer.com/v2/radar/1700000600/256/{z}/{x}/{y}/2/1_1.png'],
      }));
    });

    it('scrubbing renders that frame without refetching, and clears live', async () => {
      const { map, result } = await enabledWithNowcast();
      expect(global.fetch).toHaveBeenCalledTimes(1);

      await act(async () => { result.current.setFrameIndex(0); });

      expect(global.fetch).toHaveBeenCalledTimes(1); // no network on scrub
      expect(result.current.live).toBe(false);
      expect(map.addSource).toHaveBeenLastCalledWith('rmpg-weather-radar', expect.objectContaining({
        tiles: ['https://tilecache.rainviewer.com/v2/radar/1700000000/256/{z}/{x}/{y}/2/1_1.png'],
      }));
    });

    it('resumeLive snaps back to the newest observed frame', async () => {
      const { result } = await enabledWithNowcast();
      await act(async () => { result.current.setFrameIndex(0); });
      expect(result.current.live).toBe(false);

      await act(async () => { result.current.resumeLive(); });

      expect(result.current.live).toBe(true);
      expect(result.current.frameIndex).toBe(1);
    });

    it('play advances one frame per tick and wraps at the end of the loop', async () => {
      const { result } = await enabledWithNowcast();
      await act(async () => { result.current.setFrameIndex(0); result.current.play(); });
      expect(result.current.playing).toBe(true);

      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      expect(result.current.frameIndex).toBe(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      expect(result.current.frameIndex).toBe(2); // into the nowcast tail

      // Last frame dwells longer, then wraps to the oldest.
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      expect(result.current.frameIndex).toBe(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      expect(result.current.frameIndex).toBe(0);
    });

    it('a poll landing mid-scrub does not yank the operator back to live', async () => {
      const { result } = await enabledWithNowcast();
      await act(async () => { result.current.setFrameIndex(0); });

      await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(result.current.live).toBe(false);
      expect(result.current.frameIndex).toBe(0);
    });

    it('disabling the overlay resets playback so re-enabling starts live', async () => {
      const { result } = await enabledWithNowcast();
      await act(async () => { result.current.setFrameIndex(0); result.current.play(); });

      await act(async () => { result.current.setEnabled(false); });

      expect(result.current.playing).toBe(false);
      expect(result.current.live).toBe(true);
    });

    it('records the poll time and clears the error flag on success', async () => {
      const { result } = await enabledWithNowcast();
      expect(result.current.lastPolledAt).toBeInstanceOf(Date);
      expect(result.current.error).toBe(false);
    });

    it('sets the error flag when the feed is unreachable', async () => {
      (global.fetch as any).mockRejectedValue(new Error('network down'));
      const map = makeMap();
      const { result } = renderHook(() => useMapWeatherRadar(map, true));
      await act(async () => {
        result.current.setEnabled(true);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.error).toBe(true);
      expect(result.current.loading).toBe(false);
    });
  });
});
