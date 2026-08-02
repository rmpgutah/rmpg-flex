# OSM Data Overlays — Plan 2: Client UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the 814,713 statewide Utah OSM features already live in R2 visible, toggleable, and correctly attributed on the Map tab.

**Architecture:** A codegen step turns `config/osm-layers.json` (the pipeline's source of truth) into a client TS module, so the two can never drift. `useVectorTileLayers` — built, hardened, and currently orphaned — gains `icon` / `line` / `fill` rendering, per-category `filter` sublayers over one shared vector source per archive, and config-driven default visibility. It is then mounted in `MapboxMapPage` and registered in the declarative layer registry so the existing dock, search, and legend render it with no bespoke wiring.

**Tech Stack:** React 18, TypeScript, Vite, Mapbox GL JS 3, vitest.

**Spec:** [`docs/superpowers/specs/2026-08-01-osm-data-overlays-design.md`](../specs/2026-08-01-osm-data-overlays-design.md) §5 and §6.
**Plan 1 (shipped):** [`2026-08-01-osm-overlays-p1-data-pipeline.md`](2026-08-01-osm-overlays-p1-data-pipeline.md)

## Global Constraints

- **OpenStreetMap is a DATA source only.** No OSM basemap, style, or tile provider. `client/src/utils/mapboxBasemap.ts` and `MAP_PALETTE` must NOT be modified.
- **Every OSM layer defaults to OFF**, and so do the two pre-existing UGRC configs (`utah_roads`, `utah_addresses`). Mounting the hook must produce **no visible change** to the live map until an operator toggles something.
- **Never hardcode hex in `layerRegistry.ts`** — `layerRegistry.test.ts` fails the build on a literal hex, on any `gold` accent, and on the banned `#d4a017`. Use `var(--x)` tokens.
- **Literal hex IS correct inside Mapbox paint properties** — mapbox-gl cannot resolve `var()`, and the space-separated `rgb(r g b)` form blanks the map. Derive those literals from theme tokens; do not invent them.
- **Radius is 2px everywhere**; never `rounded-lg`.
- **Use `hasLayer`/`hasSource`/`getSourceSafe`/`safeRemoveLayer` from `client/src/utils/mapboxSafeLayer.ts`** for every style operation. `map.getLayer(id)` throws when the style is torn down — the `if (map.getLayer(id))` guard does NOT protect.
- **Tile URLs must be same-origin** (`${window.location.origin}/api/tiles/...`) so mapbox's worker-thread fetches resolve. `/api/tiles` is `auth: 'public'`, so no token is needed.
- **`/api/tiles` serves `Cache-Control: max-age=86400`.** Do not add cache-busting to normal tile requests — that would defeat edge caching for every user. It matters only when verifying a data refresh.
- Client tests: `cd client && npx vitest run`. **Never run root and client vitest concurrently** — it fakes ~9 failures.
- Client baseline is currently CLEAN (typecheck 0 errors). Any error you see is yours.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/gen-osm-client-config.mjs` | **Create.** Reads `config/osm-layers.json`, writes the client TS module. Single source of truth, no hand-maintained duplicate. |
| `client/src/config/osmLayers.generated.ts` | **Create (generated).** Typed catalog for the client: groups, categories, minzooms, geometry, coverage class. |
| `tests/osmClientConfigSync.test.ts` | **Create.** Fails if the generated module drifts from the JSON catalog. |
| `client/src/hooks/useVectorTileLayers.ts` | **Modify.** Add `defaultVisible`, `source`, `attribution`, `coverage`, `categoryFilter`, `archive`; add `icon`/`fill` render kinds; per-category filtered sublayers over one shared source. |
| `client/src/pages/map/config/layerRegistry.ts` | **Modify.** Nine new `MapLayerGroup` values + registry entries derived from the generated config. |
| `client/src/pages/map/MapboxMapPage.tsx` | **Modify.** Mount the hook; add bindings. |
| `client/src/components/OsmAttribution.tsx` | **Create.** ODbL attribution + extract date + coverage caption. |
| `client/src/hooks/__tests__/useVectorTileLayers.osm.test.ts` | **Create.** Default-off, icon branch isolation, filter correctness. |

---

## Task 1: Catalog codegen + drift test

**Files:**
- Create: `scripts/gen-osm-client-config.mjs`
- Create: `client/src/config/osmLayers.generated.ts`
- Create: `tests/osmClientConfigSync.test.ts`

**Interfaces:**
- Consumes: `config/osm-layers.json`, `scripts/osm/catalog.mjs` (`loadCatalog`).
- Produces, from `client/src/config/osmLayers.generated.ts`:
  ```ts
  export interface OsmCategory { cat: string; label: string; minzoom: number; }
  export interface OsmGroup {
    name: string; label: string; archive: string;
    geometry: 'point' | 'line' | 'polygon' | 'mixed';
    coverage: 'sparse' | 'incomplete' | 'attribute' | 'boundary';
    assignment: 'first-match' | 'multi';
    categories: OsmCategory[];
  }
  export const OSM_GROUPS: OsmGroup[];
  export const OSM_EXTRACT_DATE: string;
  ```

`OSM_EXTRACT_DATE` is a build-time constant sourced from `.osm-build/osm-manifest.json` if present, else the string `'unknown'`. Do not fetch the manifest at runtime in this task.

The `surveillance` group additionally needs a synthetic `camera_cone` category (minzoom 14) that exists in tile data but NOT in the JSON catalog — the transform derives it. Emit it explicitly and comment why.

- [ ] **Step 1: Write the failing drift test**

Create `tests/osmClientConfigSync.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error - untyped .mjs module
import { loadCatalog } from '../scripts/osm/catalog.mjs';

const GENERATED = 'client/src/config/osmLayers.generated.ts';

describe('osm client config', () => {
  it('exists and is marked generated', () => {
    const src = readFileSync(GENERATED, 'utf8');
    expect(src).toContain('GENERATED FILE');
    expect(src).toContain('scripts/gen-osm-client-config.mjs');
  });

  it('declares every catalog group', () => {
    const src = readFileSync(GENERATED, 'utf8');
    for (const g of loadCatalog().groups) {
      expect(src, `missing group ${g.name}`).toContain(`name: '${g.name}'`);
    }
  });

  it('declares every catalog category with its minzoom', () => {
    const src = readFileSync(GENERATED, 'utf8');
    for (const g of loadCatalog().groups) {
      for (const c of g.categories) {
        expect(src, `missing category ${g.name}/${c.cat}`).toContain(`cat: '${c.cat}'`);
      }
    }
  });

  it('includes the synthetic camera_cone category that the transform derives', () => {
    const src = readFileSync(GENERATED, 'utf8');
    expect(src).toContain(`cat: 'camera_cone'`);
    // It must NOT be in the JSON catalog — it is emitted by transform.mjs only.
    const inCatalog = loadCatalog().groups.some((g: any) =>
      g.categories.some((c: any) => c.cat === 'camera_cone'));
    expect(inCatalog).toBe(false);
  });

  it('carries a coverage class for every group', () => {
    const src = readFileSync(GENERATED, 'utf8');
    for (const g of loadCatalog().groups) {
      expect(src, `${g.name} coverage`).toMatch(
        new RegExp(`name: '${g.name}'[\\s\\S]{0,400}coverage: '(sparse|incomplete|attribute|boundary)'`));
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/osmClientConfigSync.test.ts`
Expected: FAIL — the generated file does not exist.

- [ ] **Step 3: Write the generator**

`scripts/gen-osm-client-config.mjs` reads the catalog via `loadCatalog()`, appends the synthetic `camera_cone` category to the `surveillance` group, reads `.osm-build/osm-manifest.json` for `extract_date` (falling back to `'unknown'`), and writes `client/src/config/osmLayers.generated.ts`. The file header must read:

```
// GENERATED FILE — do not edit by hand.
// Source: config/osm-layers.json
// Regenerate: node scripts/gen-osm-client-config.mjs
```

Emit stable ordering (catalog order, which is load-bearing) and 2-space indentation so regeneration produces no spurious diffs.

- [ ] **Step 4: Generate and verify**

Run: `node scripts/gen-osm-client-config.mjs && npx vitest run tests/osmClientConfigSync.test.ts`
Expected: PASS, 5 tests.

Then `cd client && npx tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-osm-client-config.mjs client/src/config/osmLayers.generated.ts tests/osmClientConfigSync.test.ts
git commit -m "feat(osm): generate the client layer config from the pipeline catalog"
```

---

## Task 2: Config model + default-off

**Files:**
- Modify: `client/src/hooks/useVectorTileLayers.ts`
- Create: `client/src/hooks/__tests__/useVectorTileLayers.osm.test.ts`

**Interfaces:**
- Consumes: `OSM_GROUPS`, `OSM_EXTRACT_DATE` from Task 1.
- Produces: `VectorTileLayerConfig` extended with `defaultVisible: boolean`, `source: 'ugrc' | 'osm'`, `attribution: string`, `coverage?: string`, `categoryFilter?: string`, `archive?: string`; and `OSM_VECTOR_CONFIGS: VectorTileLayerConfig[]` derived from `OSM_GROUPS`.

- [ ] **Step 1: Write the failing test**

Create `client/src/hooks/__tests__/useVectorTileLayers.osm.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { VECTOR_TILE_CONFIGS, OSM_VECTOR_CONFIGS } from '../useVectorTileLayers';

describe('vector tile configs', () => {
  it('defaults EVERY layer to off, including the pre-existing UGRC ones', () => {
    for (const c of [...VECTOR_TILE_CONFIGS, ...OSM_VECTOR_CONFIGS]) {
      expect(c.defaultVisible, `${c.id} must default off`).toBe(false);
    }
  });

  it('gives every config a unique id', () => {
    const ids = [...VECTOR_TILE_CONFIGS, ...OSM_VECTOR_CONFIGS].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('tags provenance so the legend can attribute correctly', () => {
    for (const c of VECTOR_TILE_CONFIGS) expect(c.source).toBe('ugrc');
    for (const c of OSM_VECTOR_CONFIGS) {
      expect(c.source).toBe('osm');
      expect(c.attribution).toContain('OpenStreetMap');
      expect(c.attribution).toContain('ODbL');
    }
  });

  it('gives every OSM config a categoryFilter and a shared archive', () => {
    for (const c of OSM_VECTOR_CONFIGS) {
      expect(c.categoryFilter, `${c.id}`).toBeTruthy();
      expect(c.archive, `${c.id}`).toMatch(/^osm-[a-z]+$/);
      expect(c.sourceLayer, `${c.id} source-layer must equal the group name`).toBeTruthy();
    }
  });

  it('carries a coverage caption on every OSM config', () => {
    for (const c of OSM_VECTOR_CONFIGS) {
      expect(c.coverage, `${c.id} needs a coverage caption`).toBeTruthy();
    }
  });

  it('never uses the banned #d4a017 gold', () => {
    const all = [...VECTOR_TILE_CONFIGS, ...OSM_VECTOR_CONFIGS].map((c) => c.color).join(' ');
    expect(all.toLowerCase()).not.toContain('d4a017');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd client && npx vitest run src/hooks/__tests__/useVectorTileLayers.osm.test.ts`
Expected: FAIL — `OSM_VECTOR_CONFIGS` is not exported.

- [ ] **Step 3: Extend the config interface and derive the OSM configs**

Add the new fields to `VectorTileLayerConfig`. Set `defaultVisible: false` and `source: 'ugrc'` on both existing UGRC configs, and **replace their `#d4a017` / `#e8b84b` color literals** with values derived from theme tokens (silver/blue family — not gold).

Derive `OSM_VECTOR_CONFIGS` from `OSM_GROUPS`: one config per category, `id` = `osm_<group>_<cat>`, `name` = `osm-<group>`, `sourceLayer` = group name, `archive` = `osm-<group>`, `categoryFilter` = the cat, `minzoom` = the category's minzoom, `sourceMinzoom` = the group's lowest minzoom, `sourceMaxzoom` = 16.

Coverage captions by the group's `coverage` class:
- `sparse` → `'Crowd-sourced — only mapped features are shown. Expect unmapped features in the field.'`
- `incomplete` → `'Crowd-sourced — coverage is incomplete. Absence does not indicate none present.'`
- `attribute` → `'Crowd-sourced road attributes. Unstyled roads are untagged, not confirmed paved.'`
- `boundary` → `'Reference boundaries from OpenStreetMap. Not a legal determination of jurisdiction or authority.'`

`attribution` = `` `© OpenStreetMap contributors (ODbL) · extract ${OSM_EXTRACT_DATE}` ``.

- [ ] **Step 4: Flip the always-on behavior to config-driven**

`useVectorTileLayers.ts` line ~136 hardcodes `visible: true` for every config. Change it to `visible: cfg.defaultVisible`. Update the surrounding comments — they currently describe the statewide DB as "ALWAYS-ON", which is no longer true. Keep the auto-enable effect itself (it is what brings a `defaultVisible: true` layer up without a toggle); only its input changes.

- [ ] **Step 5: Run tests**

Run: `cd client && npx vitest run src/hooks/__tests__/useVectorTileLayers.osm.test.ts`
Expected: PASS, 6 tests. Then `npx tsc --noEmit` → 0 errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/hooks/useVectorTileLayers.ts client/src/hooks/__tests__/useVectorTileLayers.osm.test.ts
git commit -m "feat(osm): config-driven layer visibility and OSM layer configs"
```

---

## Task 3: Icon, line, and fill rendering

**Files:**
- Modify: `client/src/hooks/useVectorTileLayers.ts`

**Interfaces:**
- Consumes: `OSM_VECTOR_CONFIGS` from Task 2.
- Produces: rendering for `kind: 'icon' | 'line' | 'fill'` driven by `categoryFilter`, sharing one Mapbox source per archive.

**The existing `'point'` branch must NOT be modified.** It contains UGRC-address-specific logic — `houseNumberExpr` slices a house number out of `FullAdd`, and `ptTypeColorExpression` colors by UGRC property type. Neither is meaningful for OSM features. A separate branch is required, and a test must prove OSM layers never reach it.

- [ ] **Step 1: Write the failing test**

Append to `client/src/hooks/__tests__/useVectorTileLayers.osm.test.ts`:

```ts
import { buildOsmLayerSpecs } from '../useVectorTileLayers';

describe('osm layer specs', () => {
  const specsFor = (id: string) => {
    const cfg = OSM_VECTOR_CONFIGS.find((c) => c.id === id)!;
    return buildOsmLayerSpecs(cfg, false);
  };

  it('filters every layer to its own category', () => {
    for (const spec of specsFor('osm_safety_hydrant')) {
      expect(JSON.stringify(spec.filter)).toContain('hydrant');
    }
  });

  it('never uses the UGRC address-point expressions', () => {
    const json = JSON.stringify(OSM_VECTOR_CONFIGS.flatMap((c) => buildOsmLayerSpecs(c, false)));
    expect(json).not.toContain('FullAdd');
    expect(json).not.toContain('AddNum');
    expect(json).not.toContain('PtType');
  });

  it('binds source-layer to the group name, not the category', () => {
    const spec = specsFor('osm_safety_hydrant')[0];
    expect(spec['source-layer']).toBe('safety');
  });

  it('applies the per-category minzoom, not the archive minimum', () => {
    // safety/inlet is z16 while the safety archive minimum is 11
    expect(specsFor('osm_safety_inlet')[0].minzoom).toBe(16);
  });

  it('renders jurisdiction as fill (polygons), drivability as line', () => {
    expect(specsFor('osm_jurisdiction_tribal')[0].type).toBe('fill');
    expect(specsFor('osm_drivability_unpaved')[0].type).toBe('line');
  });

  it('renders camera cones as fill beneath their icons', () => {
    const cone = specsFor('osm_surveillance_camera_cone')[0];
    expect(cone.type).toBe('fill');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd client && npx vitest run src/hooks/__tests__/useVectorTileLayers.osm.test.ts`
Expected: FAIL — `buildOsmLayerSpecs` is not exported.

- [ ] **Step 3: Implement `buildOsmLayerSpecs`**

Export a pure function `buildOsmLayerSpecs(cfg, isLight)` returning an array of Mapbox layer specs. Purity is deliberate — it makes the paint/filter logic testable without a map instance.

Choose the layer `type` from the config's geometry: polygons → `fill` (plus a thin `line` outline), lines → `line`, points → `symbol`. Every spec gets `filter: ['==', ['get', 'cat'], cfg.categoryFilter]`, `'source-layer': cfg.sourceLayer`, `minzoom: cfg.minzoom`, and `layout.visibility: 'none'`.

Colors: literal hex derived from theme tokens (mapbox cannot resolve `var()`). Severity hues keep their operational meaning — reserve red for hazards (`terrain/hazard`, `access/barrier` with private access) rather than using it decoratively.

Icons: use built-in Mapbox sprite images or plain `circle` layers. **Do not add a sprite-loading dependency in this task** — if a named icon is unavailable the layer must still render (fall back to `circle`), because a missing sprite silently renders nothing.

- [ ] **Step 4: Wire the branch into `addLayer`**

In `addLayer`, when `cfg.source === 'osm'`, add one shared vector source per `archive` (guard with `hasSource`) then add each spec via `map.addLayer`. Reuse the existing click/popup binding, the `style.load` re-add, and the `idle` self-heal — do not duplicate them.

- [ ] **Step 5: Run tests**

Run: `cd client && npx vitest run src/hooks/__tests__/useVectorTileLayers.osm.test.ts && npx tsc --noEmit`
Expected: all pass, 0 typecheck errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/hooks/useVectorTileLayers.ts client/src/hooks/__tests__/useVectorTileLayers.osm.test.ts
git commit -m "feat(osm): icon, line, and fill rendering for OSM categories"
```

---

## Task 4: Registry, dock groups, and mount

**Files:**
- Modify: `client/src/pages/map/config/layerRegistry.ts`
- Modify: `client/src/pages/map/MapboxMapPage.tsx`

- [ ] **Step 1: Add the nine dock groups**

Add to the `MapLayerGroup` union and to `LEFT_DOCK_GROUPS`:
`'OSM Surveillance' | 'OSM Traffic' | 'OSM Fire & Safety' | 'OSM Utilities' | 'OSM Sites' | 'OSM Access' | 'OSM Drivability' | 'OSM Terrain' | 'OSM Jurisdiction'`

- [ ] **Step 2: Derive registry entries**

Map `OSM_VECTOR_CONFIGS` into `MapLayerDef[]` — `id` matching the binding key `osm-<group>-<cat>`, the category label, a lucide icon per group, `colorVar` as a `var(--x)` token (never a literal hex, never gold), and the category label as the description.

- [ ] **Step 3: Mount the hook and add bindings**

In `MapboxMapPage.tsx`, next to the existing `useGeoJsonLayers` / `useDistrictHierarchyLayers` calls:

```tsx
const vectorTiles = useVectorTileLayers({ map: mapRef.current, popup: null });
```

Add bindings in the same `Object.fromEntries(...)` style already used for `districtHierarchy` and `geoJsonLayers`.

- [ ] **Step 4: Verify no visible change on load**

Run `cd client && npx vitest run && npx tsc --noEmit`. Then confirm by reading `layerRegistry.test.ts`'s completeness property that every new registry id has a binding — a registry entry without a binding renders a dead toggle.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/config/layerRegistry.ts client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(osm): register OSM layers and mount the vector tile hook"
```

---

## Task 5: Attribution and coverage captions

**Files:**
- Create: `client/src/components/OsmAttribution.tsx`
- Modify: `client/src/pages/map/components/UnifiedMapLegend.tsx`

OSM data is ODbL (share-alike). Rendering it internally is permitted; attribution is required. More importantly, this is an authoritative records system — a blank layer must not read as "none exist."

- [ ] **Step 1: Build the component**

`OsmAttribution` takes the visible OSM configs and renders, only when at least one is visible: `© OpenStreetMap contributors (ODbL) · extract <date>`, plus the distinct coverage caption for each coverage class present (deduplicated — do not repeat the same caption per layer).

Style with theme tokens; 2px radius; no hardcoded hex.

- [ ] **Step 2: Mount it in the legend**

Render inside `UnifiedMapLegend` beneath the layer list. It must be absent entirely when no OSM layer is visible.

- [ ] **Step 3: Test**

Assert: hidden when nothing is visible; shows ODbL text when one layer is on; shows the boundary caption for a jurisdiction layer; deduplicates a repeated caption across two layers of the same coverage class.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/OsmAttribution.tsx client/src/pages/map/components/UnifiedMapLegend.tsx
git commit -m "feat(osm): ODbL attribution and coverage captions in the map legend"
```

---

## Task 6: Real-browser verification

No code changes unless a defect is found. jsdom has no layout engine and cannot prove a map renders.

- [ ] **Step 1: Gates**

`cd client && npx tsc --noEmit` → 0. `cd client && npx vitest run` → green. `npx vitest run` (worker, separately — never concurrent) → green. `cd client && npx vite build` → succeeds.

- [ ] **Step 2: Load the map in a real browser**

Start the dev server and open the Map tab. Confirm: no console errors, and **no OSM layer visible on load**.

- [ ] **Step 3: Toggle and confirm rendering**

Enable `OSM Fire & Safety → Fire hydrants`, zoom to Salt Lake City past z14, and confirm hydrant markers appear. Check the network panel for `200` responses on `/api/tiles/osm-safety/...`.

Then enable `OSM Drivability → Unpaved roads` and confirm styled lines, and `OSM Jurisdiction → Protected areas` at z8 and confirm translucent polygons.

- [ ] **Step 4: Confirm attribution and captions**

With a layer on, confirm the legend shows the ODbL line and the correct coverage caption. Toggle everything off and confirm the attribution disappears.

- [ ] **Step 5: Confirm teardown safety**

Navigate away from the Map tab and back with layers enabled. Confirm no `getOwnLayer` console error and that layers restore. Switch basemap style and confirm layers survive.

- [ ] **Step 6: Screenshot and record**

Capture a screenshot of hydrants rendered over Salt Lake City and attach it to the PR.
