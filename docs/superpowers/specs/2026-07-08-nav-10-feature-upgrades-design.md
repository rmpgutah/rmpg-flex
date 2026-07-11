# Nav System — 10 Feature Upgrades — Design

## Context

Follow-up to [`2026-07-08-nav-system-consolidation-design.md`](2026-07-08-nav-system-consolidation-design.md)
(dead-code removal + export/map-bootstrap consolidation, spec'd separately).
This spec covers ten new/improved features for the driving-navigation
subsystem: `NavigationPage.tsx` (`/navigation`, in-vehicle drive HUD) and
`NavPage.tsx` (`/nav`, trip history/management), plus their supporting hooks
(`NavTripContext`, `useNavGuidanceEngine`) and HUD components
(`pages/navigation/hud/*`).

Selected from a longer candidate list, prioritizing features that (a) don't
require new external API integrations (no weather/fuel providers, no voice-
command R&D) and (b) reuse infra that already exists elsewhere in the app:

- **Geofencing is already built server-side** — `geofence_zones` /
  `unit_geofence_state` / `geofence_events` tables, ray-cast diff logic in
  `src/routes/dispatch/gps.ts` (`parseZoneFeatures`, `pointInAnyPolygon`,
  `diffZoneMembership`), broadcasting `geofence_alert` over the websocket.
  This directly powers #8 (district overlay) and #10 (station-geofence auto
  pause/resume) — no new zone-detection code needed, just consumption.
- **Battery reporting already exists** — `client/src/components/BatteryIndicator.tsx`
  wraps the Browser Battery API. #9 (device health warnings) extends this
  pattern rather than building new.
- **District polygon data already loaded client-side** — `pages/map/utils/districtGeoData.ts`
  (`getTaggedBeats()`), used by the main map's district layers. #8 reuses this
  loader rather than re-fetching/re-parsing beat polygons.

**Correction (post-audit-2):** a second pass while drafting the implementation
plan found the subsystem already has **two parallel trip-tracking systems**:
`nav_trip_log` (`src/routes/nav.ts`, officer-based, driven by `NavTripContext`,
feeds `NavPage.tsx`) and `unit_trips` (`src/routes/dispatch/trips.ts`,
unit-based, auto-computed server-side from the GPS pipeline in `gps.ts`,
**already has** `call_id`, `harsh_accel_count`/`harsh_brake_count`/
`harsh_corner_count`, `max_lat_g`, `stop_count`, `idle_seconds` — feeding
`TripsDrawer.tsx`, already live on `/navigation`). The original #5 (trip↔call
linkage) and #7 (hard-brake/turn flagging) were already built there — building
them against `nav_trip_log` would have created a *third* redundant
implementation. Both are replaced below (see #5, #7). This existing
`nav_trip_log`/`unit_trips` duplication itself is a separate, larger
reconciliation problem, explicitly **out of scope** for this spec — flagged as
a follow-up, not fixed here.

## The 10 features

### 1. Multi-stop routing
`utils/routeOptimizer.ts` (`optimizeStops`/`estimateDriveMinutes`) and the
`dispatch_unit_routes` table already do multi-stop waypoint ordering for a
unit's queued calls — via `RouteBuilderPage.tsx`/`POST /dispatch/routing/optimize`
— but that's a dispatcher pre-planning tool, not wired into live turn-by-turn
on `/navigation`. Rather than build a second waypoint-ordering scheme, extend
`NavTripContext`/`useNavGuidanceEngine` to *consume* an existing saved route:
new `waypoints: NavWaypoint[]` state (id, lat, lng, label, completed),
populated either manually or by loading a unit's active
`dispatch_unit_routes` row (`GET /dispatch/routing/unit/:unitId`) when one
exists. The engine routes leg-by-leg: on arrival at waypoint N (existing
arrival-detection radius), auto-advances to N+1, requests a new route from
the Mapbox proxy for the next leg, and calls the existing
`POST /dispatch/routing/:id/complete-stop` so the dispatch-side route stays in
sync. `NavigationPage.tsx`'s maneuver banner and progress bar become
leg-scoped; a new compact "stop N of M" indicator sits above them.

### 2. Offline/cached-tile basemap fallback
New `hooks/useCachedBasemap.ts`: on successful `style.load`, snapshot the
current viewport's rendered tiles are NOT feasible to cache generically via
Mapbox GL (vector tiles are license-restricted from disk caching beyond the
browser's own HTTP cache) — instead, cache a **static low-fidelity fallback**:
a lightweight local vector layer (already-loaded `districtGeoData` polygons +
last-known road-network bounding data if present) rendered as a flat-color
backdrop when the map's `error`/`sourcedata` events indicate tile fetch
failures for >5s. This isn't a full offline basemap; it degrades the "blank
screen" case in `NavigationPage.tsx`'s `map.on('error', ...)` handler (today
a no-op) to "here's your last known position over a schematic district
outline" rather than nothing.

### 3. Configurable over-speed alerts
`pages/navigation/hud/useSpeedLimit.ts` already resolves a road's posted
limit. Add a threshold setting (default +10 mph over) to `NavSettingsPanel.tsx`
/ `NavPrefs`, and a new `HudOverSpeedBanner` (visual pulse + optional
`playNavTone` chime) in `HudInstruments.tsx`, gated by the threshold and a
per-trip cooldown (avoid alert spam on a road with a wrong/stale limit).

### 4. Saved/favorite destinations
New `nav_favorites` D1 table (user_id, label, lat, lng, address, created_at) +
`/api/nav/favorites` CRUD route. `NavPage.tsx` gets a "Favorites" section
(reusing `TripsDrawer`'s drawer pattern) to save the current dropped pin or a
trip's destination, and to quick-start a trip to a saved favorite. Migration:
next free integer prefix per `migrations/README.md`.

### 5. Custom avoidance zones (replaces original "trip↔call linkage" — already built in `unit_trips`)
`geofence_zones.zone_type` already has an `'exclusion'` value in its CHECK
constraint (migration `0047_spillman_modules.sql`) but nothing in the routing
path consumes it — zones of that type exist only for display/alerting today.
Wire exclusion zones into route requests: when building a Mapbox Directions
request (the server-side proxy from PR #2681), fetch active `is_active=1`
`geofence_zones` rows where `zone_type='exclusion'`, convert their
`geojson_data` polygons to Mapbox's `exclude`/`waypoints` avoidance params
(Mapbox Directions API supports point/polygon exclusion via the `exclude`
parameter for certain classes, or via routing the request around the polygon
centroid if the API tier doesn't support polygon exclusion directly — confirm
which during implementation and fall back to a post-route validity check that
flags/rejects a route crossing an exclusion zone if true polygon exclusion
isn't available). No client change needed beyond surfacing "route avoids N
restricted zones" in the guidance summary.

### 6. Driving score trends (reusing existing `unit_trips` harsh-event columns)
`unit_trips` already persists `harsh_accel_count`, `harsh_brake_count`,
`harsh_corner_count`, and `max_lat_g` per trip — no new scoring computation or
schema needed. Add a read-only aggregate endpoint (`GET
/dispatch/trips/score-trend?unit_id=&officer_id=&limit=`) computing a simple
score per trip (`100 - harsh_event_total * weight`, matching `HudDrivingScore`'s
existing color-threshold logic in `HudInstruments.tsx` for consistency) and a
trends view in `NavPage.tsx` (or a drawer) — line chart of score over the
officer's last N trips, using the existing `dataviz` conventions for chart
styling.

### 7. Trip replay (replaces original "hard-brake/turn flagging" — already built in `unit_trips`)
Neither `MovementReportDrawer.tsx` nor `TripsDrawer.tsx` currently animates a
trip's breadcrumb path — `TripDetail.points` (from `useTripDetail`, already
fetched) is only rendered statically. Add a replay control (play/pause/scrub,
speed multiplier) to `MovementReportDrawer.tsx`: step through `points` on a
`requestAnimationFrame`-driven timer scaled by each point's real timestamp
delta, moving a marker along the route on the existing map instance and
updating the speed/heading readouts live as it plays. Supervisor-facing only
(opened from `TripsDrawer`, same access as today's static report) — no new
data, no new endpoint, pure client-side animation over data already on the
page.

### 8. Always-on district/beat boundary overlay
`NavigationPage.tsx`'s map adds a toggleable layer sourced from the existing
`getTaggedBeats()` loader (already used on the main dispatch map — same
source, same styling helpers, just added to the nav map's layer stack).
Default off (avoid visual clutter on the drive HUD), togglable from the
existing HUD map-controls cluster (`HudMapControls`).

### 9. Device health warnings on HUD
Extend the existing `useBattery` hook (currently private to
`BatteryIndicator.tsx` — export it as a shared hook) plus a new GPS-signal-
quality check (already-tracked `fixSource`/accuracy from `useGpsTracking`).
New `HudDeviceHealthBadge` in `HudInstruments.tsx`: shows only when battery
<20%-unplugged or GPS accuracy is degraded beyond a threshold for >30s —
otherwise hidden, consistent with the HUD's existing "don't clutter unless
there's something to say" pattern (`HudArrivedBanner`, `HudParkedBadge`).

### 10. Auto pause/resume trip tracking at station geofence
Consume the existing `geofence_alert` websocket event (already broadcasting
zone enter/exit) in `NavTripContext`: when a unit enters a zone flagged
`zone_type = 'station'` (new zone-type value on the existing `geofence_zones`
table — no schema change needed, just data + a check), auto-pause active trip
distance/duration accumulation on the `nav_trip_log` row (via `/nav/trip/:id/update`);
resume on exit. Prevents parking-lot idling at the station from inflating trip
stats. Needs one admin action per station to draw/tag its geofence zone
(existing admin UI for `geofence_zones`, confirm it supports zone_type tagging
— audit during implementation).

## Non-goals
- No weather-API integration, fuel/range routing, voice-command control,
  convoy/multi-unit shared routing, or printable briefing sheets — deferred,
  larger scope each.
- No changes to the Worker-side Mapbox proxy routing logic itself (features
  reuse it, don't modify it), except #1's leg-by-leg re-request pattern.
- Feature #2 is explicitly NOT a full offline basemap — see its section for
  the scoped-down version.

## Data model changes
- `nav_favorites` (new table) — #4
- No new column needed for #6 — reuses existing `unit_trips.harsh_*_count`/`max_lat_g`.
- No new table needed for #5 — no schema change, only a new server-side
  routing consumption of existing `geofence_zones` rows.
- No new table needed for #7 — pure client-side animation over already-fetched data.
- `geofence_zones.zone_type` value `'station'` (data convention, confirm
  column supports arbitrary values — likely no schema change) — #10

All new migrations follow the existing idempotent-DDL pattern
(`CREATE TABLE IF NOT EXISTS`), applied via `scripts/apply-migration.sh` per
CLAUDE.md's migration process.

## Testing
- Unit tests for new pure logic: waypoint leg-advance (#1), over-speed
  threshold/cooldown (#3), exclusion-zone routing decision (#5), replay
  timing/scrub math (#7).
- Manual browser verification via preview tooling for each HUD-visible change
  (#3, #8, #9) — confirm no visual clutter when conditions aren't met.
- No live-vehicle testing required for this pass (per the consolidation
  spec's precedent) since core map bootstrap isn't touched here, but #2 and
  #8 add map layers and should get a manual check for frame-rate impact on
  the drive HUD before shipping.

## Build order
Given these are largely independent, implementation can fan out in parallel
by feature after the shared pieces land first:
1. Land the `nav_favorites` migration (#4) first — the only schema change.
2. Land #9 (export `useBattery`) first since #9's badge is small and unblocks
   nothing else, but is a good warm-up.
3. #5 (exclusion-zone routing), #6 (score trend endpoint), #7 (replay), #10
   (station pause/resume) can proceed in parallel — no shared surface area.
4. #3, #8, #9 (HUD additions) can proceed in parallel — all touch
   `HudInstruments.tsx` but as independent new exports, low conflict risk.
5. #1 (multi-stop) and #2 (offline fallback) touch the guidance engine and
   map bootstrap respectively — do these last, one at a time, since they're
   the highest-risk/most-central changes.
6. #4 (favorites) is fully independent (new table + new UI section) — can
   run anytime after its migration lands.
