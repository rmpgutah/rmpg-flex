import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMapCore } from '../MapCore';

vi.mock('../../../../utils/mapboxApiKey', () => ({
  getMapboxTokenStatus: vi.fn().mockResolvedValue({ token: null, errorKind: 'unconfigured' }),
  getCachedMapboxStyleUrl: vi.fn().mockReturnValue(null),
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
        loadBeatOverlay: async () => {},
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
        loadBeatOverlay: async () => {},
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
        loadBeatOverlay: () => {},
        terrainEnabled: false,
      })
    );

    expect(result.current.mapRef.current).toBeNull();
    expect(() => result.current.changeStyle('satellite')).not.toThrow();
  });
});
