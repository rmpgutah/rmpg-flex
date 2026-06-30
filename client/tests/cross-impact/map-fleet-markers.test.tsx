import { describe, it, expect } from 'vitest';

/** Cross-impact smoke (spec §6.5): the new /fleet/v2 work must not break
 *  MapPage. MapPage imports `useMapFleetVehicles` and other fleet-adjacent
 *  modules; if any v2 refactor breaks them transitively, this import fails.
 *
 *  We import dynamically (so the test fails with a clear error if module
 *  resolution breaks) and assert the default export is a function. Mounting
 *  MapPage in jsdom is brittle due to its Mapbox/WebGL dependency tree —
 *  module-resolution smoke is the proportionate check. */
describe('MapPage cross-impact (no regression from /fleet/v2 work)', () => {
  it('imports MapPage without throwing (transitive deps still resolve)', async () => {
    const mod = await import('../../src/pages/map');
    const MapPage = mod.default;
    expect(typeof MapPage).toBe('function');
  }, 15000);

});
