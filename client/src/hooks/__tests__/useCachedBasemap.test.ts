import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCachedBasemap } from '../useCachedBasemap';

/** Minimal event-emitter stub standing in for mapboxgl.Map — just enough
 *  surface (`on`/`off`/`emit`) for the hook under test. */
function createMockMap() {
  const listeners: Record<string, Array<(e: any) => void>> = {};
  return {
    on: vi.fn((type: string, cb: (e: any) => void) => {
      (listeners[type] ||= []).push(cb);
    }),
    off: vi.fn((type: string, cb: (e: any) => void) => {
      listeners[type] = (listeners[type] || []).filter((l) => l !== cb);
    }),
    emit(type: string, e: any) {
      for (const cb of listeners[type] || []) cb(e);
    },
    listenerCount(type: string) {
      return (listeners[type] || []).length;
    },
  };
}

const RASTER_TILE_ERROR = { error: { message: 'tile fetch failed' }, sourceId: 'rmpg-basemap', source: { type: 'raster' } };
const RASTER_TILE_LOADED = { sourceId: 'rmpg-basemap', source: { type: 'raster' }, isSourceLoaded: true };
const GEOJSON_LAYER_ERROR = { error: { message: 'bad geojson' }, sourceId: 'rmpg-districts-source', source: { type: 'geojson' } };
const NON_SOURCE_STYLE_ERROR = { error: { message: 'style.json 404' } }; // no sourceId at all

describe('useCachedBasemap', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('attaches error/sourcedata listeners when a map is passed', () => {
    const map = createMockMap();
    renderHook(() => useCachedBasemap(map as any));
    expect(map.listenerCount('error')).toBe(1);
    expect(map.listenerCount('sourcedata')).toBe(1);
  });

  it('does not attach listeners and starts not-degraded when map is null', () => {
    const { result } = renderHook(() => useCachedBasemap(null));
    expect(result.current.degraded).toBe(false);
  });

  it('flips degraded true after a base-tile error persists past the threshold', () => {
    const map = createMockMap();
    const { result } = renderHook(() => useCachedBasemap(map as any));

    act(() => map.emit('error', RASTER_TILE_ERROR));
    expect(result.current.degraded).toBe(false);

    // No further events fire — the periodic re-check (not another event)
    // must be what flips degraded once the 5s threshold elapses.
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.degraded).toBe(true);
  });

  it('ignores errors on non-base-tile sources (e.g. a broken GeoJSON overlay)', () => {
    const map = createMockMap();
    const { result } = renderHook(() => useCachedBasemap(map as any));

    act(() => map.emit('error', GEOJSON_LAYER_ERROR));
    act(() => vi.advanceTimersByTime(6000));
    expect(result.current.degraded).toBe(false);
  });

  it('ignores non-source style errors (no sourceId at all)', () => {
    const map = createMockMap();
    const { result } = renderHook(() => useCachedBasemap(map as any));

    act(() => map.emit('error', NON_SOURCE_STYLE_ERROR));
    act(() => vi.advanceTimersByTime(6000));
    expect(result.current.degraded).toBe(false);
  });

  it('resets on a base-tile-source recovery event', () => {
    const map = createMockMap();
    const { result } = renderHook(() => useCachedBasemap(map as any));

    act(() => map.emit('error', RASTER_TILE_ERROR));
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.degraded).toBe(true);

    act(() => map.emit('sourcedata', RASTER_TILE_LOADED));
    expect(result.current.degraded).toBe(false);

    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.degraded).toBe(false);
  });

  it('a sourcedata load event for an unrelated source does not clear degraded', () => {
    const map = createMockMap();
    const { result } = renderHook(() => useCachedBasemap(map as any));

    act(() => map.emit('error', RASTER_TILE_ERROR));
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.degraded).toBe(true);

    act(() => map.emit('sourcedata', { sourceId: 'rmpg-districts-source', source: { type: 'geojson' }, isSourceLoaded: true }));
    expect(result.current.degraded).toBe(true);
  });

  it('cleans up listeners and the interval on unmount, and does not update state after unmount', () => {
    const map = createMockMap();
    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = renderHook(() => useCachedBasemap(map as any));

    act(() => map.emit('error', RASTER_TILE_ERROR));
    unmount();

    expect(map.off).toHaveBeenCalledWith('error', expect.any(Function));
    expect(map.off).toHaveBeenCalledWith('sourcedata', expect.any(Function));

    // Advancing time after unmount must not trigger a setState-after-unmount
    // warning — the interval was cleared in the cleanup function.
    act(() => vi.advanceTimersByTime(10000));
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('starts a fresh tracker (no stale timestamps) when the map instance changes', () => {
    const mapA = createMockMap();
    const { result, rerender } = renderHook(({ map }) => useCachedBasemap(map as any), {
      initialProps: { map: mapA },
    });

    act(() => mapA.emit('error', RASTER_TILE_ERROR));
    act(() => vi.advanceTimersByTime(4000)); // just under threshold, not yet degraded
    expect(result.current.degraded).toBe(false);

    const mapB = createMockMap();
    rerender({ map: mapB });

    // If the old tracker's timestamp leaked into the new map's tracker, this
    // would already be degraded (4000ms old + 2000ms more > 5000ms).
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.degraded).toBe(false);
  });
});
