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
    const mod = await import('../../src/pages/map/MapPage');
    const MapPage = mod.default;
    expect(typeof MapPage).toBe('function');
  }, 15000);

  it('imports useMapFleetVehicles hook (the fleet-adjacent module that bridges fleet data → map)', async () => {
    const mod = await import('../../src/pages/map/hooks/useMapFleetVehicles');
    // Hook is exported as a named function or default — verify the module has a usable export
    const exports = Object.keys(mod);
    expect(exports.length).toBeGreaterThan(0);
  });
});
