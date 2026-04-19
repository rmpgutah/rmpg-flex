// Smoke test for MapPageV2 — verifies the module + its OL hooks load
// without throwing at import time. This catches the most common
// regressions for an opt-in V2 surface: a broken `ol` submodule import,
// a renamed export from the shared utils (statusColors, useGeoJsonLayers),
// or a typo that fails to compile-load.
//
// Render-based smoke testing is intentionally deferred — MapPageV2 needs
// WebSocket + auth providers and a non-jsdom canvas to actually render
// OpenLayers tiles. Phases 4-5 will introduce a provider-stubbing harness
// when the V2 surface needs richer integration coverage.

import { describe, it, expect } from 'vitest';

describe('MapPageV2 smoke', () => {
  it('default export is a function', async () => {
    const mod = await import('../MapPageV2');
    expect(typeof mod.default).toBe('function');
  });

  it('useOlBeatLayer hook exports a function', async () => {
    const mod = await import('../hooks/useOlBeatLayer');
    expect(typeof mod.useOlBeatLayer).toBe('function');
  });

  it('useOlLiveMarkers hook exports a function', async () => {
    const mod = await import('../hooks/useOlLiveMarkers');
    expect(typeof mod.useOlLiveMarkers).toBe('function');
  });

  it('barrel re-exports the page component', async () => {
    const mod = await import('../index');
    expect(typeof mod.default).toBe('function');
  });
});
