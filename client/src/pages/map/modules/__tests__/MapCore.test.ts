import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMapCore } from '../MapCore';

vi.mock('../../../../utils/mapboxApiKey', () => ({
  getMapboxTokenStatus: vi.fn().mockResolvedValue({ token: null, errorKind: 'unconfigured' }),
  getCachedMapboxStyleUrl: vi.fn().mockReturnValue(null),
}));

vi.mock('../../../../utils/mapboxBasemap', () => ({
  applyRmpgBasemap: vi.fn(),
}));

describe('useMapCore', () => {
  it('returns a mapContainerRef, mapRef, and initial state before any map exists', () => {
    const { result } = renderHook(() =>
      useMapCore({
        preferredEngine: 'mapbox',
        mapStyle: 'dark',
        retryNonce: 0,
        onStyleFallback: () => {},
        onRetryNonceRequest: () => {},
        terrainEnabled: false,
      })
    );

    expect(result.current.mapContainerRef.current).toBeNull();
    expect(result.current.mapRef.current).toBeNull();
    expect(result.current.mapLoaded).toBe(false);
    expect(result.current.loading).toBe(true);
    expect(result.current.mapError).toBeNull();
  });

  it('falls back to MapLibre and sets an error when no Mapbox token is configured', async () => {
    const { result, rerender } = renderHook(() =>
      useMapCore({
        preferredEngine: 'mapbox',
        mapStyle: 'dark',
        retryNonce: 0,
        onStyleFallback: () => {},
        onRetryNonceRequest: () => {},
        terrainEnabled: false,
      })
    );

    // allow the async initMap() to resolve
    await vi.waitFor(() => {
      rerender();
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.mapError).toMatch(/Mapbox access token not configured/);
    expect(result.current.mapLibreFallback).toBe(true);
  });

  it('changeStyle does not throw when no map instance exists yet', () => {
    const { result } = renderHook(() =>
      useMapCore({
        preferredEngine: 'mapbox',
        mapStyle: 'dark',
        retryNonce: 0,
        onStyleFallback: () => {},
        onRetryNonceRequest: () => {},
        terrainEnabled: false,
      })
    );

    expect(result.current.mapRef.current).toBeNull();
    expect(() => result.current.changeStyle('satellite')).not.toThrow();
  });
});

describe('useMapCore — WebGL context-loss recovery', () => {
  // A minimal mapboxgl.Map stand-in: just enough event-emitter surface for
  // installWebglContextRecovery (map.on/off for 'webglcontextlost' and
  // 'webglcontextrestored') plus the handful of calls MapCore itself makes
  // (on('load'/'error'/'style.load'), getCanvas, getCenter/Zoom/Bearing/Pitch,
  // loaded, remove).
  function makeFakeMap() {
    const listeners = new Map<string, Set<(...args: any[]) => void>>();
    const canvas = {
      getContext: () => ({ isContextLost: () => false }),
    } as unknown as HTMLCanvasElement;
    const map: any = {
      on: (evt: string, cb: (...args: any[]) => void) => {
        if (!listeners.has(evt)) listeners.set(evt, new Set());
        listeners.get(evt)!.add(cb);
        return map;
      },
      off: (evt: string, cb: (...args: any[]) => void) => {
        listeners.get(evt)?.delete(cb);
        return map;
      },
      once: (evt: string, cb: (...args: any[]) => void) => {
        const wrapped = (...args: any[]) => { map.off(evt, wrapped); cb(...args); };
        return map.on(evt, wrapped);
      },
      emit: (evt: string, ...args: any[]) => {
        listeners.get(evt)?.forEach((cb) => cb(...args));
      },
      getCanvas: () => canvas,
      getCenter: () => ({ lng: -111.891, lat: 40.7608 }),
      getZoom: () => 12,
      getBearing: () => 0,
      getPitch: () => 0,
      loaded: () => true,
      jumpTo: vi.fn(),
      remove: vi.fn(),
    };
    return map;
  }

  it('rebuilds the map via onRetryNonceRequest after a WebGL context loss that does not self-restore', async () => {
    vi.resetModules();
    const fakeMap = makeFakeMap();
    const createMapboxMapMock = vi.fn().mockReturnValue(fakeMap);
    vi.doMock('../../../../utils/mapboxLoader', async () => {
      const actual = await vi.importActual<any>('../../../../utils/mapboxLoader');
      return {
        ...actual,
        createMapboxMap: createMapboxMapMock,
        destroyMapboxMap: vi.fn((m: any) => m?.remove?.()),
      };
    });
    const { getMapboxTokenStatus } = await import('../../../../utils/mapboxApiKey');
    (getMapboxTokenStatus as any).mockResolvedValue({ token: 'fake-token' });
    const { useMapCore: freshUseMapCore } = await import('../MapCore');

    const onRetryNonceRequest = vi.fn();
    const { result } = renderHook(
      (props: { retryNonce: number }) =>
        freshUseMapCore({
          preferredEngine: 'mapbox',
          mapStyle: 'dark',
          retryNonce: props.retryNonce,
          onStyleFallback: () => {},
          onRetryNonceRequest,
          terrainEnabled: false,
        }),
      { initialProps: { retryNonce: 0 } },
    );
    // initMap() waits a tick for mapContainerRef to mount; a bare renderHook
    // never attaches it to real DOM, so supply one directly.
    (result.current.mapContainerRef as any).current = document.createElement('div');

    await vi.waitFor(() => expect(createMapboxMapMock).toHaveBeenCalled());
    await act(async () => { fakeMap.emit('load'); });

    // Context lost, and it does NOT self-restore (isContextLost stays true).
    fakeMap.getCanvas = () => ({ getContext: () => ({ isContextLost: () => true }) }) as unknown as HTMLCanvasElement;
    act(() => { fakeMap.emit('webglcontextlost', {}); });

    // installWebglContextRecovery waits restoreGraceMs (default 2500ms) for a
    // self-restore before rebuilding — real timers, since faking them here
    // fights the async token-fetch microtask chain in initMap().
    await new Promise((r) => setTimeout(r, 3000));

    expect(onRetryNonceRequest).toHaveBeenCalledTimes(1);
    expect(fakeMap.remove).toHaveBeenCalled();

    vi.doUnmock('../../../../utils/mapboxLoader');
  }, 10_000);
});
