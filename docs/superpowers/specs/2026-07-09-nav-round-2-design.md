# Nav System — Round 2: 20 Fixes & Features — Design

## Context

Follow-up to the round-1 nav feature program (spec:
`docs/superpowers/specs/2026-07-08-nav-10-feature-upgrades-design.md`, PRs
#2711–#2713, all merged). This round covers 4 review-flagged fixes plus 16
feature candidates carried over from the original 30-item brainstorm,
re-grounded against current code (an infra audit ran before this design to
avoid round 1's repeated mistake of building things that already existed).

Per user direction, fuel/range-aware routing and hands-free voice commands
are **design-only** in this round — spec'd below but not built, since each
needs either a new external data source or open-ended R&D disproportionate
to the rest of this batch. The infra audit also found two more items with
no existing or procurable-in-scope data source — convoy/shared-route
awareness (needs a "coordinated response" concept that doesn't exist yet)
and live incident/traffic overlay (no live traffic feed exists; CAD
incident data is manually entered, not automated) — so those are
design-only too. That leaves **12 features + the 4 fixes = 16 shipped
items** this round, with 4 design-only specs.

## The 4 fixes

### Fix 1: Paused-trip stale-reap gap
`src/routes/nav.ts`'s `closeStaleActiveTrips` (line ~76) only reaps
`status = 'active'` trips; a trip stuck in `'paused'` (station-geofence pause
whose resume event never fires) sits orphaned forever — already documented
as a known gap in a code comment. Fix: extend the sweep's `WHERE` clause to
also match `status = 'paused'`, using the same staleness window
(`STALE_ACTIVE_MIN`). On reap, set `status = 'completed'` same as the active
case (a paused trip that's gone stale should close out, not un-pause first).
Bundled with this fix: surface *when* a trip is currently paused in the
live HUD (matching `HudParkedBadge`'s visual pattern), so an officer sees
confirmation that station pause is active rather than it being invisible —
small addition, same file/area as the reap fix.

### Fix 2: HUD banner overlap
`NavigationPage.tsx` renders `HudArrivedBanner` and `HudOverSpeedBanner` as
two independent `absolute` divs, both at `left-1/2 -translate-x-1/2` and
`bottom: 210`, both `z-40`. If both conditions are true simultaneously
(arrived at destination while over the speed limit — plausible, e.g.
coasting into a parking lot too fast), they'd render on top of each other.
Fix: give them distinct vertical offsets (e.g. arrived banner stays at
`bottom: 210`, over-speed banner moves to `bottom: 260`) so both can be
visible at once without overlapping, consistent with the HUD's existing
stacked-notification pattern elsewhere.

### Fix 3: Driving-score color-threshold duplication
`HudInstruments.tsx`'s `HudDrivingScore` and `NavPage.tsx`'s
`driveScoreColor` both hardcode the same `events >= 6 ? red : events >= 2 ?
amber : green` logic (the latter's comment even says it mirrors the former).
Extract to a single shared function `client/src/pages/navigation/drivingScoreColor.ts`
(`harshEventColor(totalEvents: number): string`), imported by both. No
behavior change — pure dedup.

### Fix 4: GPS-quality threshold inconsistency
`HudQualityPill` uses `<10m GOOD / <30m FAIR / else POOR`; `HudDeviceHealthBadge`
independently uses `GPS_DEGRADED_M = 500` for its "GPS degraded" warning —
two different accuracy scales answering "is GPS good enough" with wildly
different numbers. These serve different purposes (the pill is a
constant fix-quality readout; the badge is a "something's wrong" alert that
should only fire on genuinely bad fixes, not routine urban multipath), so
the fix isn't to make them equal — it's to make the relationship explicit:
rename `GPS_DEGRADED_M` to document it as "worse than POOR" and set it
relative to the pill's POOR threshold (e.g. `POOR_THRESHOLD_M = 30`,
`GPS_DEGRADED_M = POOR_THRESHOLD_M * 16` with a comment explaining the
badge intentionally fires much later than the pill turns red, since the pill
is informational and the badge is an interruption-worthy alert). Extract
`POOR_THRESHOLD_M` as a named, exported constant from `HudQualityPill`'s
module scope so `HudDeviceHealthBadge` derives from it instead of
independently hardcoding.

## The 12 features to build

### 1. Voice guidance cadence (turn-by-turn TTS)
Genuinely new: nav has an alert *tone* player (`navTone.ts`) but no spoken
turn-by-turn announcements. `client/src/hooks/useDispatchVoiceAlerts.ts`
already has a working `speak()` (Web Speech API) + 60s dedup pattern for
dispatch narration — reuse that TTS wrapper rather than building a new one.
New `client/src/pages/navigation/hud/voiceGuidance.ts`: pure function
`announcementFor(maneuver, distanceM, alreadyAnnouncedDistances)` deciding
*when* to speak (e.g. at 1mi, 0.5mi, 0.25mi, "now" thresholds per maneuver,
not on every position tick) and *what* ("Turn right on Main Street in a
quarter mile"). `NavigationPage.tsx` wires this to the existing
`useNavGuidanceEngine` maneuver state and calls the reused `speak()`.
Respects the existing mute toggle (`HudMuteToggle`).

### 2. Nearby-backup-unit overlay
`MapboxMapPage.tsx` already subscribes to `unit_position` websocket frames
and renders live unit markers — reuse that subscription pattern (not the
component) in `NavigationPage.tsx`: a new toggle (matching Task 5's
district-overlay toggle pattern) shows OTHER units' live positions as small
markers on the drive map, filtered to units assigned to the same active
call as the officer's own unit (backup context, not "show every unit in the
fleet" clutter). Default off.

### 3. Lane guidance in maneuver banner
`HudNextManeuver` already accepts and renders a `lanes` prop — only the
server side is missing. Add `banner_instructions=true` to the outbound
Mapbox Directions request in `src/routes/mapbox.ts`, parse
`route.legs[].steps[].bannerInstructions[].sub.components` (Mapbox's lane
data shape) into the `lanes` prop shape `HudNextManeuver` already expects,
pass through the response. No client HUD change needed — purely a server
data-plumbing task feeding an already-built display.

### 4. General geofence/zone-entry alerts
The `geofence_alert` broadcast and consumption pattern already exist
(built for station pause/resume). Generalize: `NavTripContext.tsx`'s
existing geofence subscription gets a second branch for zone types other
than `'station'` (e.g. `'alert'`, `'patrol_required'` — already valid
`zone_type` CHECK values per migration `0047`) — on enter, surface a
transient HUD notification (reuse `HudArrivedBanner`'s visual pattern,
but for "Entering: <zone name>") rather than silently no-op'ing like the
station case does today for non-station zones.

### 5. Weather-aware alerts
`src/routes/weather.ts` (Open-Meteo, KV-cached) and `client/src/utils/weather.ts`
already exist. New: a nav-specific consumer — `NavTripContext.tsx` polls
the existing weather endpoint for the officer's current position (low
frequency, e.g. every 10 minutes, not per-GPS-tick) and surfaces a HUD
badge (matching `HudDeviceHealthBadge`'s "hidden unless there's something to
say" pattern) when conditions indicate hazard (icy/freezing precip, high
wind, poor visibility — thresholds TBD against whatever fields the existing
`weather.ts` response already exposes, no new weather-API scope).

### 6. Route/pattern heatmap
`useMapHeatmap.ts` + `PriorityHeatmap.tsx` + deck.gl layer helpers already
exist for incident-density heatmaps. New: `NavPage.tsx` gets a "My Routes"
heatmap view — feed the existing heatmap hook/component with this officer's
historical trip breadcrumb points (from `nav_trip_log`/`unit_trips`,
already-fetched via existing trip-history endpoints) instead of incident
data, adapting the existing component's data-shape contract rather than
building new heatmap rendering.

### 7. Adaptive screen brightness
`NavSettingsPanel.tsx` already has a manual 0..1 `brightness` slider applied
via a day/night + brightness model (not a raw CSS filter). New: an
"Auto" mode option alongside the manual slider, using the same day/night
`local hour` signal `NavigationPage.tsx` already derives (per its existing
comment) rather than adding an ambient-light sensor dependency (Web
Ambient Light Sensor API has poor browser support) — auto mode maps
time-of-day to a brightness curve using the existing signal, no new sensor
integration.

### 8. Quick call/radio-unit from HUD
Genuinely new UI, but `radio.ts` (server route) and existing radio pages
provide a pattern to match. New: a HUD button (in the existing map-controls
cluster) that deep-links to the existing radio/contact-unit flow (whatever
`radio.ts`-backed page already handles unit-to-unit contact) rather than
building a second contact mechanism — confirm the exact existing entry
point during implementation and link to it, don't duplicate its logic.

### 9. Printable route briefing sheet
`navTripPdf.ts`/`tripLogPdf.ts` + the broader PDF infra
(`pdfGenerator.ts`/`pdfTokens.ts`/`pdfStaticMap.ts`) already exist for
*post-trip* reports. New: a *pre-trip* briefing template
(`client/src/utils/navBriefingPdf.ts`) following the same token/layout
conventions — turn list, static map image (reusing `pdfStaticMap.ts`),
ETA, waypoints if multi-stop — generated from the guidance engine's current
route state before/during a trip, for planned/coordinated operations.

### 10. Quick avoidance-zone toggle in guidance summary
Small complement to round 1's exclusion-zone routing: today the server
flags `excludedZoneWarning: true` but nothing renders it (explicitly
deferred as a nice-to-have in round 1). New: surface it in
`NavigationPage.tsx`'s existing guidance summary line
(`HudSummaryLine`) as "Route avoids N restricted zones" when present —
small, uses data already being computed server-side.

### 11. Parking/staging suggestions
Genuinely greenfield — no existing parking/staging dataset in the app.
Scoped down for this round: rather than a new external data source,
surface the officer's own **saved favorites** (round 1's `nav_favorites`)
tagged as staging locations near the current call, if any exist within a
radius — reuses existing infra rather than sourcing new parking data. A
fuller "suggest nearby parking" feature (needing a real parking dataset) is
out of scope; this is a lightweight favorites-based substitute.

### 12. Customizable HUD layout
Genuinely greenfield, most speculative item in this batch. Scoped down: not
full drag-and-drop reordering (no existing pattern in the app to build on,
higher risk) but a **show/hide toggle list** in `NavSettingsPanel.tsx` for
the optional HUD tiles (driving score, device health, district overlay,
weather badge, etc.) — persisted in `NavPrefs`, applied as conditional
rendering in `NavigationPage.tsx`. Officers can declutter, not rearrange.

## Design-only items (spec'd, not built this round)

### A. Fuel/range-aware routing
Needs vehicle fuel-level data — no existing telemetry source for this in
the app (fleet vehicles aren't instrumented for live fuel level; this would
require either OBD-II integration or manual officer input, both
significant scope). Spec: if/when fuel telemetry exists, extend
`useNavGuidanceEngine.ts`'s route computation to warn when remaining
range (fuel level × vehicle's known mpg) can't cover the route distance,
surfaced as a HUD warning matching the device-health-badge pattern.

### B. Hands-free voice commands
Needs Web Speech API *recognition* (not just synthesis) wired to guidance
actions (mute, recenter, cancel route) — meaningfully larger scope than
TTS output (item #1 above): requires wake-word or push-to-talk handling,
recognition-accuracy tuning while driving (road noise), and a command
grammar. Spec: a small fixed grammar (5-6 commands: "mute", "unmute",
"recenter", "cancel route", "repeat"), push-to-talk triggered (a
steering-wheel-mountable button is out of scope; a HUD tap-and-hold is the
realistic v1 trigger), using `SpeechRecognition` with a short, bounded
listening window per activation rather than always-on listening (privacy +
battery).

### C. Convoy/shared-route awareness
Needs a concept of "coordinated response" that doesn't exist yet — which
units are responding together, and a shared route/ETA view across them.
Spec: extend the (already-shipped) nearby-backup-unit overlay (#2 above)
with a "convoy mode" toggle that, when 2+ units are assigned to the same
call, shows each unit's ETA and route progress in a shared panel (not
full route-merging/formation logic, which is out of scope) — essentially a
multi-unit ETA board layered on infra #2 already establishes.

### D. Live incident/traffic overlay
No live traffic/incident data source exists in the app today (CAD
`calls_for_service`/`incidents.ts` are manually entered, not automated).
Spec: if/when a traffic data source is procured (e.g. a commercial traffic
API), overlay incidents as map markers on the nav route similar to the
already-built district-overlay pattern (toggle, `getTaggedBeats()`-style
loader swapped for a traffic-incident loader), with route-crossing
detection reusing round 1's `routeCrossesExclusionZone` polygon-check
pattern for incident-radius warnings.

## Non-goals
- No new external API integrations beyond what's already in the app —
  weather uses the existing `weather.ts` integration; live incident/traffic
  is design-only (no procured data source in scope for this round).
- No full drag-and-drop HUD customization (scoped to show/hide only).
- No OBD-II/vehicle telemetry integration.

## Build order
1. Fixes 1-4 first — small, isolated, no cross-dependencies (Fix 1 includes
   the bundled paused-trip HUD badge).
2. Features #3 (lane guidance) and #10 (exclusion-zone summary line) are
   the smallest/lowest-risk — pure data-plumbing onto already-built UI.
   Do these early.
3. Features #2 (nearby-backup overlay), #4 (general zone alerts), #5
   (weather alerts), #6 (route heatmap), #9 (briefing PDF), #11 (favorites
   staging), #12 (HUD show/hide) are independent of each other — parallelize.
4. Feature #1 (voice cadence) and #7 (adaptive brightness) touch
   `NavigationPage.tsx`'s core render/effect logic more centrally — do
   after the independent batch, one at a time.
5. Feature #8 (quick call/radio) depends on confirming the exact existing
   radio-contact entry point during implementation — investigate first,
   then build.
