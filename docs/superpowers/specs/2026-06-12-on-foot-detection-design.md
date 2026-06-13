# On-Foot (Walking) Detection Automation — Design

**Date:** 2026-06-12
**Status:** Approved by user (brainstorming session)
**Scope:** Detect when an officer leaves their vehicle and is on foot, using iOS
CoreMotion activity reported with GPS breadcrumbs; automate dispatch visibility,
an officer-safety timer, and segment logging.

## Background / signal reality

- The MDT is the vehicle-mounted terminal; its GPS is the vehicle's position.
  The officer's iOS device is a separate GPS stream into the same ingest.
- **No Bluetooth/RSSI/"device strength" telemetry exists** anywhere in the
  system today. The user chose Apple's CoreMotion activity classifier
  (`CMMotionActivity`) as the detection signal instead — purpose-built,
  native-only, requires iOS app changes.
- Existing ingest: `POST /api/dispatch/gps` (src/routes/dispatch/gps.ts)
  accepts `{ points: [{ lat, lng, accuracy, heading, speed, timestamp,
  source }] }`, writes `gps_breadcrumbs (unit_id, officer_id, …)`, and updates
  `units` latest position/speed/heading.
- `units.status` is a locked CHECK enum
  (`available/dispatched/enroute/onscene/busy/off_duty/out_of_service`).
  "On foot" is therefore a **separate orthogonal flag**, not a status value —
  an officer can be `onscene` AND on foot. No table recreation.
- Safety plumbing already exists: `WelfareWatchDO` (one DO per officer,
  `POST /start` / cancel, fires back into the Worker) and
  `emitAlert()` (src/utils/alertHub.ts) for cross-device officer-safety
  fan-out via AlertHubDO.
- Two iOS apps: the Capacitor production app (`client/ios/App`, wraps the
  React SPA) and the native SwiftUI tester (`ios/RMPGFlexTester`, already has
  `LocationManager.swift`). Both get CoreMotion. This Mac cannot run
  xcodebuild (known wedge) — Swift is written here, built/run in the user's
  Xcode.

## Part 1 — Activity-aware telemetry (iOS → server)

Each location ping carries two new optional fields:

- `activity`: `walking | running | automotive | stationary | cycling | unknown`
- `activity_confidence`: `low | medium | high`

**RMPGFlexTester:** new `MotionActivityService.swift` wrapping
`CMMotionActivityManager`; `LocationManager` attaches the latest activity to
each posted point. `NSMotionUsageDescription` in Info.plist.

**Capacitor app:** small `MotionActivity.swift` Capacitor-plugin bridge
exposing `start/stop/latest` to JS; the web GPS sender attaches `activity`
when running natively, no-ops in plain browsers.

**Server:** extend `norm()` + the breadcrumb INSERT in gps.ts to accept and
store both fields. Fully backward-compatible (optional fields).

## Part 2 — Detection engine (server-side, on ingest)

Two pure functions (unit-testable, no I/O) + a thin stateful caller in the
gps handler:

- `classifyActivity(point) → 'on_foot' | 'in_vehicle' | 'unknown'`
  (on_foot = walking/running at ≥ medium confidence; in_vehicle = automotive
  at ≥ medium confidence; everything else unknown).
- `detectTransition(prevState, recentPoints) → ON_FOOT | BACK_IN_VEHICLE | null`
  — debounced: ON_FOOT requires sustained on-foot (≥ 2 pings / ~20 s);
  BACK_IN_VEHICLE requires sustained automotive. No flapping at stoplights.

State lives on `units`: `on_foot`, `on_foot_since`, `on_foot_source`.

## Part 3 — Automations (fire on transition)

1. **Auto status badge:** ON_FOOT → `units.on_foot = 1` + `on_foot_since`;
   BACK_IN_VEHICLE → clear. Dispatch board + map read the flag. Status enum
   untouched.
2. **Officer-safety timer:** ON_FOOT → start per-officer watch via existing
   `WelfareWatchDO` (default 5 min, constant in code). Cancel on
   back-in-vehicle or check-in. On fire →
   `emitAlert('officer_on_foot_overdue', {...})`.
3. **Segment log:** new `foot_segments` table — `officer_id, unit_id,
   started_at, ended_at, start_lat/lng, end_lat/lng, duration_s, distance_m,
   peak_activity`. Written on transitions; for after-action review, analytics,
   map replay.

Explicitly **not** built (user deselected / YAGNI): foot-pursuit auto-BOLO,
speed-based fallback classifier for web-only GPS, admin threshold-tuning UI.

## Part 4 — UI surfaces (web)

- **Dispatch board (DispatchPage units panel):** "ON FOOT" badge (gold, 9px,
  no pill — per design tokens) + elapsed time (`ON FOOT 4:32`) when
  `on_foot = 1`.
- **Map (MapPage unit markers):** walking glyph replaces the vehicle arrow
  while on foot.
- **Safety alert:** AlertHub client toast/voice map gets
  `officer_on_foot_overdue`, P1-style welfare treatment.
- **Foot-segment review:** compact "On-Foot Activity" section on the
  unit/officer detail (recent segments: when, where, duration, distance).
  No new page.

## Part 5 — Schema (one migration, ~0101, idempotent)

- `gps_breadcrumbs` + `activity TEXT`, `activity_confidence TEXT` (ALTER —
  not a 100-col watched table).
- `units` + `on_foot INTEGER DEFAULT 0`, `on_foot_since TEXT`,
  `on_foot_source TEXT`.
- New `foot_segments` table + indexes on `officer_id`, `started_at`.
- After merge, apply DDL directly to live D1 `785de7ae` and verify with
  `pragma_table_info` (standing migration-drift rule).

## Part 6 — Testing & verification

- **Worker unit tests** (first in /src/ — vitest, plain TS, engine is pure so
  no Miniflare): `classifyActivity` mappings; debounce (no stoplight flap,
  transition after sustained walking, low-confidence handling); segment math.
- **Client tests:** badge rendering from the `on_foot` flag.
- **Manual verify:** simulated breadcrumb POSTs with `activity:'walking'`
  against local `wrangler dev`; watch unit flip, DO timer arm, segment row
  appear.
- **Swift:** `swiftc` parse checks here; real build/run in user's Xcode.
- Typecheck both sides, full client vitest, SW cache bump.

## Decisions log (from brainstorming)

| Question | Decision |
|---|---|
| Detection signal | iOS CoreMotion activity (not speed heuristic, not Bluetooth) |
| On-foot actions | Status badge + safety timer + segment log (no auto-BOLO) |
| iOS target | Both apps (tester validates, Capacitor ships to officers) |
| Status modeling | Orthogonal `on_foot` flag on `units`, NOT a new status enum value |
