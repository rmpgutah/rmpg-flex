# On-Foot (Walking) Detection Automation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when an officer leaves their vehicle (iOS CoreMotion activity attached to GPS breadcrumbs), then automate a dispatch-board badge, an overdue-on-foot safety alert, and per-segment logging.

**Architecture:** iOS apps attach `CMMotionActivity` (`activity` + `activity_confidence`) to every GPS point. The existing `POST /api/dispatch/gps` ingest stores them and runs a pure, debounced transition engine that flips `units.on_foot`, opens/closes `foot_segments` rows. A per-minute cron sweep alerts dispatch (via existing `emitAlert`/AlertHub) when a unit has been on foot past a threshold. Web surfaces read the new `units` columns (the units list endpoint is `SELECT u.*`, so columns flow automatically).

**Tech Stack:** Cloudflare Worker (Hono, D1), vitest (worker tests in `tests/`, client tests in `client/src/**/__tests__`), React 18 + TS, Swift (CoreMotion; built in the USER's Xcode — this Mac only parse-checks via `xcrun swiftc -parse`).

**Design amendments vs the spec (recorded in Task 0):**
1. The safety timer is a **per-minute cron sweep**, not `WelfareWatchDO`. Grounding showed `WelfareWatchDO.handleStart` overwrites its single per-officer watch state, so an on-foot watch would clobber an active call-welfare watch. The Worker already has a `* * * * *` cron with a sweep pattern (`src/index.ts:320`).
2. Migration number is **0102** (0101 is taken by `0101_jail_roster_sources.sql`).
3. Map marker: the heading arrow is **kept** (heading is still meaningful on foot) and a gold `FOOT` mini-badge is added (same pattern as the ClearPathGPS `C` badge), instead of replacing the arrow with a walking glyph.

**Key existing facts (verified):**
- `gps_breadcrumbs` INSERT and `norm()` live in `src/routes/dispatch/gps.ts:16-105`. `norm` is exported as `_normalizePointForTest` and locked by `tests/gpsBreadcrumbNormalize.test.ts`.
- The unit row is selected at `gps.ts:82-83` with an explicit column list — `on_foot` must be added there.
- `units.status` CHECK enum cannot hold an "on foot" value; we use new orthogonal columns.
- `emitAlert(env, type, data)` (`src/utils/alertHub.ts`) fans out to all clients; client voice/toast handling lives in `client/src/hooks/useDispatchVoiceAlerts.ts` (see the `bolo_alert` block at ~line 238).
- Worker vitest: config `vitest.config.ts`, tests in `tests/**/*.test.ts`, run `npx vitest run tests/<file>`.
- Client GPS sender: `client/src/hooks/useGpsTracking.ts` — `QueuedPoint` at line 124, batch POST in `sendBatch` (~line 477), single-point immediate send (~line 550).
- Dispatch board rows: `client/src/components/UnitStatusBoard.tsx` (compact card call_sign ~line 195, table-row call_sign cell ~line 236, `TripBadge` shows badge style).
- Map marker: `buildUnitMarkerContent` in `client/src/pages/map/utils/mapMarkerBuilders.ts:127`; called twice in `client/src/pages/map/hooks/useMapMarkers.ts` (~lines 125 and 142).
- iOS tester GPS post body: `ios/RMPGFlexTester/RMPGFlexTester/BackgroundDuty.swift:80-87`.
- Capacitor app native dir: `client/ios/App/App/` (AppDelegate.swift, VolumeButtonHandler.swift — the established native→web bridge pattern is *injecting events into the WKWebView*, not Capacitor plugins).

---

### Task 0: Spec amendments

**Files:**
- Modify: `docs/superpowers/specs/2026-06-12-on-foot-detection-design.md`

- [ ] **Step 1: Update the spec to match the grounded design**

In Part 3 item 2, replace the sentence about WelfareWatchDO with:

```markdown
2. **Officer-safety timer:** a per-minute cron sweep (existing `* * * * *`
   trigger in src/index.ts) finds units with `on_foot = 1`,
   `on_foot_alerted = 0`, and `on_foot_since` older than 5 minutes, fires
   `emitAlert('officer_on_foot_overdue', {...})`, and sets
   `on_foot_alerted = 1` (re-armed on the next ON_FOOT transition).
   WelfareWatchDO was NOT used: its handleStart() overwrites the single
   per-officer watch state, which would clobber an active call-welfare
   watch for the same officer.
```

In Part 4, replace the map bullet with:

```markdown
- **Map (MapPage unit markers):** heading arrow kept (still meaningful on
  foot); a gold `FOOT` mini-badge (ClearPathGPS-badge pattern) marks
  on-foot units.
```

In Part 5, change "~0101" to "0102" (0101 = jail_roster_sources).

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-06-12-on-foot-detection-design.md
git commit -m "spec: on-foot detection — cron sweep instead of WelfareWatchDO; migration 0102"
```

---

### Task 1: Migration 0102

**Files:**
- Create: `migrations/0102_on_foot_detection.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0102: On-foot (walking) detection — CoreMotion activity on breadcrumbs,
-- orthogonal on-foot state on units, and per-segment logging.
-- D1 has no IF NOT EXISTS for ADD COLUMN; re-apply failures are expected
-- and reconciled by the boot reconciler (see migrations/README.md).

ALTER TABLE gps_breadcrumbs ADD COLUMN activity TEXT;
ALTER TABLE gps_breadcrumbs ADD COLUMN activity_confidence TEXT;

ALTER TABLE units ADD COLUMN on_foot INTEGER DEFAULT 0;
ALTER TABLE units ADD COLUMN on_foot_since TEXT;
ALTER TABLE units ADD COLUMN on_foot_source TEXT;
ALTER TABLE units ADD COLUMN on_foot_alerted INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS foot_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER,
  unit_id INTEGER,
  call_sign TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  start_lat REAL,
  start_lng REAL,
  end_lat REAL,
  end_lng REAL,
  duration_s INTEGER,
  distance_m REAL,
  peak_activity TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_foot_segments_officer ON foot_segments(officer_id);
CREATE INDEX IF NOT EXISTS idx_foot_segments_unit ON foot_segments(unit_id);
CREATE INDEX IF NOT EXISTS idx_foot_segments_started ON foot_segments(started_at);
```

- [ ] **Step 2: Apply locally and verify**

Run: `npm run migrate:local`
Expected: applies (or fails only on already-existing columns if re-run).
Then: `npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM pragma_table_info('units') WHERE name LIKE 'on_foot%'"`
Expected: 4 rows (`on_foot`, `on_foot_since`, `on_foot_source`, `on_foot_alerted`).

- [ ] **Step 3: Commit**

```bash
git add migrations/0102_on_foot_detection.sql
git commit -m "feat(dispatch): migration 0102 — on-foot detection columns + foot_segments"
```

> **Post-merge reminder (NOT part of this task):** apply this DDL directly to
> live D1 `785de7ae-3e7a-4e01-93bb-d24ddd813f6b` via the Cloudflare D1 API and
> verify with `pragma_table_info` — the deploy migration step is
> `continue-on-error` and historically silent-fails. Covered in Task 13.

---

### Task 2: Pure detection engine (TDD)

**Files:**
- Create: `src/utils/onFootDetection.ts`
- Test: `tests/onFootDetection.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { classifyActivity, detectTransition, type ActivityPoint } from '../src/utils/onFootDetection';

const pt = (activity: string | null, conf: string | null = 'high'): ActivityPoint =>
  ({ activity, activity_confidence: conf });

describe('classifyActivity', () => {
  it('walking/running at medium+ confidence → on_foot', () => {
    expect(classifyActivity(pt('walking', 'high'))).toBe('on_foot');
    expect(classifyActivity(pt('walking', 'medium'))).toBe('on_foot');
    expect(classifyActivity(pt('running', 'high'))).toBe('on_foot');
  });
  it('automotive at medium+ confidence → in_vehicle', () => {
    expect(classifyActivity(pt('automotive', 'high'))).toBe('in_vehicle');
    expect(classifyActivity(pt('automotive', 'medium'))).toBe('in_vehicle');
  });
  it('low confidence, stationary, cycling, unknown, missing → unknown', () => {
    expect(classifyActivity(pt('walking', 'low'))).toBe('unknown');
    expect(classifyActivity(pt('stationary'))).toBe('unknown');
    expect(classifyActivity(pt('cycling'))).toBe('unknown');
    expect(classifyActivity(pt('unknown'))).toBe('unknown');
    expect(classifyActivity(pt(null))).toBe('unknown');
    expect(classifyActivity({})).toBe('unknown');
  });
});

describe('detectTransition (debounced)', () => {
  it('fires ON_FOOT only after 2+ consecutive on-foot points', () => {
    expect(detectTransition('in_vehicle', [pt('walking'), pt('walking')])).toBe('ON_FOOT');
    expect(detectTransition('in_vehicle', [pt('automotive'), pt('walking')])).toBe(null);
    expect(detectTransition('in_vehicle', [pt('walking')])).toBe(null); // single ping
  });
  it('fires BACK_IN_VEHICLE only after 2+ consecutive automotive points', () => {
    expect(detectTransition('on_foot', [pt('automotive'), pt('automotive')])).toBe('BACK_IN_VEHICLE');
    expect(detectTransition('on_foot', [pt('walking'), pt('automotive')])).toBe(null);
  });
  it('never transitions on unknowns (stoplight: stationary in car)', () => {
    expect(detectTransition('in_vehicle', [pt('stationary'), pt('stationary')])).toBe(null);
    expect(detectTransition('on_foot', [pt('stationary'), pt('stationary')])).toBe(null);
    expect(detectTransition('in_vehicle', [])).toBe(null);
  });
  it('no-op when already in the detected state', () => {
    expect(detectTransition('on_foot', [pt('walking'), pt('walking')])).toBe(null);
    expect(detectTransition('in_vehicle', [pt('automotive'), pt('automotive')])).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/onFootDetection.test.ts`
Expected: FAIL — module `../src/utils/onFootDetection` not found.

- [ ] **Step 3: Implement the engine**

```ts
// ============================================================
// RMPG Flex — on-foot detection engine (pure functions)
// ============================================================
// Classifies iOS CoreMotion activity attached to GPS breadcrumbs and
// debounces state transitions so a stoplight (stationary) or a single
// noisy ping never flips a unit. The stateful runner that applies
// transitions to D1 lives in this file too (runOnFootTransition) but
// only the pure functions are unit-tested.

export type FootState = 'on_foot' | 'in_vehicle' | 'unknown';
export type Transition = 'ON_FOOT' | 'BACK_IN_VEHICLE';

export interface ActivityPoint {
  activity?: string | null;
  activity_confidence?: string | null;
}

/** Points required in the SAME state before a transition fires (~20 s at
 *  the apps' ping cadence). */
export const DEBOUNCE_POINTS = 2;

export function classifyActivity(p: ActivityPoint): FootState {
  const conf = (p.activity_confidence || '').toLowerCase();
  if (conf !== 'medium' && conf !== 'high') return 'unknown';
  const a = (p.activity || '').toLowerCase();
  if (a === 'walking' || a === 'running') return 'on_foot';
  if (a === 'automotive') return 'in_vehicle';
  return 'unknown'; // stationary (could be standing OR stopped car), cycling, unknown
}

/**
 * Debounced transition decision. `recent` = the most recent points,
 * chronological order not required (every one must agree anyway).
 */
export function detectTransition(prev: 'on_foot' | 'in_vehicle', recent: ActivityPoint[]): Transition | null {
  if (recent.length < DEBOUNCE_POINTS) return null;
  const states = recent.slice(-DEBOUNCE_POINTS).map(classifyActivity);
  if (states.every((s) => s === 'on_foot') && prev !== 'on_foot') return 'ON_FOOT';
  if (states.every((s) => s === 'in_vehicle') && prev !== 'in_vehicle') return 'BACK_IN_VEHICLE';
  return null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/onFootDetection.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/utils/onFootDetection.ts tests/onFootDetection.test.ts
git commit -m "feat(dispatch): pure on-foot detection engine (classify + debounced transitions)"
```

---

### Task 3: GPS ingest — store activity + run transitions

**Files:**
- Modify: `src/routes/dispatch/gps.ts` (norm at :16-28, unit SELECT at :82-83, INSERT at :101-105, hook after the units mirror at :117)
- Modify: `src/utils/onFootDetection.ts` (add the stateful runner)
- Test: `tests/gpsBreadcrumbNormalize.test.ts` (extend)

- [ ] **Step 1: Extend the norm() contract test (failing first)**

Append to `tests/gpsBreadcrumbNormalize.test.ts`:

```ts
it('passes through CoreMotion activity fields', () => {
  const n = normalizePoint({ lat: 40.7, lng: -111.9, activity: 'walking', activity_confidence: 'high' });
  expect(n.activity).toBe('walking');
  expect(n.activity_confidence).toBe('high');
});

it('omits activity fields when absent (web clients)', () => {
  const n = normalizePoint({ lat: 40.7, lng: -111.9 });
  expect(n.activity).toBeUndefined();
  expect(n.activity_confidence).toBeUndefined();
});
```

NOTE: that file imports the helper aliased as `normalizePoint`
(`import { _normalizePointForTest as normalizePoint } from '../src/routes/dispatch/gps';`)
— use `normalizePoint` (as above), NOT `_normalizePointForTest`. Add these
two `it(...)` blocks INSIDE the existing `describe(...)` block.

Run: `npx vitest run tests/gpsBreadcrumbNormalize.test.ts` — Expected: FAIL (fields undefined on first test).

- [ ] **Step 2: Extend norm() and the INSERT**

In `norm()`'s return type add `activity?: string; activity_confidence?: string;` and in the body:

```ts
    activity: typeof pt.activity === 'string' ? pt.activity : undefined,
    activity_confidence: typeof pt.activity_confidence === 'string' ? pt.activity_confidence : undefined,
```

Change the batch INSERT (gps.ts:101-105) to:

```ts
    const stmts = points.map((pt) => ({
      sql: `INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude, accuracy, heading, speed, call_sign, activity, activity_confidence, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      bindings: [unitId, userId, pt.latitude, pt.longitude, pt.accuracy ?? null, pt.heading ?? null, pt.speed ?? null, callSign, pt.activity ?? null, pt.activity_confidence ?? null],
    }));
```

(10 columns + datetime literal = 10 placeholders — count them.)

Add `on_foot` to the unit SELECT at gps.ts:82-83:

```ts
    const unit = await queryFirst<{ id: number; call_sign: string; status: string; gps_source: string | null; vehicle_id: string | null; on_foot: number | null }>(db,
      'SELECT id, call_sign, status, gps_source, vehicle_id, current_call_id, on_foot FROM units WHERE officer_id = ? LIMIT 1', userId);
```

Run: `npx vitest run tests/gpsBreadcrumbNormalize.test.ts` — Expected: PASS.

- [ ] **Step 3: Add the stateful runner to onFootDetection.ts**

First, add these imports at the **TOP** of `src/utils/onFootDetection.ts`
(ES module imports must be top-level, not mid-file):

```ts
import type { D1Database } from '@cloudflare/workers-types';
import { query, queryFirst, execute } from './db';
import { haversineM } from './tripTelemetry';
```

Then append the runner below the pure functions:

```ts
// ── Stateful runner (called from the gps ingest, best-effort) ──
interface RunArgs {
  unitId: number;
  officerId: number;
  callSign: string | null;
  prevOnFoot: boolean;
  lastLat: number;
  lastLng: number;
  source: string | null;
}

/**
 * Reads the last DEBOUNCE_POINTS breadcrumbs' activity for the unit,
 * decides a transition, and applies it: units flags + foot_segments
 * open/close. Returns the transition applied (or null).
 */
export async function runOnFootTransition(db: D1Database, a: RunArgs): Promise<Transition | null> {
  const recent = await query<ActivityPoint>(db,
    `SELECT activity, activity_confidence FROM gps_breadcrumbs
     WHERE unit_id = ? AND activity IS NOT NULL ORDER BY id DESC LIMIT ?`,
    a.unitId, DEBOUNCE_POINTS);
  // query returns newest-first; detectTransition only needs agreement.
  const t = detectTransition(a.prevOnFoot ? 'on_foot' : 'in_vehicle', recent);
  if (!t) return null;

  if (t === 'ON_FOOT') {
    await execute(db,
      `UPDATE units SET on_foot = 1, on_foot_since = datetime('now'),
         on_foot_source = ?, on_foot_alerted = 0, updated_at = datetime('now') WHERE id = ?`,
      a.source ?? 'coremotion', a.unitId);
    await execute(db,
      `INSERT INTO foot_segments (officer_id, unit_id, call_sign, start_lat, start_lng)
       VALUES (?, ?, ?, ?, ?)`,
      a.officerId, a.unitId, a.callSign, a.lastLat, a.lastLng);
    return t;
  }

  // BACK_IN_VEHICLE — close the open segment, clear the unit flags.
  const open = await queryFirst<{ id: number; started_at: string; start_lat: number | null; start_lng: number | null }>(db,
    `SELECT id, started_at, start_lat, start_lng FROM foot_segments
     WHERE unit_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1`, a.unitId);
  if (open) {
    const peak = await queryFirst<{ n: number }>(db,
      `SELECT COUNT(*) AS n FROM gps_breadcrumbs
       WHERE unit_id = ? AND activity = 'running' AND recorded_at >= ?`,
      a.unitId, open.started_at);
    const dist = (open.start_lat != null && open.start_lng != null)
      ? haversineM(open.start_lat, open.start_lng, a.lastLat, a.lastLng) : null;
    await execute(db,
      `UPDATE foot_segments SET ended_at = datetime('now'), end_lat = ?, end_lng = ?,
         duration_s = CAST((julianday(datetime('now')) - julianday(started_at)) * 86400 AS INTEGER),
         distance_m = ?, peak_activity = ? WHERE id = ?`,
      a.lastLat, a.lastLng, dist, (peak?.n ?? 0) > 0 ? 'running' : 'walking', open.id);
  }
  await execute(db,
    `UPDATE units SET on_foot = 0, on_foot_since = NULL, updated_at = datetime('now') WHERE id = ?`,
    a.unitId);
  return t;
}
```

(`haversineM` and the db helpers already exist — gps.ts imports both today. `distance_m` is straight-line start→end; documented approximation, YAGNI on breadcrumb-summing.)

- [ ] **Step 4: Hook into the gps handler**

In `gps.ts`, after the units-mirror UPDATE block (ends line ~117) and BEFORE the "GPS auto status transitions" comment, insert:

```ts
    // ── On-foot detection (CoreMotion activity) ──────────────
    // Only runs when this batch carried activity data (native iOS apps);
    // best-effort — never blocks the breadcrumb write.
    if (unitId && unit && lastPt && points.some((p) => p.activity)) {
      try {
        const { runOnFootTransition } = await import('../../utils/onFootDetection');
        const t = await runOnFootTransition(db, {
          unitId,
          officerId: userId,
          callSign,
          prevOnFoot: unit.on_foot === 1,
          lastLat: lastPt.latitude,
          lastLng: lastPt.longitude,
          source: lastPt.source ?? null,
        });
        if (t) console.log(`[gps] unit ${callSign} on-foot transition: ${t}`);
      } catch (err) {
        console.error('[gps] on-foot detection failed (non-fatal)', err);
      }
    }
```

- [ ] **Step 5: Typecheck + full worker tests**

Run: `npm run typecheck && npx vitest run`
Expected: clean / all pass.

- [ ] **Step 6: Commit**

```bash
git add src/routes/dispatch/gps.ts src/utils/onFootDetection.ts tests/gpsBreadcrumbNormalize.test.ts
git commit -m "feat(dispatch): store CoreMotion activity on breadcrumbs + on-foot transitions on ingest"
```

---

### Task 4: Overdue-on-foot cron sweep (TDD)

**Files:**
- Create: `src/utils/onFootSweep.ts`
- Modify: `src/index.ts` (the `event.cron === '* * * * *'` block at :320 — follow the `intelWatchlist` dynamic-import pattern at :331-337)
- Test: `tests/onFootSweep.test.ts`

- [ ] **Step 1: Write the failing test (pure decision fn)**

```ts
import { describe, it, expect } from 'vitest';
import { findOverdueOnFoot, ON_FOOT_OVERDUE_MS } from '../src/utils/onFootSweep';

// on_foot_since is written by D1 datetime('now') → UTC 'YYYY-MM-DD HH:MM:SS'.
const utc = (msAgo: number) =>
  new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace('T', ' ');

const row = (msAgo: number, alerted = 0) => ({
  id: 1, call_sign: 'D19', officer_name: 'Smith',
  on_foot_since: utc(msAgo), on_foot_alerted: alerted,
  latitude: 40.7, longitude: -111.9,
});

describe('findOverdueOnFoot', () => {
  it('flags units on foot past the threshold', () => {
    expect(findOverdueOnFoot([row(6 * 60_000)], Date.now())).toHaveLength(1);
  });
  it('skips units under the threshold', () => {
    expect(findOverdueOnFoot([row(3 * 60_000)], Date.now())).toHaveLength(0);
  });
  it('skips already-alerted units', () => {
    expect(findOverdueOnFoot([row(10 * 60_000, 1)], Date.now())).toHaveLength(0);
  });
  it('skips rows with missing/garbage timestamps', () => {
    expect(findOverdueOnFoot([{ ...row(0), on_foot_since: null } as any], Date.now())).toHaveLength(0);
    expect(findOverdueOnFoot([{ ...row(0), on_foot_since: 'bogus' } as any], Date.now())).toHaveLength(0);
  });
  it('threshold is 5 minutes', () => {
    expect(ON_FOOT_OVERDUE_MS).toBe(5 * 60_000);
  });
});
```

Run: `npx vitest run tests/onFootSweep.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 2: Implement the sweep**

```ts
// ============================================================
// RMPG Flex — overdue-on-foot safety sweep (per-minute cron)
// ============================================================
// Finds units that have been on foot past the threshold without
// returning to their vehicle, raises an officer-safety alert via
// AlertHub, and marks the unit alerted (re-armed on the next
// ON_FOOT transition by runOnFootTransition).

import type { D1Database } from '@cloudflare/workers-types';
import { query, execute } from './db';
import { emitAlert } from './alertHub';

export const ON_FOOT_OVERDUE_MS = 5 * 60_000;

export interface OnFootRow {
  id: number;
  call_sign: string;
  officer_name: string | null;
  on_foot_since: string | null; // UTC 'YYYY-MM-DD HH:MM:SS'
  on_foot_alerted: number;
  latitude: number | null;
  longitude: number | null;
}

/** Pure: which rows are overdue as of nowMs. */
export function findOverdueOnFoot(rows: OnFootRow[], nowMs: number, thresholdMs = ON_FOOT_OVERDUE_MS): OnFootRow[] {
  return rows.filter((r) => {
    if (r.on_foot_alerted) return false;
    if (!r.on_foot_since) return false;
    const t = Date.parse(r.on_foot_since.replace(' ', 'T') + 'Z');
    if (!Number.isFinite(t)) return false;
    return nowMs - t >= thresholdMs;
  });
}

interface SweepEnv { ALERT_HUB?: DurableObjectNamespace }

export async function sweepOnFootOverdue(db: D1Database, env: SweepEnv): Promise<number> {
  const rows = await query<OnFootRow>(db, `
    SELECT u.id, u.call_sign, usr.full_name AS officer_name,
           u.on_foot_since, u.on_foot_alerted, u.latitude, u.longitude
    FROM units u LEFT JOIN users usr ON usr.id = u.officer_id
    WHERE u.on_foot = 1 AND u.on_foot_alerted = 0`);
  const overdue = findOverdueOnFoot(rows, Date.now());
  for (const r of overdue) {
    const mins = Math.round((Date.now() - Date.parse(r.on_foot_since!.replace(' ', 'T') + 'Z')) / 60_000);
    await emitAlert(env, 'officer_on_foot_overdue', {
      action: 'on_foot_overdue',
      call_sign: r.call_sign,
      officer_name: r.officer_name,
      minutes: mins,
      on_foot_since: r.on_foot_since,
      latitude: r.latitude,
      longitude: r.longitude,
    });
    await execute(db, 'UPDATE units SET on_foot_alerted = 1 WHERE id = ?', r.id);
  }
  return overdue.length;
}
```

Run: `npx vitest run tests/onFootSweep.test.ts` — Expected: PASS.

- [ ] **Step 3: Wire into the per-minute cron**

In `src/index.ts`, inside the `if (event.cron === '* * * * *') {` block, after the intel-screen sweep `ctx.waitUntil(...)`, add:

```ts
      // Officer-safety: on-foot overdue sweep — alerts dispatch when a
      // unit has been on foot past the threshold. Cheap when none are.
      ctx.waitUntil(
        import('./utils/onFootSweep')
          .then(({ sweepOnFootOverdue }) => sweepOnFootOverdue(env.DB, env))
          .then((n) => { if (n) console.log(`[on-foot] ${n} overdue alert(s)`); })
          .catch((err) => console.error('[on-foot] sweep failed:', err)),
      );
```

- [ ] **Step 4: Typecheck + tests + commit**

Run: `npm run typecheck && npx vitest run` — Expected: clean.

```bash
git add src/utils/onFootSweep.ts tests/onFootSweep.test.ts src/index.ts
git commit -m "feat(dispatch): per-minute overdue-on-foot safety sweep → AlertHub"
```

---

### Task 5: Foot-segments read endpoint

**Files:**
- Modify: `src/routes/dispatch/gps.ts` (add route after the breadcrumb POST handler)

- [ ] **Step 1: Add the endpoint**

```ts
// GET /dispatch/gps/on-foot-segments?unit_id=&officer_id=&limit=
// Recent on-foot segments for after-action review. ended_at IS NULL
// means the segment is still open (officer currently on foot).
gps.get('/on-foot-segments', async (c) => {
  try {
    const db = getDb(c.env);
    const unitId = c.req.query('unit_id');
    const officerId = c.req.query('officer_id');
    const limit = Math.min(Number(c.req.query('limit')) || 25, 200);
    let sql = `SELECT id, officer_id, unit_id, call_sign, started_at, ended_at,
                      start_lat, start_lng, end_lat, end_lng, duration_s, distance_m, peak_activity
               FROM foot_segments WHERE 1=1`;
    const params: unknown[] = [];
    if (unitId) { sql += ' AND unit_id = ?'; params.push(unitId); }
    if (officerId) { sql += ' AND officer_id = ?'; params.push(officerId); }
    sql += ' ORDER BY started_at DESC LIMIT ?'; params.push(limit);
    const rows = await query<Record<string, unknown>>(db, sql, ...params);
    return c.json({ data: rows, count: rows.length });
  } catch {
    return c.json({ data: [], count: 0, error: 'Failed to list foot segments' }, 500);
  }
});
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck` — Expected: clean.

```bash
git add src/routes/dispatch/gps.ts
git commit -m "feat(dispatch): GET /dispatch/gps/on-foot-segments"
```

---

### Task 6: Client types, alert registration, OnFootBadge (TDD)

**Files:**
- Modify: `client/src/types/index.ts` (Unit interface at :427; WSMessage type union at :1904)
- Modify: `client/src/utils/alertSeverity.ts` (MODERATE_EVENTS set at :44)
- Create: `client/src/components/OnFootBadge.tsx`
- Test: `client/src/components/__tests__/OnFootBadge.test.tsx`

- [ ] **Step 1: Types + severity registration**

In the `Unit` interface (near `gps_heading?: number | null;` at :454) add:

```ts
  /** On-foot (walking) detection — orthogonal to status. 1/true while the
   *  officer is detected out of the vehicle (CoreMotion). */
  on_foot?: number | boolean | null;
  on_foot_since?: string | null;
```

In the WS message type union (after `'panic_escalated'` at ~:1911) add:

```ts
  | 'officer_on_foot_overdue'
```

In `alertSeverity.ts` MODERATE_EVENTS add `'officer_on_foot_overdue',` after `'backup_request',`.

- [ ] **Step 2: Failing badge test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import OnFootBadge from '../OnFootBadge';

describe('OnFootBadge', () => {
  it('renders ON FOOT with elapsed minutes', () => {
    const since = new Date(Date.now() - 4 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
    render(<OnFootBadge since={since} />);
    expect(screen.getByText(/ON FOOT/)).toBeTruthy();
    expect(screen.getByText(/4m/)).toBeTruthy();
  });
  it('renders without elapsed when since is missing', () => {
    render(<OnFootBadge since={null} />);
    expect(screen.getByText('ON FOOT')).toBeTruthy();
  });
  it('fires onClick', () => {
    const fn = vi.fn();
    render(<OnFootBadge since={null} onClick={fn} />);
    screen.getByText('ON FOOT').click();
    expect(fn).toHaveBeenCalled();
  });
});
```

Run: `cd client && npx vitest run src/components/__tests__/OnFootBadge.test.tsx`
Expected: FAIL (component missing).

- [ ] **Step 3: Implement the badge**

```tsx
// ON FOOT badge — shown on the dispatch board / unit surfaces while a
// unit's officer is detected out of the vehicle (units.on_foot = 1).
// Brand-gold, 9px mono, no pill (Spillman tokens). Click opens the
// unit's on-foot activity history when an onClick is provided.
import { parseTimestamp } from '../utils/dateUtils';

export default function OnFootBadge({ since, onClick }: { since?: string | null; onClick?: () => void }) {
  let elapsed = '';
  if (since) {
    const mins = Math.max(0, Math.floor((Date.now() - parseTimestamp(since).getTime()) / 60_000));
    elapsed = ` ${mins}m`;
  }
  return (
    <span
      className="inline-flex items-center gap-0.5 px-1 py-0 text-[9px] font-black font-mono uppercase tracking-wider cursor-pointer"
      style={{ color: '#d4a017', border: '1px solid #d4a01740', background: '#d4a01712' }}
      title={`Officer detected on foot${since ? ` since ${since}` : ''} — click for history`}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
    >
      ON FOOT{elapsed && <span className="tabular-nums">{elapsed}</span>}
    </span>
  );
}
```

Run: `cd client && npx vitest run src/components/__tests__/OnFootBadge.test.tsx`
Expected: PASS. (If `parseTimestamp` handles the UTC `'YYYY-MM-DD HH:MM:SS'` shape — it's the board's standard parser, used by `getGpsStaleStatus` for the same-format `gps_updated_at`.)

- [ ] **Step 4: Commit**

```bash
git add client/src/types/index.ts client/src/utils/alertSeverity.ts client/src/components/OnFootBadge.tsx client/src/components/__tests__/OnFootBadge.test.tsx
git commit -m "feat(client): on-foot Unit fields, alert type registration, OnFootBadge"
```

---

### Task 7: Board wiring + segments modal

**Files:**
- Create: `client/src/components/OnFootActivityModal.tsx`
- Modify: `client/src/components/UnitStatusBoard.tsx` (compact card call_sign div at ~:195; table-row call_sign cell flex at ~:236)

- [ ] **Step 1: Segments modal**

```tsx
// Compact on-foot history for one unit — fed by
// GET /dispatch/gps/on-foot-segments. Opened by clicking an OnFootBadge.
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import type { Unit } from '../types';

interface Segment {
  id: number; started_at: string; ended_at: string | null;
  duration_s: number | null; distance_m: number | null; peak_activity: string | null;
}

export default function OnFootActivityModal({ unit, onClose }: { unit: Unit; onClose: () => void }) {
  const [rows, setRows] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    apiFetch<{ data: Segment[] }>(`/dispatch/gps/on-foot-segments?unit_id=${unit.id}&limit=25`)
      .then((d) => setRows(Array.isArray(d?.data) ? d.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [unit.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="w-[420px] max-h-[70vh] overflow-auto border border-[#222222] bg-[#0a0a0a] p-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: '#d4a017' }}>
            ON-FOOT ACTIVITY — {unit.call_sign}
          </span>
          <button aria-label="Close" onClick={onClose}><X className="w-3.5 h-3.5 text-gray-400" /></button>
        </div>
        {loading ? <div className="text-[10px] text-gray-500">Loading…</div> : rows.length === 0 ? (
          <div className="text-[10px] text-gray-500">No on-foot segments recorded.</div>
        ) : (
          <table className="table-dark w-full">
            <thead><tr><th>Started</th><th>Duration</th><th>Distance</th><th>Peak</th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="font-mono text-[10px]">{s.started_at}</td>
                  <td className="font-mono text-[10px]">{s.ended_at == null ? 'ACTIVE' : s.duration_s != null ? `${Math.round(s.duration_s / 60)}m` : '—'}</td>
                  <td className="font-mono text-[10px]">{s.distance_m != null ? `${Math.round(s.distance_m)} m` : '—'}</td>
                  <td className="font-mono text-[10px] uppercase">{s.peak_activity || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into UnitStatusBoard**

At the top of `UnitStatusBoard.tsx` add imports + local state:

```tsx
import OnFootBadge from './OnFootBadge';
import OnFootActivityModal from './OnFootActivityModal';
```

Inside the component body (after existing hooks):

```tsx
  const [footUnit, setFootUnit] = useState<Unit | null>(null);
```

(add `useState` to the existing React import.)

Helper next to `isEmergency`:

```tsx
function isOnFoot(unit: Unit): boolean {
  return unit.on_foot === 1 || unit.on_foot === true;
}
```

**Compact card** — directly after the call_sign line
`<div className="text-xs font-bold text-white font-mono truncate">{unit.call_sign}</div>` (~:195), insert:

```tsx
              {isOnFoot(unit) && <OnFootBadge since={unit.on_foot_since} onClick={() => setFootUnit(unit)} />}
```

**Table row** — inside the call_sign cell's flex div, after the `EMER` badge's closing `)}` (~:245), insert:

```tsx
                  {isOnFoot(unit) && <OnFootBadge since={unit.on_foot_since} onClick={() => setFootUnit(unit)} />}
```

At the end of the component's returned JSX (both render paths share the table return; place the modal just inside the outermost `<div className="overflow-auto scrollbar-dark">` close), add:

```tsx
      {footUnit && <OnFootActivityModal unit={footUnit} onClose={() => setFootUnit(null)} />}
```

(Also add it to the compact-mode return's wrapper so the badge works in both modes.)

- [ ] **Step 3: Typecheck + client tests + commit**

Run: `cd client && npx tsc --noEmit && npx vitest run` — Expected: clean / all pass.

```bash
git add client/src/components/OnFootActivityModal.tsx client/src/components/UnitStatusBoard.tsx
git commit -m "feat(client): ON FOOT badge on the unit board + on-foot activity modal"
```

---

### Task 8: Map marker FOOT badge

**Files:**
- Modify: `client/src/pages/map/utils/mapMarkerBuilders.ts` (`buildUnitMarkerContent` at :127)
- Modify: `client/src/pages/map/hooks/useMapMarkers.ts` (both call sites, ~:125 update and ~:142 create)

- [ ] **Step 1: Extend the builder**

Change the signature to:

```ts
export function buildUnitMarkerContent(callSign: string, status: UnitStatus, _gpsSource?: string, heading?: number | null, speed?: number | null, onFoot?: boolean): HTMLElement {
```

After the `srcBadge` block (`tag.appendChild(srcBadge);`), add:

```ts
  // On-foot indicator — gold FOOT mini-badge (same pattern as the
  // ClearPathGPS 'C' badge). Heading arrow stays: direction is still
  // meaningful while walking.
  if (onFoot) {
    const footBadge = document.createElement('span');
    footBadge.setAttribute('data-unit-foot', '');
    footBadge.style.cssText = 'position:absolute;top:-12px;left:-2px;font-size:6px;font-weight:900;font-family:monospace;color:#d4a017;text-shadow:0 0 4px #d4a01780;letter-spacing:0.5px;';
    footBadge.textContent = 'FOOT';
    tag.appendChild(footBadge);
  }
```

- [ ] **Step 2: Pass the flag at both call sites**

In `useMapMarkers.ts`, both `buildUnitMarkerContent(unit.call_sign, unit.status, unit.gps_source, unit.gps_heading)` calls become:

```ts
buildUnitMarkerContent(unit.call_sign, unit.status, unit.gps_source, unit.gps_heading, undefined, unit.on_foot === 1 || unit.on_foot === true)
```

(5th param `speed` stays undefined — matches today's behavior.)

- [ ] **Step 3: Typecheck + commit**

Run: `cd client && npx tsc --noEmit` — Expected: clean.

```bash
git add client/src/pages/map/utils/mapMarkerBuilders.ts client/src/pages/map/hooks/useMapMarkers.ts
git commit -m "feat(map): gold FOOT badge on unit markers while on foot"
```

---

### Task 9: Voice/toast alert handling

**Files:**
- Modify: `client/src/hooks/useDispatchVoiceAlerts.ts` (add a subscribe block after the `bolo_alert` block at ~:238-258)

- [ ] **Step 1: Add the subscription**

Follow the bolo block's exact local style (`unsubs.push(subscribe(...))`, `nextAlertId()`, `speak`, `onAlert`):

```ts
    // ── Officer on foot overdue (safety sweep) ──
    unsubs.push(
      subscribe('officer_on_foot_overdue', (msg) => {
        const data = ((msg as any).data || msg) as any;
        const cs = data.call_sign || 'Unit';
        const mins = data.minutes ?? 5;
        if (isEdgeTTSEnabled()) {
          speak(`${cs} has been on foot for over ${mins} minutes. Check officer status.`, 'moderate');
        }
        onAlert?.({
          id: nextAlertId(),
          severity: 'moderate',
          title: 'OFFICER ON FOOT',
          message: `${cs} on foot over ${mins} min${data.officer_name ? ` — ${data.officer_name}` : ''}`,
          timestamp: Date.now(),
        });
      })
    );
```

(If `speak`'s second arg differs in that file's bolo block, mirror whatever the bolo block passes.)

- [ ] **Step 2: Typecheck + commit**

Run: `cd client && npx tsc --noEmit` — Expected: clean.

```bash
git add client/src/hooks/useDispatchVoiceAlerts.ts
git commit -m "feat(client): voice + alert-feed handling for officer_on_foot_overdue"
```

---

### Task 10: Web GPS sender — attach activity

**Files:**
- Modify: `client/src/hooks/useGpsTracking.ts` (QueuedPoint at :124; `sendBatch` POST body at ~:477; immediate send at ~:550)

- [ ] **Step 1: Extend QueuedPoint + module-level activity holder**

Add to `QueuedPoint`:

```ts
  activity?: string | null;
  activity_confidence?: string | null;
```

Below the interface (module scope), add:

```ts
// ── CoreMotion activity bridge (native iOS only) ─────────────
// The Capacitor MotionActivityBridge dispatches 'rmpg-motion-activity'
// CustomEvents into the WebView. Web/desktop browsers never fire it,
// so points stay activity-free there. Stamped at send time: a flush
// window (~15-30 s) is within the server's debounce granularity.
let latestMotionActivity: { activity: string; confidence: string; at: number } | null = null;
const MOTION_ACTIVITY_FRESH_MS = 30_000;
if (typeof window !== 'undefined') {
  window.addEventListener('rmpg-motion-activity', ((e: CustomEvent) => {
    const d = e.detail || {};
    if (typeof d.activity === 'string' && typeof d.confidence === 'string') {
      latestMotionActivity = { activity: d.activity, confidence: d.confidence, at: Date.now() };
    }
  }) as EventListener);
}

function stampActivity<T extends { activity?: string | null; activity_confidence?: string | null }>(points: T[]): T[] {
  const m = latestMotionActivity;
  if (!m || Date.now() - m.at > MOTION_ACTIVITY_FRESH_MS) return points;
  return points.map((p) => ({ ...p, activity: m.activity, activity_confidence: m.confidence }));
}
```

- [ ] **Step 2: Stamp at both send sites**

In `sendBatch` (~:477), change the body line to:

```ts
          body: JSON.stringify({ points: stampActivity(allPoints), device_type: IS_DESKTOP ? 'desktop' : 'mobile' }),
```

In the immediate single-point send (~:550):

```ts
        body: JSON.stringify({ points: stampActivity([point]), device_type: IS_DESKTOP ? 'desktop' : 'mobile' }),
```

- [ ] **Step 3: Typecheck + full client tests + commit**

Run: `cd client && npx tsc --noEmit && npx vitest run` — Expected: clean / pass.

```bash
git add client/src/hooks/useGpsTracking.ts
git commit -m "feat(client): stamp CoreMotion activity onto GPS batches (native bridge event)"
```

---

### Task 11: Capacitor app — native motion bridge (Swift)

**Files:**
- Create: `client/ios/App/App/MotionActivityBridge.swift`
- Modify: `client/ios/App/App/AppDelegate.swift`
- Modify: `client/ios/App/App/Info.plist`

> Swift here is parse-checked only (`xcrun swiftc -parse`); the USER builds in
> Xcode (this Mac's xcodebuild is wedged — known issue). The user must also add
> the new .swift file to the Xcode target.

- [ ] **Step 1: The bridge**

```swift
import CoreMotion
import WebKit

/// Streams Apple's CMMotionActivity classifier into the Capacitor WebView as
/// `rmpg-motion-activity` CustomEvents (same inject-into-WebView pattern as
/// VolumeButtonHandler). The web GPS sender (useGpsTracking) stamps the
/// latest activity onto outgoing breadcrumb batches.
final class MotionActivityBridge {
    static let shared = MotionActivityBridge()
    private let manager = CMMotionActivityManager()
    private weak var webView: WKWebView?

    func attach(to webView: WKWebView) {
        self.webView = webView
        guard CMMotionActivityManager.isActivityAvailable() else { return }
        manager.startActivityUpdates(to: .main) { [weak self] activity in
            guard let a = activity, let wv = self?.webView else { return }
            let kind = a.walking ? "walking"
                : a.running ? "running"
                : a.automotive ? "automotive"
                : a.cycling ? "cycling"
                : a.stationary ? "stationary"
                : "unknown"
            let conf = a.confidence == .high ? "high" : a.confidence == .medium ? "medium" : "low"
            let js = "window.dispatchEvent(new CustomEvent('rmpg-motion-activity',{detail:{activity:'\(kind)',confidence:'\(conf)'}}))"
            wv.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    func stop() { manager.stopActivityUpdates() }
}
```

- [ ] **Step 2: Wire from AppDelegate**

In `AppDelegate.swift`'s `application(_:didFinishLaunchingWithOptions:)`, before `return true`, add (the Capacitor webView isn't ready at launch — resolve it after a short delay, same constraint VolumeButtonHandler documents):

```swift
        // On-foot detection: stream CoreMotion activity into the WebView.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
            if let bridgeVC = self.window?.rootViewController as? CAPBridgeViewController,
               let webView = bridgeVC.bridge?.webView {
                MotionActivityBridge.shared.attach(to: webView)
            }
        }
```

(`import Capacitor` at the top of AppDelegate if not present.)

- [ ] **Step 3: Info.plist**

Add inside the top-level `<dict>`:

```xml
	<key>NSMotionUsageDescription</key>
	<string>Motion activity is used to detect when an officer is on foot for dispatch awareness and officer safety.</string>
```

- [ ] **Step 4: Parse-check + commit**

Run: `xcrun swiftc -parse client/ios/App/App/MotionActivityBridge.swift`
Expected: exits 0 (parse only; imports are not resolved at -parse).

```bash
git add client/ios/App/App/MotionActivityBridge.swift client/ios/App/App/AppDelegate.swift client/ios/App/App/Info.plist
git commit -m "feat(ios): Capacitor CoreMotion bridge → rmpg-motion-activity events"
```

---

### Task 12: Tester app — CoreMotion in native GPS posts

**Files:**
- Create: `ios/RMPGFlexTester/RMPGFlexTester/MotionActivityService.swift`
- Modify: `ios/RMPGFlexTester/RMPGFlexTester/BackgroundDuty.swift` (`pushGps` body at :80-87)
- Modify: the tester's `Info.plist` (add `NSMotionUsageDescription`, same string as Task 11)

- [ ] **Step 1: The service**

```swift
import Foundation
import CoreMotion

/// Publishes the latest CMMotionActivity as (activity, confidence) strings
/// matching the server's gps_breadcrumbs.activity vocabulary.
final class MotionActivityService: ObservableObject {
    static let shared = MotionActivityService()
    private let manager = CMMotionActivityManager()
    @Published private(set) var activity: String = "unknown"
    @Published private(set) var confidence: String = "low"
    private(set) var updatedAt: Date = .distantPast

    func start() {
        guard CMMotionActivityManager.isActivityAvailable() else { return }
        manager.startActivityUpdates(to: .main) { [weak self] a in
            guard let self, let a else { return }
            self.activity = a.walking ? "walking"
                : a.running ? "running"
                : a.automotive ? "automotive"
                : a.cycling ? "cycling"
                : a.stationary ? "stationary"
                : "unknown"
            self.confidence = a.confidence == .high ? "high" : a.confidence == .medium ? "medium" : "low"
            self.updatedAt = Date()
        }
    }

    func stop() { manager.stopActivityUpdates() }

    /// Fields to merge into a GPS post body; empty when stale (>30 s).
    var gpsFields: [String: Any] {
        guard Date().timeIntervalSince(updatedAt) < 30 else { return [:] }
        return ["activity": activity, "activity_confidence": confidence]
    }
}
```

- [ ] **Step 2: Attach to pushGps**

In `BackgroundDuty.swift`'s `pushGps`, replace the body dictionary with:

```swift
        var body: [String: Any] = [
            "latitude": loc.coordinate.latitude,
            "longitude": loc.coordinate.longitude,
            "speed": max(loc.speed, 0) * 2.23694,
            "heading": max(loc.course, 0),
            "accuracy": loc.horizontalAccuracy,
            "source": "ios-field-app-bg",
        ]
        body.merge(MotionActivityService.shared.gpsFields) { a, _ in a }
        _ = try? await client.requestJSON("POST", "api/dispatch/gps", body: body)
```

And start the service where BackgroundDuty starts its location work (alongside `LocationManager.shared.start()` — search `start()` call sites in the tester app and add `MotionActivityService.shared.start()`).

- [ ] **Step 3: Parse-check + commit**

Run: `xcrun swiftc -parse ios/RMPGFlexTester/RMPGFlexTester/MotionActivityService.swift`
Expected: exits 0.

```bash
git add ios/RMPGFlexTester/RMPGFlexTester/MotionActivityService.swift ios/RMPGFlexTester/RMPGFlexTester/BackgroundDuty.swift ios/RMPGFlexTester/RMPGFlexTester/Info.plist
git commit -m "feat(ios-tester): CoreMotion activity on native GPS posts"
```

---

### Task 13: SW bump, full verification, wrap-up

**Files:**
- Modify: `client/public/sw.js` (CACHE_NAME at :605)

- [ ] **Step 1: Bump the service worker**

`const CACHE_NAME = 'rmpg-flex-v908';` → `'rmpg-flex-v909'` (check current value first — bump by 1 from whatever is there).

- [ ] **Step 2: Full verification suite**

```bash
npm run typecheck && npx vitest run
cd client && npx tsc --noEmit && npx vitest run
```
Expected: all clean / all pass.

- [ ] **Step 3: Manual end-to-end simulation against local wrangler**

```bash
npm run dev &   # wrangler dev on 8787
# (login to get a JWT for an officer with an assigned unit, then:)
curl -s -X POST http://localhost:8787/api/dispatch/gps \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"points":[{"lat":40.7608,"lng":-111.8910,"activity":"walking","activity_confidence":"high"},{"lat":40.7609,"lng":-111.8911,"activity":"walking","activity_confidence":"high"}]}'
# Verify:
npx wrangler d1 execute rmpg-flex --local --command "SELECT call_sign, on_foot, on_foot_since FROM units WHERE on_foot=1"
npx wrangler d1 execute rmpg-flex --local --command "SELECT * FROM foot_segments ORDER BY id DESC LIMIT 1"
# Then send two automotive points the same way and verify on_foot=0 and the
# segment row gained ended_at/duration_s.
```

- [ ] **Step 4: Final commit**

```bash
git add client/public/sw.js
git commit -m "chore(client): SW cache bump for on-foot detection release"
```

- [ ] **Step 5: Post-merge live-D1 reminder (do NOT skip)**

After this branch merges and deploys: apply `migrations/0102_on_foot_detection.sql` DDL directly to live D1 `785de7ae` (Cloudflare D1 API) and verify with
`SELECT name FROM pragma_table_info('units') WHERE name LIKE 'on_foot%'` (expect 4) and `pragma_table_info('foot_segments')`. A runtime "no such column: on_foot" after deploy means this step was missed.

---

## Out of scope (explicitly cut during brainstorming)

- Foot-pursuit auto-BOLO on `running` (user deselected).
- Speed-heuristic fallback classifier for web-only GPS clients.
- Admin UI for thresholds (constants: `DEBOUNCE_POINTS`, `ON_FOOT_OVERDUE_MS`).
- Cumulative breadcrumb-summed segment distance (straight-line start→end for v1).
