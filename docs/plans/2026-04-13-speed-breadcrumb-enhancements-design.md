# Speed Breadcrumb Enhancements — Design Document

**Date**: 2026-04-13
**Status**: Approved
**Scope**: 12 features across 4 pillars

## Summary

Comprehensive upgrade to the GPS breadcrumb speed visualization, analytics, and accountability system on the MapPage and Reports page. Builds incrementally on the existing `useMapBreadcrumbs` hook (477 lines), `MapLayersPanel` (1791 lines), and `gps.ts` server route (686 lines).

---

## Pillar 1: Speed Accountability

### 1a. Speed Violation Log

**New DB table: `speed_violations`**
- `id` INTEGER PRIMARY KEY
- `unit_id` INTEGER FK → units
- `officer_id` INTEGER FK → users
- `call_sign` TEXT
- `officer_name` TEXT
- `badge_number` TEXT
- `speed_mps` REAL
- `speed_mph` REAL
- `speed_limit_mph` REAL (from speed_zone or default 80)
- `overage_mph` REAL
- `latitude` REAL
- `longitude` REAL
- `road_name` TEXT
- `nearest_intersection` TEXT
- `beat_id` INTEGER
- `zone_id` INTEGER
- `duration_seconds` INTEGER (updated while violation continues)
- `current_call_id` INTEGER
- `current_call_number` TEXT
- `recorded_at` TEXT
- `acknowledged_by` INTEGER FK → users
- `acknowledged_at` TEXT
- `notes` TEXT

**Detection logic**: In GPS POST handler, after inserting breadcrumbs, check if latest point speed exceeds threshold. If an active violation exists for this unit within last 60s and still speeding, update duration. Otherwise create new record.

**API endpoints**:
- `GET /api/dispatch/gps/speed-violations` — list with filters (officer_id, date range, acknowledged status)
- `PATCH /api/dispatch/gps/speed-violations/:id/acknowledge` — supervisor sign-off

**Client**: Badge count in map panel + expandable list. Full table in Reports page.

### 1b. Speed Stats Per Officer

**API endpoint**: `GET /api/dispatch/gps/speed-stats` with query params: officer_id, start_date, end_date
**Returns**: max_speed_mph, avg_speed_mph, p95_speed_mph, total_distance_miles, time_over_limit_seconds, violations_count, points_count

**Client (Map)**: Speed Profile card on unit trail click.
**Client (Reports)**: Officer speed comparison table with inline SVG bar charts.

### 1c. Speed Geofencing (Simplified)

**New DB table: `speed_zones`**
- `id`, `name`, `speed_limit_mph`, `polygon_coords` (JSON), `zone_type` (school_zone, residential, construction, custom), `active_hours` (JSON), `is_active`, `created_by`, `created_at`

**Admin page CRUD** (no map draw-to-create). Map layer renders existing zones as colored polygons.

**GPS handler integration**: Check latest point against active speed_zones. If speed > zone limit, log violation with zone's limit.

---

## Pillar 2: Pursuit / Emergency Tracking

### 2a. Live Speed Graph Overlay

**New component**: `SpeedGraphOverlay.tsx` — fixed-position panel (300x120px) bottom-right of map.
- Inline SVG sparkline of speed over last 15 minutes for selected unit.
- Color band background matching speed scale. Updates every 15s.
- Toggle via speedometer icon on unit info popup.
- Large current-speed readout.

### 2b. Pursuit Corridor Visualization

**API endpoint**: `GET /api/dispatch/gps/pursuit-segments?unit_id=X&hours=Y`
- Server detects sequences where speed > 60 mph AND acceleration > 2 m/s² for ≥3 consecutive points.
- Returns: `{ start_time, end_time, max_speed_mph, avg_speed_mph, distance_miles, points: [...] }`

**Client**: Highlighted thick polylines (6px, pulsing red). Time markers every 30s. Summary tooltip on hover.

### 2c. Acceleration / Deceleration Data

**Server**: Computed fields in `/trails` response: `accel_mps2`, `is_hard_brake` (< -4 m/s²), `is_rapid_accel` (> 3 m/s²).

**Client**:
- New "Accel" color mode (green=steady, yellow=mild, orange=hard accel, red=hard brake)
- Brake/accel event markers on trail (red square / orange diamond)
- Acceleration readout in info popup with arrow indicator

---

## Pillar 3: Patrol Analysis

### 3a. Speed Heatmap Layer

**API endpoint**: `GET /api/dispatch/gps/speed-heatmap?hours=8&grid_size=0.002`
- Server aggregates breadcrumbs into grid cells (~200m). Returns: lat, lng, avg_speed, max_speed, count.
- Only cells with ≥3 points.

**Client**: Map layer toggle "Speed Heatmap". Colored rectangles per cell. Mutually exclusive with breadcrumb trails. Zoom ≥11 only.

### 3b. Zone/Beat Speed Stats

**API endpoint**: `GET /api/dispatch/gps/zone-speed-stats?hours=8`
- Joins breadcrumbs with geography via point-in-polygon. Per beat/zone: avg, max, p95, total points, distance.

**Client**: Collapsible table in map panel. Click row to pan/zoom. Color-coded cells.

### 3c. Coverage Timeline

**API endpoint**: `GET /api/dispatch/gps/coverage-timeline?hours=8&interval=30`
- Per time interval, which zones had coverage and at what speeds.

**Client**: `CoverageTimeline.tsx` — horizontal timeline bar chart. Rows = zones, columns = intervals. Cell colors: green (covered), yellow (slow/stationary), gray (gap). Collapsible panel.

---

## Pillar 4: Visual Richness

### 4a. Enhanced Info Popups

Additions to existing breadcrumb click popup:
- Mini speed sparkline (inline SVG, 180x40px, surrounding 20 points)
- Acceleration indicator (arrow + magnitude + color)
- Distance from previous point with time delta
- GPS quality badge (color pill based on accuracy)
- Heading compass rose (32px CSS)

### 4b. Interactive Speed Legend + Filtering

- Expand to all 9 bands from SPEED_LEGEND_BANDS
- Each band is a clickable toggle (hide/show segments in that range)
- Dual-handle speed range slider
- Hidden segments become faint dashed lines (20% opacity) for path continuity
- Active filter text indicator

### 4c. Trail Animation Improvements

- Speed-proportional playback (faster points animate faster)
- Ghost trail effect (last 20 points fading behind marker)
- Pulsing current marker with speed-color glow
- Floating speed readout label above playback marker
- Speed graph cursor sync during playback

---

## File Changes Summary

### New Server Files
- None (all endpoints added to existing `gps.ts`)

### Modified Server Files
- `server/src/routes/dispatch/gps.ts` — new endpoints, violation detection in POST handler
- `server/src/models/database.ts` — `speed_violations` + `speed_zones` tables, addCol migrations
- `server/src/routes/reports.ts` — speed stats/violations report sections

### New Client Files
- `client/src/pages/map/components/SpeedGraphOverlay.tsx`
- `client/src/pages/map/components/CoverageTimeline.tsx`
- `client/src/pages/map/components/SpeedZonesLayer.tsx`
- `client/src/pages/map/hooks/useSpeedAnalytics.ts`

### Modified Client Files
- `client/src/pages/map/hooks/useMapBreadcrumbs.ts` — accel color mode, enhanced info popup, animation improvements, speed filtering
- `client/src/pages/map/components/MapLayersPanel.tsx` — new toggles, interactive legend, zone stats panel
- `client/src/pages/map/MapPage.tsx` — integrate new components
- `client/src/pages/ReportsPage.tsx` — speed violations report section

### New DB Tables
- `speed_violations`
- `speed_zones`
