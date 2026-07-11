# Map UI & Portal Redesign — Phase 1: Structural Refactor

**Date:** 2026-07-03
**Status:** Approved for planning

## Context

The user asked for a "Map UI function and portal" redesign. The motivation spans
four separate problems:

1. Visual/theme mismatch with the app-wide steel-blue day/night theme
2. Cluttered/hard-to-use controls and layout
3. Missing capabilities — ~27 built-but-unwired "orphan" panels and 13 orphan
   hooks under `client/src/pages/map/` (see `_ORPHANS.md`) that were never
   exposed in the live UI
4. Structural/maintainability — the live page, `MapboxMapPage.tsx`, is 1875
   lines and wires ~30 feature hooks directly

This is too large for one spec. Decided sequencing (this doc covers step 1 only):

1. **Structural refactor** (this spec)
2. Theme pass (steel-blue tokens, tactical-dark stays forced dark)
3. UX declutter (reorganize controls/layout in the new shell)
4. Feature wiring (selectively wire orphan panels into the new shell)

## Goals (this phase)

- Split `MapboxMapPage.tsx` into a thin shell + domain modules so later phases
  (theme, declutter, feature wiring) land in small, focused files instead of
  a single 1875-line component.
- Reduce the shell to roughly 200–300 lines: map instance ref, top-level
  layout composition, no feature logic.
- Preserve all current functionality. Minor UI reshuffling (e.g. moving a
  control's location, consolidating near-duplicate panel markup) is allowed
  where it makes the domain split cleaner, but no feature should be dropped
  or made harder to reach.

## Non-goals

- No theming changes (steel-blue tokens) — phase 2.
- No new feature wiring from the orphan panel/hook inventory — phase 4.
  Existing orphans stay untouched; no reverse-imports introduced.
- No changes to the underlying ~30 feature hooks in `client/src/hooks/`
  (`useMapDrawing`, `useMapHeatmap`, etc.) — this refactor relocates
  orchestration and JSX, it does not rewrite hook internals.
- No changes to `MapboxMapPage`'s public props (`preferredEngine`) or how it's
  mounted from `client/src/pages/map/index.tsx`.

## Target structure

All new files live under `client/src/pages/map/modules/`:

| Module | Responsibility | Hooks it owns |
|---|---|---|
| `MapCore.ts` | Map init, style/theme switching, camera, projection, atmosphere, daylight — the "existence" of the map instance | `useMapboxInit` (existing page-local hook), `useMapProjection`, `useMapAtmosphere`, `useMapDaylight`, `useMapCameraAnimation`, `useMapOptimization`, `useMapSnapshot` |
| `MapDrawing.tsx` | Drawing modes, measure, GL Draw, annotation/buffer/ruler toolbar UI | `useMapDrawing`, `useMapMeasure`, `useMapboxDraw` |
| `MapAnalysis.tsx` | Heatmap, clustering, traffic, coordinate grid + their toggle UI | `useMapHeatmap`, `useMapClustering`, `useMapTraffic`, `useMapCoordinateGrid` |
| `MapRouting.tsx` | Routing, multi-unit routing, directions panel, isochrone/nearest-units | `useMapRouting`, `useMultiUnitRouting`, `useMapDirectionsPanel`, `mapboxIsochrone`/`findNearestUnits` calls |
| `MapOverlaysAndAlerts.tsx` | Geofence alerts, P1 audio/auto-pan, breadcrumbs, weather radar, GeoJSON layers, deck.gl incident/unit/arc layers | `useMapGeofenceAlerts`, `useAutoPanToP1`, `useP1AudioAlert`, `useMapBreadcrumbs`, `useMapWeatherRadar`, `useGeoJsonLayers`, deck.gl overlay functions |
| `MapToolsSidebar.tsx` | Sidebar tabs/content + quick-actions footer | `useMapInfoPanel`, `useMapBookmarks`, `useMapPlacesSearch`, `useMapPrintExport`, `usePersistedTab` |
| `MapStatusBar.tsx` | Bottom status bar: unit counts, connection state, active calls | (consumes state from `MapCore`/live sync, no new hooks) |

Each module exports a single function following the pattern:

```ts
function useMapDrawingModule(map: mapboxgl.Map | null, /* shared deps */): {
  state: {...};      // values other modules or the shell need to read
  actions: {...};    // imperative handlers the shell/toolbar wires to buttons
  ui: ReactNode;      // the module's own JSX (toolbar buttons, panels, badges)
}
```

State and markup stay co-located per domain — a heatmap toggle and its legend
change together, so splitting them into separate state/view files would just
recreate prop-drilling between two files that always change together.

**Remaining in the shell (`MapboxMapPage.tsx`):**
- Map container div + Mapbox GL Geocoder mount
- Top-level layout: map canvas, sidebar slot, toolbar slot, status bar slot
- Wiring shared cross-module state (e.g. `map` ref, `selectedUnit`,
  `selectedCall`) that multiple modules need to read
- `useLiveSync`, `useWebSocket`, `useGpsTracking`, `useIsMobile` — app-level
  concerns, not map-domain concerns, stay in the shell
- Loading overlay, sidebar open/close toggle

**Marker/popup builder functions** (`buildUnitMarkerEl`, `buildUnitPopupHtml`,
`buildCallMarkerEl`, `buildCallPopupHtml`) move to
`client/src/pages/map/utils/mapMarkers.ts` (pure functions, no hook needed).

**Constants** (`SLC_CENTER`, `DEFAULT_ZOOM`, `REFRESH_INTERVAL_MS`,
`DARK_STYLES`, `HAZARD_FLAGS`) move to
`client/src/pages/map/utils/mapConstants.ts` (already exists — merge in).

## Migration approach

Incremental, one module at a time, in this order (lowest cross-dependency
risk first): `MapCore` → `MapAnalysis` → `MapDrawing` → `MapRouting` →
`MapOverlaysAndAlerts` → `MapStatusBar` → `MapToolsSidebar` (sidebar last
since it's the most cross-cutting — reads state from every other module).

After each module extraction: `tsc --noEmit` in `client/`, then a manual
click-through in the browser preview of that module's controls before moving
to the next, so a regression is caught against a small diff rather than at
the end of a 1875-line rewrite.

## Testing

No existing test suite covers `MapboxMapPage.tsx` itself (only some
sub-components under `components/__tests__/` have tests, e.g. `RulerTool`,
`AnnotationTool`). Verification for this phase is:

- `cd client && npx tsc --noEmit` after each module extraction
- `cd client && npx vite build` at the end
- Manual browser verification via the preview tools: exercise drawing,
  measuring, heatmap, clustering, traffic, routing, geofence alerts, and the
  sidebar tabs after the full split, confirming behavior matches pre-refactor.
- No new automated tests required for this phase (matches existing project
  norm of thin coverage on this page); a follow-up could add smoke tests per
  module but that's out of scope here.

## Risks

- **Cross-module shared state.** Some hooks read state owned by another
  domain (e.g. drawing tools may need the current map style from `MapCore`).
  Mitigation: shell holds truly shared primitives (`map` ref, selected
  unit/call) and passes them down; modules don't reach into each other
  directly.
- **`executionCtx`-style hidden dependencies.** Unlike the Worker-side
  `recordAudit` gotcha, this is client-only, so no equivalent risk — but keep
  an eye out for hooks relying on ref timing (mount order) since Mapbox GL
  requires the map instance to exist before most layer/handler setup.
