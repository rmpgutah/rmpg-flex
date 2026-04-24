# Speed Breadcrumb Enhancements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 12 speed breadcrumb features across 4 pillars: speed accountability (violation log, per-officer stats, speed geofencing), pursuit/emergency tracking (live speed graph, pursuit corridor detection, acceleration data), patrol analysis (speed heatmap, zone/beat speed stats, coverage timeline), and visual richness (enhanced popups, interactive legend/filtering, animation improvements).

**Architecture:** Incremental enhancement of the existing breadcrumb system. New DB tables (`speed_violations`, `speed_zones`) in `database.ts`. New API endpoints appended to `server/src/routes/dispatch/gps.ts`. New client hooks (`useSpeedAnalytics.ts`) and components (`SpeedGraphOverlay.tsx`, `CoverageTimeline.tsx`) in `client/src/pages/map/`. Modified breadcrumb rendering in `MapPage.tsx` (which has inlined breadcrumb logic at lines 311-1711, NOT using the extracted `useMapBreadcrumbs.ts` hook).

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Express 5, better-sqlite3, Google Maps JS API, inline SVG charts (no chart library), jsPDF for reports.

---

## Critical Context

- **MapPage.tsx** (5,488 lines) has breadcrumb logic **inlined** — state at lines 311-325, rendering effect at lines 1526-1711, playback at lines 1717+, panel UI at lines 2959-3034. The separate `useMapBreadcrumbs.ts` hook file is a parallel implementation that diverges from MapPage (hook has speed alert markers, MapPage doesn't).
- **gps.ts** (686 lines) — all GPS endpoints under `server/src/routes/dispatch/gps.ts`, mounted at `/` in dispatch index router. Client calls `/api/dispatch/gps/*`.
- **database.ts** (5,299 lines) — `gps_breadcrumbs` table at line 173, addCol migrations for breadcrumbs at lines 2674-2681.
- **Speed stored as m/s** in DB. Conversion: `mph = mps * 2.23694`. Current alert threshold: 80 mph (35.76 m/s).
- **Trail data shape**: `{ unit_id, call_sign, officer_name, badge_number, points: [{ lat, lng, accuracy, heading, speed, status, call_number, call_type, time, road_name, intersection }] }`
- Speed color function: `speedToColor(mps)` defined at MapPage.tsx:177 and useMapBreadcrumbs.ts:28.
- The `addCol()` helper in database.ts wraps `ALTER TABLE ADD COLUMN IF NOT EXISTS` — use it for all schema migrations.
- **Gotcha #42**: Security hook blocks certain child_process patterns in Edit tool. Use `db.prepare(...).run()` for DDL, never the bulk-run shortcut method.

---

## Task 1: DB Schema — `speed_violations` + `speed_zones` Tables

**Files:**
- Modify: `server/src/models/database.ts` (after the gps_breadcrumbs addCol block, ~line 2681)

**Step 1: Add the `speed_violations` CREATE TABLE**

In `database.ts`, find the line `addCol('gps_breadcrumbs', 'source', "TEXT DEFAULT 'unknown'");` (~line 2681). Immediately after it (before the backfill block at line 2683), add the `speed_violations` table using `db.prepare('CREATE TABLE IF NOT EXISTS speed_violations (...)').run()` with these columns:

- id INTEGER PRIMARY KEY AUTOINCREMENT
- unit_id INTEGER NOT NULL (FK units)
- officer_id INTEGER (FK users)
- call_sign TEXT, officer_name TEXT, badge_number TEXT
- speed_mps REAL NOT NULL, speed_mph REAL NOT NULL
- speed_limit_mph REAL NOT NULL DEFAULT 80, overage_mph REAL NOT NULL
- latitude REAL NOT NULL, longitude REAL NOT NULL
- road_name TEXT, nearest_intersection TEXT
- beat_id INTEGER, zone_id INTEGER
- duration_seconds INTEGER DEFAULT 0
- current_call_id INTEGER, current_call_number TEXT
- recorded_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
- acknowledged_by INTEGER (FK users), acknowledged_at TEXT, notes TEXT

**Step 2: Add the `speed_zones` CREATE TABLE**

Same pattern. Columns:
- id INTEGER PRIMARY KEY AUTOINCREMENT
- name TEXT NOT NULL, speed_limit_mph REAL NOT NULL
- polygon_coords TEXT NOT NULL, zone_type TEXT DEFAULT 'custom'
- active_hours TEXT, is_active INTEGER DEFAULT 1
- created_by INTEGER (FK users)
- created_at TEXT DEFAULT (datetime('now','localtime'))

**Step 3: Add indexes for speed_violations** on (unit_id, recorded_at), (officer_id, recorded_at), and a partial index WHERE acknowledged_by IS NULL.

**Step 4: Verify server starts** — `cd server && npx tsc --noEmit 2>&1 | head -5`

**Step 5: Commit** — `feat(db): add speed_violations and speed_zones tables`

---

## Task 2: Speed Violation Detection in GPS POST Handler

**Files:**
- Modify: `server/src/routes/dispatch/gps.ts` — inside the POST `/gps` handler, after the breadcrumb bulk-insert (~line 241) and before the geofence check (~line 249)

**Step 1: Add speed violation detection logic**

After `insertMany(validPoints);`, add a try/catch block that:

1. Converts latest point speed to mph
2. Checks if the point falls within any active `speed_zones` polygon (reuse the existing `pointInPolygon` function). If so, use that zone's limit. Otherwise default 80 mph.
3. For speed zones with `active_hours`, parse the JSON and check if current time is within the window. Skip zone if not.
4. If speed > limit:
   - Check for an active (unacknowledged) violation for this unit within last 60 seconds
   - If found: UPDATE to extend `duration_seconds` and keep max speed
   - If not found: INSERT new violation record
   - Broadcast `speed_violation` alert via `broadcastAlert()`

**Step 2: Verify no TS errors**

**Step 3: Commit** — `feat(gps): detect speed violations in POST handler with zone-aware limits`

---

## Task 3: Speed Violation API Endpoints

**Files:**
- Modify: `server/src/routes/dispatch/gps.ts` — append before `export default router;`

**Step 1: GET /gps/speed-violations**

- requireRole: admin, manager, supervisor
- Query params: hours (1-168, default 24), officer_id (optional), unacknowledged (true/false)
- Returns array of violations with JOIN to users table for acknowledger name
- ORDER BY recorded_at DESC, LIMIT 500

**Step 2: PATCH /gps/speed-violations/:id/acknowledge**

- requireRole: admin, manager, supervisor
- Body: { notes?: string }
- Updates acknowledged_by, acknowledged_at, notes WHERE acknowledged_by IS NULL
- Audit log the acknowledgment

**Step 3: GET /gps/speed-stats**

- requireRole: admin, manager, supervisor
- Query params: hours (1-168, default 8), officer_id (optional)
- Aggregates from gps_breadcrumbs: MAX/AVG speed per officer, points over limit count
- Computes p95 with a secondary sort query (SQLite lacks native percentile)
- Includes violations_count from speed_violations table

**Step 4: Commit** — `feat(gps): add speed-violations, acknowledge, and speed-stats endpoints`

---

## Task 4: Speed Zones CRUD Endpoints

**Files:**
- Modify: `server/src/routes/dispatch/gps.ts`

**Step 1: Standard CRUD for speed_zones**

- GET /gps/speed-zones — list all, accessible to all dispatch roles
- POST /gps/speed-zones — create, supervisor+, validates polygon_coords is valid JSON array with >=3 points
- PUT /gps/speed-zones/:id — partial update, supervisor+
- DELETE /gps/speed-zones/:id — admin only
- All mutations audit-logged

**Step 2: Commit** — `feat(gps): add speed-zones CRUD endpoints`

---

## Task 5: Acceleration Data + Pursuit Segment Detection

**Files:**
- Modify: `server/src/routes/dispatch/gps.ts`

**Step 1: Enhance `/trails` response with acceleration fields**

In the existing `/gps/trails` endpoint, modify the point object to include:
- `accel_mps2: number | null` — acceleration between consecutive points
- `is_hard_brake: boolean` — true when accel < -4 m/s^2
- `is_rapid_accel: boolean` — true when accel > 3 m/s^2

Calculate after each point is pushed to the trail: `accel = (speed2 - speed1) / dt_seconds`

**Step 2: Add GET /gps/pursuit-segments endpoint**

- Query params: unit_id (optional), hours (1-72, default 8)
- Fetches breadcrumbs, groups by unit
- Scans for consecutive sequences where speed > 60 mph (~26.8 m/s) for >= 3 points
- For each detected segment, returns: start_time, end_time, max_speed_mph, avg_speed_mph, distance_miles, point_count, points array

**Step 3: Commit** — `feat(gps): add acceleration data to trails + pursuit segment detection`

---

## Task 6: Heatmap + Zone Stats + Coverage Timeline Endpoints

**Files:**
- Modify: `server/src/routes/dispatch/gps.ts`

**Step 1: GET /gps/speed-heatmap**

- Aggregates breadcrumbs into lat/lng grid cells using ROUND(lat/gridSize)*gridSize
- Returns: grid_lat, grid_lng, avg_speed, max_speed, point_count
- Only cells with >= 3 points. Cache-Control: private, max-age=30

**Step 2: GET /gps/zone-speed-stats**

- Joins breadcrumbs with dispatch_beats using point-in-polygon
- Per beat: avg_speed_mph, max_speed_mph, p95_speed_mph, point_count
- Includes zone_name and sector_name from joined geography tables

**Step 3: GET /gps/coverage-timeline**

- Query params: hours, interval (10-120 min, default 30)
- Builds time intervals, classifies breadcrumbs into beats per interval
- Returns: array of { start, end, zones: [{ beat_id, beat_name, unit_count, avg_speed }] }

**Step 4: Commit** — `feat(gps): add speed-heatmap, zone-speed-stats, and coverage-timeline endpoints`

---

## Task 7: Client — Speed Analytics Hook

**Files:**
- Create: `client/src/pages/map/hooks/useSpeedAnalytics.ts`

**Step 1: Create the hook**

Exports `useSpeedAnalytics({ hours, enabled })` managing state for:
- Violations: fetched every 30s, unacknowledged count, acknowledge callback
- Pursuit segments: fetched every 30s
- Heatmap: toggled on/off, fetched every 60s when active
- Zone stats: toggled on/off, fetched every 60s when active
- Coverage timeline: toggled on/off, fetched every 60s when active
- Speed zones: fetched once on mount
- Speed filtering: min/max mph, per-band toggle record, `isSpeedVisible(mps)` helper
- Speed graph: selected unit ID

All types exported as interfaces for use in components.

**Step 2: Commit** — `feat(map): add useSpeedAnalytics hook`

---

## Task 8: Client — Speed Graph Overlay Component

**Files:**
- Create: `client/src/pages/map/components/SpeedGraphOverlay.tsx`

**Step 1: Create the component**

Fixed-position panel (300x120px, bottom-right of map). Contains:
- Header: call sign + large current speed readout (color-coded)
- Inline SVG sparkline: speed over last 200 trail points from `/gps/trail/:unitId`
- Color band backgrounds (green/yellow/orange/red horizontal stripes)
- Grid lines at 25/50/75 mph with labels
- Playback cursor sync (vertical line at `playbackIdx` if provided)
- Current point dot at the rightmost position
- Time labels at start/end

Updates every 15s. Close button in header.

**Step 2: Commit** — `feat(map): add SpeedGraphOverlay component`

---

## Task 9: Client — Coverage Timeline Component

**Files:**
- Create: `client/src/pages/map/components/CoverageTimeline.tsx`

**Step 1: Create the component**

Collapsible panel with horizontal bar chart:
- Rows = beats (top 15 by coverage frequency)
- Columns = time intervals
- Cell color: green (covered, normal speed), amber (slow/stationary), dark gray (no coverage)
- Opacity proportional to unit count
- Hover tooltips with beat name, time, unit count, avg speed
- Legend at bottom

**Step 2: Commit** — `feat(map): add CoverageTimeline component`

---

## Task 10: Client — Enhanced Info Popup + Accel Color Mode

**Files:**
- Modify: `client/src/pages/map/MapPage.tsx`

**Step 1: Add `'accel'` to breadcrumbColorMode type** (~line 315)

Change type from `'unit' | 'speed' | 'status'` to `'unit' | 'speed' | 'status' | 'accel'`

**Step 2: Add `accelToColor()` function** (~line 177)

9-band mapping: hard brake (red) < decel (orange) < mild decel (yellow) < steady (green) < mild accel (lime) < accel (orange) < rapid accel (amber)

**Step 3: Enhance info popup HTML** in the dot click handler (~line 1655-1690)

Add to the popup:
- Mini speed sparkline: 180x40px inline SVG showing surrounding 20 points
- Acceleration indicator: arrow + magnitude colored by accelToColor
- Distance from previous point: "142m from last ping (8.2s)"
- GPS quality badge: colored pill — GPS/GOOD/FAIR/POOR based on accuracy thresholds
- Heading compass: small CSS compass rose showing direction visually

Compute accel, distance, timeDelta from previous point before building HTML.

**Step 4: Add accel case to polyline color selection** (~line 1597)

When `breadcrumbColorMode === 'accel'`, compute inline acceleration between consecutive points and use `accelToColor()`.

**Step 5: Add speed alert markers** (port from useMapBreadcrumbs.ts)

After the dot markers loop, add 80+ mph triangle markers with `!` label. Add `speedAlertMarkersRef` and clean it up in the effect.

**Step 6: Commit** ��� `feat(map): accel color mode, enhanced popup, speed alerts`

---

## Task 11: Client — Interactive Speed Legend + Filtering

**Files:**
- Modify: `client/src/pages/map/MapPage.tsx` — breadcrumb panel section (~lines 2970-3034)

**Step 1: Replace 4-band static legend with 9-band interactive legend**

Each band is a clickable toggle: clicking grays out that speed range on the trail. Add state for `speedBandToggles` record.

**Step 2: Add 'Accel' to color mode selector** (~line 3009)

**Step 3: Wire speed filtering into trail rendering**

In the breadcrumb rendering effect, check each segment against the filter. If hidden: render as faint dashed polyline (2px, 20% opacity) instead of normal colored line.

**Step 4: Commit** — `feat(map): interactive speed legend with band filtering`

---

## Task 12: Client — Trail Animation Improvements

**Files:**
- Modify: `client/src/pages/map/MapPage.tsx` — trail playback effect (~lines 1713+)

**Step 1: Speed-proportional playback delay**

Replace fixed `200 / playbackSpeed` delay with:
`(200 / playbackSpeed) / Math.max(ptSpeedMph / 30, 0.2)`

**Step 2: Ghost trail effect**

Add `ghostTrailRef` with up to 20 fading circles behind the playback marker. Update on each step, remove oldest when > 20.

**Step 3: Speed-colored pulsing marker**

Use `speedToColor(pt.speed)` for the playback marker fill color. Alternate scale between 5 and 6 to create pulse effect.

**Step 4: Floating speed readout**

Add a `playbackSpeedLabelRef` InfoWindow positioned above the marker showing current speed in large colored text.

**Step 5: Commit** — `feat(map): speed-proportional playback, ghost trail, pulsing marker`

---

## Task 13: Client — Integrate Components into MapPage

**Files:**
- Modify: `client/src/pages/map/MapPage.tsx`

**Step 1: Import new hook and components**

```
import { useSpeedAnalytics } from './hooks/useSpeedAnalytics';
import SpeedGraphOverlay from './components/SpeedGraphOverlay';
import CoverageTimeline from './components/CoverageTimeline';
```

**Step 2: Initialize speed analytics hook** after breadcrumb state

**Step 3: Render SpeedGraphOverlay** when `speedGraphUnit != null`

**Step 4: Render CoverageTimeline** in layers panel after breadcrumb section

**Step 5: Add violation count badge** next to breadcrumbs toggle

**Step 6: Add speed heatmap rendering** — new useEffect with Google Maps rectangles for heatmap cells

**Step 7: Add pursuit corridor rendering** — thick red polylines for pursuit segments

**Step 8: Add speed zones layer rendering** — polygons with dashed borders

**Step 9: Add panel controls** for heatmap, zone stats, speed zones toggles

**Step 10: Commit** — `feat(map): integrate speed analytics, heatmap, pursuits, zones, timeline`

---

## Task 14: Verify Build + TypeScript

**Step 1:** `cd client && npx tsc --noEmit` — must be 0 errors
**Step 2:** Fix any TS errors
**Step 3:** `cd client && npx vite build` — must succeed
**Step 4:** `cd server && npx tsc --noEmit` — no new errors beyond known @types/express issues
**Step 5:** `cd server && npx vitest run` — all tests pass
**Step 6:** Commit fixes

---

## Task 15: Bump Service Worker + Final Commit

**Step 1:** Bump `CACHE_NAME` in `client/public/sw.js`
**Step 2:** Commit — `chore: bump service worker cache for speed breadcrumb enhancements`
