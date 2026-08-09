// ============================================================
// RMPG Flex — the ENFORCED CSP (functions/_middleware.ts header)
// must cover every host the meta-tag CSP (index.html) allows.
// ============================================================
// Multiple CSP sources (an HTTP header + a <meta> tag) are merged by
// INTERSECTION per directive — the most restrictive entry from either
// source wins. The Pages middleware header runs first and is the
// enforced policy; the meta tag is documented as a fallback. A host
// present only in the meta tag is therefore still blocked.
//
// This exact drift left weather radar tiles (tilecache.rainviewer.com)
// silently blocked in production while the meta tag already allowed
// them — confirmed live 2026-08-09. See
// client/src/utils/__tests__/mapExternalTileHosts.test.ts for the
// meta-tag side of this same host.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIDDLEWARE = readFileSync(resolve(process.cwd(), 'functions/_middleware.ts'), 'utf8');

function connectSrcHosts(): string[] {
  const match = MIDDLEWARE.match(/const ALLOWED_CONNECT = \[([\s\S]*?)\]\.join/);
  expect(match, 'ALLOWED_CONNECT array not found in functions/_middleware.ts').toBeTruthy();
  return [...match![1].matchAll(/'(https?:\/\/[^']+)'/g)].map((m) => m[1]);
}

// Hosts a currently-shipped feature fetches from at runtime and that must
// therefore appear in the enforced connect-src, not just the meta-tag one.
const REQUIRED_HOSTS = [
  ['https://tilecache.rainviewer.com', 'RainViewer radar TILES (weather radar overlay)'],
  ['https://graph.mapillary.com', 'Mapillary street-level imagery lookup'],
  ['https://api.mapbox.com', 'Mapbox styles/sprites/glyphs/tiles'],
];

describe('functions/_middleware.ts connect-src covers every live-fetched host', () => {
  for (const [host, why] of REQUIRED_HOSTS) {
    it(`allows ${host} — ${why}`, () => {
      expect(connectSrcHosts()).toContain(host);
    });
  }
});
