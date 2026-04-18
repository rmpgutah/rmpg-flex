# Section/Zone/Beat & Map Layout Enhancement Design

**Date**: 2026-04-03
**Approach**: Option B — Unified District Management

## Overview

Fix and enhance the Section/Zone/Beat system across 5 areas: admin tree view, map overlay, dispatch dropdowns, beat auto-detection, and system-wide km→mi conversion. All changes use `dispatch_districts` table as the single source of truth.

## 1. Admin Tree View — District Management

Replace the flat JSON-based table in AdminSystemTab with a hierarchical tree view that CRUDs directly against `dispatch_districts`.

### Tree Structure
- Sections are expandable top-level nodes (SL1, DV1, WB1, etc.)
- Zones are second-level nodes under their parent section
- Beats are leaf nodes under their parent zone
- Each level has Edit button; Beats also have Delete
- "+ Add Section", "+ Add Zone", "+ Add Beat" buttons at each level
- Stats bar: total sections, zones, beats

### Data Model
Sections and zones are virtual — derived by grouping `dispatch_districts` rows. Only beats (full district rows) are stored.

### New API Endpoints
```
POST   /api/dispatch/districts       — Create district row
PUT    /api/dispatch/districts/:id   — Update district row
DELETE /api/dispatch/districts/:id   — Delete district row
```

## 2. Map Layout — 7 Enhancements

### 2a. Section-Colored Beat Polygons
- Color each beat by parent section using existing `getSectionColor()`
- Increase fill opacity to 12% for dark theme visibility
- Unmapped beats fall back to gray

### 2b. Beat Labels on Map
- Show beat codes at polygon centroids via OverlayView
- Full code (SL1-SLC/A) at zoom 13+, abbreviated (A) at zoom 11-12
- Hidden below zoom 11 for performance (690 features)
- White text with dark shadow for readability

### 2c. Active Unit Overlay
- Cross-reference unit GPS positions with beat geofence
- Covered beats: normal opacity + unit count badge
- Uncovered beats: dimmed/reduced opacity
- Uses existing WebSocket GPS data

### 2d. Enhanced Info Windows
Rich popup on beat click:
- Hierarchy: Section → Zone → Beat with names
- Dispatch code
- Assigned units with current status
- Active calls count + calls today

### 2e. Call Density Heat Map
- New toggle in layers panel: "Call Heat Map"
- Colors beats by call volume (blue→yellow→red gradient)
- Selectable time range: 24h, 7d, 30d
- New endpoint: `GET /api/dispatch/districts/call-density?range=24h`

### 2f. Beat Boundary Editor (Admin Only)
- Toggle "Edit Beats" mode in layers panel
- Click beat to select, drag vertices to reshape
- Save writes updated geometry to beat.geojson
- New endpoint: `PUT /api/dispatch/districts/beat-geometry/:beatCode`
- Server reloads geofence engine after save

### 2g. Patrol Route Tracking
- Toggle in layers panel: "Patrol Trails"
- Polyline of GPS breadcrumbs per unit for current shift
- Color-coded by unit, fading from solid (recent) to transparent (older)
- New endpoint: `GET /api/gps/trail/:unitId?hours=8`

## 3. Dispatch Dropdown Fixes

### 3a. Reliable Dropdown Sync
- When GPS auto-fills section/zone/beat, force dropdown selections to match
- Add "Re-detect" button to re-run geofence from call lat/lng
- Show amber warning if no beat found

### 3b. Fallback for Missing Districts
- Empty districts: show notice linking to Admin > System > Zones & Beats
- Stale beat data: show raw values with warning icon

### 3c. Loading & Error States
- Spinner while useDistrictOptions loads
- "Failed to load districts" with retry button on error
- Disable dropdowns while loading

## 4. Beat Auto-Detection Fixes

### 4a. Nearest-Beat Fallback
- When point-in-polygon returns null, find nearest beat centroid within 1.25 miles
- Tag result as `{ exact: false }` for UI "Approximate beat" indicator

### 4b. Geofence Hot-Reload
- `reloadGeofence()` function clears cached GeoJSON and reloads from disk
- Called when beat boundary editor saves
- New endpoint: `POST /api/dispatch/districts/reload-geofence` (admin only)

### 4c. District Lookup Fix
- Match geofence result to dispatch_districts via `beat_code` → `dispatch_code`
- Fall back to `city_code + district_letter` if no direct match
- Log warning when beat exists in GeoJSON but not in dispatch_districts

## 5. System-Wide km → mi Conversion

Sweep entire codebase and convert all kilometer references to miles:
- Server-side distance calculations (geofence thresholds, GPS proximity)
- Client-side display labels ("km" → "mi")
- Radius/threshold constants
- API response distance values
- Map measurement tools

## Files Affected

### Server
- `server/src/routes/dispatch/aggregates.ts` — New CRUD + call-density + reload-geofence endpoints
- `server/src/utils/geofence.ts` — Nearest-beat fallback, hot-reload, mi conversion
- `server/src/utils/districtResolver.ts` — Lookup fix, mi conversion
- `server/src/routes/dispatch/calls.ts` — Dropdown sync improvements
- `server/src/routes/gps.ts` — Trail endpoint (if not existing)
- Various files — km→mi conversion

### Client
- `client/src/pages/admin/AdminSystemTab.tsx` — Tree view replacing flat table
- `client/src/hooks/useGeoJsonLayers.ts` — Section coloring, label overlays
- `client/src/pages/map/MapPage.tsx` — Unit overlay, heat map, boundary editor, patrol trails, info windows
- `client/src/pages/dispatch/DispatchPage.tsx` — Dropdown sync, re-detect, loading states
- `client/src/hooks/useDistrictLookup.ts` — Loading/error states
- Various files — km→mi display conversion
