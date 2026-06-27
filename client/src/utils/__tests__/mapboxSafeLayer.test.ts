// Locks in the teardown-race guard that backs the /map + /navigation
// ErrorBoundary fixes (#1020 getLayer; getSourceSafe twin for getSource).
//
// The production crash was `Cannot read properties of undefined (reading
// 'getOwnLayer'/'getOwnSource')` thrown INSIDE mapbox's getLayer/getSource
// when a late callback (interval, fetch resolve) ran after map.remove().
// The contract these helpers must hold:
//   1. When map.style is gone, short-circuit WITHOUT touching getLayer/getSource
//      (calling them is exactly what throws).
//   2. If the underlying call throws anyway, swallow it — never propagate.
import { describe, it, expect, vi } from 'vitest';
import {
  hasLayer,
  hasSource,
  getSourceSafe,
  safeRemoveLayer,
  safeRemoveSource,
  safeMapboxColor,
  upsertGeoJsonSource,
} from '../mapboxSafeLayer';

/** Minimal mapbox-like stub; `style` presence models pre-/post-teardown. */
function makeMap(opts: {
  style?: unknown;
  layer?: unknown;
  source?: unknown;
  throwOnGet?: boolean;
}) {
  return {
    style: 'style' in opts ? opts.style : {},
    getLayer: vi.fn(() => { if (opts.throwOnGet) throw new Error('getOwnLayer of undefined'); return opts.layer; }),
    getSource: vi.fn(() => { if (opts.throwOnGet) throw new Error('getOwnSource of undefined'); return opts.source; }),
    removeLayer: vi.fn(),
    removeSource: vi.fn(),
  } as any;
}

describe('mapboxSafeLayer — teardown-race guards', () => {
  it('returns falsy/undefined for null/undefined map without throwing', () => {
    expect(hasLayer(null, 'x')).toBe(false);
    expect(hasSource(undefined, 'x')).toBe(false);
    expect(getSourceSafe(null, 'x')).toBeUndefined();
    expect(() => safeRemoveLayer(null, 'x')).not.toThrow();
    expect(() => safeRemoveSource(undefined, 'x')).not.toThrow();
  });

  it('short-circuits when style is torn down — never calls getLayer/getSource', () => {
    const map = makeMap({ style: undefined, layer: {}, source: {} });
    expect(hasLayer(map, 'x')).toBe(false);
    expect(hasSource(map, 'x')).toBe(false);
    expect(getSourceSafe(map, 'x')).toBeUndefined();
    // The crux: the underlying calls (which would throw on a dead style) are
    // never reached.
    expect(map.getLayer).not.toHaveBeenCalled();
    expect(map.getSource).not.toHaveBeenCalled();
  });

  it('swallows a throwing getLayer/getSource (defense in depth)', () => {
    const map = makeMap({ throwOnGet: true });
    expect(hasLayer(map, 'x')).toBe(false);
    expect(hasSource(map, 'x')).toBe(false);
    expect(getSourceSafe(map, 'x')).toBeUndefined();
  });

  it('returns the layer/source when the style is live and it exists', () => {
    const src = { setData: vi.fn() };
    const map = makeMap({ style: {}, layer: { id: 'L' }, source: src });
    expect(hasLayer(map, 'L')).toBe(true);
    expect(hasSource(map, 'S')).toBe(true);
    expect(getSourceSafe(map, 'S')).toBe(src);
  });

  it('getSourceSafe normalizes a missing source to undefined (not null)', () => {
    const map = makeMap({ style: {}, source: null });
    expect(getSourceSafe(map, 'missing')).toBeUndefined();
  });

  it('safeRemove* only removes when present and never throws on a dead style', () => {
    const live = makeMap({ style: {}, layer: { id: 'L' }, source: { id: 'S' } });
    safeRemoveLayer(live, 'L');
    safeRemoveSource(live, 'S');
    expect(live.removeLayer).toHaveBeenCalledWith('L');
    expect(live.removeSource).toHaveBeenCalledWith('S');

    const dead = makeMap({ style: undefined });
    expect(() => { safeRemoveLayer(dead, 'L'); safeRemoveSource(dead, 'S'); }).not.toThrow();
    expect(dead.removeLayer).not.toHaveBeenCalled();
    expect(dead.removeSource).not.toHaveBeenCalled();
  });
});

// ============================================================
// safeMapboxColor — reject CSS variable strings at the addLayer
// boundary. Production crash 2026-06-21:
//   `Error: layers.geojson-county-fill.paint.fill-color: color
//    expected, "var(--surface-base)" found`
// The mapbox style spec validator accepts hex/rgb/hsl/named/
// 'transparent' only — handing it `var(--x)` zeroes the whole
// layer. Guard at every config-to-mapbox boundary.
// ============================================================
describe('safeMapboxColor', () => {
  it('rejects CSS variable strings and returns the fallback', () => {
    expect(safeMapboxColor('var(--surface-base)', '#000')).toBe('#000');
    expect(safeMapboxColor('  var(--anything)  ', '#000')).toBe('#000');
    expect(safeMapboxColor('VAR(--upper)', '#000')).toBe('#000');
  });

  it('rejects empty/whitespace/non-string values and returns the fallback', () => {
    expect(safeMapboxColor('', '#fb0')).toBe('#fb0');
    expect(safeMapboxColor('   ', '#fb0')).toBe('#fb0');
    expect(safeMapboxColor(null, '#fb0')).toBe('#fb0');
    expect(safeMapboxColor(undefined, '#fb0')).toBe('#fb0');
    expect(safeMapboxColor(42 as any, '#fb0')).toBe('#fb0');
  });

  it('passes through hex, rgb/rgba, hsl/hsla, named colors and transparent', () => {
    expect(safeMapboxColor('#0d1722', '#000')).toBe('#0d1722');
    expect(safeMapboxColor('#fff', '#000')).toBe('#fff');
    expect(safeMapboxColor('rgb(13, 23, 34)', '#000')).toBe('rgb(13, 23, 34)');
    expect(safeMapboxColor('rgba(13,23,34,0.5)', '#000')).toBe('rgba(13,23,34,0.5)');
    expect(safeMapboxColor('hsl(200, 50%, 20%)', '#000')).toBe('hsl(200, 50%, 20%)');
    expect(safeMapboxColor('transparent', '#000')).toBe('transparent');
    expect(safeMapboxColor('royalblue', '#000')).toBe('royalblue');
  });

  it('trims surrounding whitespace before returning', () => {
    expect(safeMapboxColor('  #0d1722  ', '#000')).toBe('#0d1722');
  });
});

// ============================================================
// upsertGeoJsonSource — idempotent addSource that survives
// setStyle's preservation race. Production crash 2026-06-21:
//   `Error: There is already a source with ID
//    "rmpg-breadcrumb-dots"`
// fired during setStyle → _diffStyle → load. The existing
// `if (!hasSource(...)) map.addSource(...)` guard is too narrow
// because the source can be re-added by mapbox's own diff
// preservation between the check and our call. The helper
// makes the operation safe to call any number of times.
// ============================================================
describe('upsertGeoJsonSource', () => {
  function makeUpsertMap(opts: { existingSource?: any } = {}) {
    let stored = opts.existingSource;
    return {
      style: {},
      getSource: vi.fn((id: string) => stored && stored.id === id ? stored : undefined),
      addSource: vi.fn((id: string, spec: any) => {
        if (stored && stored.id === id) {
          throw new Error(`There is already a source with ID "${id}".`);
        }
        stored = { id, setData: vi.fn(), spec };
      }),
    } as any;
  }

  it('addSource on first call', () => {
    const map = makeUpsertMap();
    const data = { type: 'FeatureCollection' as const, features: [] };
    upsertGeoJsonSource(map, 'breadcrumbs', data);
    expect(map.addSource).toHaveBeenCalledWith('breadcrumbs', { type: 'geojson', data });
  });

  it('setData on second call — never throws "already exists"', () => {
    const existing = { id: 'breadcrumbs', setData: vi.fn() };
    const map = makeUpsertMap({ existingSource: existing });
    const data = { type: 'FeatureCollection' as const, features: [{ id: 1 }] as any };
    expect(() => upsertGeoJsonSource(map, 'breadcrumbs', data)).not.toThrow();
    expect(existing.setData).toHaveBeenCalledWith(data);
    expect(map.addSource).not.toHaveBeenCalled();
  });

  it('no-op on a torn-down map (style gone)', () => {
    const map = { style: undefined, getSource: vi.fn(), addSource: vi.fn() } as any;
    expect(() => upsertGeoJsonSource(map, 'x', { type: 'FeatureCollection', features: [] })).not.toThrow();
    expect(map.addSource).not.toHaveBeenCalled();
  });

  it('swallows the "already exists" error even if Mapbox throws between our check and call (diff-race)', () => {
    // Simulates the exact race: getSource returns undefined (style mid-swap)
    // but addSource throws because Mapbox just preserved the source under us.
    const map = {
      style: {},
      getSource: vi.fn(() => undefined),
      addSource: vi.fn(() => { throw new Error('There is already a source with ID "x".'); }),
    } as any;
    expect(() => upsertGeoJsonSource(map, 'x', { type: 'FeatureCollection', features: [] })).not.toThrow();
  });
});
