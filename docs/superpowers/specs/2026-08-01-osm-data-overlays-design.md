# OpenStreetMap Data Overlays — Design

**Date:** 2026-08-01
**Status:** Design approved, pending implementation plan
**Scope:** Statewide Utah OSM reference-data overlays on the RMPG Flex Mapbox map

---

## 1. Summary

Add statewide Utah reference data sourced from OpenStreetMap as toggleable overlay
layers on the existing Mapbox map. Nine functional groups covering surveillance,
traffic control, fire/life-safety, utility infrastructure, sensitive sites,
access/passage, road drivability, natural hazards, and jurisdictional boundaries.

**OpenStreetMap is a DATA source only.** No OSM basemap, no OSM map style, no
OSM tile server. The Mapbox basemap and the fixed `MAP_PALETTE` in
`client/src/utils/mapboxBasemap.ts` are not modified by this work.

---

## 2. Existing infrastructure (discovered, not built here)

The statewide vector-tile pipeline already exists and is functional. This design
consumes it rather than reimplementing it.

| Component | Path | Status |
|---|---|---|
| PMTiles → MVT tile server | [`src/routes/tiles.ts`](../../../src/routes/tiles.ts) | Live. Reads `tiles/<name>.pmtiles` from R2 (`MAP_DATA` = `system-essentials`) via range requests, serves `/api/tiles/{name}/{z}/{x}/{y}.mvt`. |
| R2 archives | `system-essentials/tiles/*.pmtiles` | Live. `utah-roads.pmtiles` verified present (valid PMTiles header read directly). |
| Client layer hook | [`client/src/hooks/useVectorTileLayers.ts`](../../../client/src/hooks/useVectorTileLayers.ts) | Built and hardened, but **orphaned** — zero consumers. |
| Teardown-safe style ops | [`client/src/utils/mapboxSafeLayer.ts`](../../../client/src/utils/mapboxSafeLayer.ts) | Live. All layer add/remove must route through `hasLayer`/`hasSource`/`safeRemoveLayer`. |
| `tippecanoe` | `/opt/homebrew/bin/tippecanoe` | Installed on the build host. |
| `osmium-tool` | — | **Not installed.** `brew install osmium-tool` is a prerequisite. |

### 2.1 Why PMTiles and not GeoJSON

Statewide extent makes the whole-file `geojson` source pattern unusable — power
poles alone are on the order of 10^5 features. PMTiles streams only the tiles in
the current viewport over HTTP range requests, so transfer and memory stay flat
regardless of statewide extent.

Mapbox GL JS has **no `addProtocol`** (that is MapLibre), so the client cannot
read a `pmtiles://` archive directly. The Worker extracts individual MVT tiles
server-side and serves them at a native XYZ template that mapbox-gl consumes as a
standard `{type:'vector', tiles:[...]}` source. This is already how
`useVectorTileLayers` works; OSM layers follow the identical path.

### 2.2 The orphaned hook

`useVectorTileLayers` is fully implemented — including basemap-switch restore via
`style.load`, a self-healing `idle` re-assert for missed style signals, and
click-handler binding that deliberately survives `setStyle()` wipes — but nothing
mounts it. `client/src/hooks/useWhatsHere.ts:66` already references the layer id
`vt-utah_addresses-circle`, so a downstream feature assumes it exists.

This design mounts the hook. Per approved decision, **all layers default to off**,
including the two pre-existing UGRC configs (`utah_roads`, `utah_addresses`).
Mounting the hook therefore produces **no visible change** to the live map until an
operator toggles a layer.

---

## 3. Layer set

Nine PMTiles archives, one per functional group. Each feature carries a `cat`
property; individual toggles are Mapbox `filter` expressions against the shared
group source. This keeps archive count and HTTP source count low while preserving
per-category control.

All layers default to **off**.

> **Layer list is provisional pending a feature count.** Utah coverage per tag is
> unverified. Step 0 of implementation (§4.0) runs a count pass over the real
> extract; any category returning a trivially small count is dropped before client
> work begins rather than shipping an empty toggle.

### Group A — Surveillance & canvass

Archive: `osm-surveillance.pmtiles`

| Toggle | `cat` | OSM filter | Render | Min zoom |
|---|---|---|---|---|
| Cameras (public) | `camera` | `man_made=surveillance` and `surveillance:type` ≠ `ALPR` | Icon + view cone | 15 |
| Cameras (ALPR) | `alpr` | `man_made=surveillance` + `surveillance:type=ALPR` | Icon + view cone, distinct color | 14 |

View cones are rendered from `camera:direction` (degrees). Features lacking
`camera:direction` render as an icon with no cone — the absence of a cone means
"bearing unknown", never "omnidirectional".

Captured properties: `surveillance`, `surveillance:type`, `surveillance:zone`,
`camera:direction`, `camera:mount`, `camera:type`, `operator`, `name`.

### Group B — Traffic & roadway

Archive: `osm-traffic.pmtiles`

| Toggle | `cat` | OSM filter | Render | Min zoom |
|---|---|---|---|---|
| Traffic control | `control` | `highway=stop\|give_way\|traffic_signals` | Icon by subtype | 14 |
| Speed limits | `maxspeed` | ways with `maxspeed` | Line label, colored by limit band | 13 |
| Restrictions | `restriction` | `oneway=yes`, `maxheight`, `maxweight` | Arrow / icon | 14 |
| Traffic calming | `calming` | `traffic_calming=*` | Icon | 15 |
| Crossings & school zones | `crossing` | `highway=crossing`, `crossing=*`, `hazard=school_zone` | Icon | 15 |
| Exit numbers | `junction` | `highway=motorway_junction` (+ `ref`) | Label from `ref` | 11 |
| Rest & access points | `access_pt` | `highway=rest_area\|services\|emergency_access_point` | Icon | 11 |
| Enforcement devices | `enforce` | `highway=speed_camera`, `enforcement=*` | Icon | 14 |

### Group C — Fire & life safety

Archive: `osm-safety.pmtiles`

| Toggle | `cat` | OSM filter | Render | Min zoom |
|---|---|---|---|---|
| Fire hydrants | `hydrant` | `emergency=fire_hydrant` | Icon, color by `fire_hydrant:type` | 14 |
| Alt water sources | `water` | `emergency=fire_water_pond\|suction_point\|water_tank` | Icon | 13 |
| Emergency infrastructure | `emerg` | `emergency=phone\|defibrillator\|siren\|assembly_point` | Icon by subtype | 13 |
| Standpipe & riser inlets | `inlet` | `emergency=fire_service_inlet\|dry_riser_inlet\|wet_riser_inlet` | Icon | 16 |
| Portable fire equipment | `fire_equip` | `emergency=fire_extinguisher\|fire_hose` | Icon | 17 |
| Helipads & airfields | `heli` | `aeroway=helipad\|aerodrome\|runway\|windsock`, `emergency=landing_site` | Icon / line | 11 |
| Stations | `station` | `amenity=fire_station\|police\|hospital\|clinic`, `emergency=ambulance_station` | Icon by subtype | 11 |

Hydrant properties captured: `fire_hydrant:type`, `colour`, `couplings`,
`fire_hydrant:diameter`, `flow_rate`, `operator`.

### Group D — Utility infrastructure

Archive: `osm-utility.pmtiles`

| Toggle | `cat` | OSM filter | Render | Min zoom |
|---|---|---|---|---|
| Substations & lines | `power` | `power=substation\|tower\|line\|minor_line` | Line + icon | 10 |
| Power poles | `pole` | `power=pole` | Small circle | **16** |
| Generation | `gen` | `power=generator\|plant` | Icon | 11 |
| Comms masts | `comms` | `man_made=mast\|tower` with `communication:*` | Icon | 13 |
| Water towers & tanks | `water_infra` | `man_made=water_tower\|storage_tank` | Icon | 13 |
| Water & wastewater works | `water_works` | `man_made=pumping_station\|wastewater_plant\|water_works\|reservoir_covered` | Icon | 12 |
| Dams & control structures | `dam` | `waterway=dam\|weir`, `man_made=dyke` | Line + icon | 11 |
| Pipelines | `pipeline` | `man_made=pipeline` | Line, dashed | 12 |
| EV charging | `charging` | `amenity=charging_station` | Icon | 14 |

Power poles are a separate toggle specifically so they can remain off without
suppressing substations and transmission lines. The z16 gate is a hard floor —
statewide pole density makes any lower gate unusable.

### Group E — Sensitive & high-risk sites

Archive: `osm-sites.pmtiles`

| Toggle | `cat` | OSM filter | Min zoom |
|---|---|---|---|
| Schools & childcare | `school` | `amenity=school\|kindergarten\|college\|university` | 12 |
| Financial | `financial` | `amenity=bank\|atm` | 14 |
| Regulated retail | `regulated` | `shop=pawnbroker\|gun\|jewelry`, `amenity=pharmacy` | 14 |
| Alcohol venues | `alcohol` | `amenity=bar\|pub\|nightclub` | 14 |
| Government & detention | `gov` | `amenity=courthouse\|prison\|townhall\|post_office` | 12 |
| Lodging & fuel | `lodging` | `tourism=hotel\|motel`, `amenity=fuel` | 14 |
| Social services | `social` | `amenity=shelter\|social_facility` | 13 |
| Building entrances | `entrance` | `entrance=main\|service\|emergency\|exit` | 17 |
| Building height | `bldg_height` | ways with `building:levels` or `height` | 16 |

Building height renders as a label on the footprint centroid (floor count), not as
a new footprint — the Mapbox basemap already draws the geometry. Entrances are
z17-gated; below that they are indistinguishable from each other.

### Group F — Access & passage

Archive: `osm-access.pmtiles`

| Toggle | `cat` | OSM filter | Render | Min zoom |
|---|---|---|---|---|
| Gates & barriers | `barrier` | `barrier=gate\|lift_gate\|swing_gate\|bollard\|block\|cycle_barrier\|chain\|spikes` | Icon; red when `access=private\|no` | 15 |
| Controlled passages | `control_pt` | `barrier=toll_booth\|border_control\|height_restrictor\|sally_port\|turnstile` | Icon | 14 |
| Rail crossings | `rail_x` | `railway=level_crossing\|crossing` | Icon | 13 |
| Rail infrastructure | `rail_infra` | `railway=signal\|switch\|buffer_stop` | Icon | 15 |
| Street lighting | `lamp` | `highway=street_lamp` | Small icon | 16 |
| Parking | `parking` | `amenity=parking` (+ `parking=multi-storey`) | Icon by structure type | 15 |
| Clearances | `clearance` | `bridge`/`tunnel` ways with `maxheight` | Line + label | 14 |
| Transit stations | `transit` | `public_transport=station`, `railway=station` | Icon | 12 |

### Group G — Road surface & drivability

Archive: `osm-drivability.pmtiles`

Structurally different from every other group: these are **attributes of road ways
the basemap already draws**, not new features. Rendered as a styled line overlay
on top of the basemap roads, not as a separate feature symbology.

| Toggle | `cat` | OSM filter | Render | Min zoom |
|---|---|---|---|---|
| Unpaved roads | `unpaved` | `surface=unpaved\|gravel\|dirt\|ground\|sand\|compacted` | Dashed line | 11 |
| 4WD-only | `fourwd` | `4wd_only=yes`, `tracktype=grade4\|grade5`, `smoothness=very_bad\|horrible\|impassable` | Hatched line, warning color | 10 |
| Fords | `ford` | `ford=yes\|stepping_stones` on ways or nodes | Icon + line segment | 12 |
| Seasonal / restricted access | `seasonal` | `seasonal=*`, `snowmobile=*`, `motor_vehicle=no`, `access=private` on ways | Dotted line | 11 |
| Tracks | `track` | `highway=track` (+ `tracktype`) | Thin line, color by grade | 12 |

Captured properties: `surface`, `tracktype`, `smoothness`, `4wd_only`, `ford`,
`seasonal`, `access`, `motor_vehicle`, `name`, `ref`.

Rationale: committing a vehicle to a route that turns out to be 4WD-only or
seasonally closed is a concrete field failure this data prevents. Coverage is
comparatively good because offroad and cycling mappers actively maintain these
tags.

### Group H — Terrain & natural hazards

Archive: `osm-terrain.pmtiles`

| Toggle | `cat` | OSM filter | Render | Min zoom |
|---|---|---|---|---|
| Cliffs & steep terrain | `cliff` | `natural=cliff\|arete\|ridge` | Line with tick marks | 12 |
| Cave entrances & sinkholes | `cave` | `natural=cave_entrance\|sinkhole` | Icon | 12 |
| Mine shafts & adits | `mine` | `man_made=mineshaft\|adit`, `historic=mine` | Icon | 12 |
| Springs & water sources | `spring` | `natural=spring\|hot_spring` | Icon | 13 |
| Mapped hazards | `hazard` | `hazard=falling_rocks\|avalanche\|landslide\|flood\|animal_crossing\|dangerous_junction` | Icon by subtype | 11 |

Abandoned mine shafts and unmarked sinkholes are documented Utah backcountry
hazards. Coverage is sparse but, like cameras, high-precision — a tagged shaft is
a real shaft.

### Group I — Jurisdiction & restricted areas

Archive: `osm-jurisdiction.pmtiles`

**Polygon layer**, unlike every other group. Rendered as translucent fill +
outline, drawn beneath all point layers.

| Toggle | `cat` | OSM filter | Min zoom |
|---|---|---|---|
| Protected areas & parks | `protected` | `boundary=protected_area\|national_park`, `leisure=nature_reserve` | 8 |
| Tribal lands | `tribal` | `boundary=aboriginal_lands` | 8 |
| Military | `military` | `landuse=military`, `military=range\|training_area\|danger_area\|barracks\|checkpoint` | 8 |
| Industrial extraction & disposal | `extraction` | `landuse=quarry\|landfill` | 11 |

Answers "whose jurisdiction is this" at a glance — a first-order question for a
private security company operating across agency boundaries.

Polygon-specific handling is called out in §4.2.

### Explicitly excluded

- Building footprints — already rendered by the Mapbox basemap, including 3D.
- Generic retail/restaurant POIs — already on the basemap; would bury the
  operational layers in noise.
- Any OSM basemap, map style, or raster tile source.

---

## 4. Build pipeline

### 4.0 Step 0 — measure before building

Before any client work, run a count pass over the real Utah extract:

```bash
scripts/build-osm-tiles.sh --count-only
```

This filters each declared category and reports its statewide feature count
without generating tiles. Output is committed to
`docs/osm-utah-feature-counts.md` as the grounding record.

**Drop rule:** any category with fewer than 50 statewide features is removed from
the layer set before implementation, unless it is high-consequence and
low-frequency by nature (mine shafts, sally ports, helipads — a handful of real
ones still earns a toggle). The judgment call is recorded in the counts doc with
a one-line reason.

This step exists because the layer set in §3 is derived from OSM's tagging
schema, not from measured Utah coverage. Shipping a toggle that renders nothing
is worse than not shipping it — it reads as "none exist."

### 4.1 Pipeline

New script: `scripts/build-osm-tiles.sh`

```
utah-latest.osm.pbf  (Geofabrik, ~250 MB)
  │
  ├─ osmium tags-filter   → one filtered .osm.pbf per GROUP
  │
  ├─ osmium export        → GeoJSONSeq, with `cat` injected per feature
  │
  ├─ tippecanoe           → tiles/osm-<group>.pmtiles
  │
  └─ wrangler r2 object put system-essentials/tiles/osm-<group>.pmtiles
```

### 4.2 Properties

`osmium export` emits all tags. The script projects each feature down to the
declared property allow-list for its group (plus `cat`), so archives stay small
and popups have a stable schema. Unlisted tags are dropped at export time.

### 4.3 Tippecanoe settings

- **Point groups** (A, C, E, F, H): `--drop-densest-as-needed` disabled; instead
  per-category `--minimum-zoom` matching the tables above, so features are never
  silently dropped. A rendered layer must be complete for its zoom range or the
  absence-vs-nonexistence problem becomes unbounded.
- **Line groups** (B `maxspeed`, D pipelines, F clearances, G drivability):
  `--simplification=4`, `--no-tiny-polygon-reduction`.
- **Polygon group** (I jurisdiction): `--no-tiny-polygon-reduction` plus
  `--detect-shared-borders`. Independent simplification of adjacent
  jurisdiction polygons opens visible gaps along shared boundaries and makes a
  jurisdiction map lie about where one agency's authority ends. Simplification is
  capped at `--simplification=2` for this group for the same reason.
- **Group G is line-only** — it re-draws road geometry with drivability styling.
  It must be added *above* the basemap road layers but *below* every point layer,
  or unpaved-road hatching will occlude hydrants and cameras.
- Layer name inside each archive equals the group name (`surveillance`,
  `traffic`, `safety`, `utility`, `sites`, `access`, `drivability`, `terrain`,
  `jurisdiction`) and is what `source-layer` binds to.

### 4.4 Manifest

The script writes `tiles/osm-manifest.json` to R2 alongside the archives:

```json
{
  "generated_at": "2026-08-01T00:00:00Z",
  "extract": "utah-latest.osm.pbf",
  "extract_date": "2026-07-30",
  "groups": {
    "surveillance": { "feature_count": 1234, "categories": ["camera", "alpr"] }
  }
}
```

The client reads this for the freshness stamp shown in the legend. If the
manifest is missing or unparseable, the UI shows "extract date unknown" — it
does not block layer rendering and does not throw.

### 4.5 Refresh

Re-running the script regenerates and re-uploads. **No deploy required** — the
archives are data in R2, not build artifacts. Refresh cadence is operational, not
tied to release.

### 4.6 Prerequisite

`brew install osmium-tool`. The script must check for `osmium` and `tippecanoe`
up front and exit with an actionable message if either is missing, rather than
failing partway through a 250 MB pipeline.

---

## 5. Client changes

### 5.1 Config model

`VectorTileLayerConfig` in `useVectorTileLayers.ts` gains:

| Field | Type | Purpose |
|---|---|---|
| `defaultVisible` | `boolean` | Replaces the hardcoded always-on behavior |
| `source` | `'ugrc' \| 'osm'` | Legend grouping and attribution routing |
| `attribution` | `string` | Rendered per-layer |
| `categoryFilter` | `string \| undefined` | The `cat` value this toggle filters to |
| `group` | `string \| undefined` | Shared archive/source name |

`kind` gains a third variant: `'icon'`.

### 5.2 Default visibility

`useVectorTileLayers.ts:136` currently hardcodes `visible: true` for every
config. This becomes `visible: cfg.defaultVisible`. Both existing UGRC configs
(`utah_roads`, `utah_addresses`) are set to `defaultVisible: false`.

The "always-on" auto-enable effect and its comments are updated to reflect that
visibility is now config-driven. The effect itself is retained — it is what
brings `defaultVisible: true` layers up without an operator toggle, and removing
it would break any future default-on layer.

### 5.3 Icon rendering

A new `addIconLayer` branch handles `kind: 'icon'`. The existing `'point'` branch
is **not modified** — it contains UGRC-address-specific logic (`houseNumberExpr`
slicing a house number out of `FullAdd`, `ptTypeColorExpression` coloring by UGRC
property type) that is meaningless for OSM features and must not be reached by
them.

Icon layers use Mapbox `symbol` with SDF sprites, `icon-allow-overlap: false`,
and zoom-gated `icon-size` interpolation.

### 5.4 Camera view cones

Cameras render two layers off one source: the icon, plus a `fill` layer drawing
a cone. The cone geometry is generated **at build time** in
`build-osm-tiles.sh` as a polygon feature (`cat: 'camera_cone'`), not computed
in a Mapbox expression — expression-based geometry construction is not supported
and a client-side turf computation over a streaming vector source has no stable
feature set to operate on.

Cone parameters: 60° arc, 30 m radius, centered on `camera:direction`. Features
without `camera:direction` produce no cone feature.

### 5.5 Color tokens

Colors come from `client/src/styles/theme-palettes.css` tokens, resolved to
literals at the module boundary. The existing configs' `#d4a017` literal is
**banned under Blue & Silver** (fails WCAG AA at 4.50/3.57/5.41 and is
confusable with `--sev-warn`) and is replaced as part of this work.

Literal hex is correct *inside* the Mapbox paint module — mapbox-gl cannot
resolve `var()` in a paint property, and the space-separated `rgb(r g b)` form
blanks the map. The requirement is that the literal is *derived from* a theme
token, not invented.

### 5.6 Mounting

`useVectorTileLayers` is called from `MapboxMapPage.tsx`. Toggles are exposed in
the existing layer dock under an "OSM Reference Data" heading, grouped by the nine
functional groups, collapsed by default.

---

## 6. Provenance and attribution

OpenStreetMap data is licensed **ODbL** (share-alike). Rendering it on the
internal map is unambiguously permitted; attribution is required.

### 6.1 Requirements

1. Legend shows `© OpenStreetMap contributors (ODbL)` plus the extract date
   whenever any OSM layer is visible.
2. Every OSM feature popup carries a `Source: OpenStreetMap · <extract date>`
   line.
3. PDF exports that include a visible OSM layer carry the same attribution.
   This affects `client/src/utils/mapSituationReportPdf.ts` and
   `client/src/utils/pdfStaticMap.ts` — exported documents leave the building,
   so this is the attribution obligation that actually matters.

### 6.2 Coverage captions

RMPG Flex is an authoritative record system. Crowd-sourced data rendered inside
it invites an officer to read a blank block as "none present." Two distinct
captions, because the two failure modes differ:

- **Incomplete-coverage layers** (hydrants, traffic control, barriers, traffic
  calming, crossings) — standing legend caption:
  *"Crowd-sourced — coverage is incomplete. Absence does not indicate none
  present."*
- **Sparse-but-precise layers** (cameras, ALPR, emergency infrastructure,
  helipads, mine shafts, cave entrances, mapped hazards) — standing legend
  caption:
  *"Crowd-sourced — only mapped features are shown. Expect unmapped features in
  the field."*
- **Attribute layers** (Group G drivability) — standing legend caption:
  *"Crowd-sourced road attributes. Unstyled roads are untagged, not
  confirmed paved."* This layer's failure mode is the inverse of the others: an
  *unstyled* road is the ambiguous case, not a missing icon.
- **Boundary layers** (Group I jurisdiction) — standing legend caption:
  *"Reference boundaries from OpenStreetMap. Not a legal determination of
  jurisdiction or authority."*

Captions are attached per-config, not hardcoded per-layer-id in the UI.

---

## 7. Testing

| Test | Location | Asserts |
|---|---|---|
| Config invariants | `tests/osmLayerConfig.test.ts` | Unique ids; `minzoom` within `[sourceMinzoom, sourceMaxzoom]`; `defaultVisible` present on every config; every OSM config has `attribution` and a coverage caption |
| Manifest parser | `tests/osmManifest.test.ts` | Valid manifest parses; missing/malformed manifest yields "unknown" and does not throw |
| Filter fixture | `tests/osmExtract.test.ts` | Hand-built `.osm` XML fixture (no network) routed through the tag-filter mapping produces the expected `cat` assignment per feature |
| Cone geometry | `tests/osmCameraCone.test.ts` | 60°/30 m cone at a known bearing; absent `camera:direction` produces no cone feature |
| Icon branch isolation | `client/src/hooks/__tests__/useVectorTileLayers.icon.test.ts` | `kind: 'icon'` does **not** invoke `houseNumberExpr` or `ptTypeColorExpression` |
| Default visibility | `client/src/hooks/__tests__/useVectorTileLayers.defaults.test.ts` | Every config initializes to its `defaultVisible`; UGRC configs initialize to `false` |
| Layer ordering | `client/src/hooks/__tests__/useVectorTileLayers.order.test.ts` | Group G drivability lines are inserted below every point layer and above basemap roads |
| Count-doc sync | `tests/osmLayerConfig.test.ts` | Every config `cat` appears in `docs/osm-utah-feature-counts.md`, so a layer can't ship without a measured count |

Gates before landing, per CLAUDE.md: worker typecheck, worker vitest, worker
integration (Miniflare), client typecheck, **full** client vitest (not targeted
runs), client build. Baseline is clean as of 2026-07-24, so any failure is
attributable to this change.

Note: root and client vitest must **not** run concurrently — that fakes ~9
failures. Run serially.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Officer reads absence as nonexistence | Per-layer coverage captions (§6.2); no layer defaults on |
| Mounting the hook surfaces UGRC layers unexpectedly | All configs `defaultVisible: false`; no visible change on mount |
| OSM point layer reuses UGRC address rendering | Separate `'icon'` branch; explicit isolation test |
| Statewide pole density degrades render | z16 hard floor; poles are an independent toggle |
| ODbL attribution missing from exported PDFs | Explicit requirement (§6.1.3) covering both PDF utils |
| `osmium` absent on build host | Script pre-flight check with actionable message |
| Archive upload partially completes | Manifest written **last**, after all archives upload; a stale manifest is detectable, a half-set of archives with a fresh manifest is not |
| A toggle ships with near-zero Utah features and reads as "none exist" | §4.0 count pass + drop rule, run before any client work |
| Jurisdiction polygons develop gaps along shared borders under simplification | `--detect-shared-borders`, `--simplification=2` cap, `--no-tiny-polygon-reduction` (§4.3) |
| Group G drivability lines occlude point layers | Explicit layer ordering: above basemap roads, below all point layers (§4.3) |
| Officer reads a jurisdiction boundary as legally authoritative | Jurisdiction layers carry the same OSM provenance line; boundaries are reference, not a legal determination — stated in the legend caption |

---

## 9. Out of scope

- OSM as a basemap, map style, or tile provider.
- Any change to `mapboxBasemap.ts`, `MAP_PALETTE`, or the theme system beyond
  replacing the banned `#d4a017` literal in the vector-tile configs.
- Changes to UGRC layer *rendering* (only their default visibility changes).
- Automated/scheduled OSM refresh — the script is operator-run.
- Writing OSM features into D1 or cross-referencing them against RMPG records.
