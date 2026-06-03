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
