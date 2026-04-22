# OpenLayers Migration — Phase 1 Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a parallel `MapPageV2` route at `/map-v2` powered by OpenLayers + the existing CartoDB raster tile cache, gated behind an admin-controlled feature flag. Production dispatch continues using the existing Google Maps `MapPage.tsx` until V2 reaches feature parity (Phases 2-5). No removal of Google code in this phase.

**Why a parallel route, not in-place migration:** `MapPage.tsx` is 5,488 lines with 51 `google.maps` references and depends on ~40 hooks. A big-bang swap would break dispatch — the primary situational-awareness surface — for live patrol units. Parallel route lets dispatchers validate V2 incrementally (admin toggles a "Try V2" link in the nav menu) while the proven Google version stays default.

**Tech Stack:** React 18 + TypeScript, Vite 6, OpenLayers 9.x (new), `ol-mapbox-style` not needed (raster tiles only this phase), existing CartoDB tile cache served via `/tiles/{z}/{x}/{y}.png` and pre-cached by `client/public/sw.js`.

**Working branch:** New worktree off `main`, e.g. `claude/openlayers-phase1`.

**Out of scope this phase:** Drawing tools, heatmaps, traffic layer, address autocomplete, route planning, drag-to-dispatch, the 40 feature hooks, geocoding (server already on Nominatim — done). All deferred to Phases 2-5.

**Phase 0 already complete (commit pending):** Removed `google.maps.geometry.spherical.computeArea` from [client/src/pages/map/hooks/useMapMeasurement.ts:59-78](client/src/pages/map/hooks/useMapMeasurement.ts:59) — function now uses the existing spherical-excess fallback always. No behavior change.

---

## Context for the Engineer

- **CartoDB tile pyramid is already deployed** to `client/public/tiles/{z}/{x}/{y}.png` and pre-cached by the Service Worker for Utah Z7-15 (CLAUDE.md "Offline-First Maps" section). OpenLayers' `XYZ` source consumes this directly with no server changes.
- **Coordinate system gotcha:** Google Maps takes lat/lng inputs natively. OpenLayers stores everything in EPSG:3857 (Web Mercator) by default and expects you to wrap lat/lng inputs in `fromLonLat([lng, lat])` — note **lng-first** order, opposite of Google. Every coordinate that crosses the OL boundary needs this transform.
- **Feature flag mechanism exists:** the `system_config` table already stores admin-controllable JSON config (CLAUDE.md "Key Patterns"). Add a `map_v2_enabled` boolean rather than introducing a new flag system.
- **WebSocket data is map-library-agnostic:** `broadcastDispatchUpdate` / `broadcastUnitUpdate` deliver plain JSON. V2 subscribes to the same `useLiveSync` hook and renders into OL features instead of Google markers.
- **Beat GeoJSON already exists** at `client/public/geojson/beat.geojson` (719 features per CLAUDE.md "Dispatch Geography"). OL's `GeoJSON` format reads it directly; no preprocessing.
- **Sub-skill reference:** `@superpowers:test-driven-development` — write a smoke test for V2 mount + tile-source URL before adding features. `@superpowers:verification-before-completion` before claiming Task 6 done.

---

## Task 1: Install OpenLayers, add feature flag

**Files:**
- Modify: `client/package.json` (add `ol`, `@types/ol`)
- Modify: `server/src/models/database.ts` (no schema change — `system_config` already supports arbitrary keys; just document the new key)
- Modify: `client/src/pages/admin/AdminIntegrationsTab.tsx` (add toggle row for `map_v2_enabled`)

**Steps:**
1. `cd client && npm install ol @types/ol --save`
2. In the Admin → Integrations panel, add a labeled toggle: "Enable OpenLayers Map V2 (beta)" backed by `system_config.map_v2_enabled` (default `false`).
3. Expose the flag client-side via the existing `useApi`-fetched config or a new `useFeatureFlag('map_v2_enabled')` hook (check codebase for existing pattern first — likely already exists).

**Verification:** `npm run dev`, toggle the flag in admin, confirm it persists across refresh via `apiFetch('/admin/config')` round-trip.

---

## Task 2: Add `/map-v2` route + nav-menu entry (flag-gated)

**Files:**
- Modify: `client/src/App.tsx` (or wherever React Router routes are registered — verify)
- Modify: `client/src/components/MenuBar.tsx` (add "Map (V2 Beta)" entry, hidden unless `map_v2_enabled`)
- Create: `client/src/pages/map-v2/MapPageV2.tsx` (stub — renders "OpenLayers V2 placeholder" text only)

**Steps:**
1. Register `<Route path="/map-v2" element={<MapPageV2 />} />` next to the existing `/map` route.
2. In MenuBar, conditionally render the V2 link based on the flag.
3. Confirm `/map` still loads Google Maps unchanged.

**Verification:** Toggle flag on → V2 link appears in menu → clicking it loads stub page. Toggle off → link disappears, `/map-v2` direct URL still loads (we don't hide the route, just the nav entry — admins can deep-link for testing).

---

## Task 3: Mount OpenLayers map with CartoDB raster tile source

**Files:**
- Modify: `client/src/pages/map-v2/MapPageV2.tsx`
- Create: `client/src/pages/map-v2/hooks/useOlMap.ts` (returns `{ mapRef, map }` — analog of `useMapInit.ts`)

**Steps:**
1. In `useOlMap.ts`, instantiate `new Map({ target, layers: [tileLayer], view })` where:
   - `tileLayer = new TileLayer({ source: new XYZ({ url: '/tiles/{z}/{x}/{y}.png', maxZoom: 15, attributions: '© OpenStreetMap contributors © CARTO' }) })`
   - `view = new View({ center: fromLonLat([-111.891, 40.760]), zoom: 11 })` (Salt Lake City center)
2. Attach to a `<div ref={mapRef} className="w-full h-full" />` in MapPageV2.
3. Apply Spillman dark theme — set the map container `bg-[#0a0a0a]` so the gap before tiles load matches dispatch chrome.

**Verification:** Load `/map-v2` → CartoDB dark tiles render at SLC. Pan + zoom work. No console errors. Confirm tiles served from SW cache when offline (DevTools → Network → toggle Offline → reload → tiles still appear).

---

## Task 4: Render beat polygons from GeoJSON

**Files:**
- Modify: `client/src/pages/map-v2/MapPageV2.tsx`
- Create: `client/src/pages/map-v2/hooks/useOlBeatLayer.ts`

**Steps:**
1. Fetch `/geojson/beat.geojson` once on mount.
2. Build `new VectorLayer({ source: new VectorSource({ features: new GeoJSON().readFeatures(json, { featureProjection: 'EPSG:3857' }) }) })`.
3. Style each feature with a sector-derived stroke color (port the existing palette from `client/src/utils/sectorColors.ts` if it exists — verify).
4. On hover, show beat code in a small overlay (use OL's `Overlay` class — mirrors Google `InfoWindow`).

**Verification:** All 719 beat polygons visible, colored by sector, hover shows beat code. Confirm polygon rendering performance — OL handles 719 polygons trivially but verify no jank on pan.

---

## Task 5: Render live unit + call markers from WebSocket

**Files:**
- Modify: `client/src/pages/map-v2/MapPageV2.tsx`
- Create: `client/src/pages/map-v2/hooks/useOlUnitMarkers.ts`
- Create: `client/src/pages/map-v2/hooks/useOlCallMarkers.ts`

**Steps:**
1. Subscribe to the same `useLiveSync` channels as `MapPage.tsx` — units and calls.
2. For each entity, create an `ol/Feature` with a `Point` geometry at `fromLonLat([lng, lat])`.
3. Style with `ol/style/Icon` — port the existing unit/call marker SVGs from `client/src/pages/map/utils/mapMarkerBuilders.ts`.
4. Apply the existing status-color logic from `client/src/utils/statusColors.ts` to icon `color` style.
5. On feature click, show a popup `Overlay` with unit/call summary — mirror the Google `InfoWindow` content from `client/src/pages/map/utils/infoWindowBuilder.ts` (text only, no buttons yet — Phase 2).

**Verification:**
- Open V2 in one tab, dispatch console in another. Update a unit's status — V2 marker color changes within 2s.
- Create a new call — marker appears on V2 without refresh.
- Click a unit marker — popup shows callsign + status + last-seen timestamp.
- **Critical regression check:** Open `/map` (Google) and `/map-v2` side-by-side, confirm same units/calls appear in same locations.

---

## Task 6: Smoke test + admin documentation

**Files:**
- Create: `client/src/pages/map-v2/__tests__/MapPageV2.smoke.test.tsx`
- Modify: `CLAUDE.md` (add section under "Key Systems" → "Map V2 (OpenLayers, beta)")

**Steps:**
1. Smoke test mirrors the PDF pattern (CLAUDE.md "Client-side PDF smoke tests"): render `<MapPageV2 />` with stubbed `fetch` for the tiles + GeoJSON, assert no throw + `<div>` mount. Don't test rendered tiles — jsdom can't paint canvas.
2. CLAUDE.md section: "Toggle in Admin → Integrations. V2 is read-only this phase — no drawing, no dispatch interaction. Production stays on `/map` until Phases 2-5 ship."

**Verification:** `cd client && npx vitest run MapPageV2.smoke` passes. `cd client && npx tsc --noEmit` returns 0 errors.

---

## Deploy + Rollback

- Bump `client/public/sw.js` `CACHE_NAME` (CLAUDE.md gotcha #5).
- `bash deploy/deploy.sh` from this worktree (CLAUDE.md gotcha #43 — verify no other worktree is mid-deploy).
- **Rollback:** Toggle `map_v2_enabled` off in Admin → Integrations. The route still exists but is unreachable from nav. No code revert needed for emergency rollback.
- **Hard rollback:** `git revert <merge-commit>` removes the route + hooks entirely. Google Maps untouched throughout this phase, so dispatch is never at risk.

---

## What Phase 2-5 Will Add (not this PR)

- **Phase 2:** Per-surface migration of DispatchMiniMap, ServeRoutePlanner, PatrolPage, DashCamDetailPage to OpenLayers.
- **Phase 3:** Address autocomplete using Nominatim `/search` with debounced suggestions (replaces `google.maps.places.Autocomplete`).
- **Phase 4:** Port the 40 feature hooks (markers, overlays, drawing, heatmaps, traffic) into V2. Drawing tools become OL's `Draw` interaction. Heatmaps use `ol-ext`'s `HeatmapLayer`.
- **Phase 5:** Flip default to V2, delete Google code paths, drop `@googlemaps/*` from package.json, remove `VITE_GOOGLE_MAPS_API_KEY` env var, tighten CSP (remove `*.googleapis.com`, `*.gstatic.com`), bump major version.
