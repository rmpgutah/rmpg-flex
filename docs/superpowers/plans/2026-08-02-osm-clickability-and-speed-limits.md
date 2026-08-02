# OSM Clickability + Speed-Limit Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 57 OSM overlay categories from PR #3260 clickable and readable, replace the browser's third-party Overpass speed-limit call with RMPG's own OSM data, and surface posted limit + ETA + turn-by-turn on the Dispatch map for the `enroute` → `onscene` window.

**Architecture:** Speed limits are served in two tiers. **Route limits** ride along in the Directions call Dispatch already makes (`useMapRouting.ts:395` already sends `overview=full&steps=true`, which is exactly Mapbox's precondition for `annotations=maxspeed`). **Point limits** come from a new Worker endpoint that reads the existing `osm-traffic` PMTiles archive out of R2. Clickability is fixed inside `useVectorTileLayers.ts`, whose OSM branch currently binds interaction to the wrong layer and declares no popup fields.

**Tech Stack:** Cloudflare Workers + Hono, D1, R2, `pmtiles`, `@mapbox/vector-tile` + `pbf` (new), React 18 + Vite, Mapbox GL JS, Vitest (Node + Miniflare).

## Global Constraints

- **Never hardcode hex in `layerRegistry.ts`** — `layerRegistry.test.ts` fails the build. Colors are CSS variables.
- **Literal hex IS correct in Mapbox paint properties** — mapbox-gl cannot resolve `var()`, and the space-separated `rgb(r g b)` form blanks the map.
- **`#d4a017` is banned** in the blue-silver theme (fails AA at 4.50:1; confusable with `--sev-warn`). Do not introduce it. Pre-existing instances are out of scope.
- **All D1 calls are async** — always `await`.
- **Never build an IN-list from an unbounded array** (D1 100-bound-parameter cap). Not expected in this plan; noted because it 500s silently.
- **OpenStreetMap is a DATA source only.** Do not touch `mapboxBasemap.ts` or `MAP_PALETTE`.
- **Fresh worktree:** run `npm install` at the repo root and `cd client && npm install --legacy-peer-deps` before anything. Without them you get phantom module errors and a red pre-commit hook.
- **Pre-commit hook runs the full Worker vitest suite.** Baseline is green (334 files, 3242 passed). Any red is yours.
- **Never run root and client vitest concurrently** — it fakes ~9 failures. Run serially.
- **Mapbox `annotations` requires `overview=full`** and `maxspeed` works only on `driving` / `driving-traffic` profiles. It is a BETA annotation.
- **The enroute speed comparison is display-only.** Do not add a D1 table, column, or audit row for it.

---

### Task 1: Shared speed-limit parsing utilities

Two near-identical `maxspeed` parsers exist today (`client/src/hooks/useSpeedLimit.ts:52` and `client/src/pages/navigation/hud/useSpeedLimit.ts:33`). This task creates the single implementation both will use, plus the decoder for Mapbox's annotation shape.

**Files:**
- Create: `client/src/utils/speedLimit.ts`
- Test: `client/src/utils/__tests__/speedLimit.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseMaxspeedMph(raw: unknown): number | null`
  - `decodeMaxspeedAnnotation(entry: unknown): number | null`
  - `type MaxspeedAnnotationEntry = { speed?: number; unit?: 'km/h' | 'mph'; unknown?: boolean; none?: boolean }`

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/__tests__/speedLimit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseMaxspeedMph, decodeMaxspeedAnnotation } from '../speedLimit';

describe('parseMaxspeedMph', () => {
  it('parses a bare number', () => {
    expect(parseMaxspeedMph(35)).toBe(35);
  });
  it('parses a bare numeric string', () => {
    expect(parseMaxspeedMph('35')).toBe(35);
  });
  it('parses an explicit mph string', () => {
    expect(parseMaxspeedMph('35 mph')).toBe(35);
  });
  it('converts km/h to mph', () => {
    expect(parseMaxspeedMph('50 km/h')).toBe(31);
  });
  it('converts the kph spelling too', () => {
    expect(parseMaxspeedMph('50 kph')).toBe(31);
  });
  it('returns null for a non-numeric OSM value', () => {
    // Real OSM data carries these; they are not speeds.
    expect(parseMaxspeedMph('none')).toBeNull();
    expect(parseMaxspeedMph('signals')).toBeNull();
  });
  it('returns null for nullish and non-string input', () => {
    expect(parseMaxspeedMph(null)).toBeNull();
    expect(parseMaxspeedMph(undefined)).toBeNull();
    expect(parseMaxspeedMph({})).toBeNull();
  });
  it('rejects zero and negative speeds', () => {
    expect(parseMaxspeedMph(0)).toBeNull();
    expect(parseMaxspeedMph('-20')).toBeNull();
  });
});

describe('decodeMaxspeedAnnotation', () => {
  it('decodes an mph entry', () => {
    expect(decodeMaxspeedAnnotation({ speed: 55, unit: 'mph' })).toBe(55);
  });
  it('decodes and converts a km/h entry', () => {
    expect(decodeMaxspeedAnnotation({ speed: 56, unit: 'km/h' })).toBe(35);
  });
  it('returns null when Mapbox reports the limit unknown', () => {
    expect(decodeMaxspeedAnnotation({ unknown: true })).toBeNull();
  });
  it('returns null when Mapbox reports no limit (autobahn)', () => {
    expect(decodeMaxspeedAnnotation({ none: true })).toBeNull();
  });
  it('returns null for malformed entries', () => {
    expect(decodeMaxspeedAnnotation(null)).toBeNull();
    expect(decodeMaxspeedAnnotation({})).toBeNull();
    expect(decodeMaxspeedAnnotation({ speed: 55 })).toBeNull(); // unit required
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/speedLimit.test.ts`
Expected: FAIL — `Failed to resolve import "../speedLimit"`.

- [ ] **Step 3: Write the implementation**

Create `client/src/utils/speedLimit.ts`:

```ts
// ============================================================
// RMPG Flex — Speed-limit parsing (single source of truth)
// ============================================================
// Consolidates two near-identical parsers that previously lived in
// client/src/hooks/useSpeedLimit.ts and
// client/src/pages/navigation/hud/useSpeedLimit.ts.
//
// Two input shapes are handled:
//   1. A raw OSM `maxspeed` tag value ("35 mph", "50 km/h", 35).
//   2. One entry of Mapbox Directions' `annotation.maxspeed` array,
//      which is an object rather than a scalar.
// Both normalize to whole mph, or null when no usable speed exists.
// ============================================================

const KMH_TO_MPH = 0.621371;

/** One entry of Mapbox Directions' `annotation.maxspeed` array. */
export interface MaxspeedAnnotationEntry {
  speed?: number;
  unit?: 'km/h' | 'mph';
  /** Mapbox sets this when it has no posted limit for the segment. */
  unknown?: boolean;
  /** Mapbox sets this where the limit is unlimited (e.g. a German autobahn). */
  none?: boolean;
}

/**
 * Parse an OSM-style `maxspeed` tag into whole mph.
 * Accepts 35 | "35" | "35 mph" | "50 km/h" | "50 kph".
 * Returns null for non-numeric OSM values ("none", "signals", "walk"),
 * for nullish/non-scalar input, and for non-positive speeds.
 */
export function parseMaxspeedMph(raw: unknown): number | null {
  if (raw == null) return null;

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return Math.round(raw);
  }

  if (typeof raw !== 'string') return null;

  const s = raw.trim().toLowerCase();
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;

  const val = parseFloat(m[1]);
  if (!Number.isFinite(val) || val <= 0) return null;

  // "km/h", "kmh" and "kph" all appear in real OSM data.
  if (s.includes('km') || s.includes('kph')) return Math.round(val * KMH_TO_MPH);
  return Math.round(val);
}

/**
 * Decode one entry of Mapbox's `annotation.maxspeed` array into mph.
 *
 * Per the Directions API reference, `speed` and `unit` are returned together,
 * and `unknown`/`none` are returned INSTEAD of them — never alongside. Both of
 * those mean "no posted limit to show", so both decode to null.
 */
export function decodeMaxspeedAnnotation(entry: unknown): number | null {
  if (entry == null || typeof entry !== 'object') return null;
  const e = entry as MaxspeedAnnotationEntry;
  if (e.unknown === true || e.none === true) return null;
  if (typeof e.speed !== 'number' || !Number.isFinite(e.speed)) return null;
  // `unit` is documented as always present alongside `speed`. Its absence means
  // a shape we don't recognise, and guessing the unit could double a limit.
  if (e.unit !== 'mph' && e.unit !== 'km/h') return null;
  if (e.speed <= 0) return null;
  return e.unit === 'km/h' ? Math.round(e.speed * KMH_TO_MPH) : Math.round(e.speed);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/speedLimit.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/speedLimit.ts client/src/utils/__tests__/speedLimit.test.ts
git commit -m "feat(speed): single maxspeed parser + Mapbox annotation decoder"
```

---

### Task 2: Nearest-way geometry helpers for the point lookup

The point-lookup endpoint needs to find the nearest `maxspeed`-tagged way to a coordinate inside an MVT tile. This task builds the pure geometry and tile-math it needs, with no I/O, so the maths is testable without R2 or a real archive.

**Files:**
- Create: `src/utils/osm/tileGeometry.ts`
- Test: `tests/osmTileGeometry.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `lngLatToTile(lng: number, lat: number, z: number): { x: number; y: number }`
  - `tileExtentToLngLat(x, y, z, px, py, extent): { lng: number; lat: number }`
  - `pointToSegmentMeters(pLng, pLat, aLng, aLat, bLng, bLat): number`
  - `neighborTiles(x: number, y: number, z: number): { x: number; y: number }[]`

- [ ] **Step 1: Write the failing test**

Create `tests/osmTileGeometry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  lngLatToTile, tileExtentToLngLat, pointToSegmentMeters, neighborTiles,
} from '../src/utils/osm/tileGeometry';

describe('lngLatToTile', () => {
  it('maps 0,0 to the middle of the z1 grid', () => {
    expect(lngLatToTile(0, 0, 1)).toEqual({ x: 1, y: 1 });
  });
  it('maps downtown Salt Lake City to its known z13 tile', () => {
    // 40.7608 N, 111.8910 W
    expect(lngLatToTile(-111.891, 40.7608, 13)).toEqual({ x: 1620, y: 3128 });
  });
});

describe('tileExtentToLngLat', () => {
  it('round-trips the tile origin back to a lng/lat inside that tile', () => {
    const z = 13, x = 1620, y = 3128;
    const { lng, lat } = tileExtentToLngLat(x, y, z, 0, 0, 4096);
    expect(lngLatToTile(lng, lat, z)).toEqual({ x, y });
  });
  it('places extent-center near the tile center', () => {
    const z = 13, x = 1620, y = 3128;
    const c = tileExtentToLngLat(x, y, z, 2048, 2048, 4096);
    const o = tileExtentToLngLat(x, y, z, 0, 0, 4096);
    expect(c.lng).toBeGreaterThan(o.lng);
    expect(c.lat).toBeLessThan(o.lat); // y grows southward
  });
});

describe('pointToSegmentMeters', () => {
  it('returns ~0 for a point on the segment', () => {
    expect(pointToSegmentMeters(0, 0, -1, 0, 1, 0)).toBeLessThan(1);
  });
  it('measures perpendicular distance to the segment body', () => {
    // 0.001 deg latitude is ~111 m.
    const d = pointToSegmentMeters(0, 0.001, -1, 0, 1, 0);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });
  it('clamps to the nearer endpoint when the point is beyond the segment', () => {
    // Point is well past B; distance must be to B, not to the infinite line.
    const d = pointToSegmentMeters(2, 0, -1, 0, 1, 0);
    expect(d).toBeGreaterThan(100_000);
  });
  it('handles a degenerate zero-length segment without dividing by zero', () => {
    const d = pointToSegmentMeters(0, 0, 1, 0, 1, 0);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(100_000);
  });
});

describe('neighborTiles', () => {
  it('returns the 8 surrounding tiles plus none of the center', () => {
    const n = neighborTiles(10, 10, 13);
    expect(n).toHaveLength(8);
    expect(n).not.toContainEqual({ x: 10, y: 10 });
    expect(n).toContainEqual({ x: 9, y: 9 });
    expect(n).toContainEqual({ x: 11, y: 11 });
  });
  it('drops neighbours that fall outside the tile pyramid', () => {
    // At z1 the grid is 2x2, so the corner tile has only 3 valid neighbours.
    expect(neighborTiles(0, 0, 1)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/osmTileGeometry.test.ts`
Expected: FAIL — cannot resolve `../src/utils/osm/tileGeometry`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/osm/tileGeometry.ts`:

```ts
// ============================================================
// RMPG Flex — Web-Mercator tile maths for the OSM point lookup
// ============================================================
// Pure functions only — no I/O, no R2, no MVT decoding. Keeping the maths
// here is what lets the nearest-way search be unit-tested without building
// a fixture PMTiles archive.
// ============================================================

const EARTH_RADIUS_M = 6371000;

/** Which XYZ tile contains this coordinate at the given zoom. */
export function lngLatToTile(lng: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  // Clamp so a lat/lng at the very edge of the projection can't index past the
  // grid — callers use this to build R2 keys, and an out-of-range tile 400s.
  const max = n - 1;
  return {
    x: Math.min(max, Math.max(0, x)),
    y: Math.min(max, Math.max(0, y)),
  };
}

/**
 * Convert an MVT-local coordinate (0..extent within tile x/y/z) back to lng/lat.
 * MVT y grows southward, matching XYZ tile y.
 */
export function tileExtentToLngLat(
  x: number, y: number, z: number, px: number, py: number, extent: number,
): { lng: number; lat: number } {
  const n = 2 ** z;
  const worldX = x + px / extent;
  const worldY = y + py / extent;
  const lng = (worldX / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * worldY) / n)));
  return { lng, lat: (latRad * 180) / Math.PI };
}

/**
 * Shortest distance in meters from a point to a line SEGMENT (not the infinite
 * line). Projects into a local equirectangular plane scaled by cos(lat), which
 * is accurate well past the ~1 km scale this lookup cares about and avoids the
 * cost of a full geodesic solve per segment.
 *
 * The segment clamp matters: a road's nearest point is frequently past an
 * endpoint, and an unclamped perpendicular would report a road as closer than
 * it is and pick the wrong speed limit.
 */
export function pointToSegmentMeters(
  pLng: number, pLat: number,
  aLng: number, aLat: number,
  bLng: number, bLat: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const cosLat = Math.cos(toRad(pLat));
  // Local plane in meters, origin at A.
  const px = toRad(pLng - aLng) * cosLat * EARTH_RADIUS_M;
  const py = toRad(pLat - aLat) * EARTH_RADIUS_M;
  const bx = toRad(bLng - aLng) * cosLat * EARTH_RADIUS_M;
  const by = toRad(bLat - aLat) * EARTH_RADIUS_M;

  const lenSq = bx * bx + by * by;
  // Degenerate segment (duplicate vertices are common in real tile data):
  // fall back to point-to-point rather than dividing by zero.
  if (lenSq === 0) return Math.hypot(px, py);

  let t = (px * bx + py * by) / lenSq;
  t = Math.max(0, Math.min(1, t)); // clamp to the segment
  return Math.hypot(px - t * bx, py - t * by);
}

/**
 * The up-to-8 tiles surrounding (x,y) at zoom z, dropping any that fall outside
 * the pyramid. A point near a tile edge can have its nearest road in the
 * neighbouring tile, so the lookup must consider these.
 */
export function neighborTiles(x: number, y: number, z: number): { x: number; y: number }[] {
  const n = 2 ** z;
  const out: { x: number; y: number }[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      out.push({ x: nx, y: ny });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/osmTileGeometry.test.ts`
Expected: PASS — 10 tests.

If the SLC z13 tile assertion fails, print the actual value and correct the
**test** to it — the formula above is the standard slippy-map transform and the
expected constant is the thing more likely to be mistyped. Verify the corrected
value satisfies the round-trip test, which is self-consistent and does not
depend on a hardcoded tile number.

- [ ] **Step 5: Commit**

```bash
git add src/utils/osm/tileGeometry.ts tests/osmTileGeometry.test.ts
git commit -m "feat(osm): web-mercator tile maths for the speed-limit point lookup"
```

---

### Task 3: MVT decode → nearest maxspeed way

Adds the two MVT dependencies and the function that turns raw tile bytes into a nearest-road answer. Separated from the route handler (Task 4) so the decode logic is testable without Miniflare.

**Files:**
- Modify: `package.json` (add `@mapbox/vector-tile`, `pbf`)
- Create: `src/utils/osm/speedLimitLookup.ts`
- Test: `tests/osmSpeedLimitLookup.test.ts`

**Interfaces:**
- Consumes: `pointToSegmentMeters`, `tileExtentToLngLat` from Task 2; `parseMaxspeedMph` is **re-implemented server-side** (see note below).
- Produces:
  - `type SpeedLimitHit = { limitMph: number; roadName: string | null; distanceM: number }`
  - `nearestMaxspeedInTile(tileData: Uint8Array, z, x, y, lng, lat, sourceLayer: string): SpeedLimitHit | null`
  - `parseMaxspeedMphServer(raw: unknown): number | null`

> **Why the parser is duplicated across the Worker/client boundary:** `/src/` and
> `/client/src/` share no build, no tsconfig, and no package.json (CLAUDE.md
> gotcha 2). A Worker file cannot import from `client/src/`. The two copies are
> kept byte-identical in behaviour and both are tested; a shared package is not
> worth introducing for ~25 lines.

- [ ] **Step 1: Add the MVT dependencies**

Run:

```bash
npm install --save @mapbox/vector-tile@^2.0.3 pbf@^4.0.1 && npm install --save-dev @types/mapbox__vector-tile@^1.3.4
```

Both are pure-JS and isomorphic, so they run in workerd without `node:*` shims.

- [ ] **Step 2: Write the failing test**

Create `tests/osmSpeedLimitLookup.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import Pbf from 'pbf';
import { nearestMaxspeedInTile, parseMaxspeedMphServer } from '../src/utils/osm/speedLimitLookup';
import { lngLatToTile } from '../src/utils/osm/tileGeometry';

// ── Minimal MVT writer ───────────────────────────────────────────────────────
// Building a real fixture archive would make this test depend on tippecanoe.
// Instead we hand-encode a single-layer vector tile with the MVT v2 wire format,
// which is small and fully specified. One LineString feature, two properties.
function encodeTile(opts: {
  layer: string;
  extent: number;
  props: Record<string, string>;
  // MVT-local coordinates, 0..extent
  line: [number, number][];
}): Uint8Array {
  const keys = Object.keys(opts.props);
  const values = keys.map((k) => opts.props[k]);

  const pbf = new Pbf();
  pbf.writeMessage(3, (layerObj: typeof opts, p: Pbf) => {
    p.writeVarintField(15, 2);              // version
    p.writeStringField(1, layerObj.layer);  // name
    p.writeVarintField(5, layerObj.extent); // extent

    // feature
    p.writeMessage(2, (_: unknown, fp: Pbf) => {
      fp.writeVarintField(1, 1); // id
      // tags: [keyIdx, valueIdx, ...]
      const tags: number[] = [];
      keys.forEach((_k, i) => { tags.push(i, i); });
      fp.writePackedVarint(2, tags);
      fp.writeVarintField(3, 2); // geometry type: LINESTRING
      // geometry: MoveTo(1) + LineTo(n-1), zigzag deltas
      const geom: number[] = [];
      const zig = (v: number) => (v << 1) ^ (v >> 31);
      geom.push((1 & 0x7) | (1 << 3)); // MoveTo, count 1
      let cx = 0, cy = 0;
      const [first, ...rest] = layerObj.line;
      geom.push(zig(first[0] - cx), zig(first[1] - cy));
      cx = first[0]; cy = first[1];
      geom.push((2 & 0x7) | (rest.length << 3)); // LineTo, count rest
      for (const [x, y] of rest) {
        geom.push(zig(x - cx), zig(y - cy));
        cx = x; cy = y;
      }
      fp.writePackedVarint(4, geom);
    }, layerObj);

    for (const k of keys) p.writeStringField(3, k);
    for (const v of values) {
      p.writeMessage(4, (val: string, vp: Pbf) => { vp.writeStringField(1, val); }, v);
    }
  }, opts);

  return pbf.finish();
}

const Z = 13;
const SLC = { lng: -111.891, lat: 40.7608 };
const { x: TX, y: TY } = lngLatToTile(SLC.lng, SLC.lat, Z);

describe('parseMaxspeedMphServer', () => {
  it('matches the client parser on the shapes that matter', () => {
    expect(parseMaxspeedMphServer('35 mph')).toBe(35);
    expect(parseMaxspeedMphServer('50 km/h')).toBe(31);
    expect(parseMaxspeedMphServer(45)).toBe(45);
    expect(parseMaxspeedMphServer('none')).toBeNull();
    expect(parseMaxspeedMphServer(null)).toBeNull();
  });
});

describe('nearestMaxspeedInTile', () => {
  it('returns the limit and name of a way passing through the query point', () => {
    const tile = encodeTile({
      layer: 'traffic',
      extent: 4096,
      props: { cat: 'maxspeed', maxspeed: '35 mph', name: 'S Main St' },
      line: [[2000, 2000], [2100, 2000]],
    });
    // Query at the tile-local coordinate the line passes through.
    const hit = nearestMaxspeedInTile(tile, Z, TX, TY, SLC.lng, SLC.lat, 'traffic');
    expect(hit).not.toBeNull();
    expect(hit!.limitMph).toBe(35);
    expect(hit!.roadName).toBe('S Main St');
  });

  it('ignores features whose cat is not maxspeed', () => {
    const tile = encodeTile({
      layer: 'traffic',
      extent: 4096,
      props: { cat: 'restriction', maxspeed: '35 mph', name: 'Not A Limit' },
      line: [[2000, 2000], [2100, 2000]],
    });
    expect(nearestMaxspeedInTile(tile, Z, TX, TY, SLC.lng, SLC.lat, 'traffic')).toBeNull();
  });

  it('ignores maxspeed features whose value does not parse', () => {
    const tile = encodeTile({
      layer: 'traffic',
      extent: 4096,
      props: { cat: 'maxspeed', maxspeed: 'signals', name: 'Signals Rd' },
      line: [[2000, 2000], [2100, 2000]],
    });
    expect(nearestMaxspeedInTile(tile, Z, TX, TY, SLC.lng, SLC.lat, 'traffic')).toBeNull();
  });

  it('returns null when the requested source-layer is absent', () => {
    const tile = encodeTile({
      layer: 'something_else',
      extent: 4096,
      props: { cat: 'maxspeed', maxspeed: '35 mph' },
      line: [[2000, 2000], [2100, 2000]],
    });
    expect(nearestMaxspeedInTile(tile, Z, TX, TY, SLC.lng, SLC.lat, 'traffic')).toBeNull();
  });

  it('returns null on undecodable bytes rather than throwing', () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5]);
    expect(() => nearestMaxspeedInTile(junk, Z, TX, TY, SLC.lng, SLC.lat, 'traffic')).not.toThrow();
    expect(nearestMaxspeedInTile(junk, Z, TX, TY, SLC.lng, SLC.lat, 'traffic')).toBeNull();
  });

  it('reports a distance for a nearby but not coincident way', () => {
    const tile = encodeTile({
      layer: 'traffic',
      extent: 4096,
      props: { cat: 'maxspeed', maxspeed: '25 mph', name: 'Side St' },
      line: [[0, 0], [50, 0]],
    });
    const hit = nearestMaxspeedInTile(tile, Z, TX, TY, SLC.lng, SLC.lat, 'traffic');
    expect(hit).not.toBeNull();
    expect(hit!.distanceM).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/osmSpeedLimitLookup.test.ts`
Expected: FAIL — cannot resolve `../src/utils/osm/speedLimitLookup`.

- [ ] **Step 4: Write the implementation**

Create `src/utils/osm/speedLimitLookup.ts`:

```ts
// ============================================================
// RMPG Flex — Nearest posted speed limit from an OSM vector tile
// ============================================================
// Decodes one MVT tile and finds the closest way carrying cat='maxspeed'
// to a query coordinate. Used by GET /api/dispatch/geography/road-speed,
// which reads the tile out of the osm-traffic PMTiles archive in R2.
//
// This exists so RMPG stops asking overpass-api.de — a volunteer-run public
// service with a fair-use policy that excludes production traffic — for a
// fact already sitting in its own R2 bucket.
//
// NOTE ON THE DUPLICATED PARSER: /src (Worker) and /client/src (React) share
// no build or package.json, so this cannot import client/src/utils/speedLimit.
// parseMaxspeedMphServer is behaviourally identical and separately tested.
// ============================================================

import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { pointToSegmentMeters, tileExtentToLngLat } from './tileGeometry';

const KMH_TO_MPH = 0.621371;

export interface SpeedLimitHit {
  limitMph: number;
  roadName: string | null;
  distanceM: number;
}

/** Worker-side twin of client/src/utils/speedLimit.ts#parseMaxspeedMph. */
export function parseMaxspeedMphServer(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return Math.round(raw);
  }
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const val = parseFloat(m[1]);
  if (!Number.isFinite(val) || val <= 0) return null;
  if (s.includes('km') || s.includes('kph')) return Math.round(val * KMH_TO_MPH);
  return Math.round(val);
}

/**
 * Closest cat='maxspeed' way to (lng,lat) within one decoded tile, or null.
 *
 * Returns null rather than throwing on any decode failure: a corrupt or
 * unexpected tile must degrade to "limit unknown", never fault the request.
 * The caller compares hits across several tiles, so a per-tile null is normal.
 */
export function nearestMaxspeedInTile(
  tileData: Uint8Array,
  z: number, x: number, y: number,
  lng: number, lat: number,
  sourceLayer: string,
): SpeedLimitHit | null {
  let layer;
  try {
    const tile = new VectorTile(new Pbf(tileData));
    layer = tile.layers[sourceLayer];
  } catch {
    return null;
  }
  if (!layer) return null;

  const extent = layer.extent || 4096;
  let best: SpeedLimitHit | null = null;

  for (let i = 0; i < layer.length; i++) {
    let feature;
    try {
      feature = layer.feature(i);
    } catch {
      continue; // one bad feature must not abandon the rest of the tile
    }

    const props = feature.properties || {};
    // One shared source per archive holds every category; filter to ours.
    if (props.cat !== 'maxspeed') continue;

    const limitMph = parseMaxspeedMphServer(props.maxspeed);
    // Real OSM carries non-numeric maxspeed values ("signals", "walk"). Those
    // are not a posted limit and must not be reported as one.
    if (limitMph == null) continue;

    let rings;
    try {
      rings = feature.loadGeometry();
    } catch {
      continue;
    }

    for (const ring of rings) {
      for (let k = 0; k + 1 < ring.length; k++) {
        const a = tileExtentToLngLat(x, y, z, ring[k].x, ring[k].y, extent);
        const b = tileExtentToLngLat(x, y, z, ring[k + 1].x, ring[k + 1].y, extent);
        const d = pointToSegmentMeters(lng, lat, a.lng, a.lat, b.lng, b.lat);
        if (best == null || d < best.distanceM) {
          const name = props.name;
          best = {
            limitMph,
            roadName: typeof name === 'string' && name.trim() !== '' ? name : null,
            distanceM: d,
          };
        }
      }
    }
  }

  return best;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/osmSpeedLimitLookup.test.ts`
Expected: PASS — 7 tests.

If the hand-rolled MVT writer proves fiddly, the fallback is to mock
`@mapbox/vector-tile` with `vi.mock` and assert the filtering/nearest logic
against synthetic `layer.feature(i)` objects. Prefer the real encoder: it
proves the decode path, which is the part most likely to be wrong.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/utils/osm/speedLimitLookup.ts tests/osmSpeedLimitLookup.test.ts
git commit -m "feat(osm): decode MVT tiles to find the nearest posted speed limit"
```

---

### Task 4: `GET /api/dispatch/geography/road-speed`

Builds the endpoint `client/src/hooks/useSpeedLimit.ts:114` has been calling since it was written, and which has never existed.

**Files:**
- Modify: `src/routes/dispatch/geography.ts` (add route; imports at top)
- Test: `test-workers/roadSpeed.test.ts`

**Interfaces:**
- Consumes: `nearestMaxspeedInTile`, `SpeedLimitHit` (Task 3); `lngLatToTile`, `neighborTiles` (Task 2).
- Produces: `GET /dispatch/geography/road-speed?lat=&lng=` → `200 { limitMph: number|null, roadName: string|null, distanceM: number|null, source: 'osm' }`

- [ ] **Step 1: Write the failing test**

Create `test-workers/roadSpeed.test.ts`:

```ts
// Route-level tests for the OSM speed-limit point lookup. Mocks the pmtiles
// archive so the test exercises THIS route's validation, tile-fan-out and
// degrade behaviour rather than re-testing the PMTiles library.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getZxy = vi.fn();
vi.mock('pmtiles', () => ({
  PMTiles: class { getZxy = getZxy; },
}));

const nearestMaxspeedInTile = vi.fn();
vi.mock('../src/utils/osm/speedLimitLookup', () => ({
  nearestMaxspeedInTile: (...a: unknown[]) => nearestMaxspeedInTile(...a),
}));

const { Hono } = await import('hono');
const geography = (await import('../src/routes/dispatch/geography')).default;

const app = new Hono<{ Bindings: Record<string, unknown> }>();
app.route('/api/dispatch/geography', geography);

const env = () => ({ MAP_DATA: { async get() { return null; } } }) as unknown as Record<string, unknown>;
const call = (qs: string) =>
  app.request(`/api/dispatch/geography/road-speed${qs}`, {}, env());

beforeEach(() => {
  getZxy.mockReset();
  nearestMaxspeedInTile.mockReset();
  getZxy.mockResolvedValue({ data: new Uint8Array([1]) });
});

describe('GET /road-speed — validation', () => {
  it('400s on a missing lat/lng', async () => {
    expect((await call('')).status).toBe(400);
  });
  it('400s on a non-numeric lat', async () => {
    expect((await call('?lat=abc&lng=-111.9')).status).toBe(400);
  });
  it('400s on an out-of-range lat', async () => {
    expect((await call('?lat=99&lng=-111.9')).status).toBe(400);
  });
  it('400s on an out-of-range lng', async () => {
    expect((await call('?lat=40.76&lng=-999')).status).toBe(400);
  });
});

describe('GET /road-speed — lookup', () => {
  it('returns the nearest hit', async () => {
    nearestMaxspeedInTile.mockReturnValue({ limitMph: 35, roadName: 'S Main St', distanceM: 12 });
    const res = await call('?lat=40.7608&lng=-111.891');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      limitMph: 35, roadName: 'S Main St', distanceM: 12, source: 'osm',
    });
  });

  it('picks the globally nearest hit across tiles, not the first', async () => {
    // Center tile returns a far road; a neighbour returns a nearer one.
    nearestMaxspeedInTile
      .mockReturnValueOnce({ limitMph: 55, roadName: 'Far Hwy', distanceM: 400 })
      .mockReturnValue({ limitMph: 25, roadName: 'Near St', distanceM: 9 });
    const res = await call('?lat=40.7608&lng=-111.891');
    const body = await res.json() as { limitMph: number; roadName: string };
    expect(body.limitMph).toBe(25);
    expect(body.roadName).toBe('Near St');
  });

  it('reports limitMph null when nothing is within the radius cap', async () => {
    nearestMaxspeedInTile.mockReturnValue({ limitMph: 35, roadName: 'Too Far', distanceM: 5000 });
    const res = await call('?lat=40.7608&lng=-111.891');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      limitMph: null, roadName: null, distanceM: null, source: 'osm',
    });
  });

  it('reports limitMph null when no tile has a tagged way', async () => {
    nearestMaxspeedInTile.mockReturnValue(null);
    const res = await call('?lat=40.7608&lng=-111.891');
    expect(res.status).toBe(200);
    expect((await res.json() as { limitMph: number | null }).limitMph).toBeNull();
  });

  it('degrades to 200/null when the archive is missing, not 404 or 500', async () => {
    // A missing archive means "we have no data here", which for a HUD readout
    // is the same operational answer as "no limit posted".
    getZxy.mockRejectedValue(new Error('archive not found'));
    nearestMaxspeedInTile.mockReturnValue(null);
    const res = await call('?lat=40.7608&lng=-111.891');
    expect(res.status).toBe(200);
    expect((await res.json() as { limitMph: number | null }).limitMph).toBeNull();
  });

  it('degrades to 200/null when a tile is empty (204-equivalent)', async () => {
    getZxy.mockResolvedValue(null);
    const res = await call('?lat=40.7608&lng=-111.891');
    expect(res.status).toBe(200);
    expect((await res.json() as { limitMph: number | null }).limitMph).toBeNull();
    expect(nearestMaxspeedInTile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/roadSpeed.test.ts`
Expected: FAIL — every case 404s, because the route does not exist.

- [ ] **Step 3: Write the implementation**

Add to the imports at the top of `src/routes/dispatch/geography.ts`:

```ts
import { PMTiles, type Source, type RangeResponse } from 'pmtiles';
import { lngLatToTile, neighborTiles } from '../../utils/osm/tileGeometry';
import { nearestMaxspeedInTile, type SpeedLimitHit } from '../../utils/osm/speedLimitLookup';
```

Append this route to `src/routes/dispatch/geography.ts`, immediately before the
final `export default geography;`:

```ts
// ── Posted speed limit at a point ───────────────────────────────────────────
// GET /dispatch/geography/road-speed?lat=&lng=  ->  { limitMph, roadName, ... }
//
// Reads the osm-traffic PMTiles archive from R2 and returns the nearest way
// carrying a maxspeed tag. This replaces a direct browser call to
// overpass-api.de (a volunteer-run service whose fair-use policy excludes
// production traffic) with RMPG's own data.
//
// EVERY failure mode degrades to 200 { limitMph: null }. This backs a drive-mode
// HUD readout: "we don't know" and "there is no posted limit" are the same
// operational answer, and neither justifies an error the caller must handle.

/** Zoom of the maxspeed category in config/osm-layers.json. */
const ROAD_SPEED_Z = 13;
/** Source-layer name inside osm-traffic.pmtiles (the OSM group name). */
const ROAD_SPEED_LAYER = 'traffic';
/**
 * Ignore a "nearest" road farther than this. At z13 a tile is ~4.9 km wide, so
 * without a cap the lookup would confidently report a highway a suburb away.
 */
const ROAD_SPEED_MAX_M = 60;

class RoadSpeedR2Source implements Source {
  constructor(private bucket: R2Bucket, private key: string) {}
  getKey() { return this.key; }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const obj = await this.bucket.get(this.key, { range: { offset, length } });
    if (!obj) throw new Error(`archive not found: ${this.key}`);
    return { data: await obj.arrayBuffer() };
  }
}

geography.get('/road-speed', async (c) => {
  const latRaw = c.req.query('lat');
  const lngRaw = c.req.query('lng');
  const lat = Number(latRaw);
  const lng = Number(lngRaw);

  if (latRaw == null || lngRaw == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return c.json({ error: 'lat and lng are required numbers' }, 400);
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return c.json({ error: 'lat/lng out of range' }, 400);
  }

  const miss = { limitMph: null, roadName: null, distanceM: null, source: 'osm' as const };

  try {
    const archive = new PMTiles(
      new RoadSpeedR2Source(c.env.MAP_DATA, 'tiles/osm-traffic.pmtiles'),
    );

    const center = lngLatToTile(lng, lat, ROAD_SPEED_Z);
    // A point near a tile edge can have its nearest road in the next tile over,
    // so search the neighbours too and take the global minimum.
    const candidates = [center, ...neighborTiles(center.x, center.y, ROAD_SPEED_Z)];

    let best: SpeedLimitHit | null = null;
    for (const t of candidates) {
      let tile;
      try {
        tile = await archive.getZxy(ROAD_SPEED_Z, t.x, t.y);
      } catch {
        // Missing archive or unreadable tile — treat as no data here.
        continue;
      }
      if (!tile || !tile.data) continue;

      const hit = nearestMaxspeedInTile(
        new Uint8Array(tile.data as ArrayBuffer),
        ROAD_SPEED_Z, t.x, t.y, lng, lat, ROAD_SPEED_LAYER,
      );
      if (hit && (best == null || hit.distanceM < best.distanceM)) best = hit;
    }

    if (!best || best.distanceM > ROAD_SPEED_MAX_M) return c.json(miss);

    return c.json(
      {
        limitMph: best.limitMph,
        roadName: best.roadName,
        distanceM: Math.round(best.distanceM),
        source: 'osm' as const,
      },
      200,
      // The archive is a static extract, so a coordinate's answer only changes
      // when the extract is rebuilt. Same TTL as the tile route.
      { 'Cache-Control': 'public, max-age=86400' },
    );
  } catch (err) {
    log.error('road-speed lookup failed', { lat, lng }, err as Error);
    return c.json(miss);
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/roadSpeed.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Verify the route is reachable through the real mount**

`/api/dispatch` is behind `authMiddleware`, so this endpoint requires a JWT —
correct, and consistent with the rest of `geography.ts`.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/dispatch/geography.ts test-workers/roadSpeed.test.ts
git commit -m "feat(dispatch): add /geography/road-speed backed by the osm-traffic archive"
```

---

### Task 5: Consolidate the two `useSpeedLimit` hooks

Two hooks share a name and differ in API. The shipping one calls Overpass; the other calls the endpoint that now exists. This task leaves exactly one.

**Files:**
- Modify: `client/src/hooks/useSpeedLimit.ts`
- Delete: `client/src/pages/navigation/hud/useSpeedLimit.ts`
- Modify: `client/src/pages/NavigationPage.tsx:43,1084`
- Modify: `client/src/pages/navigation/hud/__tests__/overSpeedLogic.test.ts:2`
- Test: `client/src/hooks/__tests__/useSpeedLimit.test.ts`

**Interfaces:**
- Consumes: `parseMaxspeedMph` (Task 1); `/dispatch/geography/road-speed` (Task 4).
- Produces:
  - `useSpeedLimit(lat: number|null, lng: number|null, opts?: { enabled?: boolean }): { limitMph: number|null; buffer: number }`
  - `shouldFireOverSpeedAlert(speedMph, limitMph, thresholdMph, lastFiredAt, nowMs): boolean`
  - `OVER_SPEED_COOLDOWN_MS: number`

> The surviving hook adopts the **positional** signature of the deleted one,
> because `NavigationPage.tsx:1084` is the only production call site and it calls
> `useSpeedLimit(gps.latitude, gps.longitude)` and destructures `buffer`.
> Matching it means one import line changes and no behaviour does.

- [ ] **Step 1: Write the failing test**

Replace `client/src/hooks/__tests__/useSpeedLimit.test.ts` entirely:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../useApi', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { useSpeedLimit, shouldFireOverSpeedAlert, OVER_SPEED_COOLDOWN_MS } from '../useSpeedLimit';

beforeEach(() => { apiFetch.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('useSpeedLimit', () => {
  it('starts with no known limit', () => {
    apiFetch.mockResolvedValue({ limitMph: null });
    const { result } = renderHook(() => useSpeedLimit(40.76, -111.89));
    expect(result.current.limitMph).toBeNull();
  });

  it('exposes the posted limit from the road-speed endpoint', async () => {
    apiFetch.mockResolvedValue({ limitMph: 35, roadName: 'S Main St' });
    const { result } = renderHook(() => useSpeedLimit(40.76, -111.89));
    await waitFor(() => expect(result.current.limitMph).toBe(35));
  });

  it('queries the road-speed endpoint, NOT overpass', async () => {
    apiFetch.mockResolvedValue({ limitMph: 35 });
    renderHook(() => useSpeedLimit(40.76, -111.89));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const url = String(apiFetch.mock.calls[0][0]);
    expect(url).toContain('/dispatch/geography/road-speed');
    expect(url).not.toContain('overpass');
  });

  it('clears the limit when a SUCCESSFUL lookup reports none', async () => {
    // Driving from a posted road onto an unposted one must clear the badge --
    // keeping the old value would red-line the HUD against the wrong road.
    apiFetch.mockResolvedValueOnce({ limitMph: 35 });
    const { result, rerender } = renderHook(
      ({ lat, lng }: { lat: number; lng: number }) => useSpeedLimit(lat, lng),
      { initialProps: { lat: 40.76, lng: -111.89 } },
    );
    await waitFor(() => expect(result.current.limitMph).toBe(35));

    apiFetch.mockResolvedValueOnce({ limitMph: null });
    rerender({ lat: 41.0, lng: -112.5 }); // far enough to beat the move threshold
    await waitFor(() => expect(result.current.limitMph).toBeNull());
  });

  it('keeps the last known limit when the lookup THROWS', async () => {
    apiFetch.mockResolvedValueOnce({ limitMph: 35 });
    const { result, rerender } = renderHook(
      ({ lat, lng }: { lat: number; lng: number }) => useSpeedLimit(lat, lng),
      { initialProps: { lat: 40.76, lng: -111.89 } },
    );
    await waitFor(() => expect(result.current.limitMph).toBe(35));

    apiFetch.mockRejectedValueOnce(new Error('offline'));
    rerender({ lat: 41.0, lng: -112.5 });
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.limitMph).toBe(35);
  });

  it('does not query when disabled', async () => {
    renderHook(() => useSpeedLimit(40.76, -111.89, { enabled: false }));
    await new Promise((r) => setTimeout(r, 10));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('does not query for a null fix', async () => {
    renderHook(() => useSpeedLimit(null, null));
    await new Promise((r) => setTimeout(r, 10));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('exposes a redline buffer', () => {
    apiFetch.mockResolvedValue({ limitMph: null });
    const { result } = renderHook(() => useSpeedLimit(40.76, -111.89));
    expect(result.current.buffer).toBe(7);
  });
});

describe('shouldFireOverSpeedAlert', () => {
  it('does not fire without a known limit', () => {
    expect(shouldFireOverSpeedAlert(80, null, 10, null, 1000)).toBe(false);
  });
  it('does not fire below limit + threshold', () => {
    expect(shouldFireOverSpeedAlert(40, 35, 10, null, 1000)).toBe(false);
  });
  it('fires at or above limit + threshold', () => {
    expect(shouldFireOverSpeedAlert(45, 35, 10, null, 1000)).toBe(true);
  });
  it('respects the cooldown', () => {
    expect(shouldFireOverSpeedAlert(45, 35, 10, 1000, 1000 + OVER_SPEED_COOLDOWN_MS - 1)).toBe(false);
    expect(shouldFireOverSpeedAlert(45, 35, 10, 1000, 1000 + OVER_SPEED_COOLDOWN_MS)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/hooks/__tests__/useSpeedLimit.test.ts`
Expected: FAIL — `shouldFireOverSpeedAlert` is not exported from `../useSpeedLimit`, and the hook signature is object-based not positional.

- [ ] **Step 3: Rewrite the surviving hook**

Replace `client/src/hooks/useSpeedLimit.ts` entirely:

```ts
// ============================================================
// useSpeedLimit — posted-speed-limit lookup for the active road
// ============================================================
// Given a live {lat,lng}, throttles lookups so a query fires at most once per
// ~80 m of travel, hits GET /dispatch/geography/road-speed (which reads RMPG's
// own osm-traffic PMTiles archive from R2), and exposes the posted limit in mph.
//
// HISTORY: this replaces TWO hooks. A duplicate at
// client/src/pages/navigation/hud/useSpeedLimit.ts queried overpass-api.de
// directly from the browser on every 120 m of travel — a volunteer-run public
// service whose fair-use policy excludes production traffic, reached over an
// uncached cross-origin request from a moving vehicle. It is deleted; this hook
// keeps its positional signature and its `buffer` so NavigationPage's call site
// is unchanged apart from the import path.
//
// DEGRADES CLEANLY: never throws, never blocks the drive lane.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from './useApi';
import { parseMaxspeedMph } from '../utils/speedLimit';

const MOVE_THRESHOLD_M = 80;
/** Don't re-query faster than this even after 80 m (tunnels, GPS jitter). */
const MIN_QUERY_INTERVAL_MS = 4_000;
/** Safe-ceiling buffer (mph) added on top of the posted limit for the redline. */
const REDLINE_BUFFER_MPH = 7;

export interface UseSpeedLimitOptions {
  /** Master enable (e.g. Drive Mode active). Default true. */
  enabled?: boolean;
}

export interface UseSpeedLimitResult {
  /** Posted limit in mph, or null when unknown / none posted. */
  limitMph: number | null;
  /** Buffer added on top of the posted limit before the HUD redlines. */
  buffer: number;
}

interface RoadSpeedResponse {
  limitMph?: number | null;
  roadName?: string | null;
}

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function useSpeedLimit(
  lat: number | null,
  lng: number | null,
  opts: UseSpeedLimitOptions = {},
): UseSpeedLimitResult {
  const { enabled = true } = opts;
  const [limitMph, setLimitMph] = useState<number | null>(null);

  const lastQueryPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastQueryTsRef = useRef(0);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const now = Date.now();
    const prev = lastQueryPosRef.current;
    const movedEnough =
      !prev || haversineMeters(prev.lat, prev.lng, lat, lng) >= MOVE_THRESHOLD_M;
    const cooledDown = now - lastQueryTsRef.current >= MIN_QUERY_INTERVAL_MS;
    if (!movedEnough || !cooledDown || inFlightRef.current) return;

    lastQueryPosRef.current = { lat, lng };
    lastQueryTsRef.current = now;
    inFlightRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        const data = await apiFetch<RoadSpeedResponse>(
          `/dispatch/geography/road-speed?lat=${lat}&lng=${lng}`,
          { timeoutMs: 6000 } as any,
        );
        if (cancelled) return;
        // Set unconditionally on a SUCCESSFUL query, including null: driving
        // from a posted road onto an unposted one must clear the badge, or the
        // HUD redlines against a limit that no longer applies.
        setLimitMph(parseMaxspeedMph(data?.limitMph));
      } catch {
        // Network error / offline / abort — keep the last known value.
      } finally {
        if (!cancelled) inFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      inFlightRef.current = false;
    };
  }, [lat, lng, enabled]);

  return { limitMph, buffer: REDLINE_BUFFER_MPH };
}

export const OVER_SPEED_COOLDOWN_MS = 60000;

/** Whether an over-speed alert should fire now, given the last time one fired.
 *  Pure so it's cheaply testable without mocking timers/hooks. */
export function shouldFireOverSpeedAlert(
  speedMph: number,
  limitMph: number | null,
  thresholdMph: number,
  lastFiredAt: number | null,
  nowMs: number,
): boolean {
  if (limitMph == null) return false;
  if (speedMph < limitMph + thresholdMph) return false;
  if (lastFiredAt != null && nowMs - lastFiredAt < OVER_SPEED_COOLDOWN_MS) return false;
  return true;
}

export default useSpeedLimit;
```

- [ ] **Step 4: Delete the Overpass hook and repoint its consumers**

```bash
git rm client/src/pages/navigation/hud/useSpeedLimit.ts
```

In `client/src/pages/NavigationPage.tsx`, change line 43 from:

```ts
import { useSpeedLimit, shouldFireOverSpeedAlert } from './navigation/hud/useSpeedLimit';
```

to:

```ts
import { useSpeedLimit, shouldFireOverSpeedAlert } from '../hooks/useSpeedLimit';
```

Line 1084 needs no change — `useSpeedLimit(gps.latitude, gps.longitude)` and the
`{ limitMph, buffer: limitBuffer }` destructure both still match.

In `client/src/pages/navigation/hud/__tests__/overSpeedLogic.test.ts`, change line 2 from:

```ts
import { shouldFireOverSpeedAlert, OVER_SPEED_COOLDOWN_MS } from '../useSpeedLimit';
```

to:

```ts
import { shouldFireOverSpeedAlert, OVER_SPEED_COOLDOWN_MS } from '../../../hooks/useSpeedLimit';
```

- [ ] **Step 5: Verify no dangling references remain**

Run: `grep -rn "hud/useSpeedLimit\|overpass" client/src --include="*.ts" --include="*.tsx"`
Expected: **no output.** Any hit is a missed consumer.

- [ ] **Step 6: Run the tests**

Run: `cd client && npx vitest run src/hooks/__tests__/useSpeedLimit.test.ts src/pages/navigation/hud/__tests__/overSpeedLogic.test.ts`
Expected: PASS — 12 + existing overSpeed tests.

- [ ] **Step 7: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add -A client/src
git commit -m "refactor(speed): one useSpeedLimit hook, backed by RMPG data not overpass"
```

---

### Task 6: Make OSM clicks actually produce a popup

Three defects stack here, and fixing fewer than all three still yields nothing on
screen:

1. `MapboxMapPage.tsx:565` mounts the hook as `useVectorTileLayers({ map, popup: null })`.
   **Every OSM click handler opens `if (!pop || ...) return;`**, so no popup can
   ever appear regardless of binding.
2. Polygon categories bind interaction to their `-outline` layer, so the polygon
   body is inert.
3. The `isLight` recolor effect skips OSM configs.

Defect 1 is upstream of defect 2 — it is why the polygon bug was never noticed.

**Files:**
- Modify: `client/src/hooks/useVectorTileLayers.ts:418-430` (click binding), `:749-761` (recolor effect)
- Modify: `client/src/pages/map/MapboxMapPage.tsx:362` (add ref), `:565` (pass popup)
- Test: `client/src/hooks/__tests__/useVectorTileLayers.osm.test.ts`

**Interfaces:**
- Consumes: `buildOsmLayerSpecs` (existing export).
- Produces: `osmInteractiveLayerIds(cfg: VectorTileLayerConfig, isLight: boolean): string[]` (new export).

- [ ] **Step 1: Write the failing test**

Append to `client/src/hooks/__tests__/useVectorTileLayers.osm.test.ts`:

```ts
import { osmInteractiveLayerIds, buildOsmLayerSpecs, OSM_VECTOR_CONFIGS } from '../useVectorTileLayers';

describe('osmInteractiveLayerIds', () => {
  it('returns EVERY emitted layer id for a polygon category', () => {
    // Polygon categories emit [fill, outline]. Binding only the last one put
    // the click target on a 1px outline, so clicking inside the polygon --
    // which is the whole polygon -- did nothing.
    const poly = OSM_VECTOR_CONFIGS.find((c) => c.categoryRender === 'polygon');
    expect(poly, 'expected at least one polygon OSM category').toBeDefined();

    const specs = buildOsmLayerSpecs(poly!, false);
    expect(specs.length).toBeGreaterThan(1);

    const ids = osmInteractiveLayerIds(poly!, false);
    for (const s of specs) expect(ids).toContain(s.id);
  });

  it('includes the fill layer, not just the outline', () => {
    const poly = OSM_VECTOR_CONFIGS.find((c) => c.categoryRender === 'polygon')!;
    const ids = osmInteractiveLayerIds(poly, false);
    expect(ids.some((id) => id.endsWith('-fill'))).toBe(true);
  });

  it('returns the single id for point and line categories', () => {
    const pt = OSM_VECTOR_CONFIGS.find((c) => c.categoryRender === 'point')!;
    expect(osmInteractiveLayerIds(pt, false)).toHaveLength(1);
    const ln = OSM_VECTOR_CONFIGS.find((c) => c.categoryRender === 'line')!;
    expect(osmInteractiveLayerIds(ln, false)).toHaveLength(1);
  });

  it('returns no duplicate ids', () => {
    for (const cfg of OSM_VECTOR_CONFIGS) {
      const ids = osmInteractiveLayerIds(cfg, false);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/hooks/__tests__/useVectorTileLayers.osm.test.ts`
Expected: FAIL — `osmInteractiveLayerIds` is not exported.

- [ ] **Step 3: Add the helper**

In `client/src/hooks/useVectorTileLayers.ts`, add immediately after
`buildOsmLayerSpecs`:

```ts
/**
 * Every layer id that should carry click/hover for one OSM config.
 *
 * Polygon categories emit BOTH a `-fill` and a `-outline` layer. The original
 * implementation bound interaction to `specs[specs.length - 1]`, described in a
 * comment as "the topmost/interactive one" — but for a polygon that is the 1px
 * outline, so clicking anywhere inside the polygon hit nothing. Binding every
 * emitted id is also correct for any future category that emits more layers.
 */
export function osmInteractiveLayerIds(cfg: VectorTileLayerConfig, isLight: boolean): string[] {
  return Array.from(new Set(buildOsmLayerSpecs(cfg, isLight).map((s) => s.id)));
}
```

- [ ] **Step 4: Use it at the binding site**

In `client/src/hooks/useVectorTileLayers.ts`, replace lines 415-430 (the block
beginning `// Topmost spec is the interactive one`) with:

```ts
          // Bind interaction on EVERY layer this config emits. A polygon
          // category emits [fill, outline]; binding only the last one put the
          // click target on the 1px outline and made the polygon body inert.
          if (!clickBoundRef.current.has(cfg.id)) {
            clickBoundRef.current.add(cfg.id);
            for (const layerId of osmInteractiveLayerIds(cfg, isLightRef.current)) {
              map.on('click', layerId, (e) => {
                const pop = popupRef.current;
                if (!pop || !e.features || e.features.length === 0) return;
                const props = e.features[0].properties || {};
                pop.setLngLat(e.lngLat).setHTML(buildPopupHtml(cfg, props)).addTo(map);
              });
              map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
              map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
            }
          }
```

- [ ] **Step 5: Extend the recolor effect to OSM layers**

In `client/src/hooks/useVectorTileLayers.ts`, replace the effect at lines 749-761
(`// Re-color labels live when the basemap light/dark theme changes`) with:

```ts
  // Re-color live when the basemap light/dark theme changes, for layers already
  // on the map (newly added ones pick up the current theme in addLayer).
  //
  // This previously looped VECTOR_TILE_CONFIGS only, so OSM circle layers — whose
  // circle-stroke-color is derived from isLight at add time — kept a dark stroke
  // after a switch to a light basemap and lost their outline against it.
  useEffect(() => {
    if (!map) return;
    const lp = labelPaint(isLight);
    for (const cfg of VECTOR_TILE_CONFIGS) {
      const id = labelLayerId(cfg.id);
      try {
        if (hasLayer(map, id)) {
          map.setPaintProperty(id, 'text-color', lp.text);
          map.setPaintProperty(id, 'text-halo-color', lp.halo);
        }
      } catch { /* style not ready */ }
    }
    for (const cfg of OSM_VECTOR_CONFIGS) {
      for (const spec of buildOsmLayerSpecs(cfg, isLight)) {
        if (spec.type !== 'circle') continue;
        try {
          if (hasLayer(map, spec.id)) {
            map.setPaintProperty(
              spec.id, 'circle-stroke-color', spec.paint['circle-stroke-color'],
            );
          }
        } catch { /* style not ready */ }
      }
    }
  }, [map, isLight]);
```

- [ ] **Step 6: Supply a real popup to the hook**

Without this the binding fix is invisible: the hook is currently mounted with
`popup: null` and every handler bails on it.

In `client/src/pages/map/MapboxMapPage.tsx`, add beside the existing
`identifyPopupRef` declaration at line 362:

```ts
  // Persistent popup for OSM vector-tile feature clicks. Deliberately NOT
  // identifyPopupRef: that one is created and destroyed per click by the
  // Identify tool, so it is null whenever Identify is not mid-interaction.
  // useVectorTileLayers was previously passed `popup: null`, which made every
  // OSM click handler return before rendering anything.
  const osmPopupRef = useRef<mapboxgl.Popup | null>(null);
  if (osmPopupRef.current === null && typeof window !== 'undefined') {
    osmPopupRef.current = new mapboxgl.Popup({
      closeButton: true,
      closeOnClick: true,
      className: 'mapbox-popup-dark',
      maxWidth: '280px',
    });
  }
```

Then change line 565 from:

```ts
  const vectorTiles = useVectorTileLayers({ map: mapRef.current, popup: null });
```

to:

```ts
  const vectorTiles = useVectorTileLayers({ map: mapRef.current, popup: osmPopupRef.current });
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd client && npx vitest run src/hooks/__tests__/useVectorTileLayers.osm.test.ts && npx tsc --noEmit`
Expected: PASS — 4 new + existing tests; no type errors.

- [ ] **Step 8: Commit**

```bash
git add client/src/hooks/useVectorTileLayers.ts client/src/hooks/__tests__/useVectorTileLayers.osm.test.ts client/src/pages/map/MapboxMapPage.tsx
git commit -m "fix(osm): give vector-tile clicks a popup, bind polygon fills, recolor on theme switch"
```

---

### Task 7: Real popup fields for OSM layers

Every OSM config declares `detailProps: []`, so a click yields a title and nothing else. The tags are already in the tiles and already declared per group in `config/osm-layers.json`.

**Files:**
- Modify: `scripts/gen-osm-client-config.mjs`
- Modify: `client/src/config/osmLayers.generated.ts` (regenerated, not hand-edited)
- Modify: `client/src/hooks/useVectorTileLayers.ts:192` (`detailProps`)
- Test: `tests/osmClientConfigSync.test.ts`

**Interfaces:**
- Consumes: `OSM_GROUPS` (existing).
- Produces: `OsmGroup.properties: string[]` on the generated config; non-empty `detailProps` on every OSM `VectorTileLayerConfig`.

- [ ] **Step 1: Write the failing test**

Append to `tests/osmClientConfigSync.test.ts`:

```ts
import { OSM_GROUPS } from '../client/src/config/osmLayers.generated';
import { readFileSync } from 'node:fs';

describe('generated OSM config carries popup properties', () => {
  const source = JSON.parse(readFileSync('config/osm-layers.json', 'utf8'));
  const groups = Array.isArray(source) ? source : source.groups;

  it('every group exposes a properties array', () => {
    for (const g of OSM_GROUPS) {
      expect(Array.isArray(g.properties), `${g.name} missing properties`).toBe(true);
      expect(g.properties.length, `${g.name} has no properties`).toBeGreaterThan(0);
    }
  });

  it('properties match config/osm-layers.json exactly', () => {
    for (const g of OSM_GROUPS) {
      const src = groups.find((s: { name: string }) => s.name === g.name);
      expect(src, `${g.name} absent from osm-layers.json`).toBeDefined();
      expect(g.properties).toEqual(src.properties);
    }
  });

  it('the traffic group carries maxspeed, since the map must answer what the HUD does', () => {
    const traffic = OSM_GROUPS.find((g) => g.name === 'traffic');
    expect(traffic!.properties).toContain('maxspeed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/osmClientConfigSync.test.ts`
Expected: FAIL — `g.properties` is undefined; the generated type has no such field.

- [ ] **Step 3: Emit `properties` from the generator**

In `scripts/gen-osm-client-config.mjs`, add `properties` to the `OsmGroup`
interface it emits and to each group object it writes.

In the interface block, add after `assignment`:

```js
  properties: string[];
```

In the per-group emit, add alongside the existing `assignment` line:

```js
    properties: ${JSON.stringify(group.properties ?? [])},
```

- [ ] **Step 4: Regenerate and verify no hand-edits**

Run:

```bash
node scripts/gen-osm-client-config.mjs && git diff --stat client/src/config/osmLayers.generated.ts
```

Expected: only `properties: [...]` lines added. If anything else changed, the
generator drifted from the committed file — investigate before continuing.

- [ ] **Step 5: Build `detailProps` from the group properties**

In `client/src/hooks/useVectorTileLayers.ts`, add above `OSM_VECTOR_CONFIGS`:

```ts
// Human labels for the OSM tag keys declared per group in config/osm-layers.json.
// A key with no entry falls back to a title-cased version of itself, so adding a
// property to the JSON never leaves a blank label in a popup.
const OSM_PROP_LABELS: Record<string, string> = {
  name: 'Name',
  ref: 'Ref',
  operator: 'Operator',
  highway: 'Road type',
  maxspeed: 'Speed limit',
  oneway: 'One-way',
  maxheight: 'Max height',
  maxweight: 'Max weight',
  traffic_calming: 'Calming',
  crossing: 'Crossing',
  hazard: 'Hazard',
  enforcement: 'Enforcement',
  surface: 'Surface',
  access: 'Access',
  emergency: 'Emergency',
  amenity: 'Amenity',
  man_made: 'Structure',
  barrier: 'Barrier',
  natural: 'Natural',
  boundary: 'Boundary',
  landuse: 'Land use',
};

function osmPropLabel(key: string): string {
  return OSM_PROP_LABELS[key]
    ?? key.replace(/[_:]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
```

Then in the `OSM_VECTOR_CONFIGS` builder, replace `detailProps: [],` with:

```ts
    // Real popup fields, sourced from the same config/osm-layers.json group
    // `properties` list that decides what the tiles carry — so the popup can
    // never ask for a tag the pipeline did not emit. `name` is excluded here
    // because it is already rendered as the popup title (labelProp).
    detailProps: (group.properties ?? [])
      .filter((p) => p !== 'name')
      .map((p) => ({ key: p, label: osmPropLabel(p) })),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/osmClientConfigSync.test.ts && cd client && npx vitest run src/hooks/__tests__/useVectorTileLayers.osm.test.ts`
Expected: PASS both.

- [ ] **Step 7: Typecheck both projects**

Run: `npm run typecheck && cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add scripts/gen-osm-client-config.mjs client/src/config/osmLayers.generated.ts client/src/hooks/useVectorTileLayers.ts tests/osmClientConfigSync.test.ts
git commit -m "feat(osm): populate popup fields from the generated layer catalog"
```

---

### Task 8: Click-anywhere identify across OSM layers

With 57 categories, hunting for the exact pixel of the right layer is not a workable interaction. One click should report everything under the cursor.

**Files:**
- Create: `client/src/hooks/useOsmIdentify.ts`
- Create: `client/src/hooks/__tests__/useOsmIdentify.test.ts`
- Modify: `client/src/pages/map/MapboxMapPage.tsx` (mount the hook)

**Interfaces:**
- Consumes: `osmInteractiveLayerIds` (Task 6), `OSM_VECTOR_CONFIGS`, `osmPropLabel` behaviour via `detailProps` (Task 7).
- Produces:
  - `type OsmIdentifyGroup = { layerId: string; label: string; color: string; rows: { label: string; value: string }[] }`
  - `buildIdentifyGroups(features, configsById): OsmIdentifyGroup[]`
  - `useOsmIdentify({ map, popup, visibleIds, isLight })`

- [ ] **Step 1: Write the failing test**

Create `client/src/hooks/__tests__/useOsmIdentify.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildIdentifyGroups } from '../useOsmIdentify';
import { OSM_VECTOR_CONFIGS } from '../useVectorTileLayers';

const byId = new Map(OSM_VECTOR_CONFIGS.map((c) => [c.id, c]));
const cfg = OSM_VECTOR_CONFIGS.find((c) => c.id.startsWith('osm_traffic_'))!;

describe('buildIdentifyGroups', () => {
  it('returns nothing for no features', () => {
    expect(buildIdentifyGroups([], byId)).toEqual([]);
  });

  it('groups one feature under its config label', () => {
    const groups = buildIdentifyGroups(
      [{ layer: { id: `vt-${cfg.id}-circle` }, properties: { name: 'Main St' } }],
      byId,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe(cfg.label);
  });

  it('renders declared detailProps as labelled rows', () => {
    const withMaxspeed = OSM_VECTOR_CONFIGS.find(
      (c) => c.detailProps.some((d) => d.key === 'maxspeed'),
    )!;
    const groups = buildIdentifyGroups(
      [{ layer: { id: `vt-${withMaxspeed.id}-line` }, properties: { maxspeed: '35 mph' } }],
      byId,
    );
    expect(groups[0].rows).toContainEqual({ label: 'Speed limit', value: '35 mph' });
  });

  it('omits properties that are absent or blank', () => {
    const groups = buildIdentifyGroups(
      [{ layer: { id: `vt-${cfg.id}-circle` }, properties: { name: 'X', maxspeed: '' } }],
      byId,
    );
    expect(groups[0].rows.some((r) => r.label === 'Speed limit')).toBe(false);
  });

  it('collapses several features of the same layer into one group', () => {
    const f = { layer: { id: `vt-${cfg.id}-circle` }, properties: { name: 'A' } };
    expect(buildIdentifyGroups([f, f, f], byId)).toHaveLength(1);
  });

  it('ignores features from non-OSM layers', () => {
    expect(buildIdentifyGroups(
      [{ layer: { id: 'some-basemap-layer' }, properties: {} }], byId,
    )).toEqual([]);
  });

  it('handles a polygon feature hit on its FILL layer', () => {
    // The whole point of Task 6 -- a polygon body click must identify.
    const poly = OSM_VECTOR_CONFIGS.find((c) => c.categoryRender === 'polygon')!;
    const groups = buildIdentifyGroups(
      [{ layer: { id: `vt-${poly.id}-fill` }, properties: { name: 'Zone' } }], byId,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe(poly.label);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/hooks/__tests__/useOsmIdentify.test.ts`
Expected: FAIL — cannot resolve `../useOsmIdentify`.

- [ ] **Step 3: Write the implementation**

Create `client/src/hooks/useOsmIdentify.ts`:

```ts
// ============================================================
// RMPG Flex — Click-anywhere identify for OSM overlays
// ============================================================
// PR #3260 shipped 57 OSM categories. Per-layer click binding alone means an
// operator must know which layer a feature belongs to before they can click it,
// and must hit that layer's exact pixels. This reports EVERYTHING under the
// cursor in one popup, grouped by layer.
//
// The pure grouping function is separated from the map wiring so the popup
// content is testable without a live Mapbox instance.
// ============================================================

import { useEffect, useRef } from 'react';
import { mapboxgl } from '../utils/mapboxLoader';
import {
  OSM_VECTOR_CONFIGS, osmInteractiveLayerIds, type VectorTileLayerConfig,
} from './useVectorTileLayers';

export interface OsmIdentifyRow { label: string; value: string }

export interface OsmIdentifyGroup {
  layerId: string;
  label: string;
  color: string;
  rows: OsmIdentifyRow[];
}

/** Minimal shape of the queried features we depend on — keeps this testable. */
interface IdentifiableFeature {
  layer?: { id?: string };
  properties?: Record<string, unknown> | null;
}

/** `vt-<configId>-<suffix>` -> `<configId>`. Returns null for non-OSM layers. */
function configIdFromLayerId(layerId: string): string | null {
  const m = /^vt-(.+)-(fill|outline|line|circle|label)$/.exec(layerId);
  return m ? m[1] : null;
}

/**
 * Group queried features by their originating OSM config, rendering each
 * config's declared detailProps as labelled rows. Several features from one
 * layer collapse into a single group — a click near a junction routinely hits
 * a dozen segments of the same road class, and listing each would bury the
 * other layers under the cursor.
 */
export function buildIdentifyGroups(
  features: IdentifiableFeature[],
  configsById: Map<string, VectorTileLayerConfig>,
): OsmIdentifyGroup[] {
  const out: OsmIdentifyGroup[] = [];
  const seen = new Set<string>();

  for (const f of features) {
    const layerId = f.layer?.id;
    if (!layerId) continue;
    const cfgId = configIdFromLayerId(layerId);
    if (!cfgId) continue;
    const cfg = configsById.get(cfgId);
    if (!cfg) continue;
    if (seen.has(cfg.id)) continue;
    seen.add(cfg.id);

    const props = f.properties || {};
    const rows: OsmIdentifyRow[] = [];

    const titleRaw = props[cfg.labelProp];
    if (titleRaw != null && String(titleRaw).trim() !== '') {
      rows.push({ label: 'Name', value: String(titleRaw) });
    }
    for (const d of cfg.detailProps) {
      const v = props[d.key];
      if (v === undefined || v === null || String(v).trim() === '') continue;
      rows.push({ label: d.label, value: String(v) });
    }

    out.push({ layerId, label: cfg.label, color: cfg.color, rows });
  }

  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderIdentifyHtml(groups: OsmIdentifyGroup[], isLight: boolean): string {
  const fg = isLight ? '#222222' : '#d4d4d4';
  const sub = isLight ? '#666666' : '#888888';
  const rule = isLight ? '#cccccc' : '#444444';

  let html = `<div style="font-family:'JetBrains Mono','Courier New',monospace;color:${fg};font-size:11px;min-width:180px;max-height:260px;overflow-y:auto;">`;
  for (const g of groups) {
    html += `<div style="margin-bottom:6px;">`;
    html += `<div style="font-weight:bold;font-size:11px;color:${g.color};border-bottom:1px solid ${rule};padding-bottom:2px;margin-bottom:3px;">${escapeHtml(g.label)}</div>`;
    if (g.rows.length === 0) {
      html += `<div style="font-size:9px;color:${sub};">no attributes mapped</div>`;
    }
    for (const r of g.rows) {
      html += `<div style="font-size:10px;color:${sub};"><span style="color:${fg};">${escapeHtml(r.label)}:</span> ${escapeHtml(r.value)}</div>`;
    }
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}

interface UseOsmIdentifyOptions {
  map: mapboxgl.Map | null;
  popup: mapboxgl.Popup | null;
  /** Config ids currently toggled visible — only these are queried. */
  visibleIds: string[];
  isLight?: boolean;
}

export function useOsmIdentify({ map, popup, visibleIds, isLight = false }: UseOsmIdentifyOptions) {
  const visibleRef = useRef(visibleIds);
  useEffect(() => { visibleRef.current = visibleIds; }, [visibleIds]);
  const isLightRef = useRef(isLight);
  useEffect(() => { isLightRef.current = isLight; }, [isLight]);
  const popupRef = useRef(popup);
  useEffect(() => { popupRef.current = popup; }, [popup]);

  const configsById = useRef(new Map(OSM_VECTOR_CONFIGS.map((c) => [c.id, c])));

  useEffect(() => {
    if (!map) return;

    const onClick = (e: mapboxgl.MapMouseEvent) => {
      const pop = popupRef.current;
      if (!pop) return;

      const visible = new Set(visibleRef.current);
      if (visible.size === 0) return;

      // Only query layers that both exist in the style and are toggled on.
      // queryRenderedFeatures THROWS on an unknown layer id, which would break
      // every click after any style swap that dropped a layer.
      const layerIds: string[] = [];
      for (const cfg of OSM_VECTOR_CONFIGS) {
        if (!visible.has(cfg.id)) continue;
        for (const id of osmInteractiveLayerIds(cfg, isLightRef.current)) {
          if (map.getLayer(id)) layerIds.push(id);
        }
      }
      if (layerIds.length === 0) return;

      let features;
      try {
        features = map.queryRenderedFeatures(e.point, { layers: layerIds });
      } catch {
        return; // style mid-swap — next click retries
      }

      const groups = buildIdentifyGroups(features as unknown as IdentifiableFeature[], configsById.current);
      if (groups.length === 0) return;

      pop.setLngLat(e.lngLat).setHTML(renderIdentifyHtml(groups, isLightRef.current)).addTo(map);
    };

    map.on('click', onClick);
    return () => { map.off('click', onClick); };
  }, [map]);
}

export default useOsmIdentify;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/hooks/__tests__/useOsmIdentify.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Mount the hook**

In `client/src/pages/map/MapboxMapPage.tsx`, add to the imports:

```ts
import { useOsmIdentify } from '../../hooks/useOsmIdentify';
```

Then, immediately after the `useVectorTileLayers(...)` call at line 565 (which
Task 6 changed to pass `osmPopupRef.current`), add:

```ts
  // Click-anywhere identify across every visible OSM layer. Complements the
  // per-layer click binding in useVectorTileLayers: with 57 categories an
  // operator can't be expected to know which layer owns a feature first.
  // Shares osmPopupRef with the per-layer binding so the two can never render
  // two stacked popups for one click.
  useOsmIdentify({
    map: mapRef.current,
    popup: osmPopupRef.current,
    visibleIds: Object.entries(vectorTiles.vectorLayerStates)
      .filter(([, s]) => s.visible)
      .map(([id]) => id),
    isLight: false,
  });
```

`isLight` is `false` here to match the hardcoded `isLight={false}` this page
already passes to `UnifiedMapLegend` at line 1832 — the map page has no
light-basemap state to read. Do not invent one.

- [ ] **Step 6: Hand the popup to identify alone, keeping per-layer hover**

Both systems now fire on the same click and both write to `osmPopupRef`, so a
single click would render a popup twice — whichever handler runs last silently
wins, which is exactly the kind of ordering dependence that breaks later.

Identify supersedes the per-layer popup: it reports every layer under the
cursor rather than one. Keep the per-layer handlers for the **hover cursor**,
which identify does not provide, and drop their popup.

In `client/src/hooks/useVectorTileLayers.ts`, replace the block Task 6 added
(the `for (const layerId of osmInteractiveLayerIds(...))` loop) with:

```ts
          // Hover affordance only. The POPUP for OSM features is owned by
          // useOsmIdentify, which reports every layer under the cursor instead
          // of just this one. Binding a popup here as well would render two for
          // a single click, with the winner decided by handler registration
          // order.
          if (!clickBoundRef.current.has(cfg.id)) {
            clickBoundRef.current.add(cfg.id);
            for (const layerId of osmInteractiveLayerIds(cfg, isLightRef.current)) {
              map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
              map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
            }
          }
```

`buildPopupHtml` stays in use by the UGRC (non-OSM) branch below it — do not
delete it.

- [ ] **Step 7: Typecheck and run the map test suite**

Run: `cd client && npx tsc --noEmit && npx vitest run src/pages/map src/hooks`
Expected: no type errors; all tests pass. The Task 6 tests still pass —
`osmInteractiveLayerIds` is unchanged and still drives the hover binding.

- [ ] **Step 8: Commit**

```bash
git add client/src/hooks/useOsmIdentify.ts client/src/hooks/__tests__/useOsmIdentify.test.ts client/src/hooks/useVectorTileLayers.ts client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(osm): click-anywhere identify across visible OSM layers"
```

---

### Task 9: Route speed limits via the Mapbox annotation

Adds `maxspeed` to the Directions request Dispatch already makes, and exposes the current segment's limit on `RouteInfo`.

**Files:**
- Modify: `client/src/hooks/useMapRouting.ts:395` (annotation), `:62-76` (`RouteInfo`), route-build block near `:468`
- Test: `client/src/hooks/__tests__/useMapRouting.maxspeed.test.ts` (create)

**Interfaces:**
- Consumes: `decodeMaxspeedAnnotation` (Task 1).
- Produces: `RouteInfo.postedLimitMph: number | null`; `pickCurrentSegmentLimit(annotation: unknown[]): number | null`

- [ ] **Step 1: Write the failing test**

Create `client/src/hooks/__tests__/useMapRouting.maxspeed.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pickCurrentSegmentLimit } from '../useMapRouting';

describe('pickCurrentSegmentLimit', () => {
  it('returns null for a missing or empty annotation', () => {
    expect(pickCurrentSegmentLimit(undefined as unknown as unknown[])).toBeNull();
    expect(pickCurrentSegmentLimit([])).toBeNull();
  });

  it('takes the FIRST segment, which is the one being driven now', () => {
    // useMapRouting recomputes from the unit's live origin, so index 0 is the
    // segment under the vehicle -- not the start of the original route.
    expect(pickCurrentSegmentLimit([
      { speed: 35, unit: 'mph' },
      { speed: 65, unit: 'mph' },
    ])).toBe(35);
  });

  it('converts km/h', () => {
    expect(pickCurrentSegmentLimit([{ speed: 56, unit: 'km/h' }])).toBe(35);
  });

  it('falls through to the next known segment when the first is unknown', () => {
    // A short unmapped stub at the origin must not blank the readout for a
    // whole route that is otherwise posted.
    expect(pickCurrentSegmentLimit([
      { unknown: true }, { unknown: true }, { speed: 45, unit: 'mph' },
    ])).toBe(45);
  });

  it('returns null when no segment has a known limit', () => {
    expect(pickCurrentSegmentLimit([{ unknown: true }, { none: true }])).toBeNull();
  });

  it('does not scan indefinitely for a limit far down the route', () => {
    // Only the near-term segments describe the road the unit is on.
    const ann = Array.from({ length: 50 }, () => ({ unknown: true }));
    ann.push({ speed: 70, unit: 'mph' } as never);
    expect(pickCurrentSegmentLimit(ann)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/hooks/__tests__/useMapRouting.maxspeed.test.ts`
Expected: FAIL — `pickCurrentSegmentLimit` is not exported.

- [ ] **Step 3: Add the picker and the `RouteInfo` field**

In `client/src/hooks/useMapRouting.ts`, add the import:

```ts
import { decodeMaxspeedAnnotation } from '../utils/speedLimit';
```

Add after the `RouteStepLane` interface:

```ts
/** How many leading segments to scan for a posted limit before giving up. */
const MAXSPEED_LOOKAHEAD_SEGMENTS = 8;

/**
 * The posted limit for the segment the unit is on right now.
 *
 * `annotation.maxspeed` is per-segment along the route, and useMapRouting
 * recomputes from the unit's LIVE origin, so index 0 is the segment under the
 * vehicle. A short unmapped stub at the origin is common, so scan a few
 * segments ahead — but only a few, since segments far down the route describe
 * a different road.
 */
export function pickCurrentSegmentLimit(annotation: unknown[]): number | null {
  if (!Array.isArray(annotation) || annotation.length === 0) return null;
  const limit = Math.min(annotation.length, MAXSPEED_LOOKAHEAD_SEGMENTS);
  for (let i = 0; i < limit; i++) {
    const mph = decodeMaxspeedAnnotation(annotation[i]);
    if (mph != null) return mph;
  }
  return null;
}
```

Add to the `RouteInfo` interface, after `worstCongestion`:

```ts
  /** Posted speed limit (mph) for the segment being driven now, or null.
   *  Sourced from Mapbox's `annotation.maxspeed`, which rides along in the
   *  same Directions request that produces the ETA and the turn-by-turn steps. */
  postedLimitMph: number | null;
```

- [ ] **Step 4: Request the annotation and populate the field**

In `client/src/hooks/useMapRouting.ts` line 395, change:

```ts
          `&profile=driving-traffic&geometries=geojson&overview=full&steps=true&annotations=congestion`,
```

to:

```ts
          // maxspeed rides along with congestion — same request, and overview=full
          // (already set) is Mapbox's precondition for any annotation.
          `&profile=driving-traffic&geometries=geojson&overview=full&steps=true&annotations=congestion,maxspeed`,
```

Then, in the block that builds the `RouteInfo` object from the response (near
line 468, where `steps` is assembled), add to the constructed object:

```ts
        postedLimitMph: pickCurrentSegmentLimit(
          (route?.legs?.[0]?.annotation?.maxspeed ?? []) as unknown[],
        ),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd client && npx vitest run src/hooks/__tests__/useMapRouting.maxspeed.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 6: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors. If other construction sites of `RouteInfo` exist (e.g. the
multi-stop path near line 819), TypeScript will name them — add
`postedLimitMph: null` to each, since those paths do not request the annotation.

- [ ] **Step 7: Commit**

```bash
git add client/src/hooks/useMapRouting.ts client/src/hooks/__tests__/useMapRouting.maxspeed.test.ts
git commit -m "feat(dispatch): carry posted speed limit on the route via Mapbox maxspeed"
```

---

### Task 10: Gate turn-by-turn to `enroute` → `onscene`, add the speed readout

Turn-by-turn already renders. Voice is already gated. Only the banner is not — `DispatchMiniMap.tsx:457` records that as deliberate; this reverses it at operator request, and adds the `58 in a 35` readout.

**Files:**
- Create: `client/src/components/dispatchNavGate.ts`
- Create: `client/src/components/__tests__/dispatchNavGate.test.ts`
- Modify: `client/src/components/DispatchMiniMap.tsx:462-473` (voice gate), `:616` (banner condition), banner body

**Interfaces:**
- Consumes: `RouteInfo.postedLimitMph` (Task 9).
- Produces:
  - `isNavGuidanceActive(status: string | null | undefined): boolean`
  - `speedComparison(args: { gpsSpeedMps, gpsUpdatedAt, postedLimitMph, nowMs }): { speedMph: number; limitMph: number } | null`
  - `SPEED_FIX_MAX_AGE_MS: number`

- [ ] **Step 1: Write the failing test**

Create `client/src/components/__tests__/dispatchNavGate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isNavGuidanceActive, speedComparison, SPEED_FIX_MAX_AGE_MS } from '../dispatchNavGate';

describe('isNavGuidanceActive', () => {
  it('is active while enroute', () => {
    expect(isNavGuidanceActive('enroute')).toBe(true);
  });
  it('ends on scene', () => {
    expect(isNavGuidanceActive('onscene')).toBe(false);
  });
  it('is inactive before the unit is enroute', () => {
    expect(isNavGuidanceActive('pending')).toBe(false);
    expect(isNavGuidanceActive('dispatched')).toBe(false);
  });
  it('is inactive after the call closes', () => {
    expect(isNavGuidanceActive('cleared')).toBe(false);
    expect(isNavGuidanceActive('closed')).toBe(false);
  });
  it('is inactive for null/undefined', () => {
    expect(isNavGuidanceActive(null)).toBe(false);
    expect(isNavGuidanceActive(undefined)).toBe(false);
  });
});

describe('speedComparison', () => {
  const now = 1_700_000_000_000;
  const fresh = new Date(now - 5_000).toISOString();

  it('converts m/s to mph and pairs it with the limit', () => {
    // 25 m/s = 55.9 mph
    expect(speedComparison({
      gpsSpeedMps: 25, gpsUpdatedAt: fresh, postedLimitMph: 35, nowMs: now,
    })).toEqual({ speedMph: 56, limitMph: 35 });
  });

  it('returns null without a posted limit', () => {
    expect(speedComparison({
      gpsSpeedMps: 25, gpsUpdatedAt: fresh, postedLimitMph: null, nowMs: now,
    })).toBeNull();
  });

  it('returns null without a speed reading', () => {
    expect(speedComparison({
      gpsSpeedMps: null, gpsUpdatedAt: fresh, postedLimitMph: 35, nowMs: now,
    })).toBeNull();
  });

  it('suppresses the comparison when the fix is stale', () => {
    // A stale speed against a fresh limit reads as a confident fact and is not
    // one -- the unit may have stopped, or turned onto a different road.
    const stale = new Date(now - SPEED_FIX_MAX_AGE_MS - 1).toISOString();
    expect(speedComparison({
      gpsSpeedMps: 25, gpsUpdatedAt: stale, postedLimitMph: 35, nowMs: now,
    })).toBeNull();
  });

  it('allows a fix exactly at the age limit', () => {
    const edge = new Date(now - SPEED_FIX_MAX_AGE_MS).toISOString();
    expect(speedComparison({
      gpsSpeedMps: 25, gpsUpdatedAt: edge, postedLimitMph: 35, nowMs: now,
    })).not.toBeNull();
  });

  it('suppresses the comparison when the fix has no timestamp', () => {
    expect(speedComparison({
      gpsSpeedMps: 25, gpsUpdatedAt: undefined, postedLimitMph: 35, nowMs: now,
    })).toBeNull();
  });

  it('suppresses on an unparseable timestamp rather than assuming fresh', () => {
    expect(speedComparison({
      gpsSpeedMps: 25, gpsUpdatedAt: 'not-a-date', postedLimitMph: 35, nowMs: now,
    })).toBeNull();
  });

  it('treats a stationary unit as a real zero, not a missing reading', () => {
    expect(speedComparison({
      gpsSpeedMps: 0, gpsUpdatedAt: fresh, postedLimitMph: 35, nowMs: now,
    })).toEqual({ speedMph: 0, limitMph: 35 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/__tests__/dispatchNavGate.test.ts`
Expected: FAIL — cannot resolve `../dispatchNavGate`.

- [ ] **Step 3: Write the implementation**

Create `client/src/components/dispatchNavGate.ts`:

```ts
// ============================================================
// RMPG Flex — Dispatch nav-guidance lifecycle + speed readout
// ============================================================
// Turn-by-turn guidance on the dispatch map runs for exactly one window:
// it begins when the unit goes EN ROUTE and ends when it arrives ON SCENE.
//
// Extracted as a shared predicate because DispatchMiniMap previously read
// call.status in two independent places -- once to gate voice, once (not at
// all) for the banner -- which is how the two drifted apart.
// ============================================================

/** Statuses during which turn-by-turn guidance is shown and spoken. */
const NAV_ACTIVE_STATUSES = new Set(['enroute']);

/**
 * Whether nav guidance (banner + voice) should run for this call status.
 * Begins at 'enroute', ends at 'onscene'.
 */
export function isNavGuidanceActive(status: string | null | undefined): boolean {
  if (!status) return false;
  return NAV_ACTIVE_STATUSES.has(status);
}

/**
 * Oldest GPS fix whose speed may still be compared against a live posted limit.
 * Beyond this the unit may have stopped or turned onto another road, and the
 * pairing would render a confident-looking reading that is not true.
 */
export const SPEED_FIX_MAX_AGE_MS = 30_000;

const MPS_TO_MPH = 2.236936;

export interface SpeedComparisonArgs {
  /** Ground speed of the last fix, m/s (units.gps_speed). */
  gpsSpeedMps: number | null | undefined;
  /** ISO timestamp of that fix (units.gps_updated_at). */
  gpsUpdatedAt: string | null | undefined;
  /** Posted limit for the current route segment, mph. */
  postedLimitMph: number | null | undefined;
  nowMs: number;
}

export interface SpeedComparison {
  speedMph: number;
  limitMph: number;
}

/**
 * Pair the unit's current speed with the posted limit, or null when the pairing
 * would not be trustworthy.
 *
 * DISPLAY ONLY. This is deliberately not persisted anywhere: a stored record of
 * officer speed exceedances carries legal and HR consequences that a mapping
 * feature must not create as a side effect.
 */
export function speedComparison(args: SpeedComparisonArgs): SpeedComparison | null {
  const { gpsSpeedMps, gpsUpdatedAt, postedLimitMph, nowMs } = args;

  if (typeof postedLimitMph !== 'number' || !Number.isFinite(postedLimitMph)) return null;
  if (typeof gpsSpeedMps !== 'number' || !Number.isFinite(gpsSpeedMps) || gpsSpeedMps < 0) return null;
  if (!gpsUpdatedAt) return null;

  const fixMs = Date.parse(gpsUpdatedAt);
  // An unparseable timestamp is indistinguishable from a missing one; assuming
  // "fresh" would defeat the staleness guard entirely.
  if (!Number.isFinite(fixMs)) return null;
  if (nowMs - fixMs > SPEED_FIX_MAX_AGE_MS) return null;

  return {
    speedMph: Math.round(gpsSpeedMps * MPS_TO_MPH),
    limitMph: Math.round(postedLimitMph),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/__tests__/dispatchNavGate.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Apply the gate in DispatchMiniMap**

In `client/src/components/DispatchMiniMap.tsx`, add the import:

```ts
import { isNavGuidanceActive, speedComparison } from './dispatchNavGate';
```

Replace the voice-gate effect body's first line (currently
`const isEnRoute = call?.status === 'enroute';` at line 464) with:

```ts
    const isEnRoute = isNavGuidanceActive(call?.status);
```

Update the comment block above it (lines 455-461) to read:

```ts
  // Voice-announce the current driving direction at the appropriate time.
  // Because useMapRouting recomputes from the unit's live origin, steps[0]
  // becomes the next maneuver as the unit drives — so we speak whenever that
  // instruction CHANGES (the moment it becomes current). Throttled to one
  // utterance per distinct instruction so we don't repeat on every re-render.
  //
  // Both the spoken directions AND the on-screen banner are gated to the
  // EN-ROUTE phase via isNavGuidanceActive: guidance begins when the call goes
  // 'enroute' and ends once the unit is 'onscene'. The route LINE deliberately
  // still draws at any status — a dispatcher benefits from seeing the path to a
  // dispatched-but-not-yet-enroute call; only the turn-by-turn instructions
  // follow the status. Resetting the throttle ref outside en-route means the
  // first instruction is announced the instant status flips to 'enroute'.
```

Then change the banner condition at line 616 from:

```tsx
      {activeRoute?.steps && activeRoute.steps.length > 0 && (
```

to:

```tsx
      {isNavGuidanceActive(call?.status) && activeRoute?.steps && activeRoute.steps.length > 0 && (
```

- [ ] **Step 6: Add the speed readout to the banner**

Inside the banner's ETA row in `client/src/components/DispatchMiniMap.tsx` — the
`<div>` containing `{activeRoute.eta}` and `{activeRoute.distance}` — add after
the distance span:

```tsx
            {(() => {
              // Display-only speed context for the responding unit. Suppressed
              // when the GPS fix is stale (see dispatchNavGate.speedComparison)
              // so a paused reading never renders as a live fact.
              const assigned = assignedUnits[0];
              const cmp = speedComparison({
                gpsSpeedMps: assigned?.gps_speed,
                gpsUpdatedAt: assigned?.gps_updated_at,
                postedLimitMph: activeRoute.postedLimitMph,
                nowMs: Date.now(),
              });
              if (!cmp) {
                if (activeRoute.postedLimitMph == null) return null;
                return (
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 700 }}>
                    {activeRoute.postedLimitMph} limit
                  </span>
                );
              }
              const over = cmp.speedMph > cmp.limitMph;
              return (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 900,
                    color: over ? 'var(--sev-warn)' : 'var(--text-secondary)',
                  }}
                >
                  {cmp.speedMph} in a {cmp.limitMph}
                </span>
              );
            })()}
```

`assignedUnits` is already computed in this component at line 157.

- [ ] **Step 7: Run the component tests and typecheck**

Run: `cd client && npx vitest run src/components && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 8: Commit**

```bash
git add client/src/components/dispatchNavGate.ts client/src/components/__tests__/dispatchNavGate.test.ts client/src/components/DispatchMiniMap.tsx
git commit -m "feat(dispatch): gate turn-by-turn to enroute-onscene and show speed vs posted limit"
```

---

### Task 11: Full-suite verification

Every prior task ran targeted tests. A red test can hide behind green targeted runs for several tasks (this happened during the 2026-07-24 sweep), so the full suite is the gate.

**Files:** none modified unless a failure is found.

- [ ] **Step 1: Worker typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Worker unit tests**

Run: `npx vitest run`
Expected: PASS. Baseline before this work was 334 files / 3242 passed; expect that plus the new files.

- [ ] **Step 3: Worker integration tests**

Run: `npx vitest run --config vitest.workers.config.mts`
Expected: PASS, including the new `roadSpeed.test.ts`.

- [ ] **Step 4: Client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Client tests**

Run: `cd client && npx vitest run`
Expected: PASS. Baseline was 443 files / 3101 passed.

> Do NOT run this concurrently with the Worker suite — concurrent runs fake
> roughly nine failures. If you see timeout failures in `tests/pdfSign.test.ts`
> or `tests/footage/flexcamRoute.test.ts`, check machine load and re-run
> serially before treating them as real.

- [ ] **Step 6: Client build**

Run: `cd client && npx vite build`
Expected: build succeeds.

- [ ] **Step 7: Verify the Overpass dependency is gone**

Run: `grep -rn "overpass" client/src src`
Expected: **no output.**

- [ ] **Step 8: Commit any fixes**

```bash
git add -A
git commit -m "test: full-suite verification for OSM clickability + speed limits"
```

---

## Post-merge operational steps

No D1 migration is required — this plan adds no table or column, by design.

1. **Verify the archive is present in R2.** The point lookup reads
   `tiles/osm-traffic.pmtiles` from the `system-essentials` bucket (`MAP_DATA`).
   If it is absent, `/road-speed` correctly returns `{limitMph: null}` forever and
   the Nav HUD silently shows no limit — indistinguishable from "no limit posted".
   Confirm the object exists before concluding the feature works.
2. **Verify in a real browser, not curl.** Every path except `/api/health` sits
   behind a Cloudflare managed challenge, so curl returns 403 regardless of health.
3. **Confirm `MAPBOX_ACCESS_TOKEN` is set on the Worker.** `annotations=maxspeed`
   flows through the existing `/api/mapbox/directions` proxy, which 503s without it.

## Deliberately unchanged

**`src/utils/eta.ts` keeps `overview=false`.** The design doc anticipated moving
it to `overview=full` to carry the `maxspeed` annotation. That turned out to be
unnecessary: the Dispatch banner sources its route from `useMapRouting`
(`client/src/hooks/useMapRouting.ts:395`), which already sends `overview=full`.
`eta.ts` is a separate server-side ETA path that no consumer in this plan reads a
speed limit from, so it keeps the smaller no-geometry response.

## Deferred (not in this plan)

- **Per-category OSM colors.** All 7 traffic categories currently render the same
  `#d0d8e0` and are visually indistinguishable.
- **Legend rows for active OSM layers.** `UnifiedMapLegend` renders attribution
  but no swatches, so an operator cannot decode the colors on screen.
- **`#d4a017` removal.** Present in `UnifiedMapLegend.tsx:73`, its `HSWATCH.area`
  entry, and `DispatchMiniMap.tsx`'s grid overlay (`rgba(212,160,23,0.04)`).
  Banned by CLAUDE.md — fails AA at 4.50:1 and is confusable with `--sev-warn`,
  which on a CAD surface means decorative gold can read as a live alert.
- **Persisting speed exceedances.** Deliberately excluded; see Task 10.
