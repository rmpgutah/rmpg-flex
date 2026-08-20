# Serve Mileage Attribution Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the process-server GPS mileage computation from double-counting driven distance across overlapping jobs, and surface the same number to the officer before it reaches a client invoice.

**Architecture:** Extract the mileage math into a new shared module (`src/utils/serveMileage.ts`) that computes, once per officer/day, a set of non-overlapping "segments" — one per attempt, bounded by whichever comes first: the next attempt or a 2-hour cap (same cap as today, just no longer able to overlap a neighboring job's window). Both the existing billing path and a new officer-facing endpoint read from this single source of truth.

**Tech Stack:** Cloudflare Workers (Hono), D1 (SQLite), Vitest (Node unit tests) + `@cloudflare/vitest-pool-workers` (Miniflare integration tests), React (client).

## Global Constraints

- No changes to `DEFAULT_MILEAGE_RATE` / `resolveRate` — mileage billing dollar amounts must not change.
- No changes to `serve_routes.total_distance_miles` (planned mileage) or the Route Efficiency card.
- No schema migration — `serve_attempts` and `gps_breadcrumbs` already have every column needed.
- Preserve exact behavior for a single-attempt job (no other attempts that officer/day): its computed mileage must be identical to today's `computeMileageForQueue` output, since its window degenerates to the same `attempt_at → attempt_at + 2h` range with no next-attempt boundary to shorten it.
- Follow the existing `.catch(() => [])` pattern for D1 queries in this file — a query failure returns `0` miles, never throws (matches `computeMileageForQueue`'s current fail-safe behavior; the officer already sees a `$0.00`/`--` mileage line rather than a 500 if breadcrumb data is malformed).
- The new officer-facing endpoint scopes to the authenticated user's own `officer_id` only — never accept an `officer_id` query param for it (no IDOR surface).

---

## File Structure

- **Create `src/utils/serveMileage.ts`** — the single source of truth for GPS-derived serve mileage: `haversineMiles`, `computeOfficerMileageSegments`, `computeMileageForQueue`, `computeOfficerMileageForDay`.
- **Create `tests/serveMileage.test.ts`** — unit tests for the module above (Node, mocked D1).
- **Modify `src/utils/serveBillingEnhanced.ts`** — delete the local `computeMileageForQueue` (1121-1149) and local `haversineMiles` (1103-1118); import both from `serveMileage.ts` instead. `calculateMileageReimbursement` (unused/uncalled dead code — grepped, no callers anywhere in the repo) is untouched except its `haversineMiles` call now resolves to the shared import.
- **Modify `src/routes/serve.ts`** — replace the hardcoded `mileage: null` in `/stats/summary` with a real aggregate; add `GET /mileage/mine`.
- **Create `test-workers/serveMileage.test.ts`** — Miniflare integration tests hitting both endpoints.
- **Modify `client/src/pages/serve/MyRunTab.tsx`** — add a "Mileage today" line to the existing progress-bar area, fed by the new endpoint.

---

### Task 1: `serveMileage.ts` — shared attribution module

**Files:**
- Create: `src/utils/serveMileage.ts`
- Test: `tests/serveMileage.test.ts`

**Interfaces:**
- Consumes: `query`, `queryFirst` from `src/utils/db.ts` (signature: `query<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]>`, already used identically throughout `serveBillingEnhanced.ts` and `serve.ts`).
- Produces (used by Tasks 2 and 3):
  - `export function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number`
  - `export interface AttemptMileageSegment { attemptId: number; serveQueueId: number; officerId: number; attemptAt: string; miles: number }`
  - `export async function computeOfficerMileageSegments(db: D1Database, officerId: number, from: string, to: string): Promise<AttemptMileageSegment[]>`
  - `export async function computeMileageForQueue(db: D1Database, queueId: number): Promise<number>`
  - `export async function computeOfficerMileageForDay(db: D1Database, officerId: number, day: string): Promise<number>` (`day` is `YYYY-MM-DD`)

- [ ] **Step 1: Write the failing regression test for the double-counting bug**

Create `tests/serveMileage.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { computeOfficerMileageSegments, computeMileageForQueue, computeOfficerMileageForDay, haversineMiles } from '../src/utils/serveMileage';

// In-memory fake D1: enough of the query() surface for these tests. Mirrors
// the fake used by other serveBillingEnhanced tests in this repo (a plain
// object with a `prepare().bind().all()` chain that `query()`/`queryFirst()`
// in src/utils/db.ts call into).
function fakeDb(tables: { serve_attempts?: any[]; gps_breadcrumbs?: any[] }) {
  return {
    prepare(sql: string) {
      const isAttempts = sql.includes('FROM serve_attempts');
      return {
        bind(..._args: unknown[]) {
          return {
            all: async () => ({
              results: isAttempts ? (tables.serve_attempts ?? []) : (tables.gps_breadcrumbs ?? []),
            }),
          };
        },
      };
    },
  } as any;
}

describe('haversineMiles', () => {
  it('is zero for identical points', () => {
    expect(haversineMiles(40.76, -111.89, 40.76, -111.89)).toBeCloseTo(0, 5);
  });

  it('matches a known distance (Salt Lake City to Provo, ~43 miles)', () => {
    const d = haversineMiles(40.7608, -111.8910, 40.2338, -111.6585);
    expect(d).toBeGreaterThan(35);
    expect(d).toBeLessThan(50);
  });
});

describe('computeOfficerMileageSegments — cross-job double counting', () => {
  it('does not double-count breadcrumbs shared by two overlapping-window attempts', async () => {
    // Officer drives a continuous line: 4 points, ~1 mile apart each (~3 mi total).
    // Two attempts on DIFFERENT serve_queue_id, 30 minutes apart — well inside
    // the old +2h window, so the old code would have summed the whole 3-mile
    // trail into BOTH jobs (6mi billed for 3mi driven). The fix must split
    // the trail so the two jobs' totals sum to the trail total, not double it.
    const db = fakeDb({
      serve_attempts: [
        { id: 1, serve_queue_id: 100, attempt_at: '2026-08-01 09:00:00' },
        { id: 2, serve_queue_id: 200, attempt_at: '2026-08-01 09:30:00' },
      ],
      gps_breadcrumbs: [
        { latitude: 40.7000, longitude: -111.8900, recorded_at: '2026-08-01 08:50:00' },
        { latitude: 40.7150, longitude: -111.8900, recorded_at: '2026-08-01 09:05:00' },
        { latitude: 40.7300, longitude: -111.8900, recorded_at: '2026-08-01 09:20:00' },
        { latitude: 40.7450, longitude: -111.8900, recorded_at: '2026-08-01 09:40:00' },
      ],
    });

    const segments = await computeOfficerMileageSegments(
      db, 7, '2026-08-01 00:00:00', '2026-08-01 23:59:59',
    );

    const job100 = segments.find(s => s.serveQueueId === 100)!;
    const job200 = segments.find(s => s.serveQueueId === 200)!;

    const wholeTrail =
      haversineMiles(40.7000, -111.8900, 40.7150, -111.8900) +
      haversineMiles(40.7150, -111.8900, 40.7300, -111.8900) +
      haversineMiles(40.7300, -111.8900, 40.7450, -111.8900);

    // The two jobs' totals must sum to the trail total (not exceed it) —
    // this is the assertion that fails against today's +-2h-window code,
    // which would give job100 the FULL trail (all 4 points fall inside its
    // window) and job200 a partial re-count of the same points.
    expect(job100.miles + job200.miles).toBeCloseTo(wholeTrail, 5);
    expect(job100.miles).toBeGreaterThan(0);
    expect(job200.miles).toBeGreaterThan(0);
  });

  it('excludes breadcrumbs before the first attempt and after the last', async () => {
    const db = fakeDb({
      serve_attempts: [
        { id: 1, serve_queue_id: 100, attempt_at: '2026-08-01 09:00:00' },
      ],
      gps_breadcrumbs: [
        // Before the attempt: the commute to the first job of the day.
        { latitude: 40.60, longitude: -111.90, recorded_at: '2026-08-01 08:00:00' },
        { latitude: 40.70, longitude: -111.90, recorded_at: '2026-08-01 08:59:00' },
        // After the attempt's 2h cap: unrelated later driving.
        { latitude: 40.80, longitude: -111.90, recorded_at: '2026-08-01 12:00:00' },
      ],
    });

    const segments = await computeOfficerMileageSegments(
      db, 7, '2026-08-01 00:00:00', '2026-08-01 23:59:59',
    );

    expect(segments).toHaveLength(1);
    expect(segments[0].miles).toBe(0);
  });
});

describe('computeMileageForQueue — unchanged for a single-attempt job', () => {
  it('matches the sum of consecutive-breadcrumb distances inside attempt_at -> +2h', async () => {
    const db = fakeDb({
      serve_attempts: [
        { id: 1, serve_queue_id: 100, officer_id: 7, attempt_at: '2026-08-01 09:00:00', day: '2026-08-01' },
      ],
      gps_breadcrumbs: [
        { latitude: 40.70, longitude: -111.89, recorded_at: '2026-08-01 09:05:00' },
        { latitude: 40.71, longitude: -111.89, recorded_at: '2026-08-01 09:30:00' },
        { latitude: 40.72, longitude: -111.89, recorded_at: '2026-08-01 09:50:00' },
      ],
    });

    const total = await computeMileageForQueue(db, 100);
    const expected =
      haversineMiles(40.70, -111.89, 40.71, -111.89) +
      haversineMiles(40.71, -111.89, 40.72, -111.89);

    expect(total).toBeCloseTo(expected, 5);
  });
});

describe('computeOfficerMileageForDay', () => {
  it('sums every job segment for the officer that day', async () => {
    const db = fakeDb({
      serve_attempts: [
        { id: 1, serve_queue_id: 100, attempt_at: '2026-08-01 09:00:00' },
        { id: 2, serve_queue_id: 200, attempt_at: '2026-08-01 11:00:00' },
      ],
      gps_breadcrumbs: [
        { latitude: 40.70, longitude: -111.89, recorded_at: '2026-08-01 09:10:00' },
        { latitude: 40.71, longitude: -111.89, recorded_at: '2026-08-01 09:20:00' },
        { latitude: 40.72, longitude: -111.89, recorded_at: '2026-08-01 11:10:00' },
        { latitude: 40.73, longitude: -111.89, recorded_at: '2026-08-01 11:20:00' },
      ],
    });

    const total = await computeOfficerMileageForDay(db, 7, '2026-08-01');
    const expected =
      haversineMiles(40.70, -111.89, 40.71, -111.89) +
      haversineMiles(40.72, -111.89, 40.73, -111.89);

    expect(total).toBeCloseTo(expected, 5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/serveMileage.test.ts`
Expected: FAIL with `Cannot find module '../src/utils/serveMileage'` (the module doesn't exist yet).

- [ ] **Step 3: Implement `src/utils/serveMileage.ts`**

```ts
// ============================================================
// RMPG Flex — Serve mileage attribution (Cloudflare Worker)
// ============================================================
// Single source of truth for GPS-derived process-server mileage. Both the
// billing line-item generator (serveBillingEnhanced.ts) and the officer-
// facing "mileage today" surface (serve.ts /mileage/mine, /stats/summary)
// read from computeOfficerMileageSegments so a client is never billed for
// driving the officer can't also see on their own run.
//
// Segment rule: an officer's gps_breadcrumbs trail for a day is partitioned
// into one segment per serve_attempts row (across ALL that officer's jobs
// that day, not just one), where segment i's window is
//   [attempt[i].attempt_at, min(attempt[i+1].attempt_at, attempt[i].attempt_at + 2h))
// — bounded by whichever comes first: the next attempt (any job) or the
// existing 2-hour cap. This is a strict tightening of the prior
// `attempt_at -> attempt_at + 2h` window (which had no awareness of a
// next attempt), so:
//   - Segments can never overlap -> no breadcrumb is ever double-counted
//     across two jobs (the prior bug: two attempts by the same officer
//     less than 2h apart billed the same driven miles to both clients).
//   - A single-attempt day (nothing to shorten the window) computes
//     identically to the prior behavior.
// Breadcrumbs before the officer's first attempt of the day, or after their
// last attempt's capped window, are not attributed to any job -- getting to
// the first stop of the day isn't "for" that job any more than it's for any
// other, and inventing an attribution rule for it is out of scope here.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { query } from './db';

export interface AttemptMileageSegment {
  attemptId: number;
  serveQueueId: number;
  officerId: number;
  attemptAt: string;
  miles: number;
}

/** Haversine distance in miles between two lat/lng points. */
export function haversineMiles(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Compute non-overlapping per-attempt mileage segments for one officer over
 * [from, to] (inclusive TEXT datetimes, same lexical-comparison convention
 * used elsewhere against these UTC-naive `datetime('now')` columns).
 */
export async function computeOfficerMileageSegments(
  db: D1Database,
  officerId: number,
  from: string,
  to: string,
): Promise<AttemptMileageSegment[]> {
  const attempts = await query<{
    id: number;
    serve_queue_id: number;
    attempt_at: string;
  }>(
    db,
    `SELECT id, serve_queue_id, attempt_at
     FROM serve_attempts
     WHERE officer_id = ? AND attempt_at >= ? AND attempt_at <= ?
     ORDER BY attempt_at ASC, id ASC`,
    officerId, from, to,
  ).catch(() => []);

  if (attempts.length === 0) return [];

  const segments: AttemptMileageSegment[] = attempts.map((a) => ({
    attemptId: a.id,
    serveQueueId: a.serve_queue_id,
    officerId,
    attemptAt: a.attempt_at,
    miles: 0,
  }));

  // The next attempt's start (or null for the officer's last attempt of the
  // window) — one operand of segmentEndFor's min(next, +2h cap) below.
  const nextAttemptAt = attempts.map((a, i) =>
    i + 1 < attempts.length ? attempts[i + 1].attempt_at : null,
  );

  const breadcrumbs = await query<{
    latitude: number;
    longitude: number;
    recorded_at: string;
  }>(
    db,
    `SELECT latitude, longitude, recorded_at
     FROM gps_breadcrumbs
     WHERE officer_id = ? AND recorded_at >= ? AND recorded_at <= ?
       AND latitude IS NOT NULL AND longitude IS NOT NULL
     ORDER BY recorded_at ASC`,
    officerId, from, to,
  ).catch(() => []);

  let attemptIdx = 0;

  function cappedEnd(attemptAt: string): string {
    const d = new Date(attemptAt.replace(' ', 'T') + 'Z');
    d.setUTCHours(d.getUTCHours() + 2);
    return d.toISOString().replace('T', ' ').slice(0, 19);
  }

  function segmentEndFor(idx: number): string {
    const next = nextAttemptAt[idx];
    const cap = cappedEnd(attempts[idx].attempt_at);
    if (next === null) return cap;
    return next < cap ? next : cap;
  }

  for (let i = 1; i < breadcrumbs.length; i++) {
    const prev = breadcrumbs[i - 1];
    const curr = breadcrumbs[i];
    const dist = haversineMiles(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
    if (dist > 50) continue; // GPS jump guard (device restart / data gap), same as before

    // Advance to the attempt whose window covers curr.recorded_at. A
    // breadcrumb before the officer's first attempt never enters this loop
    // body meaningfully attributed (attemptIdx stays 0 but curr must also be
    // >= attempts[0].attempt_at to be attributed — checked below).
    while (attemptIdx < attempts.length && curr.recorded_at >= segmentEndFor(attemptIdx)) {
      attemptIdx++;
    }
    if (attemptIdx >= attempts.length) break; // past every attempt's window — unattributed, rest is too

    if (curr.recorded_at < attempts[attemptIdx].attempt_at) continue; // before the first attempt — unattributed
    if (prev.recorded_at < attempts[attemptIdx].attempt_at) continue; // hop starts before this attempt's window opened

    segments[attemptIdx].miles += dist;
  }

  return segments;
}

/** Sum of segments belonging to one serve_queue_id — used by the billing
 *  line-item generator. Scopes the underlying segment computation to every
 *  distinct (officer, day) pair touched by this job, so mileage from a job
 *  reassigned between officers, or spanning multiple attempt dates, is
 *  still computed against each officer's FULL day (preventing the
 *  cross-job double-count this module exists to fix) before filtering
 *  down to just this job's share. */
export async function computeMileageForQueue(
  db: D1Database,
  queueId: number,
): Promise<number> {
  const officerDays = await query<{ officer_id: number; day: string }>(
    db,
    `SELECT DISTINCT officer_id, date(attempt_at) as day
     FROM serve_attempts
     WHERE serve_queue_id = ? AND officer_id IS NOT NULL`,
    queueId,
  ).catch(() => []);

  let total = 0;
  for (const { officer_id, day } of officerDays) {
    const segments = await computeOfficerMileageSegments(
      db, officer_id, `${day} 00:00:00`, `${day} 23:59:59`,
    );
    total += segments
      .filter((s) => s.serveQueueId === queueId)
      .reduce((sum, s) => sum + s.miles, 0);
  }
  return total;
}

/** Sum of every segment for one officer on one calendar day (America/Denver
 *  day boundary handling matches the existing `date(attempt_at) = ?`
 *  convention already used by /stats/summary's other day-bucketed queries
 *  in serve.ts — not fixed here, kept consistent). Powers the daily Stats
 *  aggregate and the officer-facing "mileage today" endpoint. */
export async function computeOfficerMileageForDay(
  db: D1Database,
  officerId: number,
  day: string,
): Promise<number> {
  const segments = await computeOfficerMileageSegments(
    db, officerId, `${day} 00:00:00`, `${day} 23:59:59`,
  );
  return segments.reduce((sum, s) => sum + s.miles, 0);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/serveMileage.test.ts`
Expected: PASS, all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/utils/serveMileage.ts tests/serveMileage.test.ts
git commit -m "feat(serve): add non-overlapping mileage attribution module

Fixes cross-job double-counting where two attempts by the same
officer within 2h of each other (normal on a multi-stop run) had
overlapping GPS-breadcrumb windows, billing the same driven miles
to two different clients."
```

---

### Task 2: Wire `serveBillingEnhanced.ts` to the shared module

**Files:**
- Modify: `src/utils/serveBillingEnhanced.ts:1101-1149` (delete local `haversineMiles` + `computeMileageForQueue`, add import)
- Test: `tests/serveBillingEnhanced*.test.ts` (existing — must stay green, no new test needed since Task 1 already covers the math)

**Interfaces:**
- Consumes: `computeMileageForQueue` from `./serveMileage` (Task 1).
- Produces: no change to `serveBillingEnhanced.ts`'s own exports — `generateBillingLineItems` (the function around line 334 that calls `computeMileageForQueue`) keeps its existing signature.

- [ ] **Step 1: Add the import and remove the local duplicate**

At the top of `src/utils/serveBillingEnhanced.ts`, alongside the existing imports (around line 13):

```ts
import { computeMileageForQueue, haversineMiles } from './serveMileage';
```

Delete lines 1101-1149 (the `// ── Internal helpers ──` comment through the end of the local `computeMileageForQueue` function) — both the local `haversineMiles` and `computeMileageForQueue` definitions. Leave `calculateMileageReimbursement` (lines 1049-1099) in place exactly as-is; it now resolves its `haversineMiles` call to the shared import instead of a local definition, with no behavior change (dead code with no callers — grepped repo-wide, confirmed unused — so this is a safe no-op import swap, not a functional change).

- [ ] **Step 2: Run the full serveBillingEnhanced test suite to verify nothing broke**

Run: `npx vitest run tests/serveBillingEnhanced.test.ts tests/serveDenverBuckets.test.ts tests/d1ParamCap.test.ts`
Expected: PASS — same test count as before this change (no test should reference the deleted local functions directly; they only exercise `generateBillingLineItems`'s output).

- [ ] **Step 3: Run the worker typecheck**

Run: `npm run typecheck`
Expected: PASS, no unused-import or missing-export errors.

- [ ] **Step 4: Commit**

```bash
git add src/utils/serveBillingEnhanced.ts
git commit -m "refactor(serve): billing mileage now reads from serveMileage.ts

No behavior change for existing billing output — computeMileageForQueue
is now a thin re-export of the shared, non-overlapping attribution
module instead of a local +-2h-window implementation."
```

---

### Task 3: Fix `/stats/summary` + add `GET /mileage/mine`

**Files:**
- Modify: `src/routes/serve.ts:151-186` (the `/stats/summary` handler's mileage section)
- Modify: `src/routes/serve.ts` (add new route, anywhere among the other `sv.get(...)` handlers — placed here directly after `/stats/summary` for readability)

**Interfaces:**
- Consumes: `computeOfficerMileageForDay`, `computeOfficerMileageSegments` from `../utils/serveMileage` (Task 1).
- Produces: `GET /serve/mileage/mine?date=YYYY-MM-DD` → `{ date: string, miles: number, by_job: Array<{ serve_queue_id: number, miles: number }> }`. `GET /serve/stats/summary` → same shape as today, but `mileage` is now a real number (or `null` only on a genuine query failure, not by design).

- [ ] **Step 1: Import the module**

Add to the import block near the top of `src/routes/serve.ts` (alongside the existing `../utils/...` imports):

```ts
import { computeOfficerMileageForDay, computeOfficerMileageSegments } from '../utils/serveMileage';
```

- [ ] **Step 2: Replace the hardcoded `mileage: null` in `/stats/summary`**

Replace the block currently at `src/routes/serve.ts:149-185`:

```ts
  const total = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM serve_queue');

  // Planned mileage lives on serve_routes.total_distance_miles (one row per
  // officer per day) — verified against live D1, which has no actual_mileage
  // or planned_mileage column despite the client's field names implying both.
  // This is what the Stats tab's "Route Efficiency" card divides by, so it is
  // the field that actually unblocks that card.
  //
  // `mileage` (ACTUAL driven miles) has no serve-side source: nothing on
  // serve_routes or serve_attempts records odometer or driven distance. It is
  // reported as null rather than aliased to the planned figure — labelling a
  // planned number as actual would quietly overstate reimbursable mileage on a
  // billing surface. The card already falls back to the client's live route
  // distance, so this stays honest instead of guessing.
  let plannedMileage = 0;
  if (await columnExists(db, 'serve_routes', 'total_distance_miles')) {
    const m = await queryFirst<{ planned: number | null }>(
      db,
      `SELECT SUM(total_distance_miles) AS planned
         FROM serve_routes WHERE route_date = ?`,
      day,
    );
    plannedMileage = Math.round((m?.planned ?? 0) * 10) / 10;
  }

  return c.json({
    date: day,
    total: total?.n ?? 0,
    pending: openCounts?.pending ?? 0,
    in_progress: openCounts?.in_progress ?? 0,
    served: dayCounts?.served ?? 0,
    failed: dayCounts?.failed ?? 0,
    overdue: openCounts?.overdue ?? 0,
    total_attempts: attempts?.n ?? 0,
    mileage: null,
    planned_mileage: plannedMileage,
  });
});
```

with:

```ts
  const total = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM serve_queue');

  // Planned mileage lives on serve_routes.total_distance_miles (one row per
  // officer per day) — this is what the Stats tab's "Route Efficiency" card
  // divides by.
  let plannedMileage = 0;
  if (await columnExists(db, 'serve_routes', 'total_distance_miles')) {
    const m = await queryFirst<{ planned: number | null }>(
      db,
      `SELECT SUM(total_distance_miles) AS planned
         FROM serve_routes WHERE route_date = ?`,
      day,
    );
    plannedMileage = Math.round((m?.planned ?? 0) * 10) / 10;
  }

  // Actual driven mileage — sum computeOfficerMileageForDay (serveMileage.ts)
  // across every officer with an attempt that day. This is the same
  // attribution the billing line-item generator uses (serveBillingEnhanced.ts
  // -> computeMileageForQueue), so this card can never show a number the
  // eventual invoice disagrees with. A query failure falls back to null
  // (never to the planned figure — labelling a planned number as actual
  // would quietly overstate reimbursable mileage on a billing-adjacent
  // surface).
  let actualMileage: number | null = null;
  try {
    const officerRows = await query<{ officer_id: number }>(
      db,
      `SELECT DISTINCT officer_id FROM serve_attempts
       WHERE date(attempt_at) = ? AND officer_id IS NOT NULL`,
      day,
    );
    let sum = 0;
    for (const { officer_id } of officerRows) {
      sum += await computeOfficerMileageForDay(db, officer_id, day);
    }
    actualMileage = Math.round(sum * 10) / 10;
  } catch {
    actualMileage = null;
  }

  return c.json({
    date: day,
    total: total?.n ?? 0,
    pending: openCounts?.pending ?? 0,
    in_progress: openCounts?.in_progress ?? 0,
    served: dayCounts?.served ?? 0,
    failed: dayCounts?.failed ?? 0,
    overdue: openCounts?.overdue ?? 0,
    total_attempts: attempts?.n ?? 0,
    mileage: actualMileage,
    planned_mileage: plannedMileage,
  });
});
```

- [ ] **Step 3: Add `GET /mileage/mine`**

Add directly after the `/stats/summary` handler's closing `});` in `src/routes/serve.ts`:

```ts
// GET /mileage/mine — officer-facing "mileage today" surface. Scoped to the
// authenticated officer's own id only (never a query param) so this can
// never leak another officer's driven mileage. Backs MyRunTab's pre-invoice
// visibility line: the same number this endpoint returns is what
// generateBillingLineItems (serveBillingEnhanced.ts) will later bill to the
// client, computed from the same shared serveMileage.ts source.
sv.get('/mileage/mine', async (c) => {
  const denied = requireRole(c, ...READ);
  if (denied) return c.json({ error: denied }, 403);
  const user = c.get('user') as { id: number } | undefined;
  if (!user?.id) return c.json({ error: 'Not authenticated' }, 401);

  const dateParam = c.req.query('date');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dateParam ?? '')
    ? dateParam!
    : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date());

  const db = getDb(c.env);
  try {
    const segments = await computeOfficerMileageSegments(
      db, user.id, `${day} 00:00:00`, `${day} 23:59:59`,
    );
    const byJobMap = new Map<number, number>();
    for (const s of segments) {
      byJobMap.set(s.serveQueueId, (byJobMap.get(s.serveQueueId) ?? 0) + s.miles);
    }
    const by_job = Array.from(byJobMap.entries()).map(([serve_queue_id, miles]) => ({
      serve_queue_id,
      miles: Math.round(miles * 10) / 10,
    }));
    const miles = Math.round(by_job.reduce((sum, j) => sum + j.miles, 0) * 10) / 10;
    return c.json({ date: day, miles, by_job });
  } catch {
    return c.json({ date: day, miles: 0, by_job: [] });
  }
});
```

- [ ] **Step 4: Run the worker typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/serve.ts
git commit -m "feat(serve): real actual-mileage aggregate + officer mileage endpoint

/stats/summary no longer hardcodes mileage: null. New GET
/serve/mileage/mine gives the officer pre-invoice visibility into
the same GPS-attributed mileage the billing line-item generator uses."
```

---

### Task 4: Miniflare integration tests

**Files:**
- Create: `test-workers/serveMileage.test.ts`

**Interfaces:**
- Consumes: the two endpoints from Task 3 (`GET /stats/summary`, `GET /mileage/mine` on the `serve` router). This repo's Miniflare tests (`test-workers/fleetAnalytics.test.ts`, `test-workers/auth.test.ts`) mount the router under test on a local Hono app with a hardcoded `c.set('user', ...)` middleware bypassing real JWT auth entirely, call `app.request(path, {}, env)`, and `CREATE TABLE IF NOT EXISTS` their own fixtures in `beforeAll` — this test environment has no automatic migrations, only whatever tables a test file creates itself. Follow that exact convention (mirrored below), not a `SELF.fetch`/JWT-signing approach (that pattern exists elsewhere in this directory for a different reason — end-to-end auth-middleware coverage — and is unnecessary complexity here since auth is not what this test verifies).

- [ ] **Step 1: Write the failing tests**

```ts
// test-workers/serveMileage.test.ts
//
// Route-level test (Miniflare/workerd) for the serve mileage attribution
// repair: GET /stats/summary must return a real number (not the old
// hardcoded null), and GET /mileage/mine must split one officer's driven
// mileage across two overlapping-window jobs without double-counting —
// pinning the cross-job billing bug fixed by serveMileage.ts at the HTTP
// layer, not just the unit-test layer (tests/serveMileage.test.ts).
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import serve from '../src/routes/serve';

function appAs(userId: number) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: userId, role: 'officer', username: `officer-${userId}` });
    c.set('userId', userId);
    await next();
  });
  app.route('/api/serve', serve);
  return app;
}

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;

  await execute(db, `CREATE TABLE IF NOT EXISTS serve_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT, recipient_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS serve_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, serve_queue_id INTEGER, officer_id INTEGER,
    attempt_at TEXT, status TEXT DEFAULT 'attempted'
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS gps_breadcrumbs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, unit_id INTEGER, officer_id INTEGER,
    latitude REAL, longitude REAL, recorded_at TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS serve_routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, officer_id INTEGER, route_date TEXT, total_distance_miles REAL
  )`);

  await execute(db, `INSERT INTO serve_queue (id, recipient_name, status) VALUES
    (9001, 'Test Recipient A', 'in_progress'), (9002, 'Test Recipient B', 'in_progress')`);
  await execute(db, `INSERT INTO serve_attempts (id, serve_queue_id, officer_id, attempt_at, status) VALUES
    (7001, 9001, 501, '2026-08-01 09:00:00', 'attempted'),
    (7002, 9002, 501, '2026-08-01 09:30:00', 'attempted')`);
  await execute(db, `INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude, recorded_at) VALUES
    (1, 501, 40.7000, -111.8900, '2026-08-01 08:50:00'),
    (1, 501, 40.7150, -111.8900, '2026-08-01 09:05:00'),
    (1, 501, 40.7300, -111.8900, '2026-08-01 09:20:00'),
    (1, 501, 40.7450, -111.8900, '2026-08-01 09:40:00')`);
});

describe('GET /api/serve/stats/summary', () => {
  it('returns a real mileage number for the seeded day, not null', async () => {
    const app = appAs(501);
    const res = await app.request('/api/serve/stats/summary?date=2026-08-01', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { mileage: number | null };
    expect(body.mileage).not.toBeNull();
    expect(body.mileage).toBeGreaterThan(0);
  });
});

describe('GET /api/serve/mileage/mine', () => {
  it('splits mileage across both jobs without double-counting', async () => {
    const app = appAs(501);
    const res = await app.request('/api/serve/mileage/mine?date=2026-08-01', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { miles: number; by_job: Array<{ serve_queue_id: number; miles: number }> };
    expect(body.by_job).toHaveLength(2);
    const job9001 = body.by_job.find(j => j.serve_queue_id === 9001)!;
    const job9002 = body.by_job.find(j => j.serve_queue_id === 9002)!;
    expect(job9001.miles + job9002.miles).toBeCloseTo(body.miles, 1);
    // The old +-2h-window bug would have made job9001.miles alone equal the
    // FULL trail (all 4 breadcrumbs fall inside its window) — assert it
    // does not consume the other job's share.
    expect(job9001.miles).toBeLessThan(body.miles);
  });

  it('never returns another officer\'s mileage (no officer_id query param accepted)', async () => {
    const app = appAs(502); // officer 502 has no attempts/breadcrumbs seeded
    const res = await app.request('/api/serve/mileage/mine?date=2026-08-01', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { miles: number };
    expect(body.miles).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/serveMileage.test.ts`
Expected: PASS (this test is written after Tasks 1-3 are already implemented, so there's no red-then-green step here — if it fails, the failure is either a fixture/schema mismatch in this file's own `CREATE TABLE` statements or a real defect in Task 3's route code; fix whichever it is before proceeding).

- [ ] **Step 3: Run the full Miniflare suite**

Run: `npx vitest run --config vitest.workers.config.mts`
Expected: PASS, same file count as the pre-existing baseline plus this one new file.

- [ ] **Step 4: Commit**

```bash
git add test-workers/serveMileage.test.ts
git commit -m "test(serve): Miniflare coverage for mileage endpoints

Pins the cross-job double-counting fix at the HTTP layer, not just
the unit-test layer."
```

---

### Task 5: `MyRunTab.tsx` — officer-facing mileage line

**Files:**
- Modify: `client/src/pages/serve/MyRunTab.tsx`

**Interfaces:**
- Consumes: `GET /serve/mileage/mine?date=YYYY-MM-DD` (Task 3) via `apiFetch` from `../../hooks/useApi` (already imported in this file, line 28).
- Produces: no new exports — purely an added UI element within the existing default-exported `MyRunTab` component.

- [ ] **Step 1: Add state + fetch for the officer's mileage**

In `MyRunTab.tsx`, inside the `MyRunTab` component body (near the other `useState`/`useEffect` calls, after the existing `fetchRun` effect around line 497):

```tsx
  // ── Mileage today (read-only, pre-invoice visibility) ─────────────────
  const [mileageToday, setMileageToday] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ miles: number }>(`/serve/mileage/mine?date=${today}`)
      .then((res) => { if (!cancelled) setMileageToday(res?.miles ?? null); })
      .catch(() => { if (!cancelled) setMileageToday(null); });
    return () => { cancelled = true; };
  }, [today]);
```

- [ ] **Step 2: Render it next to the existing `ProgressBar`**

Replace this line (around 648):

```tsx
      <ProgressBar served={servedToday} total={totalToday} />
```

with:

```tsx
      <ProgressBar served={servedToday} total={totalToday} />
      {mileageToday !== null && mileageToday > 0 && (
        <div className="px-3 py-1 border-b border-rmpg-700 bg-surface-sunken text-[9px] text-rmpg-500 uppercase tracking-wider flex items-center justify-between">
          <span>Mileage today</span>
          <span className="font-mono tabular-nums text-rmpg-300">{mileageToday.toFixed(1)} mi</span>
        </div>
      )}
```

- [ ] **Step 3: Run the client test suite**

Run: `cd client && npx vitest run`
Expected: PASS — no existing `MyRunTab` test asserts on the exact DOM structure this changes; confirm by checking `client/src/pages/serve/__tests__/` (or wherever `MyRunTab` tests live, if any) for a snapshot test that would need updating. If one exists and fails only because of this new element's presence, update its expectation to include the new line rather than removing the feature.

- [ ] **Step 4: Verify in the browser**

Start the client dev server (`cd client && npm run dev`) and the worker (`npm run dev`), sign in as an officer with at least one serve attempt and GPS breadcrumbs seeded for today in local D1, open the Serve page's "My Run" tab, and confirm the "Mileage today" line renders with a non-zero value and updates when a new attempt is logged.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/serve/MyRunTab.tsx
git commit -m "feat(serve): show officer their own mileage before it's billed

Reads GET /serve/mileage/mine so an officer sees the same number
that will later appear on the client's invoice."
```

---

### Task 6: Full-repo verification

**Files:** none (verification only)

- [ ] **Step 1: Worker typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Full Node test suite**

Run: `npx vitest run`
Expected: PASS, 0 failing (baseline before this plan was 344 files / 3370 passed / 1 skipped — expect that plus the new `serveMileage.test.ts` file's tests).

- [ ] **Step 3: Full Miniflare suite**

Run: `npx vitest run --config vitest.workers.config.mts`
Expected: PASS, 0 failing (baseline 95 files / 553 tests, plus the new file).

- [ ] **Step 4: Client typecheck + tests**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Final commit if any verification step required a fix**

If every prior step already passed cleanly with no fixes needed, skip this — there's nothing to commit. Otherwise:

```bash
git add -A
git commit -m "fix: address verification failures in serve mileage repair"
```
