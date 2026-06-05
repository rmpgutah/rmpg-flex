# Navigation Trip Logging — Design

**Date:** 2026-06-03
**Status:** Approved (brainstorming → design). Next: implementation plan (writing-plans).
**Author:** Claude (brainstorming skill) with Christopher Zamora (operator-owner)

---

## 1. Problem & purpose

The Navigation system shows live vehicle telemetry but does not **retain** it as
bounded, named journeys. We want first-class **trips** that segment the continuous
GPS stream into lifecycle-bounded legs, chained together across a shift, capturing
the full vehicle telemetry already computed by the client.

Requested behaviour (verbatim intent):

- A trip starts at **"En route"** initiation of a call and retains data through to
  the **"On-Scene"** point.
- If no following call, a new trip is created (the "Dispatch Clearance" trip —
  **renamed `PATROL`**) that **closes if the vehicle is stationary > 5 minutes** in
  one location.
- On movement resuming, a **new point-A→B trip** begins.
- When a new call is created and the unit goes **"En route"**, that reconnects into
  a new call-linked trip — a **continuous chain** capturing full vehicle data.
- Integrate **fully** with Map UI, Navigation, and Dispatch.

### Purpose ranking (decided)
1. **Accountability & audit** (lead) — court-defensible "who/where/when" + mileage.
2. **Incident replay** — scrub a unit's full response on the map.
3. **Live situational awareness** — dispatcher sees the current trip per unit.
4. **Driver/fleet telemetry** — harsh events, idle time, distance per shift.

The audit-first ranking is decisive: trips must be **server-authoritative and
immutable once closed**, and the idle-close timer cannot depend on a client being
awake.

---

## 2. Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Non-call trip name | **`PATROL`** (vs `CALL_RESPONSE`) |
| Architecture | **Approach A, "B-ready"** — cron-swept server-side engine, written as a *pure module* so it can later drop into a per-unit Durable Object unchanged |
| Idle threshold | **5 min** stationary; **30 m** stationary radius (tunable constants) |
| Authority | **Server time** for all trip bounds & idle math (never client `timestamp`) |
| Storage | New `unit_trips` table; `gps_breadcrumbs.trip_id` added to tag each fix |
| Realtime | New `trip_update` event on existing `AlertHubDO` bus |
| Migration | Next free prefix **0075** (+ direct live-D1 patch on `785de7ae`) |

---

## 3. Governing invariant

> **A unit has at most one *active* trip at any moment.**

Every "open" event first closes the current active trip, then opens the next. This
makes the chain unambiguous and the audit trail gap-free.

---

## 4. State machine

States: `PATROL(active)`, `CALL_RESPONSE(active)`, plus `closed`.

```
   (shift start / movement)
            │
            ▼
        ┌────────┐   status→enroute      ┌───────────────┐
        │ PATROL │ ────────────────────▶ │ CALL_RESPONSE │
        │ active │                       │    active     │
        └────────┘                       └───────────────┘
          │   ▲                            │        │
 idle>5m  │   │ movement resumes  onscene  │        │ cleared (never arrived)
 close    │   │ (new A→B leg)     close    │        │ close
          ▼   └──────────┐               ▼        ▼
   close(idle_timeout)   open new PATROL  close(onscene)  close(cleared)
                                          │        │
                          (unit now parked at scene) → next movement opens PATROL

   off_duty / out_of_service → close(off_duty) any active trip
   re-dispatch while onscene → status→enroute opens a fresh CALL_RESPONSE
```

### Events (only two live sources + a sweep)

| Event | Source | Action |
|---|---|---|
| `status → enroute` | `calls.ts` status endpoint | close active trip → **open CALL_RESPONSE** (link `call_id`/`call_number`/`call_type`; capture `start_mileage`) |
| `status → onscene` | `calls.ts` | close active CALL_RESPONSE, `close_reason='onscene'`, capture `end_mileage`. **This is the "On-Scene point."** No new trip yet (unit parked). |
| `status → cleared/available` (no onscene) | `calls.ts` | close active CALL_RESPONSE, `close_reason='cleared'` |
| `status → off_duty / out_of_service` | `units.ts`/`calls.ts` | close any active trip, `close_reason='off_duty'` |
| GPS fix, **moving**, no active trip | `gps.ts` | **open PATROL** (the "new A→B leg") |
| GPS fix, active trip | `gps.ts` | append: update rollups, stamp `breadcrumb.trip_id`, refresh idle anchor |
| GPS fix, active PATROL, stationary > 5 min | `gps.ts` (lazy) **+ cron** | close PATROL, `close_reason='idle_timeout'`, **`end_time = arrival timestamp`** (not detection time) |

### "Stationary" definition
A unit is *moving* when a fix is `> STATIONARY_RADIUS` (default **30 m**) from the
current anchor **or** device speed `> ~1 mph`. The first fix that stays inside the
radius is the **arrival timestamp**; once `now − arrival > 5 min`, the PATROL trip
closes with `end_time = arrival`. Named constants, tunable.

### Idle-close mechanism (corrected from initial design)
- **Primary: lazy-on-GPS-write.** `useGpsTracking` keeps batching fixes ~every 5 s
  even while parked, so the lazy path closes a stale PATROL within seconds of the
  threshold in the common case.
- **Backstop: per-minute cron.** The existing cron is `0 */4 * * *` (warrant poll) —
  too slow. Add a second expression: `crons = ["0 */4 * * *", "* * * * *"]` and
  branch in `scheduled()` on `event.cron`. The sweep closes (a) PATROL trips whose
  unit has gone dark while stationary, and (b) **stale** active trips whose unit went
  available/off or whose last fix is older than N min (`close_reason='stale'`).

---

## 5. Data model

### New table `unit_trips` (brand new — full 100-col budget, no `_ext`)

| Column | Purpose |
|---|---|
| `id` PK · `unit_id` · `officer_id` · `vehicle_id` | who/what (officer+vehicle frozen at open) |
| `trip_type` CHECK(`call_response`,`patrol`) · `status` CHECK(`active`,`closed`) | taxonomy + lifecycle |
| `call_id` · `call_number` · `call_type` | call linkage (null for patrol; denormalized) |
| `prev_trip_id` · `shift_session_id` | the chain link + duty-session grouping |
| `start_time` · `end_time` · `close_reason` | bounds + why it closed |
| `start_lat/lng` · `end_lat/lng` | A→B endpoints |
| `start_mileage` · `end_mileage` | odometer reconciliation (from call mileage fields) |
| `distance_m` · `duration_s` · `max_speed` · `avg_speed` · `max_lat_g` | rollups |
| `harsh_accel_count` · `harsh_brake_count` · `harsh_corner_count` · `stop_count` · `idle_seconds` | telemetry summary |
| `anchor_lat/lng` · `last_move_at` · `last_fix_ts` · `speed_sum` · `fix_count` | engine bookkeeping (running aggregates persisted between stateless batches; `last_fix_ts` = idempotency guard) |
| `created_at` · `updated_at` | standard |

Indexes: `(unit_id, status)`, `(unit_id, start_time)`, `(call_id)`, `(status)`.

`close_reason` values: `onscene`, `cleared`, `idle_timeout`, `off_duty`,
`redispatch`, `stale`, `manual`.

### `gps_breadcrumbs` change
Add nullable `trip_id` (FK `unit_trips.id`). Engine stamps every fix with its trip
so replay is `SELECT … WHERE trip_id = ?` — no fragile time-range reconstruction.
`gps_breadcrumbs` is per-fix and nowhere near the 100-col cap, so the `ALTER` is safe.

**Why running aggregates live on the row:** Approach A's engine is stateless across
HTTP requests, so the accumulator (distance, max speed, harsh counts, idle anchor)
must be durable → D1 columns. The pure engine reads/writes these; a future DO would
swap them for in-memory `this.state` with no engine change.

---

## 6. The two pure modules ("B-ready" core)

- **`src/utils/tripEngine.ts`** — `decide(event, activeTrip, unitState, now) → { close?, open?, append? }`.
  No `c.env`, no D1, no Hono. Route handlers apply the returned decisions to D1.
  This is the module that lifts into a `TripTrackerDO` untouched.
- **`src/utils/tripTelemetry.ts`** — `accumulate(prevFix, newFix, agg) → agg'`:
  haversine distance, speed (device or derived), longitudinal accel (g), lateral g
  (bearing-rate × speed), harsh-event flags. Thresholds **mirrored** from client
  `client/src/pages/navigation/vehicleTelemetry.ts` (`HARSH.accel 0.3g /
  brake 0.35g / corner 0.35g`) with a cross-reference comment (client/src and src
  share no build).

---

## 7. API surface (thin — segmentation is internal)

| Route | Purpose |
|---|---|
| `GET /dispatch/trips?unit_id=&call_id=&shift=&from=&to=` | filtered trip list |
| `GET /dispatch/trips/:id` | trip detail + its breadcrumbs (`WHERE trip_id=?`) for replay |
| `GET /dispatch/units/:id/current-trip` | active trip (also folded into unit-board payload) |
| `trip_update` on `AlertHubDO` | realtime `opened`/`appended`/`closed` |

The engine is invoked **inside** `gps.ts` and `calls.ts`, not via a public endpoint.

⚠️ **Proxy routing gotcha:** `rmpgutah.us/api/*` flows through `rmpg-api-proxy`.
Add `/api/dispatch/trips*` (and `/current-trip`) to `API_ROUTES` in `proxy/index.ts`
pointing at `env.API`, or it falls through to the legacy worker and 404s. Verify the
deployed proxy bundle (`workers_get_worker_code`) — not just the repo file.

---

## 8. Integration surfaces

### Navigation (`client/src/pages/NavigationPage.tsx`)
A **TRIPS** drawer: live vertical timeline of the unit's trip chain this shift,
active trip pinned at top and growing live off the existing gauges. Each row: type
badge, `start→end`, distance, duration, max speed, harsh chips. Tap → the existing
`MovementReportDrawer` (`client/src/pages/navigation/MovementReportDrawer.tsx`)
scoped to that trip's breadcrumbs.

### Map (`client/src/pages/map/MapPage.tsx`)
Breadcrumb trails + the `PlaybackTrail` scrubber already exist. Add a **trip
selector**: choose "Unit 12 → RESPONSE 24-0613" → breadcrumb layer filters to that
`trip_id` and loads into the scrubber. A→B endpoint markers with timestamps; the
active trip polyline grows live. Reuses existing speed/status/accel color modes.

### Dispatch (`DispatchPage` unit board)
A **current-trip badge** per unit row, driven by `trip_update`:
`▶ RESPONSE 24-0613 · 2.1 mi · 4m` / `▶ PATROL · 1.3 mi · 9m` / `■ IDLE 6m`.
Click a unit → trip-history drawer (same component as Nav). On **call detail**: the
response-trip line — *"Unit 12 → scene in 4m12s over 2.1 mi, mileage 84,201→84,203"* —
the literal accountability artifact.

---

## 9. Audit export (serves requirement #1)

A **Trip Log PDF** via the existing PDF engine (`recordPdfGenerator` + the
`recordPosture()` band pattern): per unit / officer / shift / call. Columns: type,
call#, start/end time+location, distance, duration, mileage Δ, max speed, harsh
events. Plus a per-call response-trip line embedded in the existing call PDF.

---

## 10. Edge cases (each with a rule)

1. **Device dies mid-trip** — PATROL closed by cron idle-sweep; CALL_RESPONSE bounded
   by status, with a cron **stale-close safeguard** (`close_reason='stale'`).
2. **Status flip with no GPS** (dispatcher manual) — trip opens/closes on the status
   event; A/B loc = unit's last known position; distance may be 0. Valid.
3. **Out-of-order / replayed fixes** (offline-sync reconnect) — engine **idempotent**:
   only accumulate fixes with `timestamp > last_fix_ts`; dedup by `(unit_id, ts)`.
   (Mirrors the `useWhatsHere` out-of-order guard.) **This is the audit-killer** —
   double-counting inflates mileage; the row-stored `last_fix_ts` makes the guard a
   one-line, unit-testable check.
4. **Server-clock authority** — bounds + idle math use server time
   (`datetime('now')` / `recorded_at`), never client `timestamp`.
5. **Re-dispatch / officer swap** — re-dispatch → new CALL_RESPONSE. Officer change
   mid-trip does not segment (trip is vehicle-centric; officer frozen at open).

---

## 11. Testing & deployment

- **Unit tests for the two pure modules** — table-driven: feed event sequences,
  assert transitions/rollups. Worth a small **vitest config for `src/`** (CLAUDE.md
  flags Worker vitest as Phase-2 debt; these pure modules are the highest-value
  starting point, no Miniflare needed).
- Existing client typecheck/vitest/build CI unchanged.
- **Manual verify** — drive the logged-in app (Claude-in-Chrome live-sweep pattern):
  run `enroute → onscene → clear → patrol → idle` and confirm trips on all three
  surfaces + a DB-level row check on `785de7ae`.
- **Migration 0075** + direct live-D1 patch via `d1_database_query` (deploy migration
  step is unreliable; live DB is patched directly).
- **Bump `CACHE_NAME` in `client/public/sw.js`** for the client changes.

---

## 12. Build sequence (high level — detailed plan via writing-plans)

1. Migration 0075 (`unit_trips` + `gps_breadcrumbs.trip_id`) + live patch.
2. Pure modules `tripEngine.ts` + `tripTelemetry.ts` + unit tests.
3. Wire engine into `gps.ts` (append/open/lazy-close) and `calls.ts` (status events).
4. `scheduled()` per-minute sweep + second cron expression.
5. `trips` routes + `trip_update` broadcast + proxy `API_ROUTES` entry.
6. Dispatch board badge + trip-history drawer.
7. Navigation TRIPS drawer (reuse MovementReportDrawer).
8. Map trip selector + replay wiring.
9. Trip Log PDF + per-call response-trip line.
10. SW bump, deploy, manual verify on all three surfaces.
