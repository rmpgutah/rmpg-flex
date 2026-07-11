# Map page toolbar redesign

## Context

The `/map` page's Layers panel (`MapOverlaysPanel`, driven by the `layerGroups` array in `pages/map/MapboxMapPage.tsx`) has grown to ~35 tools across 6 flat-scrolling groups (Operational Overlays, GeoJSON Overlays, Base Layers, Dispatch Automation, Camera & Export, Tools & Search) as features accumulated PR by PR. The operator's assessment: "unorganized and not fully functional, and unprofessional looking."

Two prior discoveries feed into "not fully functional": `pages/map/components/` holds 16 built React components, of which 12 are never imported anywhere in the app (`RulerTool` and `BufferRingTool` were wired in already, in a prior PR). Of the remaining 10, all target `mapboxgl` (viable) except `MapCoordinateReadout`, which targets `google.maps.Map` (dead — this project migrated off Google Maps and never ported this component).

This spec covers a toolbar reorganization plus wiring in the viable orphaned components, decided through a brainstorming session with visual mockups. It does not cover: the underlying map basemap theming (done in a prior PR), or any new tool *logic* beyond what these components already implement.

## Goals

1. Replace the 6 flat-scrolling groups with 4 workflow-oriented tabs, plus a cross-tab search box.
2. Wire in the ~9 viable orphaned tool components (excluding overlap/duplicates found during implementation) so every tool in the panel actually does something.
3. Apply a consistent Blue & Silver visual treatment to tool rows (icon, one accent color, active-state pill, more spacing) in place of today's dense list with a different accent color per tool.
4. Drop `MapCoordinateReadout` (dead Google Maps code) rather than porting it — out of scope; no equivalent Mapbox coordinate-readout requirement was raised.

## Non-goals

- No changes to what any individual tool *does* (Ruler still measures distance the same way, Coverage Gaps still computes the same grid, etc.) — this is a wiring + layout + visual pass, not a feature rewrite.
- No changes to the main map canvas basemap styling (covered by the prior Blue & Silver PR).
- No changes to pages other than `MapboxMapPage.tsx` and the components it renders.

## Design

### Tab structure

Four tabs replace the current 6 groups:

- **Live Data** — Crime Heatmap, Live Traffic, Unit Trails, Call Clusters, Incidents, Safety Zones, Geofence Zones, Repeat Addresses, Call History, `GpsReplayTool`, `NavOverlayTool`
- **Analysis** — Coverage Gaps, Response Time by Beat, Response Zones (isochrone), Identify, Ruler, Buffer Ring, Feature Inspector, `AnnotationTool`, `DrawGeofenceTool`, and Street View (component-vs-hook overlap resolved per the "Orphaned component wiring" section below)
- **Map & 3D** — Base style selector, Beat Boundaries, 3D Terrain, 3D Buildings (component-vs-hook overlap check), My Position, Projection, Atmosphere, GeoJSON layers (folded in from the old separate "GeoJSON Overlays" group — it's map data, not a distinct workflow), Weather Radar, Coordinate Grid, GPU Overlay, `UnifiedMapLegend`, `ScaleFullscreenControls`, `MinimapControl`
- **Dispatch Tools** — Auto-Pan P1, P1 Audio Alert, Directions, Route Optimizer, Bookmarks, Places Search, Orbit Animation, Capture Snapshot, Map Match Trace, plus whichever of `MultiStopRoutePanel` / `DispatchToolPanel` / `MapboxDispatchConnections` survive the overlap check below

Tabs render as a horizontal `mock-nav`-style strip at the top of `MapOverlaysPanel`; only the active tab's tools render below it. A search input above the tabs filters the active tab's list by substring match on label; if the active tab has zero matches but another tab does, show a small "N results in other tabs" hint that switches tabs on click.

### Orphaned component wiring

For each of the 10 unwired, `mapboxgl`-targeting components, before wiring it in as a new panel entry, check whether the page already has equivalent functionality via an inline hook (the page has accumulated several: `useMapOptimization`, a street-view hook, a 3D-buildings toggle, an isochrone "Response Zones" toggle). Where a genuine duplicate exists:

- If the orphaned **component** is more capable, wire it in and remove the inline hook's toggle entry (avoid shipping two ways to do the same thing).
- If the inline **hook** is more capable or better integrated (e.g. already synced with other map state), leave it as-is and do not wire in the orphaned component — note it in the PR description as "found redundant, left unwired" rather than silently dropping it with no explanation.
- If they're not actually duplicates (e.g. `DrawGeofenceTool`'s custom-polygon draw vs. the existing fixed-radius geofence *alerts* feature — different capabilities despite similar names), wire in both under distinct labels.

This check applies specifically to: `StreetViewLightbox` (vs. existing Street View hook), `BuildingsLayer` (vs. existing 3D Buildings toggle), and `MultiStopRoutePanel` / `DispatchToolPanel` / `MapboxDispatchConnections` (vs. each other and vs. existing Directions/Route Optimizer hooks). All other components (`AnnotationTool`, `DrawGeofenceTool`, `GpsReplayTool`, `NavOverlayTool`, `UnifiedMapLegend`, `ScaleFullscreenControls`, `MinimapControl`) are additive with no known overlap and get wired in directly.

`UnifiedMapLegend` expects `hierarchy`/`boundaries`/`statewide`/`choro` props modeling an area/sector/zone/beat + choropleth data system richer than what's currently toggleable on this page (today's Base Layers only has a single "Beat Boundaries" boolean, not per-level area/sector/zone toggles). Wire it with whatever subset of that shape the page can genuinely populate today (at minimum the single beat-boundaries boolean), rendering only the legend sections whose backing data exists — the component already conditionally renders each section (`if (!anyActive) return null` and per-section conditionals), so this degrades gracefully rather than needing new plumbing.

### Visual styling

Per the approved mockup:
- One consistent accent color (`--brand-gold` token, which resolves to silver under the Blue & Silver theme) instead of a distinct accent per tool.
- Small icon per tool row (reuse existing `lucide-react` icons already imported in `MapboxMapPage.tsx`/`MapOverlaysPanel.tsx` where a fitting one exists; pick a reasonable icon for any tool that doesn't have one yet).
- Active state = filled pill/background highlight on the row, not a colored dot.
- Row padding increased from the current ~3px to 6-8px for breathing room.
- These changes live in `MapOverlaysPanel.tsx` (the shared rendering component for every group/tab), not per-tool, so the styling is enforced structurally rather than needing every tool's config object to opt in correctly.

### Data flow / state

No new state management patterns — tabs are a `useState<TabId>` in `MapboxMapPage.tsx` (or `MapOverlaysPanel.tsx`, whichever ends up owning the search/filter state; likely `MapOverlaysPanel` since it already owns `open`/`groups` and rendering). The `layerGroups` array's shape (`{id, label, layers: [...]}`) is preserved — tabs are just `groups` renamed/regrouped with 4 entries instead of 6, so the array-driven pattern the page already uses for every tool toggle doesn't change.

## Testing

- Existing component tests for wired-in orphans (`RulerTool`, `BufferRingTool` already covered; add coverage confirmation for `AnnotationTool.test.tsx`, `DrawGeofenceTool.test.tsx`, `BuildingsLayer.test.tsx`, `MapDiagnosticsOverlay.test.tsx` if they exist and still apply after wiring) run unchanged — this is a wiring change, the components' internals aren't touched.
- New test coverage for the tab-filter search behavior (typing narrows the list; zero-match hint offers to switch tabs) since that's new logic, not a reuse of existing tested code.
- Full client vitest suite + typecheck, per this project's established verification pattern (no live browser click-through available in this environment for most sessions — noted honestly in the PR rather than claimed).

## Verification plan

1. `cd client && npx tsc --noEmit`
2. `npx vitest run` (client, full suite)
3. `npx vitest run` (Worker, pre-commit hook)
4. Manual note in the PR: not browser-verified live (consistent with every other map-page PR this session), since this environment's dev server port is frequently held by concurrent sessions and the page requires an authenticated dispatcher session to exercise fully.
