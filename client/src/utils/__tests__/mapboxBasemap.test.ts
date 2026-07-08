// Locks in the 2026-07 rewrite: applyRmpgBasemap used to paint a hardcoded
// pure-black/gold theme; it now reads live theme CSS custom properties off
// <html> (theme-palettes.css) so every Mapbox surface follows whichever
// theme is active (Blue & Silver by default) instead of one fixed palette.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyRmpgBasemap } from '../mapboxBasemap';

/** Minimal mapbox-like stub — records every setPaintProperty/setLayoutProperty
 *  call so assertions can check the resolved color values without a real
 *  Mapbox GL instance (jsdom has no WebGL). */
function makeMap(layers: { id: string; type: string }[]) {
  const paints: Record<string, Record<string, unknown>> = {};
  const layouts: Record<string, Record<string, unknown>> = {};
  return {
    getStyle: () => ({ layers }),
    getLayer: (id: string) => layers.find((l) => l.id === id),
    setPaintProperty: (id: string, prop: string, value: unknown) => {
      paints[id] = { ...(paints[id] || {}), [prop]: value };
    },
    setLayoutProperty: (id: string, prop: string, value: unknown) => {
      layouts[id] = { ...(layouts[id] || {}), [prop]: value };
    },
    __paints: paints,
    __layouts: layouts,
  } as any;
}

describe('applyRmpgBasemap', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style');
    document.documentElement.className = '';
  });

  it('never throws for a null/undefined map', () => {
    expect(() => applyRmpgBasemap(null)).not.toThrow();
    expect(() => applyRmpgBasemap(undefined)).not.toThrow();
  });

  it('never throws when a layer lookup throws mid-restyle', () => {
    const map = makeMap([{ id: 'background', type: 'background' }]);
    map.getStyle = () => { throw new Error('style torn down'); };
    expect(() => applyRmpgBasemap(map, { variant: 'dark' })).not.toThrow();
  });

  it('paints the background from the live --surface-base-rgb custom property, not a hardcoded value', () => {
    document.documentElement.style.setProperty('--surface-base-rgb', '34 64 95'); // Blue & Silver navy
    const map = makeMap([{ id: 'background', type: 'background' }]);
    applyRmpgBasemap(map, { variant: 'dark' });
    expect(map.__paints.background['background-color']).toBe('rgb(34, 64, 95)');
  });

  it('paints major-road accent from --brand-gold-rgb (the theme accent token, silver under Blue & Silver)', () => {
    document.documentElement.style.setProperty('--brand-gold-rgb', '195 204 214'); // Blue & Silver silver
    const map = makeMap([{ id: 'road-motorway', type: 'line' }]);
    applyRmpgBasemap(map, { variant: 'dark' });
    expect(map.__paints['road-motorway']['line-color']).toBe('rgb(195, 204, 214)');
  });

  it('falls back to the pre-2026-07 black/gold literals when a CSS variable is unset', () => {
    // No custom properties set on <html> — simulates SSR / a pre-CSS-load render.
    const map = makeMap([{ id: 'background', type: 'background' }, { id: 'road-primary', type: 'line' }]);
    applyRmpgBasemap(map, { variant: 'dark' });
    expect(map.__paints.background['background-color']).toBe('rgb(0, 0, 0)');
    expect(map.__paints['road-primary']['line-color']).toBe('rgb(212, 160, 23)');
  });

  it('hides POI/transit symbol noise regardless of theme', () => {
    const map = makeMap([{ id: 'poi-label', type: 'symbol' }]);
    applyRmpgBasemap(map, { variant: 'dark' });
    expect(map.__layouts['poi-label'].visibility).toBe('none');
  });

  it('leaves the light variant untouched (print path, intentionally not re-skinned)', () => {
    const map = makeMap([{ id: 'background', type: 'background' }]);
    applyRmpgBasemap(map, { variant: 'light' });
    expect(map.__paints.background).toBeUndefined();
  });
});
