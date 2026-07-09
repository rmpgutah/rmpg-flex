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

## The 10 features

### 1. Multi-stop routing
Extend `NavTripContext` / `useNavGuidanceEngine` to accept an ordered list of
waypoints instead of a single destination. New `waypoints: NavWaypoint[]`
state (id, lat, lng, label, completed) alongside the existing single
`destination`. The engine routes leg-by-leg: on arrival at waypoint N
(existing arrival-detection radius), auto-advances to N+1 and requests a new
route from the Mapbox proxy for the next leg. `NavigationPage.tsx`'s
maneuver banner and progress bar are leg-scoped; a new compact "stop N of M"
indicator sits above them. `NavPage.tsx` gets an "Add stop" affordance when
starting a trip from a call list with multiple pending calls.

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

### 5. Better trip↔call linkage & search
`NavTripContext`'s trip-detection already links a trip to the active call
when one exists (per the fix noted in its file header) — audit whether that
link is actually persisted onto the `nav_trips` row (`call_id` column) and
surfaced. Add: (a) a `call_id` filter/search box to `TripsDrawer.tsx`, (b) a
"View call" link on trip rows that have one, (c) backfill for historical
trips where GPS timestamps overlap a call's dispatch/clear window (best-
effort, admin-triggered one-off script, not a live feature).

### 6. Driving score trends
`HudDrivingScore` already computes a per-trip score. Add a `driving_score`
column to `nav_trips` (persisted at trip completion) and a new trends view in
`NavPage.tsx` (or a drawer) — line chart of score over the officer's last N
trips, using the existing `dataviz` conventions for chart styling. Read-only
aggregate query, no new scoring logic.

### 7. Hard-brake/hard-turn event auto-flagging
`useNavTravel.ts` already samples speed/heading; add delta-based thresholds
(deceleration > X mph/s, heading change > Y°/s at speed) to flag an event.
Flagged events get a `nav_trip_events` row (trip_id, type, lat, lng, ts,
severity) and a marker on the trip's map view in `NavPage.tsx` /
`MovementReportDrawer.tsx`. This is telemetry/reporting only — no live HUD
interruption, so it doesn't add distraction risk while driving.

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
distance/duration accumulation; resume on exit. Prevents parking-lot idling
at the station from inflating trip stats. Needs one admin action per station
to draw/tag its geofence zone (existing admin UI for `geofence_zones`,
confirm it supports zone_type tagging — audit during implementation).

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
- `nav_trips.call_id` (verify/backfill, may already exist) — #5
- `nav_trips.driving_score` (new column) — #6
- `nav_trip_events` (new table) — #7
- `geofence_zones.zone_type` value `'station'` (data convention, confirm
  column supports arbitrary values — likely no schema change) — #10

All new migrations follow the existing idempotent-DDL pattern
(`CREATE TABLE IF NOT EXISTS`), applied via `scripts/apply-migration.sh` per
CLAUDE.md's migration process.

## Testing
- Unit tests for new pure logic: waypoint leg-advance (#1), over-speed
  threshold/cooldown (#3), hard-brake/turn delta detection (#7).
- Manual browser verification via preview tooling for each HUD-visible change
  (#3, #8, #9) — confirm no visual clutter when conditions aren't met.
- No live-vehicle testing required for this pass (per the consolidation
  spec's precedent) since core map bootstrap isn't touched here, but #2 and
  #8 add map layers and should get a manual check for frame-rate impact on
  the drive HUD before shipping.

## Build order
Given these are largely independent, implementation can fan out in parallel
by feature after the shared pieces land first:
1. Land migrations (#4, #6, #7) together in one PR.
2. Land #9 (export `useBattery`) first since #9's badge is small and unblocks
   nothing else, but is a good warm-up.
3. #5, #6, #7, #10 (reporting/consumption of existing data) can proceed in
   parallel — no shared surface area.
4. #3, #8, #9 (HUD additions) can proceed in parallel — all touch
   `HudInstruments.tsx` but as independent new exports, low conflict risk.
5. #1 (multi-stop) and #2 (offline fallback) touch the guidance engine and
   map bootstrap respectively — do these last, one at a time, since they're
   the highest-risk/most-central changes.
6. #4 (favorites) is fully independent (new table + new UI section) — can
   run anytime after migrations land.
