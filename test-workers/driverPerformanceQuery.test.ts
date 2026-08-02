// Query-layer execution coverage for the driver-performance route.
//
// Runs the EXACT AGG_SQL the route uses (imported, not retyped) against a real
// Miniflare D1, so a column renamed out from under the query fails here rather
// than silently returning NULLs that shape() reads as zero events.
//
// Officer ids are synthetic 9-thousands numbers — no PII.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute, query, queryFirst } from '../src/utils/db';

import driverPerformance, { AGG_SQL } from '../src/routes/driverPerformance';

type FakeUser = { id: number; role: string; username: string; full_name: string };

function appAs(user: FakeUser) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    c.set('userId', user.id);
    await next();
  });
  app.route('/api/driver-performance', driverPerformance);
  return app;
}

function request(path: string) {
  const user: FakeUser = { id: 1, role: 'supervisor', username: 'supervisor', full_name: 'Supervisor' };
  return appAs(user).request(path, {}, env as unknown as Record<string, unknown>);
}

const FROM = '2026-03-01';
const TO = '2026-03-31';

// Officer 9001: two snapshot days, 300 total miles (above the 250-mile
// exposure floor), a mix of speed tiers across both days.
// Officer 9002: one snapshot day, 100 miles — below the exposure floor.
// Officer 9003: one snapshot day, 300 miles, zero events, feed alive.
// Officer 9005: 900 miles with ZERO breadcrumb samples — the dead-feed case.
beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, full_name TEXT, badge_number TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS driver_performance_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    officer_id INTEGER NOT NULL,
    perf_date TEXT NOT NULL,
    miles_driven REAL NOT NULL DEFAULT 0,
    drive_minutes REAL NOT NULL DEFAULT 0,
    trip_count INTEGER NOT NULL DEFAULT 0,
    events_speed_high INTEGER NOT NULL DEFAULT 0,
    events_speed_very_high INTEGER NOT NULL DEFAULT 0,
    events_speed_extreme INTEGER NOT NULL DEFAULT 0,
    breadcrumb_samples INTEGER NOT NULL DEFAULT 0,
    events_critical INTEGER NOT NULL DEFAULT 0,
    events_high INTEGER NOT NULL DEFAULT 0,
    events_moderate INTEGER NOT NULL DEFAULT 0,
    events_low INTEGER NOT NULL DEFAULT 0,
    attribution_recorded_pct REAL NOT NULL DEFAULT 1,
    attribution_inferred_pct REAL NOT NULL DEFAULT 0,
    unattributed_events INTEGER NOT NULL DEFAULT 0,
    fuel_cost REAL NOT NULL DEFAULT 0,
    fuel_gallons REAL NOT NULL DEFAULT 0,
    maintenance_cost REAL NOT NULL DEFAULT 0,
    score REAL,
    score_version TEXT NOT NULL DEFAULT 'v1-speed',
    computed_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(officer_id, perf_date)
  )`);

  await execute(db, `INSERT INTO users (id, full_name, badge_number) VALUES
    (9001, 'Synthetic Officer 9001', 'T-9001'),
    (9002, 'Synthetic Officer 9002', 'T-9002'),
    (9003, 'Synthetic Officer 9003', 'T-9003')`);

  await execute(db, `INSERT INTO driver_performance_daily
    (officer_id, perf_date, miles_driven, trip_count, events_speed_high,
     events_speed_extreme, breadcrumb_samples, score_version)
    VALUES
    (9001, '2026-03-05', 150, 4, 1, 0, 900, 'v1-speed'),
    (9001, '2026-03-06', 150, 4, 0, 2, 900, 'v1-speed'),
    (9002, '2026-03-05', 100, 2, 0, 0, 400, 'v1-speed'),
    (9003, '2026-03-05', 300, 6, 0, 0, 900, 'v1-speed')`);

  // Dead feed: high mileage, no observations. Must NOT be scored 100.
  await execute(db, `INSERT INTO users (id, full_name, badge_number) VALUES
    (9005, 'Synthetic Officer 9005', 'T-9005')`);
  await execute(db, `INSERT INTO driver_performance_daily
    (officer_id, perf_date, miles_driven, trip_count, breadcrumb_samples, score_version)
    VALUES (9005, '2026-03-08', 900, 20, 0, 'v1-speed')`);

  // C1 reproduction: officer 9004 is the high-mileage / zero-attributed-event
  // case. 900 miles, no attributed events, attribution_recorded_pct 1 — the
  // exact snapshot shape that used to render "100.0 · Excellent · 0 events ·
  // Recorded" and rank ABOVE colleagues whose events DID attribute. The only
  // difference is the 14 events that failed attribution.
  await execute(db, `INSERT INTO users (id, full_name, badge_number) VALUES
    (9004, 'Synthetic Officer 9004', 'T-9004')`);
  await execute(db, `INSERT INTO driver_performance_daily
    (officer_id, perf_date, miles_driven, trip_count, attribution_recorded_pct,
     unattributed_events, breadcrumb_samples, events_critical, events_high, score_version)
    VALUES (9004, '2026-03-07', 900, 20, 1, 14, 900, 0, 0, 'v1-speed')`);
});

describe('C1: high mileage with unattributed events is never reported as confidently clean', () => {
  it('forces confidence to inferred and reports the unattributed count', async () => {
    const res = await request(`/api/driver-performance/roster?from=${FROM}&to=${TO}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ranked: Array<{
        officer_id: number; event_count: number; unattributed_events: number;
        result: { status: string; score: number; confidence: string };
      }>;
    };
    const o = body.ranked.find((r) => r.officer_id === 9004);
    expect(o).toBeTruthy();
    // The reassuring parts are all still true — which is exactly why the
    // unattributed count has to be present and the confidence downgraded.
    expect(o!.event_count).toBe(0);
    expect(o!.result.status).toBe('scored');
    expect(o!.result.score).toBe(100);
    expect(o!.unattributed_events).toBe(14);
    expect(o!.result.confidence).toBe('inferred');
  });

  it('leaves a genuinely clean officer (no events, no doubt) labelled recorded', async () => {
    const res = await request(`/api/driver-performance/roster?from=${FROM}&to=${TO}`);
    const body = await res.json() as {
      ranked: Array<{ officer_id: number; unattributed_events: number; result: { confidence: string } }>;
    };
    const o = body.ranked.find((r) => r.officer_id === 9003);
    expect(o!.unattributed_events).toBe(0);
    expect(o!.result.confidence).toBe('recorded');
  });

  it('surfaces the severity breakdown on officer detail', async () => {
    const res = await request(`/api/driver-performance/officer/9004?from=${FROM}&to=${TO}`);
    const body = await res.json() as {
      summary: { severity: { critical: number; high: number; moderate: number; low: number } } | null;
    };
    expect(body.summary!.severity).toEqual({ critical: 0, high: 0, moderate: 0, low: 0 });
  });
});

describe('dead feed: miles with no GPS samples is never reported as a clean 100', () => {
  it('places the zero-sample officer in insufficient_data with reason no_breadcrumb_samples', async () => {
    const res = await request(`/api/driver-performance/roster?from=${FROM}&to=${TO}`);
    const body = await res.json() as {
      ranked: Array<{ officer_id: number }>;
      insufficient_data: Array<{ officer_id: number; breadcrumb_samples: number; result: { status: string; reason: string } }>;
    };
    expect(body.ranked.some((r) => r.officer_id === 9005)).toBe(false);
    const o = body.insufficient_data.find((r) => r.officer_id === 9005);
    expect(o).toBeTruthy();
    expect(o!.breadcrumb_samples).toBe(0);
    expect(o!.result.status).toBe('insufficient_data');
    expect(o!.result.reason).toBe('no_breadcrumb_samples');
  });

  it('reports the observation volume for an officer whose feed IS alive', async () => {
    const res = await request(`/api/driver-performance/roster?from=${FROM}&to=${TO}`);
    const body = await res.json() as { ranked: Array<{ officer_id: number; breadcrumb_samples: number }> };
    expect(body.ranked.find((r) => r.officer_id === 9003)!.breadcrumb_samples).toBe(900);
  });
});

describe('window validation: an inverted window is rejected, not silently emptied', () => {
  it('returns 400 when from is after to', async () => {
    const res = await request('/api/driver-performance/roster?from=2026-03-31&to=2026-03-01');
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_WINDOW');
  });
});

describe('AGG_SQL executes against a real D1', () => {
  it('sums miles and events across multiple days for one officer', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const rows = await query<{
      officer_id: number; miles: number; speed_high: number; speed_extreme: number;
      breadcrumb_samples: number;
    }>(db, AGG_SQL, FROM, TO);

    const officer9001 = rows.find((r) => r.officer_id === 9001);
    expect(officer9001).toBeTruthy();
    expect(officer9001!.miles).toBe(300);
    expect(officer9001!.speed_high).toBe(1);
    expect(officer9001!.speed_extreme).toBe(2);
    expect(officer9001!.breadcrumb_samples).toBe(1800);

    // Confirms every synthetic officer is actually returned, not just the one
    // under close inspection.
    expect(rows.map((r) => r.officer_id).sort()).toEqual([9001, 9002, 9003, 9004, 9005]);
  });

  it('the HAVING d.officer_id = ? variant returns exactly that officer\'s aggregated row', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const row = await queryFirst<{ officer_id: number; miles: number }>(
      db, `${AGG_SQL} HAVING d.officer_id = ?`, FROM, TO, 9002,
    );
    expect(row).toBeTruthy();
    expect(row!.officer_id).toBe(9002);
    expect(row!.miles).toBe(100);
  });
});

describe('GET /roster and GET /officer/:id run AGG_SQL end-to-end', () => {
  it('places the above-floor officer in ranked and the below-floor officer in insufficient_data', async () => {
    const res = await request(`/api/driver-performance/roster?from=${FROM}&to=${TO}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ranked: Array<{ officer_id: number }>;
      insufficient_data: Array<{ officer_id: number }>;
    };
    expect(body.ranked.map((r) => r.officer_id)).toEqual(expect.arrayContaining([9001, 9003]));
    expect(body.insufficient_data.map((r) => r.officer_id)).toEqual(expect.arrayContaining([9002]));
    expect(body.ranked.some((r) => r.officer_id === 9002)).toBe(false);
  });

  it('officer detail returns the same officer\'s aggregated summary via the HAVING variant', async () => {
    const res = await request(`/api/driver-performance/officer/9001?from=${FROM}&to=${TO}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { summary: { officer_id: number; miles_driven: number } | null };
    expect(body.summary).toBeTruthy();
    expect(body.summary!.officer_id).toBe(9001);
    expect(body.summary!.miles_driven).toBe(300);
  });
});

describe('roster failure never reads as an empty (good-driving) result', () => {
  it('returns 500 with code ROSTER_FAILED when the underlying query breaks — not an empty roster', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    // Realistic failure: AGG_SQL joins `users`; drop it out from under the
    // route to force a genuine D1 rejection, exactly as would happen if that
    // table were ever renamed or migrated out from under this query.
    await execute(db, 'DROP TABLE users');

    const res = await request(`/api/driver-performance/roster?from=${FROM}&to=${TO}`);
    expect(res.status).toBe(500);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('ROSTER_FAILED');
  });
});
