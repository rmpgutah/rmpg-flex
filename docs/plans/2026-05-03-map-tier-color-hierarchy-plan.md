# Map Tier-Color Hierarchy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Render every beat polygon with section-color fill, zone-color border, full chart label, and an area-boundary line overlay — encoding all 4 hierarchy tiers in a single map view, gated by a "Hierarchy Colors" toggle in the Spatial Layers panel.

**Architecture:** Single `/api/dispatch/districts` fetch (already happens on map load) feeds three client-side color/area lookup maps. Beat polygon styler reads from those maps in O(1). A separate 5-feature LineString overlay (computed once via `@turf/dissolve`) draws the inter-area macro boundary. Toggle persists in localStorage; off = identical to current single-color behavior.

**Tech Stack:** TypeScript · React 18 · Google Maps JS API · `@turf/dissolve` · Vitest · Express 5 · better-sqlite3

**Design doc:** [docs/plans/2026-05-03-map-tier-color-hierarchy-design.md](2026-05-03-map-tier-color-hierarchy-design.md)

**Affected files** (all paths relative to repo root):
- `server/src/routes/dispatch/aggregates.ts` (modify line 843)
- `client/src/utils/colorLookup.ts` (new)
- `client/src/utils/dissolveAreas.ts` (new)
- `client/src/hooks/useGeoJsonLayers.ts` (modify)
- `client/src/pages/map/MapPage.tsx` (modify)
- `client/public/sw.js` (bump CACHE_NAME)
- `client/src/utils/__tests__/colorLookup.test.ts` (new)
- `client/src/utils/__tests__/dissolveAreas.test.ts` (new)

---

## Task 1: Extend `/api/dispatch/districts` response shape

**Why:** The existing route returns sector_code, zone_code, beat_code, names. The client needs `area_id` (for dissolve grouping) and the two stored color columns (`sector_color`, `zone_color`) to drive fills/strokes.

**Files:**
- Modify: `server/src/routes/dispatch/aggregates.ts:840-855`

**Step 1: Read the current SELECT**

Run: `sed -n '840,860p' server/src/routes/dispatch/aggregates.ts`
Expected output: a SELECT joining `dispatch_beats db2` → `dispatch_zones dz` → `dispatch_sectors ds` returning `id, sector_id, zone_id, beat_id, dispatch_code, sector_name, zone_name, beat_name, beat_descriptor`.

**Step 2: Apply the edit**

Replace the SELECT clause to also project `ds.area_id`, `ds.color AS sector_color`, `dz.color AS zone_color`:

```ts
let query = `
  SELECT db2.id, ds.sector_code as sector_id, dz.zone_code as zone_id, db2.beat_code as beat_id,
         db2.beat_code as dispatch_code, ds.sector_name, dz.zone_name,
         db2.beat_name, db2.beat_descriptor,
         ds.area_id, ds.color as sector_color, dz.color as zone_color
  FROM dispatch_beats db2
  JOIN dispatch_zones dz ON dz.id = db2.zone_id
  JOIN dispatch_sectors ds ON ds.id = dz.sector_id
`;
```

**Step 3: Server typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: 0 errors.

**Step 4: Hit the live endpoint via the local dev server (or skip if no auth available locally)**

Optional sanity check — if dev server is up: `curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/dispatch/districts?limit=1 | jq '.[0] | keys'`
Expected: includes `area_id`, `sector_color`, `zone_color`.

**Step 5: Commit**

```bash
git add server/src/routes/dispatch/aggregates.ts
git commit -m "feat(api): expose area_id + tier colors on /dispatch/districts"
```

---

## Task 2: Color lookup utility (`hashToHsl`)

**Why:** When `dispatch_sectors.color` / `dispatch_zones.color` is null, the client needs a deterministic color from the code string. Using golden-ratio hue distribution guarantees ≥16° hue separation across 22 sectors so adjacent polygons stay distinguishable.

**Files:**
- Create: `client/src/utils/colorLookup.ts`
- Test: `client/src/utils/__tests__/colorLookup.test.ts`

**Step 1: Write the failing tests**

```ts
// client/src/utils/__tests__/colorLookup.test.ts
import { describe, expect, it } from 'vitest';
import { hashToHsl } from '../colorLookup';

describe('hashToHsl', () => {
  it('is deterministic for the same input', () => {
    expect(hashToHsl('SL1')).toBe(hashToHsl('SL1'));
    expect(hashToHsl('UTC1')).toBe(hashToHsl('UTC1'));
  });

  it('returns a syntactically valid HSL string', () => {
    expect(hashToHsl('SL1')).toMatch(/^hsl\(\d+(?:\.\d+)?, \d+%, \d+%\)$/);
  });

  it('22 distinct codes produce 22 hues each ≥16 degrees apart', () => {
    const codes = ['SL1','SL2','SL3','UT1','UT2','UT3','DV1','DV2','DV3',
                   'WB1','WB2','WB3','WS1','WS2','TO1','SM1','WA1','BE1',
                   'BV1','CB1','CH1','CH2'];
    const hues = codes.map((c) => {
      const m = hashToHsl(c).match(/^hsl\((\d+(?:\.\d+)?)/);
      return Number(m![1]);
    }).sort((a, b) => a - b);
    for (let i = 1; i < hues.length; i++) {
      expect(hues[i] - hues[i - 1]).toBeGreaterThanOrEqual(16);
    }
  });
});
```

**Step 2: Run the tests; verify failure**

Run: `cd client && npx vitest run src/utils/__tests__/colorLookup.test.ts`
Expected: FAIL with `Cannot find module '../colorLookup'`.

**Step 3: Implement minimal**

```ts
// client/src/utils/colorLookup.ts
const GOLDEN_RATIO_CONJUGATE = 0.61803398875;

/** Hash a string to a stable seed in [0, 1). */
function strHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000; // [0, 1)
}

/**
 * Deterministic HSL color from a string key. Hue advances by golden ratio
 * for low-collision distribution; saturation + lightness fixed for the
 * dispatch dark theme.
 */
export function hashToHsl(code: string): string {
  if (!code) return 'hsl(0, 0%, 50%)';
  const seed = strHash(code);
  const hue = Math.floor((seed + GOLDEN_RATIO_CONJUGATE * code.length) * 360) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}
```

**Step 4: Run the tests; verify pass**

Run: `cd client && npx vitest run src/utils/__tests__/colorLookup.test.ts`
Expected: PASS — 3 tests.

If the "16 degrees apart" test fails, the seeding strategy has too much clumping for this code set. Bump the multiplier on `code.length` (try `* 7` or `* 11`) and rerun. Don't relax the 16° threshold without telling the user — visual distinguishability is the whole reason this helper exists.

**Step 5: Commit**

```bash
git add client/src/utils/colorLookup.ts client/src/utils/__tests__/colorLookup.test.ts
git commit -m "feat(map): hashToHsl deterministic palette helper"
```

---

## Task 3: Install `@turf/dissolve` if missing

**Why:** The area-boundary overlay needs polygon dissolve. Check if `@turf/turf` umbrella is already a dep (it pulls dissolve transitively); add `@turf/dissolve` directly only if needed.

**Files:**
- Possibly modify: `client/package.json`, `client/package-lock.json`

**Step 1: Check current dep tree**

Run: `cd client && npm ls @turf/dissolve 2>&1 | head -5`
Expected (one of):
- Already present (`@turf/dissolve@x.y.z`) → skip to Task 4
- "empty" / not present → continue this task

**Step 2: Install the dep**

Run: `cd client && npm install --save @turf/dissolve`
Expected: adds ~12 KB gzipped to bundle.

**Step 3: Verify it imports**

Run: `cd client && node -e "import('@turf/dissolve').then(m => console.log(Object.keys(m)))"`
Expected: includes a `default` export.

**Step 4: Run client typecheck — confirm no break**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors.

**Step 5: Commit**

```bash
git add client/package.json client/package-lock.json
git commit -m "chore(deps): add @turf/dissolve for area-boundary overlay"
```

---

## Task 4: Dissolve-areas utility

**Why:** `@turf/dissolve` collapses adjacent same-area beat polygons into 5 area polygons; we then extract their outer rings as LineString features for the macro-boundary overlay.

**Files:**
- Create: `client/src/utils/dissolveAreas.ts`
- Test: `client/src/utils/__tests__/dissolveAreas.test.ts`

**Step 1: Write the failing tests with a 4-beat fixture**

```ts
// client/src/utils/__tests__/dissolveAreas.test.ts
import { describe, expect, it } from 'vitest';
import { dissolveBeatsByArea } from '../dissolveAreas';
import type { Feature, Polygon } from 'geojson';

const beat = (id: string, coords: number[][][]): Feature<Polygon> => ({
  type: 'Feature',
  properties: { beat_code: id },
  geometry: { type: 'Polygon', coordinates: coords },
});

// 2x2 grid: A1, A2 share area=1 (left); B1, B2 share area=2 (right)
const fixture: Feature<Polygon>[] = [
  beat('A1', [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]),
  beat('A2', [[[0, 1], [1, 1], [1, 2], [0, 2], [0, 1]]]),
  beat('B1', [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]]),
  beat('B2', [[[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]]),
];
const beatToArea = new Map<string, number>([
  ['A1', 1], ['A2', 1], ['B1', 2], ['B2', 2],
]);

describe('dissolveBeatsByArea', () => {
  it('produces one boundary linestring per area (2 areas → 2 boundaries)', () => {
    const lines = dissolveBeatsByArea(fixture, beatToArea);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.geometry.type === 'LineString')).toBe(true);
  });

  it('excludes beats with no area_id from the dissolve', () => {
    const partial = new Map<string, number>([['A1', 1], ['A2', 1]]);
    const lines = dissolveBeatsByArea(fixture, partial);
    expect(lines).toHaveLength(1);
  });

  it('returns one outer-boundary linestring when all beats share an area', () => {
    const allSame = new Map<string, number>([['A1', 1], ['A2', 1], ['B1', 1], ['B2', 1]]);
    const lines = dissolveBeatsByArea(fixture, allSame);
    expect(lines).toHaveLength(1);
  });
});
```

**Step 2: Run; verify failure**

Run: `cd client && npx vitest run src/utils/__tests__/dissolveAreas.test.ts`
Expected: FAIL with "Cannot find module '../dissolveAreas'".

**Step 3: Implement minimal**

```ts
// client/src/utils/dissolveAreas.ts
import type { Feature, FeatureCollection, LineString, Polygon } from 'geojson';
import dissolve from '@turf/dissolve';

/**
 * Dissolves a set of beat polygons grouped by area_id into one outer-ring
 * LineString feature per area. Beats not present in `beatToArea` are
 * dropped before the dissolve.
 *
 * The output features carry `properties.area_id` so the renderer can
 * look up the per-area color.
 */
export function dissolveBeatsByArea(
  beats: Feature<Polygon>[],
  beatToArea: Map<string, number | string>,
): Feature<LineString>[] {
  // Tag each beat with its area_id and drop those without one.
  const tagged: Feature<Polygon>[] = beats
    .map((f) => {
      const beatCode = (f.properties as any)?.beat_code as string | undefined;
      if (!beatCode) return null;
      const areaId = beatToArea.get(beatCode);
      if (areaId == null) return null;
      return {
        ...f,
        properties: { ...(f.properties || {}), area_id: areaId },
      } as Feature<Polygon>;
    })
    .filter((f): f is Feature<Polygon> => f !== null);

  if (tagged.length === 0) return [];

  const fc: FeatureCollection<Polygon> = { type: 'FeatureCollection', features: tagged };
  const dissolved = dissolve(fc, { propertyName: 'area_id' });

  // Convert each dissolved polygon to its outer-ring linestring.
  return dissolved.features.map((p) => ({
    type: 'Feature',
    properties: p.properties,
    geometry: { type: 'LineString', coordinates: (p.geometry as Polygon).coordinates[0] },
  }));
}
```

**Step 4: Run; verify pass**

Run: `cd client && npx vitest run src/utils/__tests__/dissolveAreas.test.ts`
Expected: PASS — 3 tests.

If `@turf/dissolve` requires a default-import shim, change `import dissolve from '@turf/dissolve'` to `import * as Dissolve from '@turf/dissolve'; const dissolve = (Dissolve as any).default ?? Dissolve;`.

**Step 5: Commit**

```bash
git add client/src/utils/dissolveAreas.ts client/src/utils/__tests__/dissolveAreas.test.ts
git commit -m "feat(map): dissolveBeatsByArea utility for area-boundary overlay"
```

---

## Task 5: Build hierarchy lookup tables in MapPage

**Why:** The `/dispatch/districts` resolver in MapPage already builds a `BeatDistrictEntry` map. Extend it to also produce three new lookup maps consumed by the beat styler in `useGeoJsonLayers`.

**Files:**
- Modify: `client/src/pages/map/MapPage.tsx:553-578` (the `apiFetch<any[]>('/dispatch/districts')` block)

**Step 1: Read the current resolver**

Run: `sed -n '553,580p' client/src/pages/map/MapPage.tsx`
Expected output: the `for (const d of districts)` loop populating `BeatDistrictEntry` records and `sectionSet`.

**Step 2: Apply the edit**

Just inside the same block, after `setBeatDistrictMap(map);`, build and set the three new lookup states. Add to the React state at the top of MapPage:

```ts
const [hierarchyColors, setHierarchyColors] = useState<{
  sectionColors: Map<string, string>;
  zoneColors: Map<string, string>;
  areaColors: Map<string | number, string>;
  beatToArea: Map<string, string | number>;
} | null>(null);
```

In the resolver block, replace the existing loop with a version that also fills the new tables. Use `hashToHsl` from Task 2 as the fallback when a stored color is null:

```ts
import { hashToHsl } from '../../utils/colorLookup';
// ...
const sectionColors = new Map<string, string>();
const zoneColors = new Map<string, string>();
const areaColors = new Map<string | number, string>();
const beatToArea = new Map<string, string | number>();

for (const d of districts) {
  if (!d.zone_id || !d.beat_id) continue;
  // ...existing BeatDistrictEntry build...
  if (d.sector_id) sectionColors.set(d.sector_id, d.sector_color || hashToHsl(d.sector_id));
  if (d.zone_id) zoneColors.set(d.zone_id, d.zone_color || hashToHsl(d.zone_id));
  if (d.area_id != null) {
    areaColors.set(d.area_id, hashToHsl(`area-${d.area_id}`));
    beatToArea.set(d.beat_id, d.area_id);
  }
}
setBeatDistrictMap(map);
setHierarchyColors({ sectionColors, zoneColors, areaColors, beatToArea });
```

**Step 3: Client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors. If the server hasn't been redeployed yet (Task 1), `d.sector_color` will be `undefined` at runtime which is fine — `hashToHsl` covers it.

**Step 4: No new tests this step** — covered by manual visual verification in Task 9. Run the existing client suite to ensure no regression:

Run: `cd client && npx vitest run`
Expected: all existing tests still pass.

**Step 5: Commit**

```bash
git add client/src/pages/map/MapPage.tsx
git commit -m "feat(map): build sector/zone/area color lookups from /districts"
```

---

## Task 6: Beat polygon styler reads hierarchy colors

**Why:** The beat polygon visual encoding (Section fill + Zone border) goes here.

**Files:**
- Modify: `client/src/hooks/useGeoJsonLayers.ts` — add new prop, extend the data layer's `setStyle` callback for `cfg.id === 'beat'`

**Step 1: Read the current beat-style callback**

Run: `grep -n "setStyle\|beat'" client/src/hooks/useGeoJsonLayers.ts | head -10`
Expected: ≥1 hit on `setStyle((feature) => …)` near line 350-400.

**Step 2: Add the prop to `UseGeoJsonLayersOptions`**

Find `interface UseGeoJsonLayersOptions { … }` (~line 213) and add:

```ts
hierarchyColors?: {
  sectionColors: Map<string, string>;
  zoneColors: Map<string, string>;
  areaColors: Map<string | number, string>;
  beatToArea: Map<string, string | number>;
} | null;
```

Wire `hierarchyColors` into the destructure at the function top and capture in a ref so the lazy `setStyle` callback always reads current state without triggering a layer rebuild.

**Step 3: Update the beat polygon styler**

Inside the `setStyle((feature) => …)` block where `cfg.id === 'beat'`, before the existing return, add:

```ts
if (cfg.id === 'beat' && hierarchyColorsRef.current) {
  const hc = hierarchyColorsRef.current;
  const beatCode = feature.getProperty('beat_code') as string | undefined;
  const cityCode = feature.getProperty('city_code') as string | undefined;
  const distLetter = feature.getProperty('district_letter') as string | undefined;
  const entry = beatCode
    ? lookupBeatDistrict(beatDistrictMapRef.current, cityCode, distLetter)
    : undefined;
  const sectorCode = entry?.sectionId;
  const zoneCode = entry?.zoneId;
  const fillColor = sectorCode ? hc.sectionColors.get(sectorCode) ?? '#3a3a3a' : '#3a3a3a';
  const strokeColor = zoneCode ? hc.zoneColors.get(zoneCode) ?? '#666' : '#666';
  return {
    fillColor,
    fillOpacity: 0.30,
    strokeColor,
    strokeWeight: 1.5,
    strokeOpacity: 0.85,
  };
}
```

**Step 4: Client typecheck + smoke**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors.

Run: `cd client && npx vitest run`
Expected: full suite passes (no regression).

**Step 5: Commit**

```bash
git add client/src/hooks/useGeoJsonLayers.ts
git commit -m "feat(map): beat polygon styler reads tier color lookups"
```

---

## Task 7: Area-boundary line overlay

**Why:** The 5-feature dissolved overlay draws bold lines only where two areas meet — the macro-boundary visual.

**Files:**
- Modify: `client/src/hooks/useGeoJsonLayers.ts` — add a sibling `google.maps.Data` instance for area boundaries, populated when both beat features and `hierarchyColors` are loaded.

**Step 1: Identify the right hook for "beats just loaded"**

Run: `grep -n "dataLayer.forEach\|setLayerStates.*loaded" client/src/hooks/useGeoJsonLayers.ts | head -5`
Expected: a few candidate spots near the end of the per-layer initializer.

**Step 2: After the beat data layer loads, build the dissolved overlay**

Inside the `if (cfg.id === 'beat')` block (the same one that builds beat label markers around line 516), after the `dataLayer.forEach(...)` that processes each feature, accumulate the `Feature<Polygon>[]` and run `dissolveBeatsByArea`:

```ts
import { dissolveBeatsByArea } from '../utils/dissolveAreas';

// near top of useGeoJsonLayers, alongside labelMarkersRef:
const areaBoundaryLayerRef = useRef<google.maps.Data | null>(null);

// in the cfg.id === 'beat' block, after labels are placed:
if (hierarchyColorsRef.current && !areaBoundaryLayerRef.current) {
  const beatFeatures: Feature<Polygon>[] = [];
  dataLayer.forEach((f) => {
    const geom = f.getGeometry();
    if (!geom || geom.getType() !== 'Polygon') return;
    const coords: number[][][] = [];
    (geom as google.maps.Data.Polygon).getArray().forEach((linear) => {
      coords.push(linear.getArray().map((ll) => [ll.lng(), ll.lat()]));
    });
    beatFeatures.push({
      type: 'Feature',
      properties: { beat_code: f.getProperty('beat_code') },
      geometry: { type: 'Polygon', coordinates: coords },
    });
  });
  const lines = dissolveBeatsByArea(beatFeatures, hierarchyColorsRef.current.beatToArea);
  const overlay = new google.maps.Data({ map });
  overlay.addGeoJson({ type: 'FeatureCollection', features: lines });
  overlay.setStyle((feat) => {
    const areaId = feat.getProperty('area_id') as string | number;
    return {
      strokeColor: hierarchyColorsRef.current!.areaColors.get(areaId) ?? '#fff',
      strokeWeight: 3,
      strokeOpacity: 0.85,
      fillOpacity: 0,
      clickable: false,
      zIndex: 5,
    };
  });
  areaBoundaryLayerRef.current = overlay;
}
```

Cleanup on unmount: in the existing useEffect cleanup, also call `areaBoundaryLayerRef.current?.setMap(null); areaBoundaryLayerRef.current = null;`.

**Step 3: Client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: 0 errors.

**Step 4: Smoke** — there's no automated test for this overlay (visual feature). Run the existing suite to ensure no regression:

Run: `cd client && npx vitest run`
Expected: full pass.

**Step 5: Commit**

```bash
git add client/src/hooks/useGeoJsonLayers.ts
git commit -m "feat(map): area-boundary line overlay via @turf/dissolve"
```

---

## Task 8: Spatial Layers panel toggle + localStorage

**Why:** Dispatchers control the feature with one click; off behavior must be identical to before.

**Files:**
- Modify: `client/src/pages/map/MapPage.tsx` — Spatial Layers panel section + state init from localStorage

**Step 1: Find the Spatial Layers panel block**

Run: `grep -n "Spatial Layers\|spatialLayers" client/src/pages/map/MapPage.tsx | head -5`
Expected: a hit near the toggle list (panel JSX).

**Step 2: Add state + persistence**

Near the other `useState` hooks at top of MapPage:

```ts
const [tierColorsOn, setTierColorsOn] = useState<boolean>(() => {
  return localStorage.getItem('rmpg.map.hierarchyColors') !== 'off'; // default ON
});
useEffect(() => {
  localStorage.setItem('rmpg.map.hierarchyColors', tierColorsOn ? 'on' : 'off');
}, [tierColorsOn]);
```

Pass `hierarchyColors={tierColorsOn ? hierarchyColors : null}` into `useGeoJsonLayers(...)`.

**Step 3: Add the toggle row in the Spatial Layers panel**

Right after the existing "Beats" checkbox (search for `Beats` in the panel JSX), add a new row:

```tsx
<label className="flex items-center gap-2 px-2 py-1 text-[10px] cursor-pointer hover:bg-[#1a1a1a]">
  <input
    type="checkbox"
    checked={tierColorsOn}
    onChange={(e) => setTierColorsOn(e.target.checked)}
    disabled={!hierarchyColors}
    className="accent-[#d4a017]"
  />
  <span className={hierarchyColors ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}>
    Hierarchy Colors
  </span>
  {!hierarchyColors && (
    <span className="text-[8px] text-[var(--text-muted)] ml-auto" title="Districts unavailable offline">⚠</span>
  )}
</label>
```

**Step 4: Typecheck + smoke**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 errors, all tests pass.

**Step 5: Commit**

```bash
git add client/src/pages/map/MapPage.tsx
git commit -m "feat(map): hierarchy colors toggle in Spatial Layers panel"
```

---

## Task 9: Bump SW + deploy + verify

**Why:** SW cache versioning (CLAUDE.md rule); deploy via push-to-main (Gotcha #48); manual visual verification on prod.

**Files:**
- Modify: `client/public/sw.js` — `const CACHE_NAME = 'rmpg-flex-v490'` (was `v489`)

**Step 1: Bump cache name**

```bash
sed -i.bak "s/rmpg-flex-v489/rmpg-flex-v490/" client/public/sw.js && rm client/public/sw.js.bak
grep "const CACHE_NAME" client/public/sw.js
```
Expected: `const CACHE_NAME = 'rmpg-flex-v490';`

**Step 2: Run all gates**

```bash
cd server && npx tsc --noEmit
cd ../client && npx tsc --noEmit && npx vitest run
```
Expected: server 0 errors, client 0 errors, all tests pass.

**Step 3: Commit & push to main**

```bash
git add client/public/sw.js
git commit -m "chore(sw): bump cache to v490 for hierarchy colors"
git push origin HEAD:main
```
Expected: push succeeds, v2 webhook deploys (~30s).

**Step 4: Verify deploy live**

```bash
ssh root@194.113.64.90 "tail -5 /var/log/rmpg-deploy.log; grep 'const CACHE_NAME' /opt/rmpg-flex/client/dist/sw.js; curl -sf https://rmpgutah.us/api/health | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[\"status\"], d[\"version\"])'"
```
Expected: `=== deploy SUCCESS ===` line, SW shows `v490`, health `ok 5.8.2`.

**Step 5: Manual visual verification checklist** — open https://rmpgutah.us/map after Cmd+Shift+R (or Electron cache clear per Gotcha #6) and verify:

- [ ] Spatial Layers panel shows new "Hierarchy Colors" row, checked by default
- [ ] Toggle ON → 22 distinct beat fill colors visible at zoom 11
- [ ] Toggle ON → 5 area-boundary lines visible at zoom 8
- [ ] Toggle OFF → existing single-color beats, no area boundaries
- [ ] Zoom 9 → only area boundaries + section fills, no beat labels
- [ ] Click a beat → info window still shows full chart Section/Zone/Beat (no regression from round 7)
- [ ] localStorage state survives reload
- [ ] Offline mode (kill WiFi or block /dispatch/districts) → toggle disabled with tooltip

**Step 6 (deferred): Update CLAUDE.md**

After visual verification passes, append a 1-paragraph entry to the "Maps" section of CLAUDE.md describing the tier-color contract: which DB columns drive which channels, where the toggle lives, the localStorage key. Commit separately as `docs(claude-md): tier-color hierarchy contract on /map`.

---

## Rollback

If something breaks in production:

```bash
# Identify the bad SHA
ssh root@194.113.64.90 "tail -2 /var/log/rmpg-deploy.log"

# Revert the merge
git revert <bad-sha> --no-edit
git push origin HEAD:main
```

The webhook redeploys the reverted state in ~30s. localStorage `rmpg.map.hierarchyColors` is harmless on a rolled-back client (the key just goes unread).

---

## Done criteria

- [ ] All 9 tasks committed
- [ ] 6+ unit tests pass (3 colorLookup + 3 dissolveAreas)
- [ ] Server typecheck 0 errors, client typecheck 0 errors
- [ ] Production deployed on `v490`
- [ ] All 8 manual visual verification checkboxes ticked
- [ ] CLAUDE.md updated (Step 6 of Task 9)
