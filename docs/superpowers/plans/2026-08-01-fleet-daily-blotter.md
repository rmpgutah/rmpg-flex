# Fleet Daily Blotter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a combined operations + fleet daily blotter PDF nightly at 00:05 America/Denver, store it in R2, and serve it through the three endpoints `FleetReportsPage` already calls.

**Architecture:** Four small units under `src/utils/dailyReport/` — `dates` (pure timezone math), `collect` (all D1 reads), `render` (pure data→PDF), `store` (R2 key scheme + I/O) — consumed by a `src/routes/dailyReports.ts` sub-router mounted inside the existing `/api/reports` router, plus a Denver-gated branch on the existing per-minute cron.

**Tech Stack:** Cloudflare Workers, Hono, D1, R2 (`DOWNLOADS` bucket), `pdf-lib` (new dependency), Vitest (Node) + `@cloudflare/vitest-pool-workers` (Miniflare).

**Spec:** `docs/superpowers/specs/2026-08-01-fleet-daily-blotter-design.md`

## Global Constraints

- **D1 timestamps are `'YYYY-MM-DD HH:MM:SS'` in UTC** (from `datetime('now')`). All day-bound values must be emitted in that exact format so `created_at >= ? AND created_at < ?` works as a string comparison. Never `Date.toISOString()` (it emits `T` and `Z`) for a bound compared against a D1 column.
- **Never `SELECT *` (or `SELECT c.*`) from `calls_for_service`.** It sits at D1's 100-column cap. Use an explicit narrow column list. (CLAUDE.md gotcha 19.)
- **`call_units` has zero rows on live.** Officer/unit attribution comes from `calls_for_service.unit_call_signs` and `.responding_officer` only. Never join through `call_units`.
- **Never hardcode hex in client files.** (No client styling changes in this plan, but Task 7 touches a client file.)
- **All D1 calls are async** — always `await`.
- **Unset/missing binding → `200 { ok: false, code: 'not_configured' }`**, never a 503.
- Every task ends green on `npm run typecheck` and `npx vitest run`.

## File Structure

| File | Responsibility |
|---|---|
| `src/utils/dailyReport/dates.ts` | Pure Denver↔UTC day math. No I/O, no clock reads. |
| `src/utils/dailyReport/types.ts` | `DailyReportData` and row interfaces shared by collect/render. |
| `src/utils/dailyReport/collect.ts` | Every D1 read. No formatting, no PDF concepts. |
| `src/utils/dailyReport/render.ts` | Pure `DailyReportData → Uint8Array`. No bindings. |
| `src/utils/dailyReport/store.ts` | R2 key scheme, put/get/list/head. |
| `src/routes/dailyReports.ts` | The three HTTP endpoints. |
| `src/routes/reports.ts` | Modified: mount the sub-router. |
| `src/index.ts` | Modified: Denver 00:05 cron branch. |
| `client/src/pages/fleet/FleetReportsPage.tsx` | Modified: delete the stale `dailyReportGenerator` comment. |

---

### Task 1: Denver day boundaries

**Files:**
- Create: `src/utils/dailyReport/dates.ts`
- Test: `tests/dailyReportDates.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `denverDayBoundsUtc(dateStr: string): { startUtc: string; endUtc: string }`, `denverToday(nowMs: number): string`, `previousDenverDays(dateStr: string, n: number): string[]`. All strings are `YYYY-MM-DD` except the bounds, which are `YYYY-MM-DD HH:MM:SS`.

This is the highest-risk unit in the feature. A naive `date(created_at) = ?` misfiles every call after 18:00 Mountain into the next day and drifts an hour across DST.

- [ ] **Step 1: Write the failing test**

Create `tests/dailyReportDates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { denverDayBoundsUtc, denverToday, previousDenverDays } from '../src/utils/dailyReport/dates';

describe('denverDayBoundsUtc', () => {
  it('MST (winter) day is UTC-7', () => {
    expect(denverDayBoundsUtc('2026-01-15')).toEqual({
      startUtc: '2026-01-15 07:00:00',
      endUtc: '2026-01-16 07:00:00',
    });
  });

  it('MDT (summer) day is UTC-6', () => {
    expect(denverDayBoundsUtc('2026-07-18')).toEqual({
      startUtc: '2026-07-18 06:00:00',
      endUtc: '2026-07-19 06:00:00',
    });
  });

  // 2026-03-08 is the second Sunday in March — spring forward, a 23-hour day.
  it('spring-forward day spans 23 hours', () => {
    const b = denverDayBoundsUtc('2026-03-08');
    expect(b).toEqual({ startUtc: '2026-03-08 07:00:00', endUtc: '2026-03-09 06:00:00' });
    const hours = (Date.parse(b.endUtc + 'Z') - Date.parse(b.startUtc + 'Z')) / 3_600_000;
    expect(hours).toBe(23);
  });

  // 2026-11-01 is the first Sunday in November — fall back, a 25-hour day.
  it('fall-back day spans 25 hours', () => {
    const b = denverDayBoundsUtc('2026-11-01');
    expect(b).toEqual({ startUtc: '2026-11-01 06:00:00', endUtc: '2026-11-02 07:00:00' });
    const hours = (Date.parse(b.endUtc + 'Z') - Date.parse(b.startUtc + 'Z')) / 3_600_000;
    expect(hours).toBe(25);
  });

  it('emits D1 format, never ISO with T/Z', () => {
    const b = denverDayBoundsUtc('2026-07-18');
    expect(b.startUtc).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(b.startUtc).not.toContain('T');
    expect(b.startUtc).not.toContain('Z');
  });

  it('a 23:30 Mountain event falls inside that Denver day', () => {
    const { startUtc, endUtc } = denverDayBoundsUtc('2026-07-18');
    // 2026-07-18 23:30 MDT === 2026-07-19 05:30 UTC
    const event = '2026-07-19 05:30:00';
    expect(event >= startUtc && event < endUtc).toBe(true);
  });

  it('a 00:30 Mountain event falls outside the previous Denver day', () => {
    const { startUtc, endUtc } = denverDayBoundsUtc('2026-07-18');
    // 2026-07-19 00:30 MDT === 2026-07-19 06:30 UTC
    const event = '2026-07-19 06:30:00';
    expect(event >= startUtc && event < endUtc).toBe(false);
  });
});

describe('denverToday', () => {
  it('uses the Denver calendar day, not UTC', () => {
    // 2026-07-19 05:00 UTC is still 2026-07-18 23:00 in Denver.
    expect(denverToday(Date.parse('2026-07-19T05:00:00Z'))).toBe('2026-07-18');
  });
});

describe('previousDenverDays', () => {
  it('walks backward without duplicating or skipping', () => {
    expect(previousDenverDays('2026-07-18', 3)).toEqual(['2026-07-17', '2026-07-16', '2026-07-15']);
  });

  it('crosses a DST boundary cleanly', () => {
    expect(previousDenverDays('2026-11-02', 3)).toEqual(['2026-11-01', '2026-10-31', '2026-10-30']);
  });

  it('returns an empty list for n <= 0', () => {
    expect(previousDenverDays('2026-07-18', 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dailyReportDates.test.ts`
Expected: FAIL — `Failed to resolve import "../src/utils/dailyReport/dates"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/dailyReport/dates.ts`:

```ts
// ============================================================
// RMPG Flex — Daily Blotter: Denver ↔ UTC day math
// ============================================================
// A blotter "for 2026-07-18" must cover 00:00:00–23:59:59
// America/Denver, but D1 stores UTC via datetime('now'). Using
// date(created_at) would misfile every event after 18:00 Mountain
// into the next day and drift an hour across DST.
//
// Everything here is pure — no clock reads (callers inject nowMs) —
// so DST transitions are directly testable.
// ============================================================

const TZ = 'America/Denver';

/** Offset (ms) to ADD to a UTC instant to get Denver wall-clock time. */
function tzOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0');
  // hour12:false yields '24' at midnight in some ICU builds; normalize.
  const asIfUtc = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour') % 24, get('minute'), get('second'),
  );
  return asIfUtc - utcMs;
}

/**
 * UTC instant for Denver-local midnight starting `dateStr`.
 *
 * Two passes: the first offset is guessed from the naive instant, the
 * second is re-read at the corrected instant. That second pass is what
 * makes DST-transition days correct — the offset that applies at the
 * naive timestamp is not always the offset that applies at the real one.
 */
function denverMidnightUtcMs(y: number, m: number, d: number): number {
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0);
  let utc = naive - tzOffsetMs(naive);
  utc = naive - tzOffsetMs(utc);
  return utc;
}

/** D1 stores 'YYYY-MM-DD HH:MM:SS' (UTC). Bounds must match that shape
 *  exactly so string comparison against created_at is valid. */
function toD1Utc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function parseYmd(dateStr: string): [number, number, number] {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date: ${dateStr}`);
  return [y, m, d];
}

/** Half-open [startUtc, endUtc) covering one Denver calendar day. */
export function denverDayBoundsUtc(dateStr: string): { startUtc: string; endUtc: string } {
  const [y, m, d] = parseYmd(dateStr);
  return {
    startUtc: toD1Utc(denverMidnightUtcMs(y, m, d)),
    endUtc: toD1Utc(denverMidnightUtcMs(y, m, d + 1)),
  };
}

/** The Denver calendar day containing the given UTC instant. */
export function denverToday(nowMs: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(nowMs));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The `n` Denver days immediately before `dateStr`, newest first. */
export function previousDenverDays(dateStr: string, n: number): string[] {
  if (n <= 0) return [];
  const [y, m, d] = parseYmd(dateStr);
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    // Midday avoids any DST edge when stepping by whole days.
    const ms = Date.UTC(y, m - 1, d - i, 12, 0, 0);
    out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dailyReportDates.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add src/utils/dailyReport/dates.ts tests/dailyReportDates.test.ts
git commit -m "feat(blotter): Denver/UTC day boundary helpers

D1 stores UTC; a Denver day is not a UTC day. Bounds are emitted in
D1's 'YYYY-MM-DD HH:MM:SS' shape so they compare as strings against
created_at. Tested across both 2026 DST transitions (Mar 8 = 23h,
Nov 1 = 25h)."
```

---

### Task 2: Report data types

**Files:**
- Create: `src/utils/dailyReport/types.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `DailyReportData`, `CallRow`, `CitationRow`, `TripRow`, `FuelRow`, `CheckRow`, `WorkOrderRow`. Tasks 3 and 4 both import from here.

Column names below are verified against live D1 `785de7ae` on 2026-08-01.

- [ ] **Step 1: Write the file**

Create `src/utils/dailyReport/types.ts`:

```ts
// ============================================================
// RMPG Flex — Daily Blotter: shared shapes
// ============================================================
// collect.ts produces these; render.ts consumes them. Kept in their
// own module so render.ts never needs to import anything that touches
// D1, which is what keeps it a pure function.
// ============================================================

export interface CallRow {
  call_number: string | null;
  received_at: string | null;
  incident_type: string | null;
  priority: string | number | null;
  location_address: string | null;
  disposition: string | null;
  status: string | null;
  /** From calls_for_service directly — call_units is empty on live. */
  unit_call_signs: string | null;
  responding_officer: string | null;
}

export interface CitationRow {
  citation_number: string | null;
  citation_date: string | null;
  violation_description: string | null;
  location_address: string | null;
  issuing_officer_name: string | null;
  fine_amount: number | null;
}

export interface TripRow {
  vehicle_label: string;
  trips: number;
  miles: number | null;
  duration_s: number | null;
}

export interface FuelRow {
  vehicle_label: string;
  fuel_date: string | null;
  gallons: number | null;
  total_cost: number | null;
  odometer: number | null;
  station: string | null;
}

export interface CheckRow {
  vehicle_label: string;
  kind: 'inspection' | 'pretrip';
  performed_at: string | null;
  result: string | null;
  performed_by: string | null;
}

export interface WorkOrderRow {
  number: string | null;
  vehicle_label: string;
  event: 'opened' | 'closed';
  at: string | null;
  summary: string | null;
  status: string | null;
}

export interface DailyReportData {
  /** Denver calendar day, YYYY-MM-DD. */
  date: string;
  /** ISO instant the report was produced. */
  generatedAt: string;
  operations: {
    calls: CallRow[];
    citations: CitationRow[];
  };
  fleet: {
    trips: TripRow[];
    fuel: FuelRow[];
    checks: CheckRow[];
    workOrders: WorkOrderRow[];
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/utils/dailyReport/types.ts
git commit -m "feat(blotter): shared report data shapes

Separate module so render.ts imports no D1-touching code, which is
what lets it stay a pure function."
```

---

### Task 3: Data collection

**Files:**
- Create: `src/utils/dailyReport/collect.ts`
- Test: `tests/dailyReportCollect.test.ts`

**Interfaces:**
- Consumes: `denverDayBoundsUtc` (Task 1); all types from Task 2.
- Produces: `collectDailyReport(db: D1Database, date: string, nowIso?: string): Promise<DailyReportData>` and `isEmpty(data: DailyReportData): boolean`.

- [ ] **Step 1: Write the failing test**

Create `tests/dailyReportCollect.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { collectDailyReport, isEmpty } from '../src/utils/dailyReport/collect';

/** Records every SQL string + bindings, returns canned rows per table. */
function makeDb(rowsByTable: Record<string, unknown[]>) {
  const calls: { sql: string; bindings: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const ctx = { sql, bindings: [] as unknown[] };
      const stmt = {
        bind(...args: unknown[]) { ctx.bindings = args; return stmt; },
        async all<T>(): Promise<{ results: T[] }> {
          calls.push(ctx);
          const table = Object.keys(rowsByTable).find((t) => new RegExp(`FROM ${t}\\b`).test(sql));
          return { results: (table ? rowsByTable[table] : []) as T[] };
        },
      };
      return stmt;
    },
  } as unknown as Parameters<typeof collectDailyReport>[0];
  return { db, calls };
}

const EMPTY = {};

describe('collectDailyReport', () => {
  it('reports an empty day as empty', async () => {
    const { db } = makeDb(EMPTY);
    const data = await collectDailyReport(db, '2026-07-18', '2026-08-01T00:00:00.000Z');
    expect(data.date).toBe('2026-07-18');
    expect(isEmpty(data)).toBe(true);
  });

  it('carries rows into the right sections', async () => {
    const { db } = makeDb({
      calls_for_service: [{
        call_number: 'C-1', received_at: '2026-07-18 20:00:00', incident_type: 'ALARM',
        priority: 2, location_address: '123 Main', disposition: 'CLEARED',
        status: 'CLOSED', unit_call_signs: '1A1', responding_officer: 'Zamora',
      }],
      fleet_fuel_log: [{
        vehicle_label: 'Unit 1', fuel_date: '2026-07-18 10:00:00', gallons: 12.5,
        total_cost: 50, odometer: 94590, station: 'Maverik',
      }],
    });
    const data = await collectDailyReport(db, '2026-07-18', '2026-08-01T00:00:00.000Z');
    expect(data.operations.calls).toHaveLength(1);
    expect(data.operations.calls[0].call_number).toBe('C-1');
    expect(data.fleet.fuel).toHaveLength(1);
    expect(isEmpty(data)).toBe(false);
  });

  it('binds Denver day bounds in D1 format, never date()', async () => {
    const { db, calls } = makeDb(EMPTY);
    await collectDailyReport(db, '2026-07-18', '2026-08-01T00:00:00.000Z');
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      // A stub that filtered in TS would pass regardless — pin the real SQL.
      expect(c.sql).not.toMatch(/\bdate\s*\(/i);
      expect(c.bindings).toContain('2026-07-18 06:00:00');
      expect(c.bindings).toContain('2026-07-19 06:00:00');
    }
  });

  it('never selects * from calls_for_service (100-column cap)', async () => {
    const { db, calls } = makeDb(EMPTY);
    await collectDailyReport(db, '2026-07-18', '2026-08-01T00:00:00.000Z');
    const cfs = calls.filter((c) => /FROM calls_for_service\b/.test(c.sql));
    expect(cfs.length).toBeGreaterThan(0);
    for (const c of cfs) expect(c.sql).not.toMatch(/SELECT\s+\*|SELECT\s+\w+\.\*/i);
  });

  it('never joins through the empty call_units table', async () => {
    const { db, calls } = makeDb(EMPTY);
    await collectDailyReport(db, '2026-07-18', '2026-08-01T00:00:00.000Z');
    for (const c of calls) expect(c.sql).not.toMatch(/\bcall_units\b/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dailyReportCollect.test.ts`
Expected: FAIL — cannot resolve `../src/utils/dailyReport/collect`.

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/dailyReport/collect.ts`:

```ts
// ============================================================
// RMPG Flex — Daily Blotter: data collection
// ============================================================
// Every D1 read for the blotter lives here. No formatting, no PDF.
//
// Two constraints are load-bearing:
//   1. calls_for_service is at D1's 100-column cap — explicit column
//      lists only, never SELECT *.
//   2. call_units has ZERO rows on live, so unit attribution comes from
//      calls_for_service.unit_call_signs / .responding_officer. A join
//      through call_units renders a silently empty operations section.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { denverDayBoundsUtc } from './dates';
import type {
  DailyReportData, CallRow, CitationRow, TripRow, FuelRow, CheckRow, WorkOrderRow,
} from './types';

/** `fleet_vehicles` has no single display column; prefer the most
 *  human-meaningful non-null of the three, then fall back to the id. */
const VEHICLE_LABEL_SQL = `COALESCE(NULLIF(v.vehicle_name,''), NULLIF(v.vehicle_number,''), NULLIF(v.plate_number,''), 'Vehicle ' || v.id)`;

async function all<T>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T[]> {
  const rs = await db.prepare(sql).bind(...binds).all<T>();
  return rs.results ?? [];
}

export async function collectDailyReport(
  db: D1Database,
  date: string,
  nowIso?: string,
): Promise<DailyReportData> {
  const { startUtc, endUtc } = denverDayBoundsUtc(date);

  const calls = await all<CallRow>(
    db,
    `SELECT call_number, received_at, incident_type, priority, location_address,
            disposition, status, unit_call_signs, responding_officer
       FROM calls_for_service
      WHERE COALESCE(received_at, created_at) >= ? AND COALESCE(received_at, created_at) < ?
      ORDER BY COALESCE(received_at, created_at) ASC`,
    startUtc, endUtc,
  );

  const citations = await all<CitationRow>(
    db,
    `SELECT citation_number, citation_date, violation_description, location_address,
            issuing_officer_name, fine_amount
       FROM citations
      WHERE COALESCE(citation_date, created_at) >= ? AND COALESCE(citation_date, created_at) < ?
      ORDER BY COALESCE(citation_date, created_at) ASC`,
    startUtc, endUtc,
  );

  const trips = await all<TripRow>(
    db,
    `SELECT ${VEHICLE_LABEL_SQL} AS vehicle_label,
            COUNT(*) AS trips,
            ROUND(SUM(COALESCE(t.distance_m, 0)) / 1609.344, 1) AS miles,
            SUM(COALESCE(t.duration_s, 0)) AS duration_s
       FROM unit_trips t
       LEFT JOIN fleet_vehicles v ON v.id = t.vehicle_id
      WHERE t.start_time >= ? AND t.start_time < ?
      GROUP BY vehicle_label
      ORDER BY vehicle_label ASC`,
    startUtc, endUtc,
  );

  const fuel = await all<FuelRow>(
    db,
    `SELECT ${VEHICLE_LABEL_SQL} AS vehicle_label,
            f.fuel_date, f.gallons, f.total_cost, f.odometer, f.station
       FROM fleet_fuel_log f
       LEFT JOIN fleet_vehicles v ON v.id = f.vehicle_id
      WHERE COALESCE(f.fuel_date, f.created_at) >= ? AND COALESCE(f.fuel_date, f.created_at) < ?
      ORDER BY COALESCE(f.fuel_date, f.created_at) ASC`,
    startUtc, endUtc,
  );

  const inspections = await all<CheckRow>(
    db,
    `SELECT ${VEHICLE_LABEL_SQL} AS vehicle_label,
            'inspection' AS kind,
            COALESCE(i.inspection_date, i.created_at) AS performed_at,
            COALESCE(i.overall_result, CASE WHEN i.passed = 1 THEN 'PASS' ELSE 'FAIL' END) AS result,
            i.inspector AS performed_by
       FROM fleet_inspections i
       LEFT JOIN fleet_vehicles v ON v.id = i.vehicle_id
      WHERE COALESCE(i.inspection_date, i.created_at) >= ? AND COALESCE(i.inspection_date, i.created_at) < ?
      ORDER BY performed_at ASC`,
    startUtc, endUtc,
  );

  const pretrips = await all<CheckRow>(
    db,
    `SELECT ${VEHICLE_LABEL_SQL} AS vehicle_label,
            'pretrip' AS kind,
            COALESCE(p.check_date, p.created_at) AS performed_at,
            p.status AS result,
            CAST(p.officer_id AS TEXT) AS performed_by
       FROM fleet_pretrip_checklists p
       LEFT JOIN fleet_vehicles v ON v.id = p.vehicle_id
      WHERE COALESCE(p.check_date, p.created_at) >= ? AND COALESCE(p.check_date, p.created_at) < ?
      ORDER BY performed_at ASC`,
    startUtc, endUtc,
  );

  const opened = await all<WorkOrderRow>(
    db,
    `SELECT w.number, ${VEHICLE_LABEL_SQL} AS vehicle_label,
            'opened' AS event, w.opened_at AS at, w.summary, w.status
       FROM work_orders w
       LEFT JOIN fleet_vehicles v ON v.id = w.vehicle_id
      WHERE w.opened_at >= ? AND w.opened_at < ?
      ORDER BY w.opened_at ASC`,
    startUtc, endUtc,
  );

  const closed = await all<WorkOrderRow>(
    db,
    `SELECT w.number, ${VEHICLE_LABEL_SQL} AS vehicle_label,
            'closed' AS event, w.closed_at AS at, w.summary, w.status
       FROM work_orders w
       LEFT JOIN fleet_vehicles v ON v.id = w.vehicle_id
      WHERE w.closed_at >= ? AND w.closed_at < ?
      ORDER BY w.closed_at ASC`,
    startUtc, endUtc,
  );

  return {
    date,
    generatedAt: nowIso ?? new Date().toISOString(),
    operations: { calls, citations },
    fleet: {
      trips,
      fuel,
      checks: [...inspections, ...pretrips],
      workOrders: [...opened, ...closed],
    },
  };
}

/** True when the day produced nothing worth archiving. */
export function isEmpty(data: DailyReportData): boolean {
  return (
    data.operations.calls.length === 0 &&
    data.operations.citations.length === 0 &&
    data.fleet.trips.length === 0 &&
    data.fleet.fuel.length === 0 &&
    data.fleet.checks.length === 0 &&
    data.fleet.workOrders.length === 0
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dailyReportCollect.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify every query runs against live D1**

The stub cannot catch a SQL error. Run each shape once, read-only, substituting real bounds:

```bash
npx wrangler d1 execute rmpg-flex --remote --command "SELECT call_number, received_at, incident_type, priority, location_address, disposition, status, unit_call_signs, responding_officer FROM calls_for_service WHERE COALESCE(received_at, created_at) >= '2026-07-30 06:00:00' AND COALESCE(received_at, created_at) < '2026-07-31 06:00:00' ORDER BY COALESCE(received_at, created_at) ASC"
```

Expected: rows returned (2026-07-30 had 6 calls), no error. Repeat for the trips, fuel, inspections, pretrip and work-order queries. Any `no such column` here is a real defect the unit tests cannot see.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/utils/dailyReport/collect.ts tests/dailyReportCollect.test.ts
git commit -m "feat(blotter): day data collection

Explicit column lists (calls_for_service is at the 100-col cap) and no
call_units join (zero rows on live — a join there renders a silently
empty operations section). Tests pin the emitted SQL, because a stub
that filtered in TS would pass either way."
```

---

### Task 4: PDF rendering

**Files:**
- Modify: `package.json` (add `pdf-lib`)
- Create: `src/utils/dailyReport/render.ts`
- Test: `tests/dailyReportRender.test.ts`

**Interfaces:**
- Consumes: `DailyReportData` (Task 2).
- Produces: `renderDailyReport(data: DailyReportData): Promise<Uint8Array>`.

- [ ] **Step 1: Add the dependency and record the bundle baseline**

```bash
npx wrangler deploy --dry-run --outdir /tmp/bundle-before >/dev/null 2>&1
ls -l /tmp/bundle-before/index.js | awk '{print "before:", $5, "bytes"}'
npm install pdf-lib --save
```

Note the "before" number — Step 7 compares against it.

- [ ] **Step 2: Write the failing test**

Create `tests/dailyReportRender.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderDailyReport } from '../src/utils/dailyReport/render';
import type { DailyReportData } from '../src/utils/dailyReport/types';

const emptyData: DailyReportData = {
  date: '2026-07-18',
  generatedAt: '2026-08-01T12:00:00.000Z',
  operations: { calls: [], citations: [] },
  fleet: { trips: [], fuel: [], checks: [], workOrders: [] },
};

const fullData: DailyReportData = {
  ...emptyData,
  operations: {
    calls: [{
      call_number: 'C-1', received_at: '2026-07-18 20:00:00', incident_type: 'ALARM',
      priority: 2, location_address: '123 Main St', disposition: 'CLEARED',
      status: 'CLOSED', unit_call_signs: '1A1', responding_officer: 'Zamora',
    }],
    citations: [],
  },
  fleet: {
    trips: [{ vehicle_label: 'Unit 1', trips: 3, miles: 42.5, duration_s: 5400 }],
    fuel: [], checks: [], workOrders: [],
  },
};

describe('renderDailyReport', () => {
  it('produces a real PDF', async () => {
    const bytes = await renderDailyReport(fullData);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(500);
  });

  it('renders an explicit no-activity line rather than omitting a section', async () => {
    // Distinguishing "quiet day" from "report is broken" is the whole point.
    const empty = await renderDailyReport(emptyData);
    const populated = await renderDailyReport(fullData);
    expect(empty.length).toBeGreaterThan(500);
    expect(populated.length).not.toBe(empty.length);
  });

  it('is deterministic for identical input', async () => {
    const a = await renderDailyReport(fullData);
    const b = await renderDailyReport(fullData);
    expect(a.length).toBe(b.length);
  });

  it('is pure — no bindings, no globals, no throw on minimal input', async () => {
    await expect(renderDailyReport(emptyData)).resolves.toBeInstanceOf(Uint8Array);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/dailyReportRender.test.ts`
Expected: FAIL — cannot resolve `../src/utils/dailyReport/render`.

- [ ] **Step 4: Write minimal implementation**

Create `src/utils/dailyReport/render.ts`:

```ts
// ============================================================
// RMPG Flex — Daily Blotter: PDF rendering
// ============================================================
// PURE: DailyReportData in, PDF bytes out. No D1, no R2, no clock —
// `generatedAt` arrives on the data. That purity is what lets the tests
// run with no bindings at all.
//
// pdf-lib rather than the [browser] Browser Rendering binding: it is
// pure JS, Workers-compatible, and not billed per browser-minute.
// The client keeps its own jsPDF v2 engine; the two coexist.
// ============================================================

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { DailyReportData } from './types';

const PAGE_W = 612;   // US Letter, points
const PAGE_H = 792;
const MARGIN = 48;
const LINE = 12;
const NO_ACTIVITY = 'No activity recorded.';

interface Cursor { page: ReturnType<PDFDocument['addPage']>; y: number; }

export async function renderDailyReport(data: DailyReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const cur: Cursor = { page: doc.addPage([PAGE_W, PAGE_H]), y: PAGE_H - MARGIN };

  const newPage = (): void => {
    cur.page = doc.addPage([PAGE_W, PAGE_H]);
    cur.y = PAGE_H - MARGIN;
  };

  const text = (s: string, size: number, useBold: boolean): void => {
    if (cur.y < MARGIN + LINE) newPage();
    cur.page.drawText(s.slice(0, 120), {
      x: MARGIN, y: cur.y, size,
      font: useBold ? bold : font,
      color: rgb(0.05, 0.05, 0.05),
    });
    cur.y -= size + 4;
  };

  const heading = (s: string): void => { cur.y -= 6; text(s, 12, true); };
  const row = (s: string): void => text(s, 8, false);

  // ── Header ──
  text('Rocky Mountain Protective Group', 16, true);
  text(`Daily Blotter — ${data.date}`, 12, true);
  text(`Generated ${data.generatedAt}`, 8, false);

  // ── Operations ──
  heading('OPERATIONS — Calls for Service');
  if (data.operations.calls.length === 0) row(NO_ACTIVITY);
  for (const c of data.operations.calls) {
    row(`${c.received_at ?? '—'}  ${c.call_number ?? '—'}  ${c.incident_type ?? '—'}  P${c.priority ?? '—'}`);
    row(`    ${c.location_address ?? '—'}  |  unit ${c.unit_call_signs ?? '—'}  |  ${c.responding_officer ?? '—'}  |  ${c.disposition ?? c.status ?? '—'}`);
  }

  heading('OPERATIONS — Citations');
  if (data.operations.citations.length === 0) row(NO_ACTIVITY);
  for (const c of data.operations.citations) {
    row(`${c.citation_date ?? '—'}  ${c.citation_number ?? '—'}  ${c.violation_description ?? '—'}  $${c.fine_amount ?? 0}`);
  }

  // ── Fleet ──
  heading('FLEET — Trips & Mileage');
  if (data.fleet.trips.length === 0) row(NO_ACTIVITY);
  for (const t of data.fleet.trips) {
    row(`${t.vehicle_label}  ${t.trips} trip(s)  ${t.miles ?? 0} mi  ${Math.round((t.duration_s ?? 0) / 60)} min`);
  }

  heading('FLEET — Fuel');
  if (data.fleet.fuel.length === 0) row(NO_ACTIVITY);
  for (const f of data.fleet.fuel) {
    row(`${f.fuel_date ?? '—'}  ${f.vehicle_label}  ${f.gallons ?? 0} gal  $${f.total_cost ?? 0}  odo ${f.odometer ?? '—'}  ${f.station ?? ''}`);
  }

  heading('FLEET — Inspections & Pre-Trip Checks');
  if (data.fleet.checks.length === 0) row(NO_ACTIVITY);
  for (const c of data.fleet.checks) {
    row(`${c.performed_at ?? '—'}  ${c.vehicle_label}  ${c.kind}  ${c.result ?? '—'}  ${c.performed_by ?? ''}`);
  }

  heading('FLEET — Work Orders');
  if (data.fleet.workOrders.length === 0) row(NO_ACTIVITY);
  for (const w of data.fleet.workOrders) {
    row(`${w.at ?? '—'}  ${w.number ?? '—'}  ${w.vehicle_label}  ${w.event}  ${w.summary ?? ''}`);
  }

  // ── Footer page numbers ──
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(`Page ${i + 1} of ${pages.length}`, {
      x: PAGE_W - MARGIN - 70, y: MARGIN - 20, size: 7, font,
      color: rgb(0.4, 0.4, 0.4),
    });
  });

  return doc.save();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/dailyReportRender.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Look at an actual PDF**

A PDF that parses is not a PDF that reads well. Generate one and open it:

```bash
npx vitest run tests/dailyReportRender.test.ts --reporter=verbose
```

Then add a throwaway script that writes `/tmp/blotter.pdf` from `fullData` and open it (`open /tmp/blotter.pdf`). Confirm: nothing overlaps, nothing runs off the right edge, the footer is visible. Delete the script before committing. *(Per the `serve-pdf-layout-traps` memory, jsPDF/pdf-lib layout defects are invisible without rendering and looking.)*

- [ ] **Step 7: Check the bundle delta**

```bash
npx wrangler deploy --dry-run --outdir /tmp/bundle-after >/dev/null 2>&1
ls -l /tmp/bundle-after/index.js | awk '{print "after:", $5, "bytes"}'
```

If the increase is over ~1 MB, switch `render.ts` to a lazy `const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');` inside the function so only the cron and `generate` pay for it. Record the actual before/after numbers in the commit message either way.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/utils/dailyReport/render.ts tests/dailyReportRender.test.ts
git commit -m "feat(blotter): pdf-lib renderer

Pure data->bytes, no bindings, so it tests without Miniflare. pdf-lib
over the [browser] binding because the latter bills per browser-minute.
Empty sections print 'No activity recorded' so a reader can tell a quiet
day from a broken report. Bundle: <before> -> <after> bytes."
```

---

### Task 5: R2 storage

**Files:**
- Create: `src/utils/dailyReport/store.ts`
- Test: `tests/dailyReportStore.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `reportKey(date)`, `parseReportKey(key)`, `reportFilename(date)`, `putReport(bucket, date, bytes)`, `getReport(bucket, filename)`, `listReports(bucket)`, `hasReport(bucket, date)`, and `interface StoredReport { filename: string; date: string; size: number; generated_at: string }`.

- [ ] **Step 1: Write the failing test**

Create `tests/dailyReportStore.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reportKey, parseReportKey, reportFilename } from '../src/utils/dailyReport/store';

describe('report key scheme', () => {
  it('builds a year/month partitioned key', () => {
    expect(reportKey('2026-07-18')).toBe('daily-reports/2026/07/rmpg-daily-2026-07-18.pdf');
  });

  it('round-trips', () => {
    const k = reportKey('2026-07-18');
    expect(parseReportKey(k)).toEqual({
      date: '2026-07-18',
      filename: 'rmpg-daily-2026-07-18.pdf',
    });
  });

  it('exposes the bare filename the UI passes back', () => {
    expect(reportFilename('2026-07-18')).toBe('rmpg-daily-2026-07-18.pdf');
  });

  // The download route resolves user input through parseReportKey rather
  // than interpolating it, so traversal must be structurally rejected.
  it('rejects traversal and malformed input', () => {
    expect(parseReportKey('daily-reports/2026/07/../../../secret.pdf')).toBeNull();
    expect(parseReportKey('rmpg-daily-2026-07-18.txt')).toBeNull();
    expect(parseReportKey('rmpg-daily-not-a-date.pdf')).toBeNull();
    expect(parseReportKey('')).toBeNull();
    expect(parseReportKey('daily-reports/2026/07/rmpg-daily-2026-13-99.pdf')).toBeNull();
  });

  it('accepts a bare filename as well as a full key', () => {
    expect(parseReportKey('rmpg-daily-2026-07-18.pdf')?.date).toBe('2026-07-18');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dailyReportStore.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/dailyReport/store.ts`:

```ts
// ============================================================
// RMPG Flex — Daily Blotter: R2 storage
// ============================================================
// R2 is the single source of truth for which reports exist — by-month
// is built from a list, so there is no index table that can drift from
// the objects.
//
// parseReportKey is also the security boundary: the download route
// resolves a caller-supplied filename THROUGH it rather than
// interpolating it into a key, so traversal is structurally impossible.
// ============================================================

import type { R2Bucket, R2ObjectBody } from '@cloudflare/workers-types';

const PREFIX = 'daily-reports/';
const FILENAME_RE = /^rmpg-daily-(\d{4})-(\d{2})-(\d{2})\.pdf$/;

export interface StoredReport {
  filename: string;
  date: string;
  size: number;
  generated_at: string;
}

export function reportFilename(date: string): string {
  return `rmpg-daily-${date}.pdf`;
}

export function reportKey(date: string): string {
  const [y, m] = date.split('-');
  return `${PREFIX}${y}/${m}/${reportFilename(date)}`;
}

/** Accepts a full key or a bare filename. Returns null for anything that
 *  is not an exact, well-formed report name — including traversal. */
export function parseReportKey(input: string): { date: string; filename: string } | null {
  if (!input || input.includes('..')) return null;
  const filename = input.slice(input.lastIndexOf('/') + 1);
  const m = FILENAME_RE.exec(filename);
  if (!m) return null;
  const [, y, mo, d] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = `${y}-${mo}-${d}`;
  // Reject impossible dates (e.g. 2026-02-31) by round-tripping.
  const probe = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== date) return null;
  return { date, filename };
}

export async function putReport(bucket: R2Bucket, date: string, bytes: Uint8Array): Promise<void> {
  await bucket.put(reportKey(date), bytes, {
    httpMetadata: { contentType: 'application/pdf' },
    customMetadata: { generated_at: new Date().toISOString(), report_date: date },
  });
}

export async function getReport(bucket: R2Bucket, filename: string): Promise<R2ObjectBody | null> {
  const parsed = parseReportKey(filename);
  if (!parsed) return null;
  return bucket.get(reportKey(parsed.date));
}

export async function hasReport(bucket: R2Bucket, date: string): Promise<boolean> {
  return (await bucket.head(reportKey(date))) !== null;
}

/** Every stored report, newest first. Paginates — R2 list caps at 1000. */
export async function listReports(bucket: R2Bucket): Promise<StoredReport[]> {
  const out: StoredReport[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: PREFIX, limit: 1000, cursor, include: ['customMetadata'] });
    for (const obj of page.objects) {
      const parsed = parseReportKey(obj.key);
      if (!parsed) continue;
      out.push({
        filename: parsed.filename,
        date: parsed.date,
        size: obj.size,
        generated_at: obj.customMetadata?.generated_at ?? obj.uploaded.toISOString(),
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dailyReportStore.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/utils/dailyReport/store.ts tests/dailyReportStore.test.ts
git commit -m "feat(blotter): R2 key scheme and storage

R2 is the source of truth for which reports exist, so by-month can't
drift from the objects. parseReportKey doubles as the security boundary
for the download route — traversal is rejected structurally, not by
sanitizing."
```

---

### Task 6: HTTP endpoints

**Files:**
- Create: `src/routes/dailyReports.ts`
- Modify: `src/routes/reports.ts` (mount the sub-router; the file ends with `export default reports;`)
- Test: `test-workers/dailyReports.test.ts`

**Interfaces:**
- Consumes: `collectDailyReport`/`isEmpty` (Task 3), `renderDailyReport` (Task 4), all of `store.ts` (Task 5).
- Produces: routes at `/api/reports/daily-reports/*`.

- [ ] **Step 1: Write the failing test**

Create `test-workers/dailyReports.test.ts`, following the existing patterns in `test-workers/health.test.ts` and `test-workers/auth.test.ts` for building an authed request:

```ts
import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { reportKey } from '../src/utils/dailyReport/store';

// Mirror the token helper used by test-workers/auth.test.ts.
async function authHeaders(role: 'admin' | 'officer'): Promise<Record<string, string>> {
  const { SignJWT } = await import('jose');
  const secret = new TextEncoder().encode(env.JWT_SECRET);
  const token = await new SignJWT({ userId: 1, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(secret);
  return { Authorization: `Bearer ${token}` };
}

describe('GET /api/reports/daily-reports/by-month', () => {
  it('returns an empty shape, not a 500, when nothing is stored', async () => {
    const res = await SELF.fetch('https://x/api/reports/daily-reports/by-month', {
      headers: await authHeaders('officer'),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { months: unknown[]; total_reports: number };
    expect(Array.isArray(body.months)).toBe(true);
    expect(body.total_reports).toBe(0);
  });

  it('groups stored reports by month, newest first', async () => {
    await env.DOWNLOADS.put(reportKey('2026-07-18'), new Uint8Array([1, 2, 3]));
    await env.DOWNLOADS.put(reportKey('2026-08-01'), new Uint8Array([1, 2, 3]));
    const res = await SELF.fetch('https://x/api/reports/daily-reports/by-month', {
      headers: await authHeaders('officer'),
    });
    const body = await res.json() as { months: { month: string; days: { date: string }[] }[]; total_reports: number };
    expect(body.total_reports).toBe(2);
    expect(body.months[0].month).toBe('2026-08');
    expect(body.months[1].month).toBe('2026-07');
    expect(body.months[1].days[0].date).toBe('2026-07-18');
  });

  // Pins the mount: a sibling route in reports.ts must not swallow this path.
  it('resolves to the daily-reports router, not a sibling handler', async () => {
    const res = await SELF.fetch('https://x/api/reports/daily-reports/by-month', {
      headers: await authHeaders('officer'),
    });
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('months');
  });
});

describe('GET /api/reports/daily-reports/:filename', () => {
  it('serves stored bytes inline as a PDF', async () => {
    await env.DOWNLOADS.put(reportKey('2026-07-18'), new TextEncoder().encode('%PDF-1.7 test'));
    const res = await SELF.fetch('https://x/api/reports/daily-reports/rmpg-daily-2026-07-18.pdf', {
      headers: await authHeaders('officer'),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('inline');
  });

  it('404s an unknown report', async () => {
    const res = await SELF.fetch('https://x/api/reports/daily-reports/rmpg-daily-1999-01-01.pdf', {
      headers: await authHeaders('officer'),
    });
    expect(res.status).toBe(404);
  });

  it('404s a malformed filename rather than touching R2', async () => {
    const res = await SELF.fetch('https://x/api/reports/daily-reports/not-a-report.pdf', {
      headers: await authHeaders('officer'),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/reports/daily-reports/generate', () => {
  it('is admin-only', async () => {
    const res = await SELF.fetch('https://x/api/reports/daily-reports/generate', {
      method: 'POST',
      headers: { ...(await authHeaders('officer')), 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-07-18' }),
    });
    expect(res.status).toBe(403);
  });

  it('reports ok:false for a day with no activity', async () => {
    const res = await SELF.fetch('https://x/api/reports/daily-reports/generate', {
      method: 'POST',
      headers: { ...(await authHeaders('admin')), 'content-type': 'application/json' },
      body: JSON.stringify({ date: '1999-01-01' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; message?: string };
    expect(body.ok).toBe(false);
    expect(body.message).toBeTruthy();
  });

  it('rejects a malformed date', async () => {
    const res = await SELF.fetch('https://x/api/reports/daily-reports/generate', {
      method: 'POST',
      headers: { ...(await authHeaders('admin')), 'content-type': 'application/json' },
      body: JSON.stringify({ date: 'yesterday' }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/dailyReports.test.ts`
Expected: FAIL — every request 404s, because the router does not exist.

- [ ] **Step 3: Write the router**

Create `src/routes/dailyReports.ts`:

```ts
// ============================================================
// RMPG Flex — /api/reports/daily-reports/*
// ============================================================
// Serves the Fleet Daily Blotter archive consumed by
// client/src/pages/fleet/FleetReportsPage.tsx. R2 (DOWNLOADS) is the
// source of truth for which reports exist.
//
// Viewing is open to any authenticated user (the parent /api/reports
// router is already auth:'required'); generating is admin-only, matching
// the page's own isAdmin gate.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { log } from '../utils/logger';
import { collectDailyReport, isEmpty } from '../utils/dailyReport/collect';
import { renderDailyReport } from '../utils/dailyReport/render';
import { getReport, listReports, putReport, reportFilename, type StoredReport } from '../utils/dailyReport/store';

const dailyReports = new Hono<Env>();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Unset binding → 200 { ok:false, code:'not_configured' }, never 503. */
function bucketOf(c: { env: Env['Bindings'] }) {
  return c.env.DOWNLOADS ?? null;
}

export function groupByMonth(reports: StoredReport[]): { month: string; days: StoredReport[] }[] {
  const byMonth = new Map<string, StoredReport[]>();
  for (const r of reports) {
    const month = r.date.slice(0, 7);
    const bucket = byMonth.get(month);
    if (bucket) bucket.push(r); else byMonth.set(month, [r]);
  }
  return [...byMonth.entries()]
    .map(([month, days]) => ({ month, days }))
    .sort((a, b) => (a.month < b.month ? 1 : -1));
}

dailyReports.get('/by-month', async (c) => {
  const bucket = bucketOf(c);
  if (!bucket) return c.json({ ok: false, code: 'not_configured', months: [], total_reports: 0 });
  try {
    const reports = await listReports(bucket);
    return c.json({ months: groupByMonth(reports), total_reports: reports.length });
  } catch (err) {
    log.error('GET /daily-reports/by-month failed', { src: 'src/routes/dailyReports.ts' }, err as Error);
    return c.json({ error: 'Failed to list reports' }, 500);
  }
});

dailyReports.post('/generate', requireRole('admin'), async (c) => {
  const bucket = bucketOf(c);
  if (!bucket) return c.json({ ok: false, code: 'not_configured' });
  const body = await c.req.json<{ date?: string }>().catch(() => ({} as { date?: string }));
  const date = body.date ?? '';
  if (!DATE_RE.test(date)) return c.json({ error: 'Invalid date; expected YYYY-MM-DD' }, 400);
  try {
    const data = await collectDailyReport(getDb(c.env), date);
    if (isEmpty(data)) {
      return c.json({ ok: false, message: `No activity recorded for ${date}.` });
    }
    await putReport(bucket, date, await renderDailyReport(data));
    return c.json({ ok: true, filename: reportFilename(date) });
  } catch (err) {
    log.error('POST /daily-reports/generate failed', { src: 'src/routes/dailyReports.ts', date }, err as Error);
    return c.json({ error: 'Generation failed' }, 500);
  }
});

// Declared LAST: a bare :filename would otherwise shadow the literal
// routes above. Hono matches in declaration order.
dailyReports.get('/:filename', async (c) => {
  const bucket = bucketOf(c);
  if (!bucket) return c.json({ ok: false, code: 'not_configured' });
  const obj = await getReport(bucket, c.req.param('filename'));
  if (!obj) return c.json({ error: 'Report not found' }, 404);
  return new Response(obj.body as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${c.req.param('filename')}"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
});

export default dailyReports;
```

- [ ] **Step 4: Mount it**

In `src/routes/reports.ts`, add the import at the top of the import block:

```ts
import dailyReports from './dailyReports';
```

and immediately before the final `export default reports;`:

```ts
// Mounted here rather than in routesConfig so it inherits /api/reports'
// auth:'required'. Declaration order matters in Hono — verified 2026-08-01
// that no route above is a bare /:param that could shadow this.
reports.route('/daily-reports', dailyReports);

export default reports;
```

- [ ] **Step 5: Add the DOWNLOADS bucket to the Miniflare config**

Verified 2026-08-01: `vitest.workers.config.mts:17` reads `r2Buckets: ['UPLOADS']`. Without `DOWNLOADS`, every test in this task fails on an undefined binding. Change that line to:

```ts
    r2Buckets: ['UPLOADS', 'DOWNLOADS'],
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/dailyReports.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 7: Full gates and commit**

```bash
npm run typecheck && npx vitest run && npm run test:worker
git add src/routes/dailyReports.ts src/routes/reports.ts test-workers/dailyReports.test.ts vitest.workers.config.mts
git commit -m "feat(blotter): daily-report endpoints

by-month / :filename / generate, matching what FleetReportsPage already
calls. :filename is declared last so it cannot shadow the literal routes.
A routing test pins that /daily-reports/by-month reaches this router and
not a sibling in reports.ts."
```

---

### Task 7: Nightly generation

**Files:**
- Modify: `src/index.ts` (inside the `* * * * *` branch, after `denverHour`/`denverMinute` are computed near line 512)
- Create: `src/utils/dailyReport/nightly.ts`
- Test: `tests/dailyReportNightly.test.ts`
- Modify: `client/src/pages/fleet/FleetReportsPage.tsx` (delete the stale comment)

**Interfaces:**
- Consumes: `denverToday`/`previousDenverDays` (Task 1), `collectDailyReport`/`isEmpty` (Task 3), `renderDailyReport` (Task 4), `hasReport`/`putReport` (Task 5).
- Produces: `runNightlyBlotter(db, bucket, nowMs, backfillDays?): Promise<{ generated: string[]; skipped: string[] }>`.

- [ ] **Step 1: Write the failing test**

Create `tests/dailyReportNightly.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runNightlyBlotter } from '../src/utils/dailyReport/nightly';

function makeDb(datesWithData: Set<string>) {
  return {
    prepare(sql: string) {
      const ctx = { bindings: [] as unknown[] };
      const stmt = {
        bind(...args: unknown[]) { ctx.bindings = args; return stmt; },
        async all<T>(): Promise<{ results: T[] }> {
          // Bound start is 'YYYY-MM-DD HH:MM:SS'; the Denver day it belongs
          // to is the date part of the *local* day, so match on prefix of
          // either the bound start or the day before it (UTC offset).
          const start = String(ctx.bindings[0] ?? '');
          const hit = [...datesWithData].some((d) => start.startsWith(d));
          if (!hit || !/FROM calls_for_service/.test(sql)) return { results: [] };
          return { results: [{ call_number: 'C-1' }] as unknown as T[] };
        },
      };
      return stmt;
    },
  } as unknown as Parameters<typeof runNightlyBlotter>[0];
}

function makeBucket(existing: Set<string>) {
  const put: string[] = [];
  const bucket = {
    async head(key: string) { return existing.has(key) ? { key } : null; },
    async put(key: string) { put.push(key); existing.add(key); },
  } as unknown as Parameters<typeof runNightlyBlotter>[1];
  return { bucket, put };
}

// 2026-07-19 07:05 UTC === 2026-07-19 01:05 MDT, so "yesterday" is 07-18.
const NOW = Date.parse('2026-07-19T07:05:00Z');

describe('runNightlyBlotter', () => {
  it('generates yesterday when it has activity and is missing', async () => {
    const { bucket, put } = makeBucket(new Set());
    const res = await runNightlyBlotter(makeDb(new Set(['2026-07-18'])), bucket, NOW, 1);
    expect(res.generated).toEqual(['2026-07-18']);
    expect(put).toEqual(['daily-reports/2026/07/rmpg-daily-2026-07-18.pdf']);
  });

  it('skips a day that already has a report', async () => {
    const { bucket, put } = makeBucket(new Set(['daily-reports/2026/07/rmpg-daily-2026-07-18.pdf']));
    const res = await runNightlyBlotter(makeDb(new Set(['2026-07-18'])), bucket, NOW, 1);
    expect(res.generated).toEqual([]);
    expect(put).toEqual([]);
  });

  it('writes nothing for a day with no activity', async () => {
    const { bucket, put } = makeBucket(new Set());
    const res = await runNightlyBlotter(makeDb(new Set()), bucket, NOW, 1);
    expect(res.generated).toEqual([]);
    expect(put).toEqual([]);
    expect(res.skipped).toContain('2026-07-18');
  });

  it('backfills up to N missing days', async () => {
    const { bucket, put } = makeBucket(new Set());
    const res = await runNightlyBlotter(
      makeDb(new Set(['2026-07-18', '2026-07-16'])), bucket, NOW, 7,
    );
    expect(res.generated).toEqual(['2026-07-18', '2026-07-16']);
    expect(put).toHaveLength(2);
  });

  it('is bounded — never considers more than backfillDays', async () => {
    const { bucket } = makeBucket(new Set());
    const res = await runNightlyBlotter(makeDb(new Set()), bucket, NOW, 7);
    expect(res.skipped).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dailyReportNightly.test.ts`
Expected: FAIL — cannot resolve `../src/utils/dailyReport/nightly`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/dailyReport/nightly.ts`:

```ts
// ============================================================
// RMPG Flex — Daily Blotter: nightly generation
// ============================================================
// Runs at 00:05 America/Denver off the existing per-minute cron.
// Generates yesterday, then backfills any of the previous N Denver days
// missing from R2 — self-healing after an outage, bounded so it can
// never run long. Days with no activity produce no object and are
// re-checked cheaply each night (head + a short-circuited collect).
// ============================================================

import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { denverToday, previousDenverDays } from './dates';
import { collectDailyReport, isEmpty } from './collect';
import { renderDailyReport } from './render';
import { hasReport, putReport } from './store';

export const DEFAULT_BACKFILL_DAYS = 7;

export interface NightlyResult {
  generated: string[];
  skipped: string[];
}

export async function runNightlyBlotter(
  db: D1Database,
  bucket: R2Bucket,
  nowMs: number,
  backfillDays: number = DEFAULT_BACKFILL_DAYS,
): Promise<NightlyResult> {
  const today = denverToday(nowMs);
  const candidates = previousDenverDays(today, Math.max(1, backfillDays));
  const generated: string[] = [];
  const skipped: string[] = [];

  for (const date of candidates) {
    if (await hasReport(bucket, date)) { skipped.push(date); continue; }
    const data = await collectDailyReport(db, date);
    if (isEmpty(data)) { skipped.push(date); continue; }
    await putReport(bucket, date, await renderDailyReport(data));
    generated.push(date);
  }

  return { generated, skipped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dailyReportNightly.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire the cron**

In `src/index.ts`, inside the `event.cron === '* * * * *'` branch, immediately after the existing `if (denverHour === 4 && denverMinute === 0) { ... }` block closes, add:

```ts
      // Daily blotter at 00:05 America/Denver. Same hour+minute gate as the
      // 04:00 tasks above — an hour-only gate would fire ~60x. Self-contained
      // try/catch so a blotter failure cannot abort the rest of the cron.
      if (denverHour === 0 && denverMinute === 5) {
        ctx.waitUntil(
          (async () => {
            if (!env.DOWNLOADS) {
              console.warn('[blotter] DOWNLOADS bucket unbound; skipping nightly run');
              return;
            }
            const { runNightlyBlotter } = await import('./utils/dailyReport/nightly');
            const res = await runNightlyBlotter(env.DB, env.DOWNLOADS, Date.now());
            console.log(`[blotter] generated=${res.generated.join(',') || 'none'} skipped=${res.skipped.length}`);
          })().catch((err) => {
            console.error('[blotter] nightly run failed:', err);
            return logErrorToDb(env.DB, {
              severity: 'error',
              category: 'cron',
              message: err instanceof Error ? err.message : String(err),
              source: 'scheduled:daily-blotter',
            }).catch(() => {});
          }),
        );
      }
```

`logErrorToDb` is already imported at `src/index.ts:36` — no new import needed. The dynamic `import()` keeps `pdf-lib` off the hot request path.

- [ ] **Step 6: Remove the stale comment**

In `client/src/pages/fleet/FleetReportsPage.tsx`, replace the header lines:

```
// month → day. Generated nightly at 00:05 MT by the existing
// dailyReportGenerator, served from /api/reports/daily-reports.
```

with:

```
// month → day. Generated nightly at 00:05 America/Denver by
// src/utils/dailyReport/nightly.ts, served from /api/reports/daily-reports.
```

The old text named a module that never existed in the Workers codebase — it described VPS-era code deleted in the 2026-07-16 cleanup.

- [ ] **Step 7: Full gates**

```bash
npm run typecheck
npx vitest run
npm run test:worker
cd client && npx tsc --noEmit && npx vitest run && npx vite build && cd ..
```

Expected: all green. Run the root and client suites **separately, never concurrently** — running both at once fabricates ~9 timeout failures (see the `test-timeout-flakes-not-bugs` memory).

- [ ] **Step 8: Commit**

```bash
git add src/utils/dailyReport/nightly.ts tests/dailyReportNightly.test.ts src/index.ts client/src/pages/fleet/FleetReportsPage.tsx
git commit -m "feat(blotter): nightly generation at 00:05 America/Denver

Reuses the existing per-minute cron's Denver hour+minute gate rather
than adding a trigger, so DST is handled for free. Backfills up to 7
missing days — self-healing after an outage, bounded so it can't run
long. Also drops the FleetReportsPage comment naming a
dailyReportGenerator that never existed in the Workers codebase."
```

---

### Task 8: Verify against production

**Files:** none (verification only)

- [ ] **Step 1: Open the PR**

```bash
git push -u origin claude/fleet-daily-blotter
gh pr create -R rmpgutah/rmpg-flex --base main \
  --title "feat(fleet): Daily Blotter backend" \
  --body "Implements docs/superpowers/specs/2026-08-01-fleet-daily-blotter-design.md. FleetReportsPage has been live and 404ing since it shipped; this builds the three endpoints, the renderer and the nightly job it expects. No client behavior changes beyond a corrected comment."
```

- [ ] **Step 2: After merge, confirm the deploy**

The R2 bucket already exists (`rmpg-flex-downloads`, bound as `DOWNLOADS`) — no migration and no new binding, so nothing needs applying to D1.

- [ ] **Step 3: Generate one real report**

In a browser (the WAF blocks curl on non-`/api/health` paths), open `https://rmpgutah.us/fleet/reports`, click **Regenerate** for **2026-07-30** — the busiest recent day, with 6 calls.

Expected: a toast reading `Regenerated rmpg-daily-2026-07-30.pdf`, the month group appears, and clicking the day opens a PDF listing those 6 calls.

- [ ] **Step 4: Confirm the object landed**

```bash
npx wrangler r2 object get rmpg-flex-downloads/daily-reports/2026/07/rmpg-daily-2026-07-30.pdf --file /tmp/verify.pdf
head -c 5 /tmp/verify.pdf   # expect: %PDF-
```

Open `/tmp/verify.pdf` and read it. Confirm the operations section lists the calls and that empty fleet sections say "No activity recorded" rather than being blank.

- [ ] **Step 5: Confirm an empty day is refused**

Click **Regenerate** for a day with no activity. Expected: a warning toast, no new file in the list, no R2 object created.

---

## Self-Review

**Spec coverage:** dates → Task 1; types → Task 2; collect → Task 3; render + pdf-lib → Task 4; store → Task 5; three endpoints + mount order → Task 6; cron + backfill + stale comment → Task 7; retention (indefinite, no lifecycle rule) → no task needed, it is the default; error-handling table → covered across Tasks 6 and 7; every test group named in the spec has a task.

**Placeholders:** none. Every code step carries real code; every run step names an exact command and expected result. The one deliberate blank is `<before> -> <after>` in Task 4's commit message, which is a measurement the implementer takes in Step 7 of that same task.

**Type consistency:** `DailyReportData`, `StoredReport`, `CallRow`/`CitationRow`/`TripRow`/`FuelRow`/`CheckRow`/`WorkOrderRow` are defined once in Task 2 and imported unchanged by Tasks 3, 4, 6 and 7. `reportKey`/`reportFilename`/`parseReportKey`/`putReport`/`getReport`/`listReports`/`hasReport` are defined in Task 5 and used with matching signatures in Tasks 6 and 7. `collectDailyReport(db, date, nowIso?)` and `isEmpty(data)` match between Tasks 3, 6 and 7. `runNightlyBlotter(db, bucket, nowMs, backfillDays?)` matches between Task 7's implementation and its cron call site.
