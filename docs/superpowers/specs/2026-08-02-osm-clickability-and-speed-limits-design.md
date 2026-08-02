# OSM Overlay Clickability + Speed-Limit Integration — Design

**Date:** 2026-08-02
**Status:** Approved (design)
**Predecessor:** [`2026-08-01-osm-data-overlays-design.md`](2026-08-01-osm-data-overlays-design.md), PR #3260

## Problem

PR #3260 landed 57 OSM overlay categories on the Mapbox map. Three things block
that data from reaching operators:

1. **Polygon overlays are unclickable.** Clicking inside a polygon does nothing.
2. **Popups are empty.** Every OSM config declares `detailProps: []`, so a click
   returns the layer's own name and no attributes.
3. **Speed limits are fetched from a third party** — the Nav drive-mode HUD calls
   `overpass-api.de` directly from the browser, while the same `maxspeed` data
   already sits in RMPG's own R2 archive.

Additionally, Dispatch has no speed or posted-limit context for enroute units.

## Current state (verified 2026-08-02)

| Fact | Evidence |
|---|---|
| Polygon click binds to the outline, not the fill | `useVectorTileLayers.ts:418` takes `specs[specs.length-1]`; `buildOsmLayerSpecs` returns `[fill, outline]` for polygons |
| The comment there describes a layer that is never created | `:415-417` cites "camera_cone's fill + the camera icon layer added separately"; `buildOsmLayerSpecs` emits no icon layer |
| All OSM popups are empty | `useVectorTileLayers.ts:192` — `detailProps: []` for every generated OSM config |
| `isLight` never reaches OSM layers | `useVectorTileLayers.ts:749` loops `VECTOR_TILE_CONFIGS` only, excluding `OSM_VECTOR_CONFIGS` |
| Two `useSpeedLimit` hooks exist with different APIs | `client/src/hooks/useSpeedLimit.ts` (object arg) vs `client/src/pages/navigation/hud/useSpeedLimit.ts` (positional) |
| The shipping one calls Overpass from the browser | `pages/navigation/hud/useSpeedLimit.ts:64` |
| The other is dead — its endpoint does not exist | `hooks/useSpeedLimit.ts:114` calls `/dispatch/geography/road-speed`; `src/routes/dispatch/geography.ts` has no such route. Only consumer is its own test. |
| Mapbox Directions supports `annotations=maxspeed` | Directions API reference; BETA; `driving` + `driving-traffic` profiles only; **requires `overview=full`** |
| The existing Directions proxy already forwards annotations | `src/routes/mapbox.ts:122`, and defaults `overview=full` at `:116` |
| `src/utils/eta.ts` uses `overview=false` | `:91` — incompatible with `annotations`; must change to add maxspeed |
| Dispatch already has unit speed + position | `src/routes/dispatch/gps.ts:230` mirrors `gps_speed` (m/s), `latitude`, `longitude` onto `units` |
| maxspeed data is in the `osm-traffic` archive | `config/osm-layers.json` traffic group, `cat: "maxspeed"`, filter `w/maxspeed`, minzoom 13 |
| **Turn-by-turn already renders on the Dispatch map** | `DispatchMiniMap.tsx:616` — maneuver banner with `ManeuverArrow`, instruction, distance, ETA |
| **Voice guidance is already gated `enroute` → `onscene`** | `DispatchMiniMap.tsx:464` |
| **The visual banner is deliberately NOT gated** | `DispatchMiniMap.tsx:457` comment: "the on-screen maneuver banner still render[s] at any status — this gate is voice-only" |
| The Dispatch route call already meets the annotation preconditions | `useMapRouting.ts:395` — `overview=full&steps=true&annotations=congestion` |
| `UnitStatus`/`CallStatus` both carry `enroute` + `onscene` | `client/src/types/index.ts:218,434`, with `enroute_at`/`onscene_at` timestamps |

## Design

### Two-tier speed lookup

Speed limits are needed in two shapes; each gets the mechanism suited to it.

| Question | Shape | Source | Why |
|---|---|---|---|
| Limit **along a route** | Per-segment array, needed together with an ETA | Mapbox Directions `annotations=maxspeed` | Turn-by-turn requires a `steps=true` Directions call regardless, and `useMapRouting.ts:395` already sends `overview=full` — the annotation's precondition. Limits ride along in a request Dispatch already makes, aligned to the driven geometry rather than "nearest way," which is wrong near interchanges. |
| Limit **at a point** | Single value at a coordinate | `osm-traffic` PMTiles in R2 | No route exists for map popups or off-route drive mode. This tier is what removes the Overpass dependency. |

### Components

**1. `GET /api/dispatch/geography/road-speed?lat=&lng=`** (new)

The endpoint `hooks/useSpeedLimit.ts` already expects. Reads `tiles/osm-traffic.pmtiles`
from R2 server-side using the `pmtiles` lib already imported by `src/routes/tiles.ts`.

- Decodes the MVT tile containing the point at z13 (the `maxspeed` category minzoom).
- Filters to `cat === 'maxspeed'`, finds the nearest way segment by
  point-to-segment distance.
- Returns `{ limitMph, roadName, distanceM, source: 'osm' }`, or
  `{ limitMph: null }` when no tagged way is within a radius cap.
- **Tile-boundary handling:** a point near a tile edge may have its nearest way in
  the adjacent tile. Query the containing tile plus any neighbour within the radius
  cap of the point, and pick the global nearest.
- Cached at the edge (`Cache-Control: public, max-age=86400`) — the archive is a
  static extract, so the answer for a coordinate only changes on re-extract.
- Interface: depends only on `MAP_DATA` (R2). Testable by seeding a fixture archive.

**2. `client/src/utils/speedLimit.ts`** (new, shared)

- `parseMaxspeedMph(raw)` — single implementation. Both existing hooks have their
  own near-identical copy today; both are deleted in favour of this.
- `decodeMaxspeedAnnotation(annotation)` — maps Mapbox's per-segment
  `{speed, unit}` / `{unknown:true}` / `{none:true}` objects to `number | null`,
  converting `km/h` to mph.
- Pure functions, no React, unit-tested directly.

**3. Hook consolidation**

- **Delete** `client/src/pages/navigation/hud/useSpeedLimit.ts` (the Overpass one).
  Its `shouldFireOverSpeedAlert` + `OVER_SPEED_COOLDOWN_MS` move to the surviving
  module unchanged — they are pure and already tested.
- **Keep and repoint** `client/src/hooks/useSpeedLimit.ts` at the now-real endpoint.
  Its throttling (80 m / 4 s) and degrade-to-last-known behaviour are retained.
- **Add** `useRouteSpeedLimits` for the annotation path.
- `NavigationPage.tsx:43` updates to import from the surviving module. Its call
  site uses positional args and destructures `buffer`, so the surviving hook keeps
  a `buffer` in its result to avoid a behaviour change at that call site.

This resolves the two-hooks-one-name collision rather than adding a third.

**4. Clickability**

- **Bind click/hover to every spec id** for a config, deduped — not
  `specs[specs.length-1]`. Correct for 2-layer polygons today and for any future
  category emitting more.
- **Real `detailProps`**, generated from the `properties` array each group already
  declares in `config/osm-layers.json` (traffic declares `maxspeed`, `oneway`,
  `maxheight`, `maxweight`, `hazard`, `enforcement`, …). Because that file is
  already the codegen source for `osmLayers.generated.ts`, popup fields and tile
  contents cannot drift apart.
- **Click-anywhere identify:** clicking the map reports every visible OSM feature
  under the cursor via `queryRenderedFeatures`, grouped by layer. With 57
  categories this is the primary interaction; per-layer binding remains as the
  hover/cursor affordance.
- **Extend the `isLight` recolor effect** to cover `OSM_VECTOR_CONFIGS`.
- The `maxspeed` popup gains a posted-limit row, so the map answers the same
  question the HUD does.

**5. Dispatch enroute**

One Directions call per enroute unit with `annotations=maxspeed`, yielding ETA and
posted limit together. Compared against `units.gps_speed` (m/s → mph).

Display: `Unit 12 · 58 in a 35 · ETA 4 min`.

- **Derived, not stored.** The comparison is computed for display. No D1 table, no
  column, no audit row. Persisting officer speed exceedances creates records with
  legal and HR consequences and is out of scope for this design; adding it later is
  a deliberate, separately-specified decision.
- **Staleness guard.** When the GPS fix backing `gps_speed` is older than 30 s, the
  comparison is suppressed and only the posted limit is shown. Comparing a stale
  speed against a freshly-fetched limit produces a confident-looking false reading.
- **ETA trade-off:** `src/utils/eta.ts` must move from `overview=false` to
  `overview=full` to carry the annotation, accepting the route-geometry payload.
  The `useMapRouting` path needs no such change — it already sends `overview=full`.

**6. Turn-by-turn lifecycle on the Dispatch map**

Turn-by-turn already renders (`DispatchMiniMap.tsx:616`) and voice is already gated
`enroute` → `onscene` (`:464`). The gap is that the **visual banner renders at any
status** — an explicit prior decision (`:457`), reversed here at operator request.

- Gate the maneuver banner on the same condition the voice gate uses, so
  instructions appear when the unit goes `enroute` and clear when it goes `onscene`.
- **The route line is deliberately NOT gated.** A dispatcher benefits from seeing
  the path to a dispatched-but-not-yet-enroute call. Only the turn-by-turn
  instructions follow the status.
- Extract the shared predicate so the banner and the voice gate cannot drift apart —
  today they are two independent reads of `call?.status`.
- Add `maxspeed` to the existing annotation list at `useMapRouting.ts:395`
  (`annotations=congestion,maxspeed`) so the posted limit for the current segment is
  available to the banner without a second request.

### Error handling

Every path degrades to "no limit shown" rather than failing a caller:

| Failure | Behaviour |
|---|---|
| R2 archive missing | `{limitMph: null}`, 200. Matches `tiles.ts` treating a missing archive as data-absent, not server fault. |
| No tagged way near the point | `{limitMph: null}`, 200. Absence of a `maxspeed` tag is a real answer — OSM coverage is incomplete by nature. |
| Mapbox returns `unknown:true` / `none:true` | Decoded to `null`; the badge hides. |
| Directions call fails | ETA falls back to the existing haversine estimate in `eta.ts`; no limit shown. |
| GPS fix stale > 30 s | Posted limit only, no comparison. |

The overlay must never block dispatch or the drive lane. No path throws.

### Testing

- **Pure functions** (`parseMaxspeedMph`, `decodeMaxspeedAnnotation`,
  point-to-segment distance, `shouldFireOverSpeedAlert`) — direct unit tests.
  These carry the correctness weight.
- **`/road-speed`** — Miniflare test in `test-workers/` against a seeded fixture
  archive: hit, miss, missing archive, tile boundary.
- **`buildOsmLayerSpecs` + click binding** — assert every emitted spec id is bound,
  extending `useVectorTileLayers.osm.test.ts`. This is the regression test for the
  polygon bug; it must fail against current `main`.
- **Dispatch staleness guard** — assert the comparison is suppressed at > 30 s.
- Per `feedback_assert_which_response_branch`: each test pins which branch it
  exercises, and the polygon-click test is confirmed red before the fix.

## Non-goals

- Persisting speed-exceedance events (see above).
- Changing `mapboxBasemap.ts` or `MAP_PALETTE`. OSM remains a data source only.
- Re-running the OSM extract pipeline. This design consumes existing archives.
- The per-category colour and legend-row work identified during exploration —
  deferred to a follow-up so this spec stays implementable in one pass.

## Known deferred defect

`UnifiedMapLegend.tsx:73` hardcodes `#d4a017`, which CLAUDE.md bans in the
blue-silver block (fails AA at 4.50:1 and is confusable with `--sev-warn`). Same
literal in `HSWATCH.area`. Out of scope here; recorded so it is not lost.
