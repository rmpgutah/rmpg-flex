# Mapbox Features Expansion + Admin Dev Settings

**Date:** 2026-06-23  
**Status:** Approved — ready for implementation  
**Delivery:** 3 PRs (PR 1 → PR 2 → PR 3, sequential)

---

## Overview

Adds 9 new Mapbox-powered features to RMPG Flex via a floating vertical toolbar on the map canvas, plus a new Admin Dev Settings panel. All new tools follow the existing 37-hook + component-per-feature pattern. MapPage.tsx gains exactly one new child element: `<MapToolbar map={mapRef} />`.

---

## Architecture

### Core invariant
Every tool is a self-contained hook + component pair. The MapToolbar shell manages `activeTool` state; only the active tool's component is mounted. Zero surgery on the 6,700-line MapPage.tsx.

### Floating toolbar
- Absolute-positioned left edge of map canvas, z-50
- Icon button per tool; one tool active at a time (mutual exclusion)
- Active tool mounts a floating control panel beside the toolbar
- Tools config array: `{ id, icon, label, component, featureFlag }`
- Each tool is hidden if its feature flag is disabled (reads FeatureFlagsContext)
- Toolbar icons: Draw ✏️ · Annotate 📍 · Ruler 📏 · Buffer ⭕ · Replay ▶️ · Nav 🧭 · separator · Buildings 🏢 · Minimap 🗺️

### FeatureFlagsContext
- React context loaded on app mount via `GET /api/admin/feature-flags`
- Polls KV every 30s on window focus
- All toolbar tools and admin sections read from this context
- Disabled tools render greyed out, not hidden

---

## PR 1 — Toolbar + Pure UI Tools

**No new D1 tables. New npm dep: `@mapbox/mapbox-gl-draw`.**

### New files
- `client/src/components/MapToolbar.tsx` — toolbar shell
- `client/src/pages/map/components/DrawGeofenceTool.tsx`
- `client/src/pages/map/components/BuildingsLayer.tsx`
- `client/src/pages/map/components/MinimapControl.tsx`
- `client/src/pages/map/components/ScaleFullscreenControls.tsx`
- `client/src/contexts/FeatureFlagsContext.tsx`
- `src/routes/geofences.ts`

### MapToolbar.tsx
- Absolute-positioned, left edge, z-50, `.tactical-dark` always-dark surface
- `activeTool: string | null` state; clicking active tool deactivates
- Renders tools from config array filtered by feature flags
- Mounts active tool's component as a sibling floating panel

### DrawGeofenceTool.tsx
- Installs `MapboxDraw` on component mount, removes on unmount
- Draw modes: polygon, circle (via `@turf/circle`)
- Floating panel: shape selector, 6-color picker + custom hex, zone name input, zone_type select (exclusion / inclusion / alert / patrol_required)
- On `draw.create` event → POST `/api/geofences` with `{ zone_name, zone_type, geojson_data: JSON.stringify(draw.getAll()), color, description }`
- On save: `useMapGeofences` hook re-fetches → existing layer updates automatically
- Existing zones load into Draw editor on mount (editable in place)

### BuildingsLayer.tsx
- Adds `fill-extrusion` layer from Mapbox built-in `building` source
- Height: `building:levels` property × 3m; fallback 10m
- Only renders at zoom ≥ 15
- Night fill: `--rmpg-800`; top face: `brand-400` (gold)
- Toggle state persisted to `mapPreferences` localStorage
- Toolbar button: simple toggle, no floating panel

### MinimapControl.tsx
- Second `mapboxgl.Map` instance in 180×140px overlay, bottom-right corner
- Style: always `mapbox://styles/mapbox/dark-v11`
- Tracks main map camera with slight lag
- Blue bbox rect showing current viewport bounds
- Click minimap → main map flies to that point
- Toggle stored in localStorage

### ScaleFullscreenControls.tsx
- `mapboxgl.ScaleControl` — imperial units (ft/mi)
- `mapboxgl.FullscreenControl` — native Mapbox control
- Both toggled by toolbar buttons (add/remove control at runtime)
- State restored from `mapPreferences` on page load

### src/routes/geofences.ts
```
GET    /api/geofences         SELECT * FROM geofence_zones WHERE is_active=1
POST   /api/geofences         INSERT INTO geofence_zones (zone_name, zone_type, geojson_data, color, description, created_by)
PUT    /api/geofences/:id     UPDATE geofence_zones SET ... WHERE id=?
DELETE /api/geofences/:id     UPDATE geofence_zones SET is_active=0 WHERE id=?
```
Auth: required (all roles). Mounted at `/api/geofences` in `src/index.ts`.

---

## PR 2 — Data Tools

**1 new D1 table (`map_annotations`). 4 new API endpoints.**

### Migration: `0153_map_annotations.sql`
```sql
CREATE TABLE IF NOT EXISTS map_annotations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  body        TEXT,
  color       TEXT    DEFAULT '#d4a017',
  icon        TEXT    DEFAULT 'pin',
  lat         REAL    NOT NULL,
  lng         REAL    NOT NULL,
  created_by  INTEGER REFERENCES users(id),
  call_id     INTEGER,
  expires_at  TEXT,
  is_active   INTEGER DEFAULT 1,
  created_at  TEXT    DEFAULT (datetime('now')),
  updated_at  TEXT    DEFAULT (datetime('now'))
);
```
**After merge:** Apply directly via `scripts/apply-migration.sh 0153_map_annotations.sql` — deploy is `continue-on-error`.

### New files
- `client/src/pages/map/components/AnnotationTool.tsx`
- `client/src/pages/map/components/BufferRingTool.tsx`
- `client/src/pages/map/components/RulerTool.tsx`
- `client/src/pages/map/components/GpsReplayTool.tsx`
- `client/src/pages/map/components/NavOverlayTool.tsx`
- `src/routes/mapAnnotations.ts`

### AnnotationTool.tsx
- Activating tool switches cursor to crosshair
- Click map → floating form: title (required), body (optional), color (5 presets), icon (pin/warning/info/flag), optional call_id link, optional expires_at
- POST `/api/map/annotations` on save
- All active annotations load on mount via GET with `?bbox=` viewport filter
- Click existing pin → popup: title, body, creator name, Edit / Delete buttons
- Soft delete (is_active=0)
- WS broadcast on create/delete so other clients update live (reuses existing WS broadcast pattern)

### BufferRingTool.tsx
- Click toolbar → crosshair cursor
- Click map point or existing call/unit marker as center
- Floating panel: radius input (ft/mi toggle), color picker, opacity slider (0.1–0.8)
- Renders via `turf.circle()` → GeoJSON fill layer on map
- Multiple rings simultaneously supported
- Distance label at ring center
- Ephemeral — cleared on tool deactivate or page refresh

### RulerTool.tsx
- Click map to place waypoints (up to 20 points)
- Line rendered between each point; distance label at each segment midpoint
- Units: ft if < 0.25 mi, else mi (imperial throughout)
- Total distance shown in floating panel
- Double-click to finish; Esc to clear
- Uses `@turf/length` (already in client/package.json) for geodesic calculation on the ruler LineString
- Ephemeral — temporary GeoJSON source removed on deactivate

### GpsReplayTool.tsx
- Reads unit GPS position history from existing D1 GPS tracking data (same source as `useMapBreadcrumbs`, with time-range param added)
- Floating panel: unit selector dropdown, date range picker (default: last 8h), playback speed selector (1×/2×/5×/10×)
- Time slider scrubs position history
- Play/Pause/Stop controls
- Animated unit marker moves along trail during playback
- Trail fades gold → dim as positions age (matches existing breadcrumb styling)
- Camera auto-follow toggle (follows unit during playback)
- Ephemeral — no new D1 writes

### NavOverlayTool.tsx
- Input modes: (A) pick active call → auto-fills destination from call address geocoded to lat/lng; (B) manual origin + destination with geocoder autocomplete
- Routes via existing `/api/mapbox/directions` proxy (already built in `src/routes/mapbox.ts`)
- Route rendered as bold steel-blue line with direction arrows at intervals
- Alternative routes shown as thinner lines; click to select
- Floating panel: turn-by-turn list (icon + instruction + distance per step), ETA badge in panel header
- Ephemeral — route layer removed on tool deactivate

### src/routes/mapAnnotations.ts
```
GET    /api/map/annotations         WHERE is_active=1, optional ?bbox=w,s,e,n filter
POST   /api/map/annotations         INSERT with created_by from JWT
PUT    /api/map/annotations/:id     UPDATE (creator or admin only)
DELETE /api/map/annotations/:id     SET is_active=0 (creator or admin only)
```
Auth: required (all roles). Mounted in `src/index.ts`.

---

## PR 3 — Admin Dev Panel

**No new D1 tables. New KV key `"feature_flags"`. Admin role only.**

### New files
- `client/src/pages/admin/AdminDevSettingsTab.tsx`
- `src/routes/adminDev.ts`

### AdminDevSettingsTab.tsx
- New tab in AdminPage tab strip: `Map Settings | Users | Roles | Dev ⚙`
- Role guard: `role === 'admin'` (returns null otherwise)
- 4 collapsible sections using existing SpillmanGroupBox component

#### Section 1 — Feature Flags
- Toggle row per map tool: Draw · Annotations · GPS Replay · Nav Overlay · 3D Buildings · Buffer Rings · Ruler · Minimap · Dev Diagnostics
- `PUT /api/admin/feature-flags` on each toggle change (debounced 300ms)
- FeatureFlagsContext polls on window focus (30s interval) — all clients pick up changes without reload

#### Section 2 — Map Diagnostics Overlay
- Toggle: Enable diagnostics overlay
- When enabled: semi-transparent HUD in top-right of map canvas, refreshed every 500ms
- Metrics: FPS (requestAnimationFrame delta), active layer count, loaded tile count, render time (map `render` event), zoom, pitch, bearing, center lat/lng (6dp), Mapbox GL JS version string
- Keyboard shortcut: `Ctrl+Shift+D` toggles from anywhere on the map page
- State in localStorage only (no server)

#### Section 3 — API & WebSocket Inspector
- Client-side interceptor wraps `apiFetch` to log every call into a ring buffer (last 100 entries)
- Log columns: method, path, HTTP status (color-coded), latency ms, timestamp
- Path prefix filter input
- WS message log: taps `useLiveSync` message stream, last 50 messages (↑/↓ direction, type, payload preview)
- "Clear logs" button
- Zero server changes needed — entirely client-side

#### Section 4 — Simulation Controls
- **Fake GPS position:** unit selector + lat/lng inputs or click-on-map mode → POST `/api/admin/mock/gps` → injects position update into WS broadcast stream, visible to all connected clients
- **Seed test call:** POST `/api/admin/mock/call` with preset type (TRAFFIC STOP / WELFARE CHECK / DISTURBANCE) → creates CFS record with `notes='[TEST]'`, auto-clears after 10 min via cron
- **Welfare timer trigger:** unit selector → POST fires WelfareWatchDO alarm immediately for that unit
- **Clear test data:** DELETE all CFS records with `notes LIKE '%[TEST]%'`
- All actions audit-logged with `created_by` + action type

### src/routes/adminDev.ts
```
GET  /api/admin/feature-flags   KV.get("feature_flags") → JSON parse → default all true if missing
PUT  /api/admin/feature-flags   KV.put("feature_flags", JSON.stringify(body))
POST /api/admin/mock/gps        Validates unit exists → broadcasts fake position via WS
POST /api/admin/mock/call       INSERT CFS with [TEST] flag; schedules 10-min cleanup
```
All routes: auth required + `role === 'admin'` check (403 otherwise).

---

## Error handling

| Scenario | Handling |
|---|---|
| `/api/geofences` POST with invalid GeoJSON | 400 + `{ error: 'invalid_geojson' }` |
| Annotation created at invalid coordinates | 400 + `{ error: 'invalid_coordinates' }` |
| Feature flags KV key missing | Default all flags to `true` (fail-open: tools visible by default) |
| GPS Replay: no position history for unit | Empty state in panel: "No GPS data for selected unit in this range" |
| Nav Overlay: directions API fails | Error state in panel + retry button |
| Mock GPS: unit_id not found | 404 + `{ error: 'unit_not_found' }` |

---

## Testing

- PR 1: Vitest unit tests for `DrawGeofenceTool` save flow (mock POST), `BuildingsLayer` mount/unmount, `ScaleFullscreenControls` add/remove. New `GET/POST /api/geofences` route tests.
- PR 2: Unit tests for `RulerTool` turf distance calculation, `BufferRingTool` circle generation, `AnnotationTool` form validation. API route tests for all 4 annotation CRUD endpoints.
- PR 3: Unit tests for feature flags GET/PUT (KV mock), admin role guard (403 on non-admin). Mock simulation route tests.

---

## Dependencies summary

| Package | PR | Notes |
|---|---|---|
| `@mapbox/mapbox-gl-draw` | PR 1 | Official Mapbox draw library |
| `@turf/circle` | PR 1 + PR 2 | Geodesic circle generation — **new, not yet in client/package.json** |
| `@turf/length` | PR 2 | Ruler tool — **already installed** |

---

## Migration checklist (post-merge per PR)

- **PR 1:** No migration. Verify `geofence_zones` table exists in live D1 (`785de7ae`).
- **PR 2:** `scripts/apply-migration.sh 0153_map_annotations.sql` → verify via `PRAGMA table_info(map_annotations)`.
- **PR 3:** No migration. Set KV value via `wrangler kv:key put --binding=KV "feature_flags" '{"draw":true,...}'` if not auto-initialized.
