// ============================================================
// RMPG Flex — map tile hosts must be reachable under the CSP
// ============================================================
// The weather radar was dead on live because of a CSP gap that produced NO
// error anywhere: the layer was added successfully, Mapbox requested its
// tiles, every request was blocked, and the overlay simply rendered nothing.
//
// The subtlety that made it survive review: RainViewer serves the frame INDEX
// and the TILES from two different hosts.
//
//   index : https://api.rainviewer.com/public/weather-maps.json   (allow-listed)
//   tiles : https://tilecache.rainviewer.com/v2/radar/...          (NOT allow-listed)
//
// So the fetch that a developer would naturally test by hand worked fine.
// Measured against production 2026-07-31:
//
//   fetch(tileUrl)      -> BLOCKED, "Failed to fetch"
//   new Image().src=url -> loaded 256x256
//
// That split is the trap. `img-src` permits `https:`, so tiles load as <img>;
// but Mapbox GL v3 pulls raster tiles through `fetch` (for cancellation and
// CORS control), which is governed by `connect-src`. Any raster/vector tile
// host therefore needs an explicit `connect-src` entry — being fine in a
// browser address bar or an <img> proves nothing.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INDEX_HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

function connectSrc(): string {
  const csp = INDEX_HTML.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  expect(csp, 'no CSP meta tag found in index.html').toBeTruthy();
  const directive = csp![1].split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src'));
  expect(directive, 'CSP has no connect-src directive').toBeTruthy();
  return directive!;
}

// Hosts this app fetches map tiles or map data from at runtime. Mapbox GL
// requests all of these via fetch(), so each needs a connect-src entry.
const REQUIRED_TILE_HOSTS = [
  ['https://api.mapbox.com', 'Mapbox styles, sprites, glyphs and tiles'],
  ['https://api.rainviewer.com', 'RainViewer frame index (weather radar)'],
  ['https://tilecache.rainviewer.com', 'RainViewer radar TILES — a different host from the index'],
];

describe('CSP connect-src covers every map tile host', () => {
  for (const [host, why] of REQUIRED_TILE_HOSTS) {
    it(`allows ${host} — ${why}`, () => {
      expect(connectSrc()).toContain(host);
    });
  }

  it('allow-lists the RainViewer TILE host, not just its index host', () => {
    // The exact regression: api.* present, tilecache.* missing. Asserted
    // separately from the loop so the failure message names the real trap.
    const directive = connectSrc();
    const hasIndex = directive.includes('https://api.rainviewer.com');
    const hasTiles = directive.includes('https://tilecache.rainviewer.com');
    expect(
      hasIndex && !hasTiles,
      'connect-src allows the RainViewer index but not its tile host. The radar '
        + 'layer will add cleanly and render nothing, with no console error from '
        + 'our code. Add https://tilecache.rainviewer.com.',
    ).toBe(false);
  });

  it('the radar hook still reads its tile host from the API payload', () => {
    // If this stops being true (e.g. the host gets hardcoded), the allow-list
    // above is guarding the wrong thing and should be revisited.
    const hook = readFileSync(resolve(process.cwd(), 'src/hooks/useMapWeatherRadar.ts'), 'utf8');
    expect(hook).toMatch(/buildTileUrl\(\s*host/);
    expect(hook).toContain('api.rainviewer.com');
  });
});
