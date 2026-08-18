import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMapBeatOverlay } from '../useMapBeatOverlay';

describe('useMapBeatOverlay', () => {
  it('does not throw with null map and empty beats', () => {
    expect(() =>
      renderHook(() => useMapBeatOverlay({ map: null, mapLoaded: false, beats: [], beatLayerVisible: false }))
    ).not.toThrow();
  });
});
