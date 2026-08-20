// Locks in the 2026-07-24 rewrite: applyRmpgBasemap used to read live theme CSS
// custom properties off <html> so the map's accent tracked whichever app theme
// was active. That meant the map's "gold" tracked --brand-gold, which resolves
// to SILVER under Blue & Silver — so the map had no gold at all. The palette is
// now FIXED and literal (MAP_PALETTE in mapboxBasemap.ts), independent of any
// className on <html>.
import { describe, it, expect, afterEach } from 'vitest';
import { applyRmpgBasemap, MAP_PALETTE } from '../mapboxBasemap';

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

  it('paints the background from the fixed MAP_PALETTE navy, regardless of the active theme class', () => {
    document.documentElement.className = 'theme-legacy-black';
    const map = makeMap([{ id: 'background', type: 'background' }]);
    applyRmpgBasemap(map, { variant: 'dark' });
    expect(map.__paints.background['background-color']).toBe(MAP_PALETTE.land);
  });

  it('paints major-road accent from the fixed gold literal, not a theme-derived token', () => {
    const map = makeMap([{ id: 'road-motorway', type: 'line' }]);
    applyRmpgBasemap(map, { variant: 'dark' });
    expect(map.__paints['road-motorway']['line-color']).toBe(MAP_PALETTE.arterial);
  });

  it('is unaffected by CSS custom properties on <html> (palette is literal, not var()-derived)', () => {
    document.documentElement.style.setProperty('--surface-base-rgb', '0 0 0');
    document.documentElement.style.setProperty('--brand-gold-rgb', '195 204 214');
    const map = makeMap([{ id: 'background', type: 'background' }, { id: 'road-primary', type: 'line' }]);
    applyRmpgBasemap(map, { variant: 'dark' });
    expect(map.__paints.background['background-color']).toBe(MAP_PALETTE.land);
    expect(map.__paints['road-primary']['line-color']).toBe(MAP_PALETTE.arterial);
  });

  it('hides POI/transit symbol noise regardless of theme', () => {
    const map = makeMap([{ id: 'poi-label', type: 'symbol' }]);
    applyRmpgBasemap(map, { variant: 'dark' });
    expect(map.__layouts['poi-label'].visibility).toBe('none');
  });

  it('routes the light variant through the dark restyle (fixes the bright tan mini-map)', () => {
    const map = makeMap([{ id: 'background', type: 'background' }]);
    applyRmpgBasemap(map, { variant: 'light' });
    expect(map.__paints.background['background-color']).toBe(MAP_PALETTE.land);
  });

  it('leaves the print variant untouched (stock light style, intentionally not re-skinned)', () => {
    const map = makeMap([{ id: 'background', type: 'background' }]);
    applyRmpgBasemap(map, { variant: 'print' });
    expect(map.__paints.background).toBeUndefined();
  });
});
