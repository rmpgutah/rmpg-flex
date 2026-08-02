import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMapFeatureInspect } from '../useMapFeatureInspect';

/** The exact layer set a click on Woodstock Elementary returned in the
 *  reported screenshot: one real overlay hit buried under eleven rows of
 *  basemap geometry and internal RMPG render layers. */
const SCREENSHOT_FEATURES = [
  { layer: { id: 'vt-osm_sites_school-circle' }, properties: { name: 'Woodstock Elementary School', osm_id: 'w101' }, geometry: { type: 'Point', coordinates: [-111.85355, 40.64199] } },
  { layer: { id: 'rmpg-coverage-gaps-fill' }, properties: {}, geometry: { type: 'Polygon', coordinates: [] } },
  { layer: { id: 'landuse' }, properties: { class: 'school' }, geometry: { type: 'Polygon', coordinates: [] } },
  { layer: { id: 'road' }, properties: { class: 'sidewalk' }, geometry: { type: 'LineString', coordinates: [] } },
  { layer: { id: 'road' }, properties: { class: 'crossing' }, geometry: { type: 'LineString', coordinates: [] } },
  { layer: { id: 'landuse' }, properties: { class: 'surface' }, geometry: { type: 'Polygon', coordinates: [] } },
  { layer: { id: 'road' }, properties: { class: 'service' }, geometry: { type: 'LineString', coordinates: [] } },
  { layer: { id: 'building' }, properties: {}, geometry: { type: 'Polygon', coordinates: [] } },
  { layer: { id: 'water' }, properties: {}, geometry: { type: 'Polygon', coordinates: [] } },
  { layer: { id: 'poi_label' }, properties: {}, geometry: { type: 'Point', coordinates: [] } },
  { layer: { id: 'admin' }, properties: {}, geometry: { type: 'LineString', coordinates: [] } },
  { layer: { id: 'landuse_overlay' }, properties: {}, geometry: { type: 'Polygon', coordinates: [] } },
];

function makeMap(queryResults: any[] | ((box: any) => any[])) {
  const listeners: Record<string, Array<(e: any) => void>> = {};
  return {
    getCanvas: () => ({ style: {} }),
    queryRenderedFeatures: vi.fn((box: any) =>
      typeof queryResults === 'function' ? queryResults(box) : queryResults),
    on: vi.fn((event: string, cb: (e: any) => void) => { (listeners[event] ??= []).push(cb); }),
    off: vi.fn((event: string, cb: (e: any) => void) => {
      listeners[event] = (listeners[event] || []).filter((fn) => fn !== cb);
    }),
    _click: (e: any) => { (listeners['click'] || []).forEach((cb) => cb(e)); },
  } as any;
}

const CLICK = { point: { x: 400, y: 300 }, lngLat: { lng: -111.85355, lat: 40.64199 } };

describe('useMapFeatureInspect', () => {
  it('returns ONE result for the twelve-feature screenshot click', () => {
    const map = makeMap(SCREENSHOT_FEATURES);
    const { result } = renderHook(() => useMapFeatureInspect(map, true));
    act(() => { result.current.toggle(); });
    act(() => { map._click(CLICK); });

    expect(result.current.result?.features).toHaveLength(1);
    expect(result.current.result?.features[0].properties.name)
      .toBe('Woodstock Elementary School');
  });

  it('filters out internal RMPG render layers and basemap geometry', () => {
    const map = makeMap(SCREENSHOT_FEATURES);
    const { result } = renderHook(() => useMapFeatureInspect(map, true));
    act(() => { result.current.toggle(); });
    act(() => { map._click(CLICK); });

    const layerIds = result.current.result!.features.map((f) => f.layerId);
    expect(layerIds).not.toContain('rmpg-coverage-gaps-fill');
    expect(layerIds).not.toContain('landuse');
    expect(layerIds).not.toContain('road');
  });

  it('labels the hit with the operator-facing category, not the layer id', () => {
    const map = makeMap(SCREENSHOT_FEATURES);
    const { result } = renderHook(() => useMapFeatureInspect(map, true));
    act(() => { result.current.toggle(); });
    act(() => { map._click(CLICK); });

    const hit = result.current.result!.features[0];
    expect(hit.categoryLabel).not.toContain('vt-');
    expect(hit.categoryLabel.length).toBeGreaterThan(0);
  });

  it('collapses a feature returned once per tile into a single row', () => {
    const dup = SCREENSHOT_FEATURES[0];
    const map = makeMap([dup, { ...dup }, { ...dup }]);
    const { result } = renderHook(() => useMapFeatureInspect(map, true));
    act(() => { result.current.toggle(); });
    act(() => { map._click(CLICK); });

    expect(result.current.result?.features).toHaveLength(1);
  });

  it('makes no network call', () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;
    const map = makeMap(SCREENSHOT_FEATURES);
    const { result } = renderHook(() => useMapFeatureInspect(map, true));
    act(() => { result.current.toggle(); });
    act(() => { map._click(CLICK); });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does nothing while the tool is switched off', () => {
    const map = makeMap(SCREENSHOT_FEATURES);
    const { result } = renderHook(() => useMapFeatureInspect(map, true));
    act(() => { map._click(CLICK); });
    expect(result.current.result).toBeNull();
  });

  it('selects the first hit by default so a single result needs no click', () => {
    const map = makeMap(SCREENSHOT_FEATURES);
    const { result } = renderHook(() => useMapFeatureInspect(map, true));
    act(() => { result.current.toggle(); });
    act(() => { map._click(CLICK); });
    expect(result.current.selectedIndex).toBe(0);
  });
});
