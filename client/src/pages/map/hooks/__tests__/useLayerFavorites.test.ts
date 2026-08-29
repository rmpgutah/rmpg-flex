import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLayerFavorites } from '../useLayerFavorites';

describe('useLayerFavorites', () => {
  beforeEach(() => localStorage.clear());

  it('toggles a layer id and persists it', () => {
    const { result } = renderHook(() => useLayerFavorites());
    act(() => { result.current.toggle('osm_safety_hydrant'); });
    expect(result.current.set.has('osm_safety_hydrant')).toBe(true);
    expect(JSON.parse(localStorage.getItem('rmpg_map_layer_favorites') || '[]')).toEqual(['osm_safety_hydrant']);
    act(() => { result.current.toggle('osm_safety_hydrant'); });
    expect(result.current.set.has('osm_safety_hydrant')).toBe(false);
  });
});
