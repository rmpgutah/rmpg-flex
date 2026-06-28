// Config-shape regression test.
//
// Production crash 2026-06-21:
//   `Error: layers.geojson-county-fill.paint.fill-color: color expected,
//    "var(--surface-base)" found`
//
// The Mapbox style spec validator runs INSIDE addLayer and rejects any color
// value that isn't a parseable CSS color (hex, rgb/rgba, hsl/hsla, named, or
// 'transparent'). A `var(--…)` reference is valid CSS but it only resolves
// in the DOM — Mapbox can't compute it, so the whole layer fails to render.
//
// useGeoJsonLayers.ts:54 had `fillColor: 'var(--surface-base)'` for the
// county layer, which crashed the layer at runtime. This test fails CI if a
// future change re-introduces a CSS var string into any layer's color
// config. safeMapboxColor at the addLayer boundary is the runtime backstop;
// this test is the source-shape backstop.
import { describe, it, expect } from 'vitest';
import { GEO_LAYER_CONFIGS } from '../useGeoJsonLayers';

describe('GEO_LAYER_CONFIGS — color shape', () => {
  it.each(GEO_LAYER_CONFIGS.map(c => [c.id, c.style] as const))(
    '%s.style.fillColor and .strokeColor must not be CSS variable strings',
    (_id, style) => {
      expect(style.fillColor).not.toMatch(/^var\(/i);
      expect(style.strokeColor).not.toMatch(/^var\(/i);
    },
  );

  it.each(GEO_LAYER_CONFIGS.map(c => [c.id, c.style] as const))(
    '%s.style.fillColor and .strokeColor must be non-empty strings',
    (_id, style) => {
      expect(typeof style.fillColor).toBe('string');
      expect(typeof style.strokeColor).toBe('string');
      expect(style.fillColor.trim()).not.toBe('');
      expect(style.strokeColor.trim()).not.toBe('');
    },
  );
});
