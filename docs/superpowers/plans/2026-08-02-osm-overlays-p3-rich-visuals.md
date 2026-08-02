# OSM Overlays — Plan 3: Rich Visuals and Detail

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Give every OSM data point a distinct, meaningful visual and a detailed popup — cameras showing a directional coverage cone and what they capture, hydrants coloured by flow class, speed limits labelled on the road, and so on.

**Architecture:** A per-category visual table drives runtime-registered Mapbox icons (`map.addImage`, generated from inline SVG so nothing depends on a sprite that may not contain a given name). Cameras rotate to their mounted bearing via `icon-rotate` and render the pre-computed cone polygon beneath. A shared popup builder turns the captured OSM tags into labelled, unit-correct detail.

**Tech Stack:** Mapbox GL JS 3, TypeScript, React 18, vitest.

**Depends on:** Plans 1 and 2 (merged). 814,713 features live in R2; 56 layers registered, mounted, defaulting off.

## Global Constraints

- **US units.** Speeds in mph, clearances and heights in feet, distances in feet/miles, flow in GPM. OSM stores `maxheight`/`maxwidth` in metres by default (a bare number = metres; `"12'6\""` is already imperial). Convert and label explicitly — never render a bare metric number.
- **OpenStreetMap is a DATA source only.** Do not modify `client/src/utils/mapboxBasemap.ts` or `MAP_PALETTE`.
- **Literal hex is correct inside Mapbox paint/layout properties** (mapbox-gl cannot resolve `var()`, and `rgb(r g b)` blanks the map) — but derive values from `client/src/styles/theme-palettes.css`. **`#d4a017` is banned.**
- Severity hues keep their CAD meaning: red = hazard/critical only, amber = warning, green = ok. Do not use them decoratively.
- **Never use a bare `icon-image` name from the basemap sprite.** If the name is absent Mapbox renders **nothing, silently**. Every icon must be registered by us via `map.addImage` first.
- All style operations go through `hasLayer`/`hasSource`/`getSourceSafe`/`safeRemoveLayer`.
- Every layer still defaults **off**.
- Client tests: `cd client && npx vitest run`. **Never run root and client vitest concurrently.**
- Baselines are clean (client typecheck 0, worker typecheck 0). Any error is yours.

---

## Task 1: Per-category icons

**Files:**
- Create: `client/src/utils/osmIcons.ts`
- Create: `client/src/utils/__tests__/osmIcons.test.ts`
- Modify: `client/src/hooks/useVectorTileLayers.ts`

**Interfaces produced:**
```ts
export interface OsmIconSpec { id: string; svg: string; size: number; }
export const OSM_ICON_BY_CAT: Record<string, OsmIconSpec>;
export function ensureOsmIcons(map: mapboxgl.Map): Promise<string[]>; // returns registered ids
export function iconIdForCat(cat: string): string | null;
```

`ensureOsmIcons` rasterises each SVG to a canvas at `pixelRatio: 2` and calls `map.addImage(id, imageData, { pixelRatio: 2 })`, skipping ids already present (`map.hasImage`). It must be idempotent — it is called on every `style.load`, since a style change wipes registered images.

Icons needed (distinct silhouettes, not colour-only variants — colour alone fails for colour-blind operators and at low contrast):

| Category | Visual |
|---|---|
| `hydrant` | hydrant silhouette |
| `camera`, `alpr` | camera body with a lens nub indicating facing |
| `inlet` | standpipe/FDC twin-port |
| `station` | building with a cross/star |
| `heli` | circled H |
| `emerg` | phone/AED glyph by subtype |
| `control` | octagon (stop), triangle (yield), signal head |
| `calming` | speed-hump chevrons |
| `crossing` | zebra bars |
| `junction` | exit shield |
| `barrier`, `control_pt` | gate bars |
| `rail_x` | crossbuck |
| `parking` | P in a square |
| `lamp` | lamp head with cast light |
| `pole`, `power`, `comms` | pylon / mast |
| `gen` | turbine |
| `water_infra`, `water_works`, `dam` | tank / dam glyph |
| `charging` | plug |
| `school`, `financial`, `regulated`, `alcohol`, `gov`, `lodging`, `social` | distinct site glyphs |
| `cave`, `mine`, `spring`, `hazard` | terrain glyphs; `hazard` uses the warning triangle |
| `entrance` | door |

- [ ] **Step 1: Write the failing test**

`client/src/utils/__tests__/osmIcons.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { OSM_ICON_BY_CAT, iconIdForCat } from '../osmIcons';
import { OSM_GROUPS } from '../../config/osmLayers.generated';

const POINT_CATS = OSM_GROUPS.flatMap((g) =>
  g.categories.filter((c) => (c as any).render === 'point').map((c) => c.cat));

describe('osm icons', () => {
  it('provides an icon for every point-rendered category', () => {
    for (const cat of POINT_CATS) {
      expect(iconIdForCat(cat), `no icon for ${cat}`).toBeTruthy();
    }
  });

  it('gives every icon a unique id', () => {
    const ids = Object.values(OSM_ICON_BY_CAT).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('emits valid standalone SVG for every icon', () => {
    for (const [cat, spec] of Object.entries(OSM_ICON_BY_CAT)) {
      expect(spec.svg, `${cat}`).toMatch(/^<svg[\s\S]*<\/svg>$/);
      expect(spec.svg, `${cat} needs a viewBox`).toContain('viewBox');
      expect(spec.size, `${cat} size`).toBeGreaterThan(0);
    }
  });

  it('never uses the banned gold', () => {
    const all = Object.values(OSM_ICON_BY_CAT).map((s) => s.svg).join(' ').toLowerCase();
    expect(all).not.toContain('d4a017');
  });

  it('distinguishes categories by SHAPE, not colour alone', () => {
    // Strip all colour attributes; the remaining geometry must still be distinct.
    const shapes = Object.values(OSM_ICON_BY_CAT)
      .map((s) => s.svg.replace(/(fill|stroke)="[^"]*"/g, ''));
    const dupes = shapes.length - new Set(shapes).size;
    expect(dupes, 'icons differing only by colour are indistinguishable to colour-blind operators').toBe(0);
  });

  it('returns null for an unknown category rather than throwing', () => {
    expect(iconIdForCat('not-a-real-category')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails** — `cd client && npx vitest run src/utils/__tests__/osmIcons.test.ts`

- [ ] **Step 3: Implement `osmIcons.ts`** with the SVG table and `ensureOsmIcons`.

- [ ] **Step 4: Switch point layers from `circle` to `symbol`** in `buildOsmLayerSpecs`, using `icon-image: iconIdForCat(cat)`, `icon-allow-overlap: false`, and zoom-interpolated `icon-size`. **Fall back to `circle` when `iconIdForCat` returns null** so an unmapped category still renders something rather than vanishing.

- [ ] **Step 5: Call `ensureOsmIcons` before adding layers** in `addLayer`, and again on `style.load` (a style change wipes images). Await it — adding a symbol layer whose image is not yet registered renders nothing.

- [ ] **Step 6: Verify** — targeted test, full client suite, `npx tsc --noEmit`, `vite build`.

- [ ] **Step 7: Commit** — `feat(osm): distinct icons for every OSM category`

---

## Task 2: Camera direction cones

**Files:**
- Modify: `client/src/hooks/useVectorTileLayers.ts`
- Create: `client/src/hooks/__tests__/useVectorTileLayers.camera.test.ts`

The archives already contain `camera_cone` polygons, generated at build time from `camera:direction` (60° arc, 30 m radius). Only **80 of 1,729** cameras (4.6%) have a bearing.

- [ ] **Step 1: Write the failing test**

Assert, via `buildOsmLayerSpecs`:
- the `camera_cone` fill sits **below** the camera icon layers in the returned order
- cone fill uses low opacity (≤ 0.35) so the basemap stays readable
- `alpr` cones and `camera` cones are visually distinguishable (different paint)
- the camera icon layer sets `icon-rotate: ['coalesce', ['get','camera:direction'], 0]` and `icon-rotation-alignment: 'map'` — a north-up icon would be a lie about where it points
- a camera **without** `camera:direction` still renders its icon (unrotated) and produces no cone

- [ ] **Step 2: Implement.** Cone fill + soft outline, rotated icon, correct layer ordering.

- [ ] **Step 3: Verify + commit** — `feat(osm): rotate camera icons to bearing and render coverage cones`

---

## Task 3: Detailed popups

**Files:**
- Create: `client/src/utils/osmPopup.ts`
- Create: `client/src/utils/__tests__/osmPopup.test.ts`
- Modify: `client/src/hooks/useVectorTileLayers.ts`

**Interface produced:**
```ts
export function buildOsmPopupHtml(cat: string, props: Record<string, unknown>): string;
```

The popup is the "what does this actually capture" surface. It must show a human title, a category chip, then labelled fields — **in US units** — plus the OSM provenance line.

Field mapping highlights:

| Tag | Label | Rendering |
|---|---|---|
| `maxspeed` | Speed limit | `"45 mph"`; a bare number is km/h → convert to mph |
| `maxheight` | Clearance | bare number = metres → **feet-inches** (`4.1` → `13' 5"`); `"12'6\""` passes through |
| `maxweight` | Weight limit | tonnes → US tons |
| `fire_hydrant:type` | Hydrant type | pillar / underground / wall / pond |
| `colour` | Bonnet colour | show the literal colour word |
| `couplings` | Couplings | numeric |
| `flow_rate` | Flow rate | to GPM when convertible |
| `fire_hydrant:diameter` | Main diameter | mm → inches |
| `camera:direction` | Facing | degrees → compass point (`90` → `E (90°)`) |
| `camera:mount` | Mount | wall / pole / ceiling |
| `surveillance:type` | Camera type | ALPR flagged prominently |
| `surveillance:zone` | Covers | what the camera watches — **this is the "what it captures" field** |
| `operator` | Operator | verbatim |
| `surface`, `tracktype`, `smoothness` | Surface / Grade / Condition | plain English |
| `4wd_only` | 4WD only | Yes |
| `ford` | Ford | "Roadway crosses water" |
| `access` | Access | private / no / permissive |
| `building:levels` | Floors | numeric |
| `ele` | Elevation | metres → feet |
| `voltage` | Voltage | volts → kV when ≥ 1000 |

Rules:
- Omit absent fields entirely — never render "Unknown".
- Escape all values (`escapeHtml`); OSM text is user-generated.
- Always append `Source: OpenStreetMap · <extract date>`.
- For `sparse`/`incomplete` coverage classes, append the layer's coverage caption so the popup carries the same warning as the legend.

- [ ] **Step 1: Write the failing test** covering: mph passthrough, km/h→mph conversion, metres→feet-inches clearance, bearing→compass, absent fields omitted, HTML escaping of a malicious `name`, and the provenance line always present.

- [ ] **Step 2: Implement.**

- [ ] **Step 3: Wire click handlers** for OSM layers in `addLayer`, reusing the existing `clickBoundRef` guard — it must bind exactly once per layer for the life of the map instance, or a basemap switch stacks duplicate popups.

- [ ] **Step 4: Verify + commit** — `feat(osm): detailed popups with US units and provenance`

---

## Task 4: On-map labels

**Files:** Modify `client/src/hooks/useVectorTileLayers.ts`

Some values belong on the map, not behind a click:

| Category | Label | Min zoom |
|---|---|---|
| `maxspeed` | speed value along the line | 14 |
| `junction` | exit `ref` in a shield | 12 |
| `clearance` | clearance in feet-inches | 15 |
| `hydrant` | flow class when present | 17 |
| `transit`, `station`, `school`, `gov` | `name` | 14 |

Use `symbol-placement: 'line'` for way labels, `text-halo-width: 1.4` for legibility on the dark basemap, and `text-allow-overlap: false`.

- [ ] Write tests asserting label layers exist for those categories, carry the right `text-field`, and are gated at the right zoom.
- [ ] Implement, verify, commit — `feat(osm): on-map labels for speed limits, exits, and clearances`

---

## Task 5: Verification

- [ ] Full gates: worker typecheck, worker vitest, client typecheck, client vitest, `vite build`. Never root+client vitest concurrently.
- [ ] Confirm every layer still defaults **off** and no `client/src/utils/mapboxBasemap.ts` change.
- [ ] Confirm no bare sprite `icon-image` reference survives — every icon id must come from `ensureOsmIcons`.
- [ ] Report which categories fall back to `circle` (no icon), so the gap is explicit rather than silent.
