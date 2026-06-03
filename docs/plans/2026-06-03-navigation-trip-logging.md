# Navigation Trip Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Segment each unit's continuous GPS stream into lifecycle-bounded, server-authoritative "trips" (CALL_RESPONSE en route→on-scene, PATROL otherwise, auto-closing after 5 min idle) chained across a shift, with full vehicle telemetry, surfaced in Dispatch, Navigation, and the Map.

**Architecture:** Approach A ("B-ready") from `docs/plans/2026-06-03-navigation-trip-logging-design.md`. A pure, I/O-free `tripEngine.decide()` is invoked from the two events that already hit the Worker — the GPS write (`src/routes/dispatch/gps.ts`) and the status change (`src/routes/dispatch/calls.ts`) — plus a per-minute cron sweep. Trips persist in a new `unit_trips` table; every `gps_breadcrumbs` row is tagged with `trip_id`. Realtime via the existing `AlertHubDO` bus (`trip_update`). The engine is pure so it can later drop into a `TripTrackerDO` unchanged.

**Tech Stack:** Cloudflare Workers + Hono, D1 (via `src/utils/db.ts`), `emitAlert` → `AlertHubDO`, React 18 + Vite client, root vitest (`tests/**/*.test.ts`, node env).

**Read first:** the design doc (above) and these files for context — `src/routes/dispatch/gps.ts`, `src/routes/dispatch/calls.ts:939-1093`, `src/utils/alertHub.ts`, `src/utils/db.ts`, `client/src/pages/navigation/vehicleTelemetry.ts`, `src/routesConfig.ts:188-234`, `proxy/index.ts` (API_ROUTES region).

**Conventions:** D1 calls are async (`await`). All timestamps server-side `datetime('now')` (UTC). Idempotent DDL. Bump `client/public/sw.js` `CACHE_NAME` on any client change. The proxy needs an explicit rule for every new `/api/dispatch/*` path. Commit after each task.

---

## Task 1: Migration 0075 — `unit_trips` table + `gps_breadcrumbs.trip_id`

**Files:**
- Create: `migrations/0075_unit_trips.sql`

**Step 1: Write the migration**

```sql
-- 0075_unit_trips.sql
-- Navigation trip logging. A "trip" is a lifecycle-bounded leg of a unit's
-- movement: CALL_RESPONSE (status enroute → onscene/cleared) or PATROL
-- (everything else that's moving; auto-closes after 5 min stationary).
-- Server-authoritative + immutable once closed (close_reason set) for audit.
-- See docs/plans/2026-06-03-navigation-trip-logging-design.md.
--
-- Apply to live D1 (785de7ae) via d1_database_query as well — the deploy
-- migration step is continue-on-error and the live schema is patched directly.
-- D1 has no IF NOT EXISTS on ADD COLUMN; re-applying the ALTER errors harmlessly.

CREATE TABLE IF NOT EXISTS unit_trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL,
  officer_id INTEGER,
  vehicle_id INTEGER,
  trip_type TEXT NOT NULL CHECK (trip_type IN ('call_response','patrol')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  call_id INTEGER,
  call_number TEXT,
  call_type TEXT,
  prev_trip_id INTEGER,
  shift_session_id TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT,
  close_reason TEXT,            -- onscene|cleared|idle_timeout|off_duty|redispatch|stale|manual
  start_lat REAL, start_lng REAL,
  end_lat REAL, end_lng REAL,
  start_mileage REAL, end_mileage REAL,
  distance_m REAL NOT NULL DEFAULT 0,
  duration_s INTEGER,
  max_speed REAL NOT NULL DEFAULT 0,   -- m/s
  avg_speed REAL,                      -- m/s
  max_lat_g REAL NOT NULL DEFAULT 0,
  harsh_accel_count INTEGER NOT NULL DEFAULT 0,
  harsh_brake_count INTEGER NOT NULL DEFAULT 0,
  harsh_corner_count INTEGER NOT NULL DEFAULT 0,
  stop_count INTEGER NOT NULL DEFAULT 0,
  idle_seconds INTEGER NOT NULL DEFAULT 0,
  -- engine bookkeeping (running aggregates persisted between stateless batches)
  anchor_lat REAL, anchor_lng REAL,
  last_move_at TEXT,
  last_fix_ts TEXT,                    -- idempotency guard (ISO of last applied fix)
  speed_sum REAL NOT NULL DEFAULT 0,   -- Σ per-fix speed (m/s) for avg
  fix_count INTEGER NOT NULL DEFAULT 0,
  prev_bearing REAL,                   -- last segment bearing, for incremental lateral-g
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_unit_trips_unit_status ON unit_trips (unit_id, status);
CREATE INDEX IF NOT EXISTS idx_unit_trips_unit_start  ON unit_trips (unit_id, start_time);
CREATE INDEX IF NOT EXISTS idx_unit_trips_call        ON unit_trips (call_id);
CREATE INDEX IF NOT EXISTS idx_unit_trips_status      ON unit_trips (status);

-- Tag each breadcrumb with its trip so replay is a clean WHERE trip_id = ?.
ALTER TABLE gps_breadcrumbs ADD COLUMN trip_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_gps_breadcrumbs_trip ON gps_breadcrumbs (trip_id);
```

**Step 2: Apply locally**

Run: `npm run migrate:local`
Expected: applies without error (table + index creation; the ADD COLUMN succeeds first time).

**Step 3: Apply to live D1**

Use the `d1_database_query` MCP tool against database `785de7ae-3e7a-4e01-93bb-d24ddd813f6b`, running each statement. Confirm with `SELECT name FROM sqlite_master WHERE type='table' AND name='unit_trips'` (expect one row) and `SELECT trip_id FROM gps_breadcrumbs LIMIT 1` (column exists). If the ALTER errors with "duplicate column", it was already applied — continue.

**Step 4: Commit**

```bash
git add migrations/0075_unit_trips.sql
git commit -m "feat(trips): migration 0075 — unit_trips table + gps_breadcrumbs.trip_id"
```

---

## Task 2: `src/utils/tripTelemetry.ts` — incremental telemetry accumulator (TDD)

Mirrors the math + `HARSH` thresholds in `client/src/pages/navigation/vehicleTelemetry.ts` (no shared build between `client/src` and `src`), but in **incremental** form: one fix at a time, state carried on a `TripAgg`.

**Files:**
- Create: `src/utils/tripTelemetry.ts`
- Test: `tests/tripTelemetry.test.ts`

**Step 1: Write the failing test**

```ts
// tests/tripTelemetry.test.ts
import { describe, it, expect } from 'vitest';
import { emptyAgg, accumulate, haversineM, type IncomingFix } from '../src/utils/tripTelemetry';

const at = (lat: number, lng: number, ts: number, speed: number | null = null): IncomingFix =>
  ({ lat, lng, speed, heading: null, ts });

describe('tripTelemetry.accumulate', () => {
  it('first fix seeds state, adds no distance', () => {
    const a = accumulate(emptyAgg(), at(40.76, -111.89, 1000));
    expect(a.distance_m).toBe(0);
    expect(a.fix_count).toBe(1);
    expect(a.prev_lat).toBeCloseTo(40.76);
  });

  it('accumulates distance across two fixes (~100m apart)', () => {
    let a = accumulate(emptyAgg(), at(40.7600, -111.8900, 0));
    a = accumulate(a, at(40.7609, -111.8900, 10_000)); // ~100m north
    expect(a.distance_m).toBeGreaterThan(90);
    expect(a.distance_m).toBeLessThan(110);
  });

  it('tracks max_speed from device speed (m/s)', () => {
    let a = accumulate(emptyAgg(), at(40.76, -111.89, 0, 5));
    a = accumulate(a, at(40.761, -111.89, 5_000, 20));
    expect(a.max_speed).toBe(20);
  });

  it('ignores teleport jumps (>5km between fixes) in distance', () => {
    let a = accumulate(emptyAgg(), at(40.76, -111.89, 0));
    a = accumulate(a, at(41.50, -112.50, 5_000)); // ~90km — bad fix
    expect(a.distance_m).toBe(0);
  });

  it('counts a harsh brake when decel exceeds the LE threshold', () => {
    // 60 mph -> 5 mph over 1s ≈ 2.5 g brake (well past 0.35 g notable)
    let a = accumulate(emptyAgg(), at(40.7600, -111.8900, 0, 26.8)); // ~60 mph
    a = accumulate(a, at(40.7601, -111.8900, 1_000, 2.2));           // ~5 mph
    expect(a.harsh_brake_count).toBe(1);
  });
});

describe('haversineM', () => {
  it('measures ~111km per degree of latitude', () => {
    expect(haversineM(40, -111, 41, -111)).toBeGreaterThan(110_000);
    expect(haversineM(40, -111, 41, -111)).toBeLessThan(112_000);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run tests/tripTelemetry.test.ts`
Expected: FAIL — cannot resolve `../src/utils/tripTelemetry`.

**Step 3: Write the implementation**

```ts
// src/utils/tripTelemetry.ts
// Incremental, pure telemetry accumulator for unit_trips. One fix at a time,
// state carried on TripAgg (because the cron-swept engine is stateless across
// HTTP requests — see design §5). The constants + thresholds MIRROR
// client/src/pages/navigation/vehicleTelemetry.ts (HARSH, MPS_TO_MPH, etc.) —
// keep them in sync; the two trees share no build so this is a deliberate dup.

const MPS_TO_MPH = 2.236936;
const MPH_PER_S_PER_G = 21.936; // 1 g = 9.80665 m/s² = 21.936 mph/s
const EARTH_M = 6371000;
const STOP_MPH = 2;             // at/below = stopped
const TELEPORT_M = 5000;        // ignore distance jumps beyond this (bad fix)

// LE-driver tuned (mirror of vehicleTelemetry.HARSH). g magnitudes (≥0).
export const HARSH = {
  minMph: 5,
  accelG: 0.3,   // notable forward accel
  brakeG: 0.35,  // notable braking
  cornerG: 0.35, // notable lateral
};

const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  return (Math.atan2(y, x) * 180) / Math.PI; // -180..180
}

function angleDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export interface IncomingFix {
  lat: number; lng: number;
  speed: number | null;   // m/s, device value or null
  heading: number | null; // unused (we derive bearing); kept for parity
  ts: number;             // epoch ms (server-derived)
}

export interface TripAgg {
  distance_m: number;
  max_speed: number;   // m/s
  speed_sum: number;   // m/s
  fix_count: number;
  max_lat_g: number;
  harsh_accel_count: number;
  harsh_brake_count: number;
  harsh_corner_count: number;
  stop_count: number;
  // bookkeeping
  prev_lat: number | null;
  prev_lng: number | null;
  prev_ts: number | null;     // epoch ms
  prev_mph: number | null;
  prev_bearing: number | null;
  was_moving: boolean;
}

export function emptyAgg(): TripAgg {
  return {
    distance_m: 0, max_speed: 0, speed_sum: 0, fix_count: 0, max_lat_g: 0,
    harsh_accel_count: 0, harsh_brake_count: 0, harsh_corner_count: 0, stop_count: 0,
    prev_lat: null, prev_lng: null, prev_ts: null, prev_mph: null,
    prev_bearing: null, was_moving: false,
  };
}

/** Fold one fix into the running aggregate. Pure: returns a new TripAgg. */
export function accumulate(agg: TripAgg, fix: IncomingFix): TripAgg {
  const a: TripAgg = { ...agg };
  const { lat, lng, ts } = fix;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(ts)) return a;

  // speed (mph): device value or derived from displacement
  let mph: number;
  if (fix.speed != null && Number.isFinite(fix.speed) && fix.speed >= 0) {
    mph = fix.speed * MPS_TO_MPH;
  } else if (a.prev_lat != null && a.prev_ts != null && ts > a.prev_ts) {
    const d = haversineM(a.prev_lat, a.prev_lng!, lat, lng);
    const dt = (ts - a.prev_ts) / 1000;
    mph = dt > 0 ? (d / dt) * MPS_TO_MPH : 0;
    if (mph > 120) mph = 0; // teleport spike
  } else {
    mph = 0;
  }

  const speedMps = mph / MPS_TO_MPH;
  a.max_speed = Math.max(a.max_speed, speedMps);
  a.speed_sum += speedMps;
  a.fix_count += 1;

  let curBearing: number | null = a.prev_bearing;
  if (a.prev_lat != null && a.prev_ts != null && ts > a.prev_ts) {
    const dt = (ts - a.prev_ts) / 1000;
    if (dt > 0 && dt < 30) {
      const d = haversineM(a.prev_lat, a.prev_lng!, lat, lng);
      if (d < TELEPORT_M) a.distance_m += d;

      // longitudinal g
      const longG = a.prev_mph != null ? (mph - a.prev_mph) / dt / MPH_PER_S_PER_G : 0;
      const gateMph = Math.max(a.prev_mph ?? 0, mph);
      if (gateMph >= HARSH.minMph) {
        if (longG >= HARSH.accelG) a.harsh_accel_count += 1;
        if (-longG >= HARSH.brakeG) a.harsh_brake_count += 1;
      }

      // lateral g from turn rate × speed (needs a prior bearing)
      curBearing = d > 1 ? bearing(a.prev_lat, a.prev_lng!, lat, lng) : a.prev_bearing;
      if (mph > 8 && a.prev_bearing != null && curBearing != null) {
        const turnDegPerS = angleDelta(a.prev_bearing, curBearing) / dt;
        const omega = toRad(turnDegPerS);
        const vMs = mph / MPS_TO_MPH;
        let latG = (omega * vMs) / 9.80665;
        if (!Number.isFinite(latG) || Math.abs(latG) > 2) latG = 0;
        a.max_lat_g = Math.max(a.max_lat_g, Math.abs(latG));
        if (gateMph >= HARSH.minMph && Math.abs(latG) >= HARSH.cornerG) a.harsh_corner_count += 1;
      }

      // stop detection (moving → stopped)
      const movingNow = mph > STOP_MPH;
      if (a.was_moving && !movingNow) a.stop_count += 1;
      a.was_moving = movingNow;
    }
  } else {
    a.was_moving = mph > STOP_MPH;
  }

  a.prev_lat = lat; a.prev_lng = lng; a.prev_ts = ts; a.prev_mph = mph;
  a.prev_bearing = curBearing;
  return a;
}
```

**Step 4: Run to verify it passes**

Run: `npx vitest run tests/tripTelemetry.test.ts`
Expected: PASS (6 tests).

**Step 5: Commit**

```bash
git add src/utils/tripTelemetry.ts tests/tripTelemetry.test.ts
git commit -m "feat(trips): incremental telemetry accumulator + tests"
```

---

## Task 3: `src/utils/tripEngine.ts` — pure state machine (TDD)

The I/O-free decision core. Takes an event + the unit's active trip + context, returns intents (`close` / `open` / `append` / `updateAnchor`). The route handlers apply intents to D1.

**Files:**
- Create: `src/utils/tripEngine.ts`
- Test: `tests/tripEngine.test.ts`

**Step 1: Write the failing test**

```ts
// tests/tripEngine.test.ts
import { describe, it, expect } from 'vitest';
import { decide, type ActiveTrip, type EngineCtx } from '../src/utils/tripEngine';

const baseCtx = (over: Partial<EngineCtx> = {}): EngineCtx => ({
  now: 1_000_000, curLat: 40.76, curLng: -111.89, prevLat: 40.76, prevLng: -111.89,
  stationaryRadiusM: 30, idleMs: 300_000, staleMs: 900_000, ...over,
});

const patrol = (over: Partial<ActiveTrip> = {}): ActiveTrip => ({
  id: 7, trip_type: 'patrol', call_id: null,
  anchor_lat: 40.76, anchor_lng: -111.89, last_move_at: 1_000_000, last_fix_ts: 999_000, ...over,
});

describe('tripEngine.decide — status events', () => {
  it('enroute with no active trip opens a CALL_RESPONSE', () => {
    const d = decide({ kind: 'status', status: 'enroute' }, null,
      baseCtx({ callId: 42, callNumber: '24-0613', callType: 'alarm' }));
    expect(d.open?.type).toBe('call_response');
    expect(d.open?.callId).toBe(42);
    expect(d.close).toBeUndefined();
  });

  it('enroute while a PATROL is active closes patrol then opens CALL_RESPONSE chained', () => {
    const d = decide({ kind: 'status', status: 'enroute' }, patrol(),
      baseCtx({ callId: 42, callNumber: '24-0613' }));
    expect(d.close?.tripId).toBe(7);
    expect(d.close?.reason).toBe('redispatch');
    expect(d.open?.type).toBe('call_response');
    expect(d.open?.prevTripId).toBe(7);
  });

  it('onscene closes the active CALL_RESPONSE with reason onscene', () => {
    const active: ActiveTrip = { ...patrol(), trip_type: 'call_response', call_id: 42 };
    const d = decide({ kind: 'status', status: 'onscene' }, active, baseCtx());
    expect(d.close?.reason).toBe('onscene');
    expect(d.open).toBeUndefined(); // parked at scene — no new trip yet
  });

  it('cleared closes an active response with reason cleared', () => {
    const active: ActiveTrip = { ...patrol(), trip_type: 'call_response', call_id: 42 };
    const d = decide({ kind: 'status', status: 'cleared' }, active, baseCtx());
    expect(d.close?.reason).toBe('cleared');
  });

  it('off_duty closes any active trip', () => {
    const d = decide({ kind: 'status', status: 'off_duty' }, patrol(), baseCtx());
    expect(d.close?.reason).toBe('off_duty');
  });
});

describe('tripEngine.decide — gps events', () => {
  it('moving with no active trip opens a PATROL', () => {
    const d = decide(
      { kind: 'gps', fix: { lat: 40.770, lng: -111.89, speed: 10, heading: null, ts: 1_000_000 } },
      null, baseCtx({ prevLat: 40.760, prevLng: -111.89 }), // ~1.1km from prev → moving
    );
    expect(d.open?.type).toBe('patrol');
  });

  it('stationary with no active trip opens nothing', () => {
    const d = decide(
      { kind: 'gps', fix: { lat: 40.7600, lng: -111.8900, speed: 0, heading: null, ts: 1_000_000 } },
      null, baseCtx({ prevLat: 40.7600, prevLng: -111.8900 }),
    );
    expect(d.open).toBeUndefined();
  });

  it('active trip + fresh fix appends', () => {
    const d = decide(
      { kind: 'gps', fix: { lat: 40.7601, lng: -111.8900, speed: 8, heading: null, ts: 1_001_000 } },
      patrol(), baseCtx({ now: 1_001_000 }),
    );
    expect(d.append?.tripId).toBe(7);
  });

  it('idempotency: a fix at/older than last_fix_ts is dropped', () => {
    const d = decide(
      { kind: 'gps', fix: { lat: 40.7601, lng: -111.89, speed: 8, heading: null, ts: 999_000 } },
      patrol({ last_fix_ts: 999_000 }), baseCtx(),
    );
    expect(d.append).toBeUndefined();
    expect(d.close).toBeUndefined();
  });

  it('PATROL stationary past idleMs closes with end_time = arrival (last_move_at)', () => {
    const d = decide(
      { kind: 'gps', fix: { lat: 40.7600, lng: -111.8900, speed: 0, heading: null, ts: 1_400_000 } },
      patrol({ last_move_at: 1_000_000 }), // 400s of stillness > 300s
      baseCtx({ now: 1_400_000 }),
    );
    expect(d.close?.reason).toBe('idle_timeout');
    expect(d.close?.endTs).toBe(1_000_000);
  });

  it('PATROL moving beyond the radius updates the anchor', () => {
    const d = decide(
      { kind: 'gps', fix: { lat: 40.770, lng: -111.89, speed: 12, heading: null, ts: 1_001_000 } },
      patrol(), baseCtx({ now: 1_001_000 }),
    );
    expect(d.updateAnchor).toBeTruthy();
    expect(d.updateAnchor?.lat).toBeCloseTo(40.770);
  });
});

describe('tripEngine.decide — sweep', () => {
  it('closes an idle PATROL', () => {
    const d = decide({ kind: 'sweep' }, patrol({ last_move_at: 1_000_000 }), baseCtx({ now: 1_400_000 }));
    expect(d.close?.reason).toBe('idle_timeout');
  });
  it('stale-closes a CALL_RESPONSE whose last fix is older than staleMs', () => {
    const active: ActiveTrip = { ...patrol(), trip_type: 'call_response', call_id: 42, last_fix_ts: 1_000 };
    const d = decide({ kind: 'sweep' }, active, baseCtx({ now: 2_000_000 }));
    expect(d.close?.reason).toBe('stale');
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run tests/tripEngine.test.ts`
Expected: FAIL — cannot resolve `../src/utils/tripEngine`.

**Step 3: Write the implementation**

```ts
// src/utils/tripEngine.ts
// Pure trip state machine. No D1, no Hono, no env — the route handlers (gps.ts,
// calls.ts) and the cron sweep apply the returned intents. Kept pure so it can
// later drop into a per-unit TripTrackerDO unchanged ("B-ready", design §2).

import { haversineM, type IncomingFix } from './tripTelemetry';

export type TripType = 'call_response' | 'patrol';
export type CloseReason = 'onscene' | 'cleared' | 'idle_timeout' | 'off_duty' | 'redispatch' | 'stale' | 'manual';

export interface ActiveTrip {
  id: number;
  trip_type: TripType;
  call_id: number | null;
  anchor_lat: number | null;
  anchor_lng: number | null;
  last_move_at: number | null; // epoch ms
  last_fix_ts: number | null;  // epoch ms — idempotency
}

export type TripEvent =
  | { kind: 'status'; status: string }
  | { kind: 'gps'; fix: IncomingFix }
  | { kind: 'sweep' };

export interface EngineCtx {
  now: number;                 // server epoch ms
  curLat: number | null;       // current unit position (= fix on gps events)
  curLng: number | null;
  prevLat: number | null;      // unit's last known position before this event
  prevLng: number | null;
  callId?: number | null;
  callNumber?: string | null;
  callType?: string | null;
  stationaryRadiusM?: number;  // default 30
  idleMs?: number;             // default 300000 (5 min)
  staleMs?: number;            // default 900000 (15 min) — response stale-close
}

export interface EngineDecision {
  close?: { tripId: number; reason: CloseReason; endTs: number; endLat: number | null; endLng: number | null };
  open?: { type: TripType; startTs: number; startLat: number | null; startLng: number | null;
           callId?: number | null; callNumber?: string | null; callType?: string | null; prevTripId?: number | null };
  append?: { tripId: number; fix: IncomingFix };
  updateAnchor?: { lat: number; lng: number; at: number };
}

const MOVING_STATUSES = new Set(['enroute']);
const ONSCENE = 'onscene';
const TERMINAL = new Set(['cleared', 'closed', 'cancelled', 'archived']);
const OFFLINE = new Set(['off_duty', 'out_of_service']);

const RADIUS = (c: EngineCtx) => c.stationaryRadiusM ?? 30;
const IDLE = (c: EngineCtx) => c.idleMs ?? 300_000;
const STALE = (c: EngineCtx) => c.staleMs ?? 900_000;

export function decide(event: TripEvent, active: ActiveTrip | null, ctx: EngineCtx): EngineDecision {
  if (event.kind === 'status') return decideStatus(event.status, active, ctx);
  if (event.kind === 'gps') return decideGps(event.fix, active, ctx);
  return decideSweep(active, ctx);
}

function decideStatus(status: string, active: ActiveTrip | null, ctx: EngineCtx): EngineDecision {
  const d: EngineDecision = {};
  if (MOVING_STATUSES.has(status)) {
    // enroute → close whatever's active (chained), open CALL_RESPONSE
    if (active) {
      d.close = { tripId: active.id, reason: 'redispatch', endTs: ctx.now, endLat: ctx.curLat, endLng: ctx.curLng };
    }
    d.open = {
      type: 'call_response', startTs: ctx.now, startLat: ctx.curLat, startLng: ctx.curLng,
      callId: ctx.callId ?? null, callNumber: ctx.callNumber ?? null, callType: ctx.callType ?? null,
      prevTripId: active?.id ?? null,
    };
    return d;
  }
  if (status === ONSCENE) {
    if (active && active.trip_type === 'call_response') {
      d.close = { tripId: active.id, reason: 'onscene', endTs: ctx.now, endLat: ctx.curLat, endLng: ctx.curLng };
    }
    return d; // parked at scene — next movement opens PATROL
  }
  if (TERMINAL.has(status)) {
    if (active) d.close = { tripId: active.id, reason: 'cleared', endTs: ctx.now, endLat: ctx.curLat, endLng: ctx.curLng };
    return d;
  }
  if (OFFLINE.has(status)) {
    if (active) d.close = { tripId: active.id, reason: 'off_duty', endTs: ctx.now, endLat: ctx.curLat, endLng: ctx.curLng };
    return d;
  }
  return d; // available/dispatched/busy/pending — no trip action
}

function decideGps(fix: IncomingFix, active: ActiveTrip | null, ctx: EngineCtx): EngineDecision {
  const d: EngineDecision = {};

  if (!active) {
    // Open a PATROL only when the unit is actually moving.
    const moved =
      (fix.speed != null && fix.speed * 2.236936 > 2) ||
      (ctx.prevLat != null && ctx.prevLng != null &&
        haversineM(ctx.prevLat, ctx.prevLng, fix.lat, fix.lng) > RADIUS(ctx));
    if (moved) {
      d.open = { type: 'patrol', startTs: fix.ts, startLat: ctx.prevLat ?? fix.lat, startLng: ctx.prevLng ?? fix.lng };
    }
    return d;
  }

  // Idempotency: drop replays / out-of-order fixes.
  if (active.last_fix_ts != null && fix.ts <= active.last_fix_ts) return d;

  if (active.trip_type === 'call_response') {
    d.append = { tripId: active.id, fix }; // bounded by status, never idle-closed
    return d;
  }

  // PATROL: moving vs stationary
  const withinRadius = active.anchor_lat != null && active.anchor_lng != null &&
    haversineM(active.anchor_lat, active.anchor_lng, fix.lat, fix.lng) <= RADIUS(ctx);

  if (withinRadius) {
    if (active.last_move_at != null && ctx.now - active.last_move_at > IDLE(ctx)) {
      d.close = { tripId: active.id, reason: 'idle_timeout', endTs: active.last_move_at,
        endLat: active.anchor_lat, endLng: active.anchor_lng };
      return d;
    }
    d.append = { tripId: active.id, fix }; // still parked, accumulate idle
    return d;
  }

  // moved beyond the radius → reset the anchor, keep going
  d.append = { tripId: active.id, fix };
  d.updateAnchor = { lat: fix.lat, lng: fix.lng, at: fix.ts };
  return d;
}

function decideSweep(active: ActiveTrip | null, ctx: EngineCtx): EngineDecision {
  const d: EngineDecision = {};
  if (!active) return d;
  if (active.trip_type === 'patrol' && active.last_move_at != null && ctx.now - active.last_move_at > IDLE(ctx)) {
    d.close = { tripId: active.id, reason: 'idle_timeout', endTs: active.last_move_at,
      endLat: active.anchor_lat, endLng: active.anchor_lng };
    return d;
  }
  if (active.last_fix_ts != null && ctx.now - active.last_fix_ts > STALE(ctx)) {
    d.close = { tripId: active.id, reason: 'stale', endTs: active.last_fix_ts, endLat: active.anchor_lat, endLng: active.anchor_lng };
  }
  return d;
}
```

**Step 4: Run to verify it passes**

Run: `npx vitest run tests/tripEngine.test.ts`
Expected: PASS (all cases).

**Step 5: Commit**

```bash
git add src/utils/tripEngine.ts tests/tripEngine.test.ts
git commit -m "feat(trips): pure trip state machine (decide) + tests"
```

---

## Task 4: `src/utils/tripStore.ts` — D1 applier (the only I/O layer)

A thin module that loads the active trip, calls `decide()`, applies intents to D1 (`unit_trips` + breadcrumb `trip_id` + telemetry via `accumulate`), and broadcasts `trip_update`. This is what `gps.ts`, `calls.ts`, and the sweep call.

**Files:**
- Create: `src/utils/tripStore.ts`
- Test: `tests/tripStore.smoke.test.ts` (a light smoke test with a fake DB; full behavior is already covered by the pure-module tests)

**Step 1: Write the implementation** (no failing-test-first here — this is glue over already-tested pure logic; we add one smoke test after)

```ts
// src/utils/tripStore.ts
import { query, queryFirst, execute } from './db';
import { emitAlert } from './alertHub';
import { decide, type ActiveTrip, type TripEvent, type EngineCtx, type EngineDecision } from './tripEngine';
import { emptyAgg, accumulate, type TripAgg, type IncomingFix } from './tripTelemetry';

type DB = D1Database;
const iso = (epochMs: number) => new Date(epochMs).toISOString().replace('T', ' ').slice(0, 19);
const epoch = (isoStr: string | null) => (isoStr ? Date.parse(isoStr.replace(' ', 'T') + 'Z') : null);

export interface ApplyArgs {
  db: DB; env: { ALERT_HUB?: DurableObjectNamespace };
  unitId: number; officerId?: number | null; vehicleId?: number | null;
  event: TripEvent; ctx: Omit<EngineCtx, 'now'> & { now?: number };
  startMileage?: number | null; endMileage?: number | null;
}

async function loadActive(db: DB, unitId: number): Promise<ActiveTrip | null> {
  const row = await queryFirst<any>(db,
    `SELECT id, trip_type, call_id, anchor_lat, anchor_lng, last_move_at, last_fix_ts
     FROM unit_trips WHERE unit_id = ? AND status = 'active' ORDER BY start_time DESC LIMIT 1`, unitId);
  if (!row) return null;
  return {
    id: row.id, trip_type: row.trip_type, call_id: row.call_id,
    anchor_lat: row.anchor_lat, anchor_lng: row.anchor_lng,
    last_move_at: epoch(row.last_move_at), last_fix_ts: epoch(row.last_fix_ts),
  };
}

/** Apply one trip event. Returns the trip ids touched (for the caller's logging). */
export async function applyTripEvent(args: ApplyArgs): Promise<void> {
  const { db, env, unitId } = args;
  const active = await loadActive(db, unitId);
  const now = args.ctx.now ?? Date.now();
  const ctx: EngineCtx = { ...args.ctx, now } as EngineCtx;
  const d: EngineDecision = decide(args.event, active, ctx);

  if (d.close) {
    const reasonMileage = args.endMileage != null && Number.isFinite(args.endMileage)
      ? ', end_mileage = ?' : '';
    const params: unknown[] = [iso(d.close.endTs), d.close.endLat, d.close.endLng, d.close.reason, d.close.endTs];
    // duration + avg computed from stored start_time/speed_sum/fix_count
    const closed = await queryFirst<any>(db, 'SELECT start_time, speed_sum, fix_count FROM unit_trips WHERE id = ?', d.close.tripId);
    const durS = closed ? Math.max(0, Math.round((d.close.endTs - (epoch(closed.start_time) ?? d.close.endTs)) / 1000)) : null;
    const avg = closed && closed.fix_count > 0 ? closed.speed_sum / closed.fix_count : null;
    if (reasonMileage) params.splice(4, 0, args.endMileage);
    await execute(db,
      `UPDATE unit_trips SET status='closed', end_time=?, end_lat=?, end_lng=?, close_reason=?,
        duration_s=?, avg_speed=?, updated_at=datetime('now')${reasonMileage} WHERE id=? AND status='active'`,
      iso(d.close.endTs), d.close.endLat, d.close.endLng, d.close.reason, durS, avg,
      ...(reasonMileage ? [args.endMileage] : []), d.close.tripId);
    await broadcastTrip(env, db, d.close.tripId, 'closed');
  }

  if (d.open) {
    const res = await execute(db,
      `INSERT INTO unit_trips (unit_id, officer_id, vehicle_id, trip_type, status, call_id, call_number, call_type,
         prev_trip_id, start_time, start_lat, start_lng, start_mileage, anchor_lat, anchor_lng, last_move_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      unitId, args.officerId ?? null, args.vehicleId ?? null, d.open.type,
      d.open.callId ?? null, d.open.callNumber ?? null, d.open.callType ?? null,
      d.open.prevTripId ?? null, iso(d.open.startTs), d.open.startLat, d.open.startLng,
      args.startMileage ?? null, d.open.startLat, d.open.startLng, iso(d.open.startTs));
    const newId = res.meta.last_row_id as number;
    await broadcastTrip(env, db, newId, 'opened');
  }

  if (d.append) {
    await applyAppend(db, d.append.tripId, d.append.fix, d.updateAnchor);
    await broadcastTrip(env, db, d.append.tripId, 'appended');
  }
}

async function applyAppend(db: DB, tripId: number, fix: IncomingFix, updateAnchor?: { lat: number; lng: number; at: number }) {
  const row = await queryFirst<any>(db,
    `SELECT distance_m, max_speed, speed_sum, fix_count, max_lat_g, harsh_accel_count, harsh_brake_count,
      harsh_corner_count, stop_count, anchor_lat, anchor_lng, last_move_at FROM unit_trips WHERE id = ?`, tripId);
  if (!row) return;
  // Rebuild a partial TripAgg from stored counters; prev_* live implicitly in the
  // last breadcrumb, so we seed prev from the unit's prior fix when present.
  const prev = await queryFirst<any>(db,
    `SELECT latitude, longitude, recorded_at FROM gps_breadcrumbs WHERE trip_id = ? ORDER BY recorded_at DESC LIMIT 1`, tripId);
  const agg: TripAgg = {
    distance_m: row.distance_m, max_speed: row.max_speed, speed_sum: row.speed_sum, fix_count: row.fix_count,
    max_lat_g: row.max_lat_g, harsh_accel_count: row.harsh_accel_count, harsh_brake_count: row.harsh_brake_count,
    harsh_corner_count: row.harsh_corner_count, stop_count: row.stop_count,
    prev_lat: prev?.latitude ?? null, prev_lng: prev?.longitude ?? null,
    prev_ts: prev ? Date.parse(String(prev.recorded_at).replace(' ', 'T') + 'Z') : null,
    prev_mph: null, prev_bearing: null, was_moving: false,
  };
  const next = accumulate(agg, fix);
  const anchorLat = updateAnchor?.lat ?? row.anchor_lat;
  const anchorLng = updateAnchor?.lng ?? row.anchor_lng;
  const lastMoveAt = updateAnchor ? iso(updateAnchor.at) : row.last_move_at;
  await execute(db,
    `UPDATE unit_trips SET distance_m=?, max_speed=?, speed_sum=?, fix_count=?, max_lat_g=?,
      harsh_accel_count=?, harsh_brake_count=?, harsh_corner_count=?, stop_count=?,
      anchor_lat=?, anchor_lng=?, last_move_at=?, last_fix_ts=?, updated_at=datetime('now') WHERE id=?`,
    next.distance_m, next.max_speed, next.speed_sum, next.fix_count, next.max_lat_g,
    next.harsh_accel_count, next.harsh_brake_count, next.harsh_corner_count, next.stop_count,
    anchorLat, anchorLng, lastMoveAt, iso(fix.ts), tripId);
}

async function broadcastTrip(env: { ALERT_HUB?: DurableObjectNamespace }, db: DB, tripId: number, action: 'opened' | 'appended' | 'closed') {
  try {
    const trip = await queryFirst<any>(db, 'SELECT * FROM unit_trips WHERE id = ?', tripId);
    if (trip) await emitAlert(env, 'trip_update', { action, unit_id: trip.unit_id, trip });
  } catch { /* never break the write */ }
}

/** Cron sweep: idle/stale-close every active trip whose unit warrants it. */
export async function sweepTrips(db: DB, env: { ALERT_HUB?: DurableObjectNamespace }, now = Date.now()): Promise<number> {
  const rows = await query<any>(db,
    `SELECT ut.id, ut.unit_id, ut.trip_type, ut.call_id, ut.anchor_lat, ut.anchor_lng, ut.last_move_at, ut.last_fix_ts,
            u.latitude, u.longitude
     FROM unit_trips ut JOIN units u ON u.id = ut.unit_id WHERE ut.status = 'active'`);
  let closed = 0;
  for (const r of rows) {
    const active: ActiveTrip = {
      id: r.id, trip_type: r.trip_type, call_id: r.call_id, anchor_lat: r.anchor_lat, anchor_lng: r.anchor_lng,
      last_move_at: epoch(r.last_move_at), last_fix_ts: epoch(r.last_fix_ts),
    };
    const d = decide({ kind: 'sweep' }, active,
      { now, curLat: r.latitude, curLng: r.longitude, prevLat: r.latitude, prevLng: r.longitude });
    if (d.close) {
      await applyTripEvent({ db, env, unitId: r.unit_id, event: { kind: 'sweep' },
        ctx: { now, curLat: r.latitude, curLng: r.longitude, prevLat: r.latitude, prevLng: r.longitude } });
      closed++;
    }
  }
  return closed;
}
```

**Step 2: Add a smoke test**

```ts
// tests/tripStore.smoke.test.ts
import { describe, it, expect } from 'vitest';
import { applyTripEvent } from '../src/utils/tripStore';

// Minimal fake D1 that records the SQL it sees — proves applyTripEvent wires
// decide()→SQL without throwing. (Behavioral correctness is in the pure tests.)
function fakeDb() {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const stub = (rows: any[] = []) => ({
    bind: (...b: unknown[]) => ({
      all: async () => { calls.push({ sql, binds: b }); return { results: rows }; },
      first: async () => { calls.push({ sql, binds: b }); return rows[0] ?? null; },
      run: async () => { calls.push({ sql, binds: b }); return { meta: { last_row_id: 1 } }; },
    }),
  });
  let sql = '';
  const db: any = { prepare: (s: string) => { sql = s; return stub([]); } };
  return { db, calls };
}

describe('tripStore.applyTripEvent', () => {
  it('opens a CALL_RESPONSE on enroute without throwing', async () => {
    const { db } = fakeDb();
    await expect(applyTripEvent({
      db, env: {}, unitId: 5, officerId: 9, vehicleId: 2,
      event: { kind: 'status', status: 'enroute' },
      ctx: { curLat: 40.76, curLng: -111.89, prevLat: 40.76, prevLng: -111.89, callId: 42, callNumber: '24-0613' },
    })).resolves.toBeUndefined();
  });
});
```

> Note: confirm `query/queryFirst/execute` in `src/utils/db.ts` accept `(db, sql, ...binds)` and that `execute` returns `{ meta: { last_row_id } }`. Adjust the fake's shape to match the real helpers (read `src/utils/db.ts` first).

**Step 3: Run**

Run: `npx vitest run tests/tripStore.smoke.test.ts`
Expected: PASS.

**Step 4: Commit**

```bash
git add src/utils/tripStore.ts tests/tripStore.smoke.test.ts
git commit -m "feat(trips): D1 applier (applyTripEvent + sweepTrips) over the pure engine"
```

---

## Task 5: Wire the engine into `gps.ts`, `calls.ts`, and the cron

### 5a — `gps.ts` (append/open/lazy-close on every fix)

**File:** Modify `src/routes/dispatch/gps.ts`

After the unit-row mirror block (currently ending ~line 107, after the `emitAlert('unit_position', …)` try/catch) and **before** `return c.json({ inserted … })`, add — capturing the unit's prior position read *before* the mirror UPDATE (so grab `unit.latitude/longitude` in the SELECT at line 41):

1. Extend the unit SELECT (line 41-42) to also fetch prior position + ids:
```ts
const unit = await queryFirst<{ id: number; call_sign: string; status: string | null;
  latitude: number | null; longitude: number | null; officer_id: number | null;
  vehicle_id: number | null; current_call_id: number | null }>(db,
  'SELECT id, call_sign, status, latitude, longitude, officer_id, vehicle_id, current_call_id FROM units WHERE officer_id = ? LIMIT 1', userId);
```
2. Capture `const prevLat = unit.latitude; const prevLng = unit.longitude;` *before* the mirror UPDATE overwrites them.
3. After the `emitAlert('unit_position', …)` block, feed the latest fix to the engine (best-effort, never fail the write):
```ts
// Trip segmentation — open PATROL on movement, append + roll up telemetry,
// lazy-close an idle PATROL. Best-effort: a trip failure must never fail the
// breadcrumb write or the client's success ack. (design §4)
try {
  const tsMs = Date.now();
  await applyTripEvent({
    db, env: c.env, unitId: unit.id, officerId: unit.officer_id, vehicleId: unit.vehicle_id,
    event: { kind: 'gps', fix: { lat: lastPt.latitude, lng: lastPt.longitude, speed: lastPt.speed, heading: lastPt.heading, ts: tsMs } },
    ctx: { curLat: lastPt.latitude, curLng: lastPt.longitude, prevLat, prevLng, now: tsMs },
  });
  // Tag the just-written breadcrumbs with the now-active trip for replay.
  await execute(db,
    `UPDATE gps_breadcrumbs SET trip_id = (SELECT id FROM unit_trips WHERE unit_id = ? AND status='active' ORDER BY start_time DESC LIMIT 1)
     WHERE unit_id = ? AND trip_id IS NULL AND recorded_at >= datetime('now','-30 seconds')`, unit.id, unit.id);
} catch (e) { console.warn('[gps] trip engine non-fatal:', e); }
```
4. Add import at top: `import { applyTripEvent } from '../../utils/tripStore';`

### 5b — `calls.ts` (status events)

**File:** Modify `src/routes/dispatch/calls.ts` (the `/:id/status` handler, ~939-1093)

Add `import { applyTripEvent } from '../../utils/tripStore';` at top.

After the status UPDATE (line 998) but using the unit(s) on the call:
```ts
// Trip segmentation on status transition (design §4). enroute → open
// CALL_RESPONSE; onscene → close (the "On-Scene point"); terminal → close.
try {
  const tripUnits = await query<{ id: number; officer_id: number | null; vehicle_id: number | null; latitude: number | null; longitude: number | null }>(
    db, 'SELECT id, officer_id, vehicle_id, latitude, longitude FROM units WHERE current_call_id = ?', id);
  const callMeta = await queryFirst<{ call_number: string | null; incident_type: string | null }>(
    db, 'SELECT call_number, incident_type FROM calls_for_service WHERE id = ?', id);
  for (const u of tripUnits) {
    await applyTripEvent({
      db, env: c.env, unitId: u.id, officerId: u.officer_id, vehicleId: u.vehicle_id,
      event: { kind: 'status', status },
      ctx: { curLat: u.latitude, curLng: u.longitude, prevLat: u.latitude, prevLng: u.longitude,
             callId: Number(id), callNumber: callMeta?.call_number ?? null, callType: callMeta?.incident_type ?? null },
      startMileage: Number.isFinite(sm) && sm > 0 ? sm : null,
      endMileage: Number.isFinite(em) && em > 0 ? em : null,
    });
  }
} catch (e) { console.warn('[calls] trip engine non-fatal:', e); }
```
> Place this for ALL transitions (the engine no-ops on statuses it doesn't care about). For terminal statuses, run it **before** the `current_call_id = NULL` UPDATE at line 1019 (otherwise `WHERE current_call_id = ?` finds no units). Easiest: compute `tripUnits` from `freedUnits` already collected at line 1018, OR move this block above line 1017.

### 5b-2 — unit-status endpoint (the C1 follow-through)

**File:** Modify the unit-status handler (the `unitStatus` router — `grep -rn "unitStatus\|/units" src/routesConfig.ts` then open the file it imports; it's mounted at `/api/dispatch/units`).

A unit can change status **without** a call event — a dispatcher flips it to `available`/`off_duty`/`out_of_service` on the status monitor. `calls.ts` (5b) only fires on call transitions, so these direct unit changes must ALSO feed the engine, or an active trip leaks until the stale sweep. After the status UPDATE in that handler, add (best-effort):
```ts
try {
  await applyTripEvent({
    db, env: c.env, unitId: <the unit id>, officerId: <unit.officer_id>, vehicleId: <unit.vehicle_id>,
    event: { kind: 'status', status: <new unit status> },
    ctx: { curLat: <unit.latitude>, curLng: <unit.longitude>, prevLat: <unit.latitude>, prevLng: <unit.longitude> },
  });
} catch (e) { console.warn('[units] trip engine non-fatal:', e); }
```
The engine treats `available` as "close an active CALL_RESPONSE, leave a PATROL running" and `off_duty`/`out_of_service` as "close any active trip" (Task 3 fix C1). Feeding both call- and unit-status events is **safe** — a redundant close is a no-op because the engine only closes when a trip is active.

### 5c — Cron sweep + second cron expression

**File:** Modify `wrangler.toml` line 179:
```toml
crons = ["0 */4 * * *", "* * * * *"]
```

**File:** Modify `src/index.ts` `scheduled()` (line 266). Branch on `event.cron`:
```ts
async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext): Promise<void> {
  if (event.cron === '* * * * *') {
    // Per-minute trip idle/stale sweep — backstop for units that go dark while
    // stationary (the lazy-on-GPS-write path handles the common case). (design §4)
    ctx.waitUntil(
      sweepTrips(env.DB, env).then((n) => { if (n) console.log(`[trips] sweep closed ${n}`); })
        .catch((err) => console.error('[trips] sweep failed:', err)),
    );
    return;
  }
  // ... existing 4h warrant/anomaly/radio scans unchanged ...
}
```
Add import: `import { sweepTrips } from './utils/tripStore';`

**Verify (typecheck):**

Run: `npm run typecheck`
Expected: PASS (no type errors in src/).

**Commit:**

```bash
git add src/routes/dispatch/gps.ts src/routes/dispatch/calls.ts src/index.ts wrangler.toml
git commit -m "feat(trips): wire engine into gps + status events + per-minute cron sweep"
```

---

## Task 6: `/api/dispatch/trips` routes + ROUTE_REGISTRY + proxy rule

**Files:**
- Create: `src/routes/dispatch/trips.ts`
- Modify: `src/routesConfig.ts` (import + registry entry)
- Modify: `proxy/index.ts` (API_ROUTES entry)

**Step 1: Create the router**

```ts
// src/routes/dispatch/trips.ts
import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst } from '../../utils/db';

const trips = new Hono<Env>();

// GET /dispatch/trips?unit_id=&call_id=&from=&to=&limit=
trips.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const { unit_id, call_id, from, to, limit } = c.req.query();
    const where: string[] = []; const p: unknown[] = [];
    if (unit_id) { where.push('unit_id = ?'); p.push(Number(unit_id)); }
    if (call_id) { where.push('call_id = ?'); p.push(Number(call_id)); }
    if (from) { where.push("start_time >= ?"); p.push(from); }
    if (to) { where.push("start_time <= ?"); p.push(to); }
    const sql = `SELECT * FROM unit_trips ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY start_time DESC LIMIT ?`;
    p.push(Math.min(Number(limit) || 100, 500));
    const rows = await query<Record<string, unknown>>(db, sql, ...p);
    return c.json(rows);
  } catch (e) { return c.json({ error: 'Failed to list trips' }, 500); }
});

// GET /dispatch/trips/active — one active trip per unit (board badges)
trips.get('/active', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT * FROM unit_trips WHERE status='active' ORDER BY unit_id, start_time DESC`);
    return c.json(rows);
  } catch (e) { return c.json({ error: 'Failed' }, 500); }
});

// GET /dispatch/trips/:id — trip + its breadcrumbs (replay)
trips.get('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const trip = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM unit_trips WHERE id = ?', id);
    if (!trip) return c.json({ error: 'Not found' }, 404);
    const points = await query<Record<string, unknown>>(db,
      `SELECT latitude AS lat, longitude AS lng, accuracy, heading, speed, recorded_at AS time
       FROM gps_breadcrumbs WHERE trip_id = ? ORDER BY recorded_at ASC`, id);
    return c.json({ ...trip, points });
  } catch (e) { return c.json({ error: 'Failed' }, 500); }
});

export default trips;
```

**Step 2: Register the route** — `src/routesConfig.ts`

Add the import near the other dispatch imports, then add to `ROUTE_REGISTRY` **before** the bare `/api/dispatch` `dispatchAggregates` mount (line 231) and near the other `/api/dispatch/*` canonical resources (after line 229):
```ts
import dispatchTrips from './routes/dispatch/trips';
// ...
{ prefix: '/api/dispatch/trips', router: dispatchTrips, auth: 'required' },
```

**Step 3: Add the proxy rule** — `proxy/index.ts`

In `API_ROUTES` (near the other `/api/dispatch/*` prefix rules, e.g. after the `/api/dispatch/welfare` entry ~line 601):
```ts
// /api/dispatch/trips[/*] — Navigation trip logging. ENTIRE namespace on the
// rewrite (new feature; no legacy handler). Without this it falls through to
// the legacy worker and 404s. (design §7)
{ kind: 'prefix', value: '/api/dispatch/trips' },
```

**Step 4: Verify routing locally**

Run: `npm run dev` (in one shell), then in another:
`curl -s 'http://localhost:8787/api/dispatch/trips/active' -H 'Authorization: Bearer <dev-jwt>'`
Expected: `[]` (empty array, 200) — proves the route mounts and auth passes. (Or assert via typecheck + a follow-up live check.)

**Step 5: Verify deployed proxy bundle later** — after deploy, `workers_get_worker_code({scriptName:'rmpg-api-proxy'})` and confirm the `/api/dispatch/trips` rule is present in the *deployed* bundle (per memory, the repo file can drift from the deployed proxy).

**Step 6: Commit**

```bash
git add src/routes/dispatch/trips.ts src/routesConfig.ts proxy/index.ts
git commit -m "feat(trips): /api/dispatch/trips routes + registry + proxy rule"
```

---

## Task 7: Client API hook + types

**Files:**
- Create: `client/src/hooks/useTrips.ts`
- Create/extend: `client/src/types/trips.ts` (or co-locate the `Trip` interface in the hook)

**Step 1: Types + hook**

```ts
// client/src/hooks/useTrips.ts
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from './useApi';

export interface Trip {
  id: number; unit_id: number; officer_id: number | null;
  trip_type: 'call_response' | 'patrol'; status: 'active' | 'closed';
  call_id: number | null; call_number: string | null; call_type: string | null;
  prev_trip_id: number | null;
  start_time: string; end_time: string | null; close_reason: string | null;
  start_lat: number | null; start_lng: number | null; end_lat: number | null; end_lng: number | null;
  start_mileage: number | null; end_mileage: number | null;
  distance_m: number; duration_s: number | null; max_speed: number; avg_speed: number | null;
  max_lat_g: number; harsh_accel_count: number; harsh_brake_count: number; harsh_corner_count: number;
  stop_count: number; idle_seconds: number;
}
export interface TripDetail extends Trip { points: { lat: number; lng: number; speed: number | null; heading: number | null; time: string }[]; }

export function useUnitTrips(unitId?: number) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const reload = useCallback(() => {
    if (!unitId) return;
    apiFetch<Trip[]>(`/dispatch/trips?unit_id=${unitId}&limit=50`).then(setTrips).catch(console.error);
  }, [unitId]);
  useEffect(reload, [reload]);
  return { trips, reload };
}
export function useTripDetail(id?: number) {
  const [trip, setTrip] = useState<TripDetail | null>(null);
  useEffect(() => { if (id) apiFetch<TripDetail>(`/dispatch/trips/${id}`).then(setTrip).catch(console.error); }, [id]);
  return trip;
}
```

Add display helpers (used by all surfaces) in the same file:
```ts
export const tripMiles = (t: Trip) => (t.distance_m / 1609.34);
export const tripLabel = (t: Trip) =>
  t.trip_type === 'call_response' ? `RESPONSE${t.call_number ? ' ' + t.call_number : ''}` : 'PATROL';
export const tripDurationMin = (t: Trip) => t.duration_s != null ? Math.round(t.duration_s / 60) : null;
```

**Step 2: Verify** `cd client && npx tsc --noEmit` → PASS.

**Step 3: Commit**

```bash
git add client/src/hooks/useTrips.ts
git commit -m "feat(trips): client useTrips hook + display helpers"
```

---

## Task 8: Dispatch board current-trip badge + trip-update live-sync

**Files:**
- Modify: the dispatch unit-board component (find it: `grep -rn "current_call_number\|Assignment" client/src/pages/dispatch* client/src/pages/DispatchPage.tsx`)
- Modify: the AlertHub WebSocket consumer (find: `grep -rn "unit_position\|dispatch_update" client/src/context client/src/hooks`)

**Step 1:** Subscribe to `trip_update` where `unit_position` is already handled (same socket). On `action: 'opened'|'appended'|'closed'`, update a `Map<unitId, Trip>` of active trips in the dispatch context/store.

**Step 2:** Render a badge per unit row using `tripLabel` + `tripMiles` + `tripDurationMin`:
- active `call_response` → `▶ RESPONSE 24-0613 · 2.1 mi · 4m` (gold `#d4a017`)
- active `patrol` → `▶ PATROL · 1.3 mi · 9m` (neutral gray)
- no active trip but recently closed `idle_timeout` → `■ IDLE` (subtle)
Use the existing 2px-radius, 9–11px table styling. No pills.

**Step 3:** Clicking the unit opens a trip-history drawer (the component built in Task 9 — reused).

**Step 4:** Verify `cd client && npx tsc --noEmit` + `npx vitest run` → PASS. Bump `client/public/sw.js` `CACHE_NAME`.

**Step 5: Commit**

```bash
git add client/src/... client/public/sw.js
git commit -m "feat(trips): dispatch board current-trip badge + trip_update live-sync"
```

> Read the board + socket consumer files fully before editing — they are large and have existing live-sync patterns to follow.

---

## Task 9: Navigation TRIPS drawer (reuses MovementReportDrawer)

**Files:**
- Create: `client/src/pages/navigation/TripsDrawer.tsx`
- Modify: `client/src/pages/NavigationPage.tsx` (mount the drawer + a toggle)

**Step 1:** `TripsDrawer` renders `useUnitTrips(unitId)` as a vertical timeline (active pinned top). Each row: type badge, `start→end` (local time), `tripMiles` mi, `tripDurationMin` m, max speed (mph = `max_speed * 2.236936`), harsh chips (`A:n B:n C:n`). Tapping a row sets `selectedTripId`.

**Step 2:** When a trip is selected, fetch `useTripDetail(id)` and feed its `points` into the **existing** `MovementReportDrawer` (`client/src/pages/navigation/MovementReportDrawer.tsx`) by mapping `points` → the `FixPoint[]` that `buildMovementReport` expects (`{ lat, lng, speed, heading, accuracy, timestamp }` — map `time`→`timestamp`). The drawer already renders the speed/g chart, events, and summary — reuse it as-is.

**Step 3:** Mount `<TripsDrawer unitId={…} />` in `NavigationPage.tsx` behind a TRIPS toggle near the existing session-stats UI. The live active trip updates from the `trip_update` socket (same store as Task 8).

**Step 4:** Verify `cd client && npx tsc --noEmit` + `npx vitest run`. Bump `sw.js` `CACHE_NAME`.

**Step 5: Commit**

```bash
git add client/src/pages/navigation/TripsDrawer.tsx client/src/pages/NavigationPage.tsx client/public/sw.js
git commit -m "feat(trips): Navigation TRIPS drawer reusing MovementReportDrawer"
```

---

## Task 10: Map trip selector + replay wiring

**Files:**
- Modify: `client/src/pages/map/MapPage.tsx` (trip selector → existing PlaybackTrail scrubber)

**Step 1:** Add a trip selector UI (per selected unit, list recent trips via `useUnitTrips`). On select, fetch `useTripDetail(id)`, map `points` into the existing `PlaybackTrail` shape (interface at MapPage ~line 165), set `playbackUnit`/`playbackIdx` to drive the existing scrubber.

**Step 2:** Filter the breadcrumb layer to the selected `trip_id` (the points come pre-scoped from the detail endpoint). Add A (start) / B (end) markers from `start_lat/lng` / `end_lat/lng`, color the polyline by `trip_type` (response gold / patrol gray) or reuse existing speed/accel color modes.

**Step 3:** The active trip polyline grows live from the `unit_position` + `trip_update` frames already on the socket.

**Step 4:** Verify `cd client && npx tsc --noEmit` + `npx vitest run` + `cd client && npx vite build`. Bump `sw.js` `CACHE_NAME`.

**Step 5: Commit**

```bash
git add client/src/pages/map/MapPage.tsx client/public/sw.js
git commit -m "feat(trips): Map trip selector + replay via PlaybackTrail"
```

> MapPage is ~2000+ lines — read the breadcrumb/playback region (lines ~126-310) fully before editing.

---

## Task 11: Audit Trip Log PDF + per-call response-trip line

**Files:**
- Create: `client/src/utils/tripLogPdf.ts` (follow the `recordPdfGenerator` + `recordPosture()` pattern — find: `grep -rn "recordPosture\|recordPdfGenerator" client/src/utils`)
- Modify: the call PDF generator to embed a response-trip line.

**Step 1:** `generateTripLogPdf(trips: Trip[], opts)` — header (unit/officer/shift), a table: type, call#, start/end time+loc, distance (mi), duration, mileage Δ, max speed (mph), harsh (A/B/C). Reuse the existing PDF engine + the `recordPosture()` band for the status posture.

**Step 2:** In the call PDF, add a line for the call's `call_response` trip (query `/dispatch/trips?call_id=…`): *"Unit 12 → scene in 4m12s over 2.1 mi · mileage 84,201→84,203."*

**Step 3:** Visual-verify with the `pdftoppm` recipe (memory `project-call-pdf-posture-integration`). Bump `sw.js`.

**Step 4: Commit**

```bash
git add client/src/utils/tripLogPdf.ts client/src/... client/public/sw.js
git commit -m "feat(trips): audit Trip Log PDF + per-call response-trip line"
```

---

## Task 12: Deploy + manual verification on all three surfaces

**Step 1:** Final full verify:
```bash
npm run typecheck && npm test && cd client && npx tsc --noEmit && npx vitest run && npx vite build && cd ..
```
Expected: all PASS. Confirm `client/public/sw.js` `CACHE_NAME` was bumped.

**Step 2:** Deploy via `git push origin main` (triggers `.github/workflows/deploy.yml` — migrations, worker, proxy, Pages). Migration 0075 was already live-patched in Task 1; the deploy re-apply is continue-on-error.

**Step 3:** Confirm deployed proxy has the `/api/dispatch/trips` rule via `workers_get_worker_code({scriptName:'rmpg-api-proxy'})`.

**Step 4:** Manual verify (Claude-in-Chrome, logged-in browser — WAF blocks curl):
- Drive a unit through `enroute → onscene → cleared`, then simulated movement → idle 6 min.
- **Dispatch:** unit row shows `▶ RESPONSE …` then `▶ PATROL …` then `■ IDLE`.
- **Navigation:** TRIPS drawer lists the chain; tapping a trip opens the Movement Report.
- **Map:** trip selector replays the response leg with A/B markers.
- **DB:** `SELECT trip_type, status, close_reason, distance_m, duration_s FROM unit_trips ORDER BY id DESC LIMIT 10` on `785de7ae` shows a chained, closed CALL_RESPONSE + PATROL.

**Step 5: Commit** any verification fixes; update the design doc status to "Shipped".

---

## Build order & dependencies
1 → 2 → 3 → 4 → 5 (backend complete & testable here) → 6 (API) → 7 (client hook) → 8, 9, 10 (surfaces, parallelizable) → 11 (PDF) → 12 (deploy/verify).

**Tasks 1–5 are the high-risk core and are fully unit-tested.** Tasks 8–11 edit megafiles — read the surrounding code before each edit; reuse existing components (`MovementReportDrawer`, `PlaybackTrail`, the PDF engine) rather than rebuilding.
