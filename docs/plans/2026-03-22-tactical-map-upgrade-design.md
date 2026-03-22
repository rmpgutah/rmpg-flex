# Tactical Map Nerve Center Upgrade — Design

**Date:** 2026-03-22
**Status:** Approved
**Goal:** Transform the map from a display tool into the operational nerve center with 7 new features: time-lapse heatmap animation, predictive hotspots, 4 new data layers, geofence alerts, incident clustering, officer safety zones, and drag-and-dispatch.

## Existing Map Capabilities (Already Built)

- Heatmap with 3 modes (all/risk/type), 7-90 day filters
- GPS breadcrumbs with color modes + playback animation
- Distance/area measurement tools
- Weather widget, closest unit panel
- 3 toggleable layers (units, calls, properties)
- 6 map styles (dark, satellite, hybrid, streets, terrain, night nav)
- Offline CartoDB tiles for vehicle dead zones
- Unit-to-call tracking lines

## Feature 1: Time-Lapse Heatmap Animation

Animate the heatmap across time intervals to watch crime patterns shift.

**Server:** `GET /api/dispatch/heatmap/timelapse?days=7&slices=24`
- Breaks date range into time slices (hourly for <=7 days, daily for 14-90 days)
- Returns `{ slices: [{ start, end, points: [{ latitude, longitude, count, risk_weight }] }] }`
- Same aggregation logic as existing heatmap endpoint but bucketed by time

**Frontend Hook:** `useMapHeatmapTimelapse.ts`
- State: `isPlaying`, `currentSlice`, `speed` (1x/2x/4x), `sliceData[]`
- Timer swaps HeatmapLayer `data` property on each tick
- Reuses existing gradient colors and modes

**UI Controls** (added to existing heatmap section in MapLayersPanel):
- "Timelapse" toggle button
- Play/Pause button, speed selector (1x/2x/4x)
- Scrub slider showing timeline
- Current timestamp label (e.g., "Mon 14:00-15:00")

## Feature 2: Predictive Hotspot Zones

Algorithm identifies areas likely to have incidents in the next shift.

**Server:** `GET /api/dispatch/heatmap/predictions?shift=swing`
- Analyzes 90 days of calls grouped by ~200m grid cells
- Weights: recency (exponential decay), day-of-week match, time-of-day match
- Returns top 15 hotspots: `{ hotspots: [{ lat, lng, radius_m, score, incident_count, top_types }] }`
- Suggested patrol route: hotspots ordered by geographic proximity (nearest-neighbor)

**Frontend Hook:** `useMapPredictions.ts`
- Renders semi-transparent circles (red=high, amber=medium risk)
- Pulsing border animation on high-risk zones
- Sidebar panel listing hotspots with "Navigate" button (centers map)

**Layer Toggle:** New "Predictions" toggle in MapLayersPanel with Brain icon

## Feature 3: Additional Data Layers

4 new toggleable layers using existing DB data:

| Layer | API Endpoint | Icon | Color | Details on Click |
|-------|-------------|------|-------|-----------------|
| Active Warrants | `/warrants?status=active&has_coords=true` | Shield | Red | Subject name, charges, bail, issuing court |
| Trespass Orders | `/trespass-orders?status=active` | Ban | Orange | Subject, property, effective dates |
| Sex Offenders | `/offender-registry?has_coords=true` | UserX | Purple | Name, tier, restrictions, buffer zone circle |
| Active BOLOs | `/comms/bolos/active` | AlertTriangle | Red | Subject/vehicle desc, issuing officer |

**Implementation:**
- Each layer fetched on toggle-on, cached until toggle-off
- Markers use AdvancedMarkerElement with custom HTML content (matching existing unit/call marker pattern)
- Info windows on click with entity details
- Offender layer includes 1000ft buffer zone circle (school proximity)

**Toggle UI:** 4 new rows in MapLayersPanel under new "Intelligence" section header

## Feature 4: Geofence Alerts

Define zones that trigger alerts when units enter/exit.

**Database:** New `geofences` table:
```sql
CREATE TABLE geofences (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  zone_type TEXT DEFAULT 'custom', -- school, restricted, high_risk, custom
  polygon_coords TEXT NOT NULL,    -- JSON array of {lat, lng} vertices
  alert_on_enter BOOLEAN DEFAULT 1,
  alert_on_exit BOOLEAN DEFAULT 0,
  color TEXT DEFAULT '#ef4444',
  is_active BOOLEAN DEFAULT 1,
  created_by TEXT,
  created_at TEXT, updated_at TEXT
);
```

**Server:**
- CRUD routes: `GET/POST/PUT/DELETE /api/map/geofences`
- GPS check: In breadcrumb handler, point-in-polygon test against active geofences
- WebSocket broadcast: `geofence:alert` with `{ unit, geofence_name, action: 'enter'|'exit' }`

**Frontend:**
- "Draw Zone" button → enters polygon drawing mode (reuses measurement polygon tool)
- Zones rendered as semi-transparent polygons with dashed borders
- Zone management panel (list, edit, delete, toggle active)
- Toast + optional sound on geofence trigger
- Zone type presets: School (amber, 1000ft buffer), Restricted (red), Custom

## Feature 5: Incident Clustering

Auto-group nearby markers when zoomed out.

**Implementation:**
- Install `@googlemaps/markerclusterer` (or implement grid-based clustering manually)
- Cluster call markers at zoom < 14
- Cluster appearance: circle with count, color = highest priority in cluster (P1=red, P2=amber, P3=blue)
- Click cluster → zoom to bounds showing individual markers
- Property markers also cluster separately at zoom < 12
- Unit markers never cluster (always visible)

**Hook:** `useMapClustering.ts`
- Wraps existing call markers in clusterer
- Recreates on call data change
- Disabled at street-level zoom

## Feature 6: Officer Safety Zones

Auto-generated danger overlays from historical weapon/DV calls.

**Server:** `GET /api/dispatch/heatmap/safety-zones`
- Queries calls with `weapons_involved=1 OR domestic_violence=1 OR injuries_reported=1` in last 90 days
- Groups by ~200m grid cells
- Cells with 3+ weapon calls → red zone, 2+ DV calls → amber zone
- Returns: `{ zones: [{ lat, lng, radius_m, risk_level, weapons_count, dv_count, last_incident }] }`

**Frontend Hook:** `useMapSafetyZones.ts`
- Renders circles: red (high risk, 200m radius), amber (moderate, 150m)
- Dashed border, 20% opacity fill
- Tooltip on hover: "3 weapons calls, last: Mar 15"
- GPS proximity alert: when unit breadcrumb enters a zone → WebSocket `safety:warning` event → toast with zone details

**Layer Toggle:** "Safety Zones" in MapLayersPanel with ShieldAlert icon

## Feature 7: Drag-and-Dispatch

Visual dispatch by dragging unit markers onto call markers.

**Implementation:**
- "Dispatch Mode" toggle button in toolbar (Grab icon)
- When active: unit AdvancedMarkerElements get `gmpDraggable: true`
- On drag start: show blue glow trail, highlight compatible call markers
- On drag end: check proximity to call markers (< 50px screen distance)
- If dropped on call → confirmation dialog: "Dispatch {unit} to {call}?"
- Confirm → `POST /api/dispatch/calls/{callId}/assign` with `{ unit_ids: [unitId] }`
- Visual feedback: green pulse on call marker, tracking line appears
- Snaps unit marker back to original GPS position after dispatch

**Hook:** `useMapDragDispatch.ts`
- Manages draggable state per marker
- Calculates screen-space proximity to call markers
- Handles dispatch API call + optimistic UI update

## Files Created/Modified

| Action | File | Purpose |
|--------|------|---------|
| Create | `client/src/pages/map/hooks/useMapHeatmapTimelapse.ts` | Time-lapse animation |
| Create | `client/src/pages/map/hooks/useMapPredictions.ts` | Predictive hotspot zones |
| Create | `client/src/pages/map/hooks/useMapIntelLayers.ts` | Warrants/trespass/offender/BOLO layers |
| Create | `client/src/pages/map/hooks/useMapGeofences.ts` | Geofence zones + alerts |
| Create | `client/src/pages/map/hooks/useMapClustering.ts` | Incident marker clustering |
| Create | `client/src/pages/map/hooks/useMapSafetyZones.ts` | Auto-generated danger overlays |
| Create | `client/src/pages/map/hooks/useMapDragDispatch.ts` | Drag unit → call dispatch |
| Create | `client/src/pages/map/components/GeofenceManager.tsx` | Zone CRUD panel |
| Create | `client/src/pages/map/components/PredictionsPanel.tsx` | Hotspot list + navigate |
| Create | `server/src/routes/mapGeofences.ts` | Geofence CRUD + alert API |
| Modify | `server/src/routes/dispatch/aggregates.ts` | Timelapse + predictions + safety endpoints |
| Modify | `server/src/routes/dispatch/gps.ts` | Geofence check on breadcrumb |
| Modify | `client/src/pages/map/MapPage.tsx` | Wire all 7 features |
| Modify | `client/src/pages/map/components/MapLayersPanel.tsx` | New toggle controls |
| Modify | `server/src/models/database.ts` | Geofences table |
| Modify | `server/src/index.ts` | Mount geofence routes |

## Security

- All new endpoints require JWT auth + appropriate role
- Geofence CRUD restricted to admin/supervisor
- Sex offender data display restricted to officer+ roles
- Warrant details restricted to authorized roles per existing pattern
- Drag-and-dispatch requires dispatcher/supervisor role
