# GPS Tracking Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden GPS tracking accuracy, refresh rate, and reliability across the ingestion route, map/dispatch polling cadence, and marker rendering, per [docs/superpowers/specs/2026-07-23-gps-tracking-hardening-design.md](../specs/2026-07-23-gps-tracking-hardening-design.md).

**Architecture:** Server-side (`src/routes/dispatch/gps.ts`) gets bounds validation on accuracy/speed/heading, a speed-jump flag, and a GPS-specific rate limit. Client-side, the Map and Dispatch pages get a faster dedicated units-position poll decoupled from slower historical-data polls, and unit markers get a shared staleness util, CSS-transition-based position interpolation, heading rotation, and an accuracy-radius ring.

**Tech Stack:** Hono/Cloudflare Workers (D1), React/TypeScript client, Mapbox GL JS, Vitest (node suite `tests/`, Miniflare suite `test-workers/`).

## Global Constraints

- Server D1 queries are async — every `.prepare()/.first()/.all()/.run()` call must be `await`ed (see project CLAUDE.md).
- Migrations must be idempotent (`CREATE TABLE IF NOT EXISTS` / accept `ALTER TABLE ADD COLUMN` re-apply failures) and use the next free integer prefix — confirmed here as `0202`.
- `gps_breadcrumbs` and `units` are not in the D1 100-column-cap watch list (`calls_for_service`, `persons`) — direct `ALTER TABLE ADD COLUMN` is fine, no `_ext` table needed.
- Worker code has no dedicated test suite beyond typecheck + the Miniflare `test-workers/` smoke suite — new server behavior gets a `test-workers/*.test.ts` file, run via `npm run test:worker` (per `vitest.workers.config.mts`).
- Client changes must pass `cd client && npx tsc --noEmit` and `cd client && npx vitest run`.
- Never hardcode hex colors in new client UI — use the existing `UNIT_STATUS_HEX`/theme tokens already imported in touched files.

---

### Task 1: Migration — `flagged_reason` + `gps_accuracy` columns

**Files:**
- Create: `migrations/0202_gps_hardening_columns.sql`

**Interfaces:**
- Produces: `gps_breadcrumbs.flagged_reason TEXT` (nullable, consumed by Task 2), `units.gps_accuracy REAL` (nullable, consumed by Task 3's mirror UPDATE and Task 7's accuracy-ring render — `units.*` is already selected with a wildcard in `src/routes/dispatch/units.ts:37`, so no route change is needed for this column to reach the client).

- [ ] **Step 1: Write the migration**

```sql
-- 0202_gps_hardening_columns.sql
-- GPS tracking hardening: server-side speed-jump flagging + live accuracy
-- mirror onto units (parallel to the existing gps_heading/gps_speed mirror
-- added in 0065_units_gps_heading_speed.sql).
ALTER TABLE gps_breadcrumbs ADD COLUMN flagged_reason TEXT;
ALTER TABLE units ADD COLUMN gps_accuracy REAL;
```

- [ ] **Step 2: Apply locally**

Run: `npm run migrate:local`
Expected: both `ALTER TABLE` statements apply without error (fresh local DB) or the run completes (columns already present from a prior local apply).

- [ ] **Step 3: Verify schema**

Run:
```bash
npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM pragma_table_info('gps_breadcrumbs') WHERE name = 'flagged_reason'"
npx wrangler d1 execute rmpg-flex --local --command "SELECT name FROM pragma_table_info('units') WHERE name = 'gps_accuracy'"
```
Expected: both commands return one row each with the column name.

- [ ] **Step 4: Commit**

```bash
git add migrations/0202_gps_hardening_columns.sql
git commit -m "feat(gps): add flagged_reason and gps_accuracy columns"
```

---

### Task 2: Server-side bounds validation + speed-jump flagging

**Files:**
- Modify: `src/routes/dispatch/gps.ts:111-112` (extend the critical SELECT), `:147-153` (insert statement + bindings)
- Test: `test-workers/gpsBoundsValidation.test.ts`

**Interfaces:**
- Consumes: `haversineM(lat1, lng1, lat2, lng2): number` (meters) already imported at `gps.ts:6` from `../../utils/tripTelemetry`.
- Produces: `gps_breadcrumbs.flagged_reason` values of `null` or `'speed_jump'`, consumed by nothing else in this plan (informational column per the design's non-goals) but available for future dispatcher-facing surfacing.

- [ ] **Step 1: Write the failing test**

Create `test-workers/gpsBoundsValidation.test.ts`:

```ts
// Route-level regression test (Miniflare/workerd) for POST /api/dispatch/gps.
// Verifies server-side bounds validation on accuracy/heading/speed (nulled,
// not dropped) and the speed-jump flag against the unit's last known
// position — defense-in-depth against a compromised/buggy client, since
// previously all such filtering was client-side only (useGpsTracking.ts).
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute, queryFirst } from '../src/utils/db';
import gps from '../src/routes/dispatch/gps';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'officer', username: 'test-officer' });
  c.set('userId', 1);
  await next();
});
app.route('/api/dispatch/gps', gps);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY AUTOINCREMENT, call_sign TEXT UNIQUE NOT NULL, officer_id INTEGER,
    status TEXT NOT NULL DEFAULT 'available', current_call_id INTEGER, current_call_number TEXT,
    latitude REAL, longitude REAL, gps_heading REAL, gps_speed REAL, gps_accuracy REAL,
    gps_updated_at TEXT, gps_source TEXT, vehicle_id TEXT, updated_at TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, has_take_home INTEGER DEFAULT 0)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS fleet_vehicles (id INTEGER PRIMARY KEY, assigned_unit_id INTEGER)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS gps_breadcrumbs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, unit_id INTEGER, officer_id INTEGER,
    latitude REAL, longitude REAL, accuracy REAL, heading REAL, speed REAL,
    call_sign TEXT, activity TEXT, activity_confidence TEXT, recorded_at TEXT, flagged_reason TEXT
  )`);
  await execute(db, "INSERT INTO users (id, has_take_home) VALUES (1, 0)");
  // Unit starts at SLC downtown, GPS updated 10s ago — a "next" fix hundreds
  // of miles away within 10s is a physically impossible jump.
  await execute(db,
    `INSERT INTO units (call_sign, officer_id, status, latitude, longitude, gps_updated_at)
     VALUES ('D190', 1, 'available', 40.7608, -111.8910, datetime('now', '-10 seconds'))`);
});

describe('POST /api/dispatch/gps — bounds validation', () => {
  it('nulls out-of-range accuracy/heading/speed but still stores the point', async () => {
    const res = await app.request('/api/dispatch/gps', {
      method: 'POST',
      body: JSON.stringify({ points: [{ lat: 40.761, lng: -111.891, accuracy: 999999, heading: 720, speed: 500 }] }),
      headers: { 'Content-Type': 'application/json' },
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { inserted?: number; accepted?: number };
    expect(body).toBeTruthy();

    const db = (env as unknown as { DB: D1Database }).DB;
    const row = await queryFirst<{ accuracy: number | null; heading: number | null; speed: number | null }>(db,
      'SELECT accuracy, heading, speed FROM gps_breadcrumbs ORDER BY id DESC LIMIT 1');
    expect(row?.accuracy).toBeNull();
    expect(row?.heading).toBeNull();
    expect(row?.speed).toBeNull();
  });

  it('accepts in-range accuracy/heading/speed unchanged', async () => {
    const res = await app.request('/api/dispatch/gps', {
      method: 'POST',
      body: JSON.stringify({ points: [{ lat: 40.762, lng: -111.892, accuracy: 12, heading: 90, speed: 15 }] }),
      headers: { 'Content-Type': 'application/json' },
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);

    const db = (env as unknown as { DB: D1Database }).DB;
    const row = await queryFirst<{ accuracy: number | null; heading: number | null; speed: number | null }>(db,
      'SELECT accuracy, heading, speed FROM gps_breadcrumbs ORDER BY id DESC LIMIT 1');
    expect(row?.accuracy).toBe(12);
    expect(row?.heading).toBe(90);
    expect(row?.speed).toBe(15);
  });

  it('flags a physically-impossible speed jump from the unit last known position', async () => {
    // Unit's last known fix (SLC) is ~10s old; this point is ~500 miles away
    // in Denver — implies a speed far beyond the 60 m/s threshold.
    const res = await app.request('/api/dispatch/gps', {
      method: 'POST',
      body: JSON.stringify({ points: [{ lat: 39.7392, lng: -104.9903, accuracy: 10 }] }),
      headers: { 'Content-Type': 'application/json' },
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);

    const db = (env as unknown as { DB: D1Database }).DB;
    const row = await queryFirst<{ flagged_reason: string | null }>(db,
      'SELECT flagged_reason FROM gps_breadcrumbs ORDER BY id DESC LIMIT 1');
    expect(row?.flagged_reason).toBe('speed_jump');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:worker -- gpsBoundsValidation`
Expected: FAIL — `accuracy`/`heading`/`speed` are not nulled (current code stores them as-is), and `flagged_reason` column doesn't exist yet on the test's inline schema... actually the test's own `CREATE TABLE` already includes `flagged_reason` (Task 1 adds it to the real migrations, this test defines its own isolated schema) — the failure here is that the route never *writes* a `flagged_reason` value, so the assertion `expect(row?.flagged_reason).toBe('speed_jump')` fails with `null`.

- [ ] **Step 3: Implement bounds validation + speed-jump flagging**

Extend the critical SELECT at `gps.ts:111-112` to include the columns needed for the speed-jump comparison:

```ts
    const unit = await queryFirst<{ id: number; call_sign: string; status: string; gps_source: string | null; vehicle_id: string | null; current_call_id: number | null; latitude: number | null; longitude: number | null; gps_updated_at: string | null }>(db,
      'SELECT id, call_sign, status, gps_source, vehicle_id, current_call_id, latitude, longitude, gps_updated_at FROM units WHERE officer_id = ? LIMIT 1', userId);
```

Add bounds constants and a sanitize/flag pass right after the existing `points` filter (after `gps.ts:88`, before the `lastPt` line at `gps.ts:97`):

```ts
    // ── Server-side bounds validation (defense-in-depth) ──────
    // Mirrors the client's own filters (useGpsTracking.ts DEFAULT_MAX_ACCURACY/
    // DEFAULT_MAX_SPEED) but a compromised or buggy client can skip those —
    // this is the last line of defense before data lands in gps_breadcrumbs.
    // Out-of-range fields are nulled, not dropped: the position itself is
    // still useful even if its accuracy/heading/speed reading is garbage.
    const MAX_ACCURACY_M = 2000;
    const MAX_SPEED_MPS = 60; // ~134 mph, generous for a pursuit
    for (const pt of points) {
      if (pt.accuracy != null && (!Number.isFinite(pt.accuracy) || pt.accuracy < 0 || pt.accuracy > MAX_ACCURACY_M)) pt.accuracy = undefined;
      if (pt.heading != null && (!Number.isFinite(pt.heading) || pt.heading < 0 || pt.heading > 360)) pt.heading = undefined;
      if (pt.speed != null && (!Number.isFinite(pt.speed) || pt.speed < 0 || pt.speed > MAX_SPEED_MPS)) pt.speed = undefined;
    }

    // ── Speed-jump flagging ────────────────────────────────────
    // Compares each point's implied speed from the PRIOR known position
    // (the unit's last mirrored fix for the first point in the batch, then
    // each preceding point within the batch) against MAX_SPEED_MPS. Flagged,
    // not rejected — dispatchers may still want to see a suspect point.
```

Then, right before the insert-statement build at `gps.ts:147`, compute the per-point flags using the now-extended `unit` row and `haversineM`:

```ts
    let prevLat = unit?.latitude ?? null;
    let prevLng = unit?.longitude ?? null;
    let prevTimeMs = unit?.gps_updated_at
      ? new Date(unit.gps_updated_at.replace(' ', 'T') + (unit.gps_updated_at.includes('Z') ? '' : 'Z')).getTime()
      : null;
    const flags: (string | null)[] = points.map((pt) => {
      const ptTimeMs = pt.timestamp ? new Date(pt.timestamp).getTime() : Date.now();
      let flag: string | null = null;
      if (prevLat != null && prevLng != null && prevTimeMs != null && Number.isFinite(ptTimeMs)) {
        const distM = haversineM(prevLat, prevLng, pt.latitude, pt.longitude);
        const dtS = Math.max(1, (ptTimeMs - prevTimeMs) / 1000);
        if (distM / dtS > MAX_SPEED_MPS) flag = 'speed_jump';
      }
      prevLat = pt.latitude; prevLng = pt.longitude; prevTimeMs = Number.isFinite(ptTimeMs) ? ptTimeMs : prevTimeMs;
      return flag;
    });
```

Update the insert statement to include `flagged_reason`:

```ts
    const stmts = points.map((pt, i) => ({
      sql: `INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude, accuracy, heading, speed, call_sign, activity, activity_confidence, recorded_at, flagged_reason)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
      bindings: [unitId, userId, pt.latitude, pt.longitude, pt.accuracy ?? null, pt.heading ?? null, pt.speed ?? null, callSign, pt.activity ?? null, pt.activity_confidence ?? null, flags[i]],
    }));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:worker -- gpsBoundsValidation`
Expected: PASS (3 tests)

- [ ] **Step 5: Run full worker typecheck**

Run: `npm run typecheck`
Expected: no new errors

- [ ] **Step 6: Commit**

```bash
git add src/routes/dispatch/gps.ts test-workers/gpsBoundsValidation.test.ts
git commit -m "feat(gps): server-side bounds validation and speed-jump flagging"
```

---

### Task 3: GPS-specific rate limit

**Files:**
- Modify: `src/routes/dispatch/gps.ts:65-72` (top of the POST handler)
- Test: `test-workers/gpsRateLimit.test.ts`

**Interfaces:**
- Consumes: `rateLimitAllow(kv: KVNamespace, bucket: string, limit: number, windowSeconds: number): Promise<boolean>` from `src/utils/rateLimit.ts` (already used by `src/middleware/rateLimit.ts`'s generic 600/300s limit).

- [ ] **Step 1: Write the failing test**

Create `test-workers/gpsRateLimit.test.ts`:

```ts
// Route-level regression test (Miniflare/workerd) for the GPS-specific rate
// limit on POST /api/dispatch/gps. The generic per-user limit (600 req/300s,
// src/middleware/rateLimit.ts) is deliberately generous and explicitly NOT
// tuned to catch GPS abuse — this is a tighter, endpoint-specific limit.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import gps from '../src/routes/dispatch/gps';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 2, role: 'officer', username: 'test-officer-2' });
  c.set('userId', 2);
  await next();
});
app.route('/api/dispatch/gps', gps);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY AUTOINCREMENT, call_sign TEXT UNIQUE NOT NULL, officer_id INTEGER,
    status TEXT NOT NULL DEFAULT 'available', current_call_id INTEGER,
    latitude REAL, longitude REAL, gps_heading REAL, gps_speed REAL, gps_accuracy REAL,
    gps_updated_at TEXT, gps_source TEXT, vehicle_id TEXT, updated_at TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, has_take_home INTEGER DEFAULT 0)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS fleet_vehicles (id INTEGER PRIMARY KEY, assigned_unit_id INTEGER)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS gps_breadcrumbs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, unit_id INTEGER, officer_id INTEGER,
    latitude REAL, longitude REAL, accuracy REAL, heading REAL, speed REAL,
    call_sign TEXT, activity TEXT, activity_confidence TEXT, recorded_at TEXT, flagged_reason TEXT
  )`);
  await execute(db, "INSERT INTO users (id, has_take_home) VALUES (2, 0)");
  await execute(db, "INSERT INTO units (call_sign, officer_id, status) VALUES ('D200', 2, 'available')");
});

describe('POST /api/dispatch/gps — rate limit', () => {
  it('rejects the 31st request within 30s with 429', async () => {
    let lastStatus = 200;
    for (let i = 0; i < 31; i++) {
      const res = await app.request('/api/dispatch/gps', {
        method: 'POST',
        body: JSON.stringify({ points: [{ lat: 40.76 + i * 0.0001, lng: -111.89 }] }),
        headers: { 'Content-Type': 'application/json' },
      }, env as unknown as Record<string, unknown>);
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:worker -- gpsRateLimit`
Expected: FAIL — `lastStatus` is `200` (no rate limit exists yet on this route).

- [ ] **Step 3: Implement the rate limit**

Add the import and check at the top of the handler in `gps.ts`:

```ts
import { rateLimitAllow } from '../../utils/rateLimit';
```

Insert right after `const userId = c.get('userId') as number;` (`gps.ts:68`):

```ts
    // GPS-specific rate limit — tighter than the generic per-user 600/300s
    // limit (src/middleware/rateLimit.ts), which is explicitly tuned to NOT
    // throttle normal GPS traffic. This catches a runaway client loop
    // hammering the single highest-frequency endpoint in the app.
    const gpsAllowed = await rateLimitAllow(c.env.KV, `gps:unit:${userId}`, 30, 30);
    if (!gpsAllowed) {
      return c.json({ error: 'Too many GPS updates. Slow down and try again shortly.', code: 'RATE_LIMITED' }, 429);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:worker -- gpsRateLimit`
Expected: PASS

- [ ] **Step 5: Run the earlier bounds-validation test to confirm no regression**

Run: `npm run test:worker -- gpsBoundsValidation`
Expected: still PASS (well under 31 requests per test)

- [ ] **Step 6: Run full worker typecheck**

Run: `npm run typecheck`
Expected: no new errors

- [ ] **Step 7: Commit**

```bash
git add src/routes/dispatch/gps.ts test-workers/gpsRateLimit.test.ts
git commit -m "feat(gps): add GPS-specific rate limit (30 req/30s per unit)"
```

---

### Task 4: Shared GPS staleness util

**Files:**
- Create: `client/src/utils/gpsStaleness.ts`
- Test: `client/src/utils/__tests__/gpsStaleness.test.ts`
- Modify: `client/src/pages/map/utils/mapMarkers.ts:23-36`, `client/src/components/UnitStatusBoard.tsx:30-36`

**Interfaces:**
- Produces: `getGpsStaleness(unit: { gps_updated_at?: string | null; status?: string | null }): 'ok' | 'stale' | 'lost'`, consumed by Tasks 6 and 7's marker rendering.
- Consumes: `parseTimestamp(dateStr: string | null | undefined): Date` from `client/src/utils/dateUtils.ts:124` (already used by `UnitStatusBoard.tsx`).

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/__tests__/gpsStaleness.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getGpsStaleness } from '../gpsStaleness';

describe('getGpsStaleness', () => {
  it('returns "ok" when gps_updated_at is missing', () => {
    expect(getGpsStaleness({ gps_updated_at: undefined, status: 'available' })).toBe('ok');
  });

  it('returns "ok" for an off-duty unit regardless of age', () => {
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(getGpsStaleness({ gps_updated_at: old, status: 'off_duty' })).toBe('ok');
  });

  it('returns "ok" for a fix under 2 minutes old', () => {
    const recent = new Date(Date.now() - 30 * 1000).toISOString();
    expect(getGpsStaleness({ gps_updated_at: recent, status: 'available' })).toBe('ok');
  });

  it('returns "stale" for a fix between 2 and 5 minutes old', () => {
    const midAge = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    expect(getGpsStaleness({ gps_updated_at: midAge, status: 'available' })).toBe('stale');
  });

  it('returns "lost" for a fix over 5 minutes old', () => {
    const oldAge = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    expect(getGpsStaleness({ gps_updated_at: oldAge, status: 'available' })).toBe('lost');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/gpsStaleness.test.ts`
Expected: FAIL — `../gpsStaleness` module doesn't exist yet.

- [ ] **Step 3: Create the shared util**

Create `client/src/utils/gpsStaleness.ts`:

```ts
// Shared GPS-fix staleness classifier. Single source of truth for the
// 2min/5min amber/gray thresholds previously duplicated between
// mapMarkers.ts's getMapUnitGpsStaleness and UnitStatusBoard.tsx's
// getGpsStaleStatus (each had its own copy of the same two numbers,
// risking silent drift between the Map and Dispatch board views).
import { parseTimestamp } from './dateUtils';

export type GpsStaleness = 'ok' | 'stale' | 'lost';

export function getGpsStaleness(unit: { gps_updated_at?: string | null; status?: string | null }): GpsStaleness {
  if (!unit.gps_updated_at || unit.status === 'off_duty') return 'ok';
  const elapsed = Date.now() - parseTimestamp(unit.gps_updated_at).getTime();
  if (elapsed > 5 * 60 * 1000) return 'lost';
  if (elapsed > 2 * 60 * 1000) return 'stale';
  return 'ok';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/gpsStaleness.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Refactor mapMarkers.ts to use the shared util**

In `client/src/pages/map/utils/mapMarkers.ts`, replace the local `getMapUnitGpsStaleness` function (lines 23-36) with an import and delegation, keeping the local function name and signature unchanged so the rest of the file (`buildUnitMarkerEl`, `applyUnitMarkerState`) needs no other edits:

```ts
import { getGpsStaleness } from '../../../utils/gpsStaleness';

// Thin wrapper kept for call-site stability within this file — the actual
// thresholds now live in gpsStaleness.ts (single source of truth shared
// with UnitStatusBoard.tsx's getGpsStaleStatus).
function getMapUnitGpsStaleness(unit: Unit): 'ok' | 'stale' | 'lost' {
  return getGpsStaleness(unit);
}
```

- [ ] **Step 6: Refactor UnitStatusBoard.tsx to use the shared util**

In `client/src/components/UnitStatusBoard.tsx`, replace the body of `getGpsStaleStatus` (lines 30-36) the same way:

```ts
import { getGpsStaleness } from '../utils/gpsStaleness';

export function getGpsStaleStatus(unit: Unit): 'ok' | 'stale' | 'lost' {
  return getGpsStaleness(unit);
}
```

- [ ] **Step 7: Run the existing mapMarkers test suite to confirm no regression**

Run: `cd client && npx vitest run src/pages/map/utils/__tests__/mapMarkers.test.ts`
Expected: PASS (unchanged behavior, same thresholds)

- [ ] **Step 8: Run full client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 9: Commit**

```bash
git add client/src/utils/gpsStaleness.ts client/src/utils/__tests__/gpsStaleness.test.ts client/src/pages/map/utils/mapMarkers.ts client/src/components/UnitStatusBoard.tsx
git commit -m "refactor(gps): extract shared gpsStaleness util, dedupe Map/Dispatch thresholds"
```

---

### Task 5: Faster live-position refresh cadence

**Files:**
- Modify: `client/src/pages/map/MapboxMapPage.tsx:127` (add fast-poll constant), `:697-703` (add a second, faster units-only interval), `:118` (import)
- Modify: `client/src/pages/dispatch/DispatchPage.tsx:1103` (`LIVE_UNIT_POLL_MS`)

**Interfaces:**
- Consumes: `apiFetch<Unit[]>('/dispatch/units')` (already used inside `fetchData` at `MapboxMapPage.tsx:659`).
- Produces: nothing consumed by later tasks — this task only changes polling cadence.

- [ ] **Step 1: Add a fast units-only poll to MapboxMapPage.tsx**

This is a cadence change with no new pure logic to unit-test in isolation (it's a `setInterval` wiring change); verification is the manual browser check in Step 3. Add a new constant near `REFRESH_INTERVAL_MS` (`MapboxMapPage.tsx:127`):

```ts
const REFRESH_INTERVAL_MS = 30_000;
// Live unit positions specifically (not the queue/properties fetched by
// fetchData) refresh on a much tighter cadence to match the ~5s client GPS
// batch interval (useGpsTracking.ts DEFAULT_BATCH_INTERVAL) — the full
// fetchData() poll stays at 30s since /dispatch/queue and /records/properties
// are comparatively heavy and don't change every few seconds.
const UNITS_FAST_POLL_MS = 5_000;
```

Add a dedicated fast refresh function and its own interval, next to the existing `fetchData`/refresh-timer wiring (`MapboxMapPage.tsx:656-703`):

```ts
  const refreshUnitsOnly = useCallback(async () => {
    try {
      const u = await apiFetch<Unit[]>('/dispatch/units');
      setUnits(u);
    } catch (err) {
      devWarn('[MapboxMap] fast units poll failed', err);
    }
  }, []);
```

```ts
  useEffect(() => {
    const t = setInterval(refreshUnitsOnly, UNITS_FAST_POLL_MS);
    return () => clearInterval(t);
  }, [refreshUnitsOnly]);
```

Place both additions immediately after the existing `fetchData`/`refreshTimerRef` effect block (after `MapboxMapPage.tsx:703`), so the slower full-refresh timer and the new fast units-only timer run side by side.

- [ ] **Step 2: Tighten DispatchPage.tsx's live-unit poll interval**

In `client/src/pages/dispatch/DispatchPage.tsx:1103`, change:

```ts
    const LIVE_UNIT_POLL_MS = 7000;
```

to:

```ts
    const LIVE_UNIT_POLL_MS = 5000; // aligned with the ~5s client GPS batch interval (useGpsTracking.ts)
```

- [ ] **Step 3: Manually verify in the browser**

Run: `cd client && npm run dev` (or use the project's preview tooling), open the Map page and the Dispatch page side by side (or in two tabs) while a test unit's position changes (e.g. via a manual `POST /dispatch/gps` call or the existing dev GPS simulator if one exists). Confirm unit markers on both pages update within ~5s of a position change, and that the browser's Network tab shows the new `UNITS_FAST_POLL_MS` interval firing separately from the slower `fetchData` calls (visible as two different repeating request cadences to `/dispatch/units`).

- [ ] **Step 4: Run full client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/map/MapboxMapPage.tsx client/src/pages/dispatch/DispatchPage.tsx
git commit -m "perf(gps): tighten live-unit poll cadence to ~5s on Map and Dispatch pages"
```

---

### Task 6: Marker position interpolation

**Files:**
- Modify: `client/src/pages/map/utils/mapMarkers.ts` (`buildUnitMarkerEl`, new export), `client/src/pages/map/MapboxMapPage.tsx:748-750` (marker update loop)

**Interfaces:**
- Consumes: `haversineDistance(lat1, lng1, lat2, lng2): number` (miles) from `client/src/utils/unitRecommendation.ts:25`.
- Produces: `MARKER_TRANSITION_MS` exported constant and `shouldAnimateMarkerMove(prevLat, prevLng, nextLat, nextLng): boolean`, both consumed by `MapboxMapPage.tsx`'s marker update loop in this same task.

- [ ] **Step 1: Write the failing test**

Add to `client/src/pages/map/utils/__tests__/mapMarkers.test.ts` (append; do not remove existing tests):

```ts
import { shouldAnimateMarkerMove } from '../mapMarkers';

describe('shouldAnimateMarkerMove', () => {
  it('animates a normal short move (under the jump threshold)', () => {
    // ~100m apart — a plausible move within one ~5s poll interval.
    expect(shouldAnimateMarkerMove(40.7608, -111.8910, 40.7617, -111.8910)).toBe(true);
  });

  it('skips animation for an implausible long jump', () => {
    // SLC to Denver — not a real single-poll move; snap instead of glide.
    expect(shouldAnimateMarkerMove(40.7608, -111.8910, 39.7392, -104.9903)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/utils/__tests__/mapMarkers.test.ts`
Expected: FAIL — `shouldAnimateMarkerMove` is not exported yet.

- [ ] **Step 3: Implement interpolation support in mapMarkers.ts**

Add near the top of `client/src/pages/map/utils/mapMarkers.ts`, alongside the other exported constants:

```ts
import { haversineDistance } from '../../../utils/unitRecommendation';

// How long a marker's CSS transform transition runs — matches the fast
// units-poll interval (MapboxMapPage.tsx UNITS_FAST_POLL_MS) so a position
// update finishes gliding right as the next one arrives, reading as
// continuous motion instead of a teleport between polls.
export const MARKER_TRANSITION_MS = 4500;

// A jump further than this in one poll interval isn't a real drive — it's a
// reassignment, GPS glitch recovery, or test data. Snap instead of gliding
// across an implausible distance (miles, since haversineDistance returns miles).
const MAX_ANIMATED_JUMP_MILES = 0.3; // ~480m

export function shouldAnimateMarkerMove(prevLat: number, prevLng: number, nextLat: number, nextLng: number): boolean {
  return haversineDistance(prevLat, prevLng, nextLat, nextLng) <= MAX_ANIMATED_JUMP_MILES;
}
```

In `buildUnitMarkerEl` (around `mapMarkers.ts:49-53`), add the CSS transition to the marker root element's inline style so mapboxgl's own `setLngLat`-driven transform updates animate automatically:

```ts
  el.style.cssText = `
    display:flex;flex-direction:column;align-items:center;gap:2px;
    cursor:pointer;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6));
    opacity:${staleness === 'lost' ? 0.45 : staleness === 'stale' ? 0.7 : 1};
    transition:transform ${MARKER_TRANSITION_MS}ms linear;
  `;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/utils/__tests__/mapMarkers.test.ts`
Expected: PASS

- [ ] **Step 5: Wire the jump check into MapboxMapPage.tsx's marker update loop**

In `MapboxMapPage.tsx`, update the import at line 118 to include `shouldAnimateMarkerMove`:

```ts
import { HAZARD_FLAGS, buildUnitMarkerEl, applyUnitMarkerState, buildUnitPopupHtml, buildCallMarkerEl, buildCallPopupHtml, shouldAnimateMarkerMove } from './utils/mapMarkers';
```

Replace the existing-marker branch of the update loop (`MapboxMapPage.tsx:748-762`) to temporarily disable the CSS transition for an implausible jump, so it snaps instead of gliding across it:

```ts
      const existing = unitMarkersRef.current.get(unit.id);
      if (existing) {
        const prevLngLat = existing.getLngLat();
        const el = existing.getElement();
        const animate = shouldAnimateMarkerMove(prevLngLat.lat, prevLngLat.lng, unit.latitude, unit.longitude);
        if (!animate) el.style.transitionDuration = '0ms';
        existing.setLngLat([unit.longitude, unit.latitude]);
        if (!animate) {
          // Restore the transition on the next frame so the NEXT (presumably
          // normal) move animates again.
          requestAnimationFrame(() => { el.style.transitionDuration = ''; });
        }
        const popup = existing.getPopup();
        if (popup) popup.setHTML(buildUnitPopupHtml(unit));
        applyUnitMarkerState(existing.getElement(), unit);
      } else {
```

- [ ] **Step 6: Manually verify in the browser**

Run the dev server, open the Map page, and move a test unit's position via a couple of `POST /dispatch/gps` calls a few seconds apart at a normal walking/driving distance — confirm the marker glides smoothly rather than snapping. Then send a position update hundreds of miles away and confirm the marker snaps instantly (no visible glide across the ocean/state).

- [ ] **Step 7: Run full client typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/map/utils/mapMarkers.ts client/src/pages/map/utils/__tests__/mapMarkers.test.ts client/src/pages/map/MapboxMapPage.tsx
git commit -m "feat(gps): animate marker position updates, snap on implausible jumps"
```

---

### Task 7: Heading rotation + accuracy-radius ring

**Files:**
- Modify: `src/routes/dispatch/gps.ts:168-174` (mirror `gps_accuracy` onto `units`, from Task 1's new column)
- Modify: `client/src/pages/map/utils/mapConstants.ts` (add `gps_accuracy` to `MapUnit`)
- Modify: `client/src/pages/map/utils/mapMarkers.ts` (`buildUnitMarkerEl`, `applyUnitMarkerState`)
- Test: `client/src/pages/map/utils/__tests__/mapMarkers.test.ts` (append)

**Interfaces:**
- Consumes: `MapUnit.gps_heading?: number | null` (already present, `mapConstants.ts:24`), `MapUnit.gps_accuracy?: number | null` (added in this task).

- [ ] **Step 1: Mirror `gps_accuracy` onto `units` server-side**

In `src/routes/dispatch/gps.ts`, extend the existing units-mirror UPDATE (`gps.ts:168-174`):

```ts
    if (lastPt && lastPt.latitude != null && lastPt.longitude != null && unitId) {
      await execute(db,
        `UPDATE units SET latitude = ?, longitude = ?, gps_heading = ?, gps_speed = ?, gps_accuracy = ?,
           gps_updated_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
        lastPt.latitude, lastPt.longitude,
        lastPt.heading ?? null, lastPt.speed ?? null, lastPt.accuracy ?? null,
        unitId);
    }
```

- [ ] **Step 2: Add `gps_accuracy` to the `MapUnit` type**

In `client/src/pages/map/utils/mapConstants.ts`, add next to the existing `gps_heading`/`gps_speed` fields (around line 24-25):

```ts
  gps_accuracy?: number | null;    // meters, from the mirrored last GPS fix
```

- [ ] **Step 3: Write the failing test**

Append to `client/src/pages/map/utils/__tests__/mapMarkers.test.ts`:

```ts
describe('buildUnitMarkerEl — heading and accuracy', () => {
  it('rotates the badge when heading is present', () => {
    const el = buildUnitMarkerEl({ ...unit, gps_heading: 90 } as MapUnit);
    const badge = el.querySelector('[data-role="badge"]') as HTMLElement;
    expect(badge.style.transform).toContain('rotate(90deg)');
  });

  it('does not rotate when heading is null', () => {
    const el = buildUnitMarkerEl({ ...unit, gps_heading: null } as MapUnit);
    const badge = el.querySelector('[data-role="badge"]') as HTMLElement;
    expect(badge.style.transform).toBe('');
  });

  it('renders an accuracy ring when accuracy is present', () => {
    const el = buildUnitMarkerEl({ ...unit, gps_accuracy: 25 } as MapUnit);
    expect(el.querySelector('[data-role="accuracy-ring"]')).not.toBeNull();
  });

  it('omits the accuracy ring when accuracy is absent', () => {
    const el = buildUnitMarkerEl({ ...unit, gps_accuracy: null } as MapUnit);
    expect(el.querySelector('[data-role="accuracy-ring"]')).toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd client && npx vitest run src/pages/map/utils/__tests__/mapMarkers.test.ts`
Expected: FAIL — no `[data-role="accuracy-ring"]` element exists yet, and the badge is never rotated.

- [ ] **Step 5: Implement heading rotation and the accuracy ring**

In `buildUnitMarkerEl` (`mapMarkers.ts`), after the existing `badge.innerHTML = UNIT_GLYPH_SVG;` line, add heading rotation:

```ts
  badge.innerHTML = UNIT_GLYPH_SVG;
  // Rotate the whole badge to point in the direction of travel. Only applied
  // when heading is present and non-null — the server nulls implausible
  // headings (gps.ts bounds validation), so a present value is trustworthy.
  if (unit.gps_heading != null && Number.isFinite(unit.gps_heading)) {
    badge.style.transform = `rotate(${unit.gps_heading}deg)`;
  }
  el.appendChild(badge);
```

Add the accuracy ring as a sibling positioned behind the badge, right before `return el;` in `buildUnitMarkerEl`:

```ts
  // Accuracy-radius ring: a translucent circle sized to the reported GPS
  // accuracy in meters. Rendered only when accuracy data is present (the
  // server nulls implausible values) so we never draw a fake/default ring.
  // Sized in CSS pixels using a fixed reference scale (roughly meters-per-
  // pixel at typical dispatch zoom levels ~14-16); it's an approximate
  // confidence indicator, not a survey-accurate overlay.
  if (unit.gps_accuracy != null && Number.isFinite(unit.gps_accuracy) && unit.gps_accuracy > 0) {
    const ring = document.createElement('div');
    ring.setAttribute('data-role', 'accuracy-ring');
    const pixelRadius = Math.min(60, Math.max(8, unit.gps_accuracy / 2));
    ring.style.cssText = `
      position:absolute;top:50%;left:50%;
      width:${pixelRadius * 2}px;height:${pixelRadius * 2}px;
      margin-left:-${pixelRadius}px;margin-top:-${pixelRadius - 15}px;
      border-radius:50%;background:${color}22;border:1px solid ${color}55;
      pointer-events:none;z-index:-1;
    `;
    el.style.position = 'relative';
    el.appendChild(ring);
  }

  return el;
```

Update `applyUnitMarkerState` (`mapMarkers.ts:89-110`) to keep an existing marker's rotation and ring in sync on subsequent updates, mirroring the same logic:

```ts
export function applyUnitMarkerState(el: HTMLElement, unit: Unit): void {
  const color = UNIT_STATUS_COLORS[unit.status] || '#888888';
  const staleness = getMapUnitGpsStaleness(unit);
  el.style.opacity = String(staleness === 'lost' ? 0.45 : staleness === 'stale' ? 0.7 : 1);
  el.title = `${unit.call_sign} — ${UNIT_STATUS_LABELS[unit.status] || unit.status}`
    + (staleness === 'lost' ? ' (GPS lost)' : staleness === 'stale' ? ' (GPS stale)' : '');

  const ringColor = staleness === 'ok' ? color : '#6b7280';
  const badge = el.querySelector<HTMLElement>('[data-role="badge"]');
  if (badge) {
    badge.style.background = color;
    badge.style.border = `2px ${staleness === 'ok' ? 'solid' : 'dashed'} ${staleness === 'ok' ? '#0d1520' : ringColor}`;
    badge.style.boxShadow = `0 0 8px ${ringColor}b3`;
    badge.style.transform = (unit.gps_heading != null && Number.isFinite(unit.gps_heading)) ? `rotate(${unit.gps_heading}deg)` : '';
  }

  const label = el.querySelector<HTMLElement>('[data-role="label"]');
  if (label) {
    label.style.border = `1.2px solid ${color}`;
    label.style.color = color;
    label.textContent = unit.call_sign.slice(0, 6);
  }

  // Accuracy ring: remove and rebuild rather than resize in place — it's a
  // cheap DOM op at this element count and avoids drifting math between
  // build and update paths.
  const existingRing = el.querySelector('[data-role="accuracy-ring"]');
  if (existingRing) existingRing.remove();
  if (unit.gps_accuracy != null && Number.isFinite(unit.gps_accuracy) && unit.gps_accuracy > 0) {
    const ring = document.createElement('div');
    ring.setAttribute('data-role', 'accuracy-ring');
    const pixelRadius = Math.min(60, Math.max(8, unit.gps_accuracy / 2));
    ring.style.cssText = `
      position:absolute;top:50%;left:50%;
      width:${pixelRadius * 2}px;height:${pixelRadius * 2}px;
      margin-left:-${pixelRadius}px;margin-top:-${pixelRadius - 15}px;
      border-radius:50%;background:${color}22;border:1px solid ${color}55;
      pointer-events:none;z-index:-1;
    `;
    el.appendChild(ring);
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd client && npx vitest run src/pages/map/utils/__tests__/mapMarkers.test.ts`
Expected: PASS (all tests, including the ones from Task 6)

- [ ] **Step 7: Manually verify in the browser**

Run the dev server, open the Map page, and confirm: a unit with a nonzero `gps_heading` shows a visibly rotated icon; a unit with `gps_accuracy` set shows a faint translucent ring around it sized proportionally; a unit missing either field renders exactly as before (no rotation, no ring).

- [ ] **Step 8: Run full worker typecheck, full client typecheck, and both test suites**

Run:
```bash
npm run typecheck
cd client && npx tsc --noEmit
cd client && npx vitest run
npm run test:worker
```
Expected: all pass, no new errors.

- [ ] **Step 9: Commit**

```bash
git add src/routes/dispatch/gps.ts client/src/pages/map/utils/mapConstants.ts client/src/pages/map/utils/mapMarkers.ts client/src/pages/map/utils/__tests__/mapMarkers.test.ts
git commit -m "feat(gps): heading-rotated unit icons and accuracy-radius ring on the map"
```

---

## Post-merge steps (per CLAUDE.md migration guidance)

After this plan's PR merges to `main`, apply the migration directly to live D1 since `deploy.yml`'s migration-apply step is `continue-on-error: true`:

```bash
scripts/apply-migration.sh 0202_gps_hardening_columns.sql
```

Then verify both columns landed:

```bash
npx wrangler d1 execute rmpg-flex --remote --command "SELECT name FROM pragma_table_info('gps_breadcrumbs') WHERE name = 'flagged_reason'"
npx wrangler d1 execute rmpg-flex --remote --command "SELECT name FROM pragma_table_info('units') WHERE name = 'gps_accuracy'"
```
