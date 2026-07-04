import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMapCore } from '../MapCore';

describe('useMapCore', () => {
  it('returns a mapContainerRef, mapRef, and initial state before any map exists', () => {
    const { result } = renderHook(() =>
      useMapCore({ preferredEngine: 'mapbox', mapStyle: 'dark', retryNonce: 0 })
    );

    expect(result.current.mapContainerRef.current).toBeNull();
    expect(result.current.mapRef.current).toBeNull();
    expect(result.current.mapLoaded).toBe(false);
    expect(result.current.loading).toBe(true);
    expect(result.current.mapError).toBeNull();
  });
});
