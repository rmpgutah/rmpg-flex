# Map Tab — Real Bugs & Orphaned Feature Cleanup

**Date:** 2026-07-20
**Status:** Approved, pending implementation plan

## Context

Following the Map tab visual-consistency/dock-reorg work (PR #2904/#2910) and the
follow-up unit-icon/click-to-detail/popup-CSS fixes (PR #2910), this spec addresses
the two remaining categories from the earlier 43-item Map tab audit: **Category A**
(real bugs in existing functionality) and **Category B** (features that are fully
built but have no UI entry point).

Every finding below was independently re-verified against the current codebase (not
trusted from the earlier audit summary, since a lot has changed since then) — file
paths, line numbers, and root causes are current as of 2026-07-20.

While researching Category B, a pre-existing repo governance doc,
`client/src/pages/map/_ORPHANS.md`, was discovered — it documents a much larger
backlog (~30 orphaned panels, 13 orphaned hooks) with a house rule: "if a sprint
wires N of these, audit + delete the rest in the same PR." The doc is also stale
(it still lists `SpeedGraphOverlay` as orphaned, but that shipped in the recent
dock-reorg work). This spec's scope is deliberately narrower than that full backlog
— see Non-goals.

## Non-goals

- **`MapboxDispatchConnections`** — a standalone Mapbox-API diagnostics/demo panel
  (Directions/Matrix/Geocoding/Isochrone/Map-Matching status + "run" actions). It
  needs a whole new UI surface (not a slot into an existing dock section), so it's
  left orphaned. Add it to `_ORPHANS.md` as a newly-identified orphan.
- **The other ~26 panels/hooks in `_ORPHANS.md`** (e.g. `AdvancedHeatmapPanel`,
  `GeofenceManager`, `WeatherPanel`, `useMapCorridor`, `useMapThreatAssessment`,
  etc.) — untouched. This spec updates `_ORPHANS.md` to reflect what it changes
  (mark newly-wired items done, remove newly-deleted items, correct the stale
  `SpeedGraphOverlay` entry, add newly-discovered orphans) but does not attempt
  the full backlog audit the doc's house rule would otherwise imply. That's a
  separate future sprint if wanted.
- No new capability beyond what's described below — every fix either repairs
  existing broken behavior, gives an already-built component/hook a real entry
  point, or deletes code confirmed to be dead/superseded. Nothing new is designed
  from scratch except the two small new UI surfaces explicitly listed (snapshot
  gallery popover, bookmarks list panel).

## Category A — 6 bug fixes

### A1. MinimapControl overlaps the Right Dock

`client/src/pages/map/components/MinimapControl.tsx:40-43` uses
`className="fixed bottom-4 right-4 z-40 ..."`. It's mounted inside the map-canvas
flex child (`MapboxMapPage.tsx:1297`), whose ancestor chain sets no `transform`/
`filter`/`contain` — so `position: fixed` escapes to the true viewport rather than
being contained by the canvas column. `MapRightDock` occupies that same bottom-right
region at `z-20`; since the minimap's `z-40` wins, it visually sits on top of the
dock's bottom-right content whenever both are visible (desktop/tablet).

**Fix:** change the minimap's positioning from `fixed` to `absolute`, scoped to a
`relative`-positioned ancestor that's already the map-canvas wrapper — this keeps it
pinned to the map viewport (not the whole page) while stopping it from floating over
page-level siblings like the dock. Confirm visually that it still sits in the
bottom-right of the *map area* once the dock's width is accounted for.

### A2. "Beat Boundaries" toggle is dead (not merely a duplicate of "Beats")

Two dock toggles both draw beat outlines:
- `id: 'beats'`, label **"Beat Boundaries"** — `MapboxMapPage.tsx:1069`, backed by
  `loadBeatOverlay` (lines 176-233), which fetches `/beats.geojson`.
- `id: 'geo-beat'`, label **"Beats"** — from `useGeoJsonLayers`'s `beat` config
  entry, fetches `/geojson/beat.geojson`.

Verified directly: **`client/public/beats.geojson` does not exist.**
`loadBeatOverlay`'s fetch gets a 404, hits its `if (!resp.ok) { devWarn(...); return; }`
guard, and silently no-ops — toggling "Beat Boundaries" on does nothing, with zero
feedback. `client/public/geojson/beat.geojson` exists, is current (719 features,
last modified 2026-07-18), and is the layer `geo-beat` ("Beats") actually renders.

**Fix:** delete the `beats` dock toggle entry, `loadBeatOverlay`, `beatsVisible`
state, and the `beats-fill`/`beats-border`/`beats-label` layer-cleanup code — all of
it is dead. `geo-beat` ("Beats") is the sole surviving beat-boundary toggle.

### A3. Dead `(G)` coordinate-grid keyboard shortcut

The Coordinate Grid toggle's description says `(G)` and a real `toggleGrid` handler
is threaded all the way into `useMapKeyboardShortcuts` (`MapboxMapPage.tsx:602`),
but that hook's internal key-matching switch (`useMapKeyboardShortcuts.ts:68-80`)
has no `case 'g'` — B/C/D commands are correctly wired, G silently isn't, despite
its handler prop existing and its interface documenting it
(`MapShortcutHandlers.toggleGrid`, line 38-39). `MAP_SHORTCUT_BINDINGS` (backing the
`?` help overlay) also omits G.

**Fix:** add `case 'g': return handlers.toggleGrid;` to the switch, and add a
`{ key: 'G', label: 'Toggle coordinate grid' }` entry to `MAP_SHORTCUT_BINDINGS` so
the in-app shortcut-help list matches reality.

### A4. MultiStopRoutePanel uses the wrong responsive breakpoint

The dock system's narrow/wide threshold is `isDockNarrow = useIsMobile(1024)`
(`MapboxMapPage.tsx:335`) — below 1024px, the top toolbar and side docks collapse
into `MapBottomTray`. `MultiStopRoutePanel` instead receives `isMobile` (the
768px-threshold flag, `MapboxMapPage.tsx:1532`) and is rendered unconditionally as
an absolutely-positioned overlay anchored at `top-16 right-3` (a position that
assumes the top toolbar is present). In the 768-1024px band, the page has already
collapsed to narrow layout (no toolbar, no docks) but the panel still renders in
"desktop" mode at a toolbar-relative position with no toolbar above it.

**Fix:** pass `isDockNarrow` into `MultiStopRoutePanel` instead of `isMobile`, so its
internal layout logic (queue ordering, `maxHeight`) matches the same threshold the
rest of the page already collapses on.

### A5. "Bookmarks" naming collision (and one dead button)

Two "Bookmarks" affordances share a name and do different things:
1. **Right-dock toggle** (`id: 'bookmarks'`) — flips `mapBookmarks.dropMode`
   (click-to-drop-a-pin mode).
2. **Top-toolbar button** (`aria-label="Show bookmarks"` / `"Hide bookmarks"`) —
   toggles `showBookmarksPanel`, but grep confirms that state is only ever *set*
   and *passed as a prop*, never read by anything that renders a panel. Clicking it
   currently does nothing visible.

**Fix:**
- Rename the dock toggle from "Bookmarks" to **"Drop Bookmark"** (accurately
  describes what it does — enters pin-drop mode).
- Build a small bookmarks-list panel for the toolbar button, using
  `mapBookmarks.bookmarks` (already the full array) plus its existing fly-to/remove
  methods — no new data layer needed, just a list UI gated on `showBookmarksPanel`.

### A6. SpeedGraphOverlay's silent empty state

`SpeedGraphOverlay.tsx:73`: `if (points.length < 2) return null;` — if a unit has
fewer than 2 recent trail points, clicking its Speed Violations marker produces
zero visible feedback that the click registered.

**Fix:** replace the early `return null` with a small "No speed data for this
window" card in the same visual slot the real chart would occupy, so a click always
produces some visible response.

## Category B — wire 4 panels + 3 hooks, delete 5 dead/duplicate items, 1 hygiene fix

### Wire in

**B1. GpsHud** (`client/src/pages/map/components/GpsHud.tsx`) — presentational HUD:
compass/heading, speed/accuracy, lat/lng, and (when a route is active)
destination/ETA/progress/turn-by-turn steps plus a track-capture export footer. Its
data source, `useGpsTracking`, is already called in `MapboxMapPage.tsx:546` (only
used today to place the "My Position" marker) — the richer `gps` object it returns
is never passed to anything. Add a new toggle in the Dispatch Tools dock section
("GPS HUD") that mounts `GpsHud` fed by the existing `gps` object and route state
already available from `useMapRouting`.

**B2. UnifiedMapLegend** (`client/src/pages/map/components/UnifiedMapLegend.tsx`) —
single collapsible legend reflecting hierarchy (area/sector/zone/beat), boundary
outlines, and an activity choropleth. Add a top-toolbar toggle that mounts it
docked bottom-left, wired to the layer-state props `MapboxMapPage` already has
(`geoJsonLayers.layerStates`, `districtHierarchy.hierarchyStates`) plus
`useActivityChoropleth` (also currently uncalled — needs to be invoked alongside
this to supply the choropleth legend data).

**B3. MapDiagnosticsOverlay**
(`client/src/pages/map/components/MapDiagnosticsOverlay.tsx`) — live perf HUD
(zoom/pitch/bearing, layer count, FPS, render timing). Add a new toggle in the
existing right-dock "Diagnostics" section (alongside Feature Inspector / Map Match
Trace / GPU Overlay), passing `mapRef.current`.

**B4. Snapshot gallery** — `useMapSnapshot` already captures snapshots (via the
"Capture Snapshot" toolbar button) and keeps the last 10 in a `snapshots` array, but
nothing ever reads that array — capture works, viewing doesn't exist. Add a small
thumbnail-strip popover anchored to the "Capture Snapshot" button, listing
`snapshot.snapshots` with the already-exposed `removeSnapshot`/`clearSnapshots`.

**B5. ~~useMapOptimization~~ — moved to Delete.** During plan-writing, traced
`MultiStopRoutePanel`'s existing "Optimize & Route" button (already live) and
confirmed it already calls a complete, working Mapbox Optimization API solve via
`useMapRouting`'s `showMultiStopRoute` — real TSP solving through
`/mapbox/optimization`, rendered route line + numbered stop markers, ETA/distance
totals. `useMapOptimization` is a second, redundant implementation of the same
capability, not a missing one — it belongs in the Delete list below, alongside the
other confirmed dead/duplicate items, not wired in.

**B6. useMapPrintExport** — client-side watermarked canvas screenshot/download +
clipboard-copy, fully self-contained. Instantiated but its `.exportImage()`/
`.copyToClipboard()` are never called. Add an "Export Image" button next to
"Capture Snapshot" in the top toolbar (a distinct feature from B4's server-side
Mapbox-Static-Images snapshot — both are worth keeping, they solve different needs:
quick low-res preview gallery vs. full-res watermarked download).

**B7. useMapInfoPanel** — fully-built rich click-location info (nearby units/calls
within 5mi, reverse-geocoded address, weather) via `showLocationInfo(lng, lat)`.
Confirmed **completely unused** — instantiated once and never called again anywhere
in the file, despite an earlier (incorrect) assumption that other click handlers
routed through it. Wire the existing "Identify" tool's click handler to call
`showLocationInfo` so a click surfaces nearby-units/calls and weather alongside the
place info it already shows; the exact merge of the two info sources (keep/replace
the current tilequery-based popup content) is left to the implementation plan to
detail precisely against the live code.

### Delete (confirmed dead stubs/duplicates)

- **`client/src/pages/map/hooks/useClosestUnit.ts`** — its entire body is
  `return [] as ClosestUnitResult[];`; not a parked feature, just an unfinished stub
  with zero callers.
- **`client/src/hooks/useMultiUnitRouting.ts`** — 17 lines, `addRoute`/`removeRoute`
  are no-op function bodies; fully superseded by `useMapRouting`'s real multi-stop
  implementation (already wired via `MultiStopRoutePanel`).
- **`client/src/pages/map/components/BuildingsLayer.tsx`** — a second, unused
  3D-buildings extrusion implementation; the live one is
  `addMapbox3DBuildings`/`removeMapbox3DBuildings` in `client/src/utils/mapboxLoader.ts`,
  already wired to the "3D Buildings" dock toggle.
- **`client/src/pages/map/hooks/useMapboxInit.ts`** — a full parallel map-init hook
  (create/destroy/style-switch/retry), unused; the live init path is
  `client/src/pages/map/modules/MapCore.ts`, which reimplements equivalent logic
  inline rather than calling this hook.
- **`client/src/pages/map/utils/mapboxOverlays.ts`** — an entire overlay-builder
  utility module (geometry helpers, paint-style helpers, a `MapboxOverlayManager`
  class, popup/marker factory functions). Verified: every exported symbol has zero
  importers anywhere outside its own file/test.
- **`client/src/hooks/useMapOptimization.ts`** — see B5 above; fully superseded by
  `useMapRouting`'s already-wired `showMultiStopRoute`. Delete the hook, remove
  `optimization` from `MapCore.ts`'s `UseMapCoreOptions`/`UseMapCoreResult`
  interfaces and its call/return, and stop invoking it in `MapCore.ts`.

### Hygiene

**B8. districtGeoData.ts helpers** — `isUnincorporatedBeat`/`unincorporatedZoneName`
(and `AREA_PALETTE`/`getAreaColor`) are exported and used internally within the same
file's `getTaggedBeats()`, but no other file imports them directly — instead, e.g.
the district-hierarchy click popup builds its own zone/sector/area label HTML
inline, risking drift from the canonical labeling logic. Point that popup's
label-building code at `unincorporatedZoneName`/`isUnincorporatedBeat` instead of
re-deriving the same logic.

## `_ORPHANS.md` maintenance

As part of this work, update `client/src/pages/map/_ORPHANS.md`:
- Remove `GpsHud`, `UnifiedMapLegend` from the orphan panel list (now wired by this
  spec).
- Correct the stale `SpeedGraphOverlay` entry — it's already wired (shipped in the
  recent dock-reorg work, predates this spec) and should not be listed as orphaned.
- Do **not** touch `_ORPHANS.md`'s existing hook-list entries that merely have
  similar names to files this spec changes (e.g. `useMapClosestUnit` in that doc's
  list is a distinct, separate file from this spec's `useClosestUnit` under
  `pages/map/hooks/` — they must not be conflated or merged in the doc).
- Add newly-discovered orphans this audit found that the doc didn't previously
  track: `MapboxDispatchConnections` and `ToolbarDropdownGroup` (both stay orphaned
  per Non-goals, so they get added as new entries, not removed).
- `MapDiagnosticsOverlay` and `mapboxOverlays.ts` are not currently listed in
  `_ORPHANS.md` at all (they predate/postdate its last audit) — no removal needed
  for them; just don't add them, since this spec wires the former and deletes the
  latter.
- Leave every other existing entry untouched.
