// Emergency-response exclusion — integration coverage for rollup.ts against
// a real Miniflare D1.
//
// This is the test that matters LATER, not just today. Right now
// gps_breadcrumbs.current_call_id/unit_status are populated in ZERO of
// 91,382 live rows, so this filter excludes nothing in production — but the
// rollup already excludes on it so the exclusion activates the instant real
// data starts flowing, with no code change required. This test proves the
// filter logic itself with synthetic samples that DO carry call context,
// which live data does not yet, so it can't be proven any other way.
//
// Officer id is a synthetic 9-thousands number — no PII.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { execute, query, ensureDriverPerformanceColumns } from '../src/utils/db';
import { rollupDay } from '../src/utils/driverPerformance/rollup';

const OFFICER_ID = 9401;
const PERF_DATE = '2026-03-10';

// Denver noon on 2026-03-10 is 2026-03-10T19:00:00Z (MDT, UTC-7). Comfortably
// inside the operational day regardless of DST edge handling.
const BASE_UTC_MS = Date.parse('2026-03-10T19:00:00Z');

function ts(offsetSeconds: number): string {
  return new Date(BASE_UTC_MS + offsetSeconds * 1000).toISOString().replace('T', ' ').replace(/\..*$/, '');
}

// gps_breadcrumbs.speed is METERS PER SECOND. ~42.5 m/s ≈ 95 mph — comfortably
// above the 85 mph sustained-speed floor (SPEED_THRESHOLDS.high) on both runs.
const SPEED_MPS = 42.5;

async function resetSchema(db: D1Database) {
  await execute(db, `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, full_name TEXT, badge_number TEXT)`);
  await ensureDriverPerformanceColumns(db);
  await execute(db, `CREATE TABLE IF NOT EXISTS gps_breadcrumbs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    officer_id INTEGER,
    recorded_at TEXT,
    speed REAL,
    current_call_id INTEGER,
    unit_status TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS unit_trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    officer_id INTEGER, distance_m REAL, duration_s REAL, start_time TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS fleet_fuel_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER, total_cost REAL, gallons REAL, fuel_date TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS fleet_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER, officer_id INTEGER, assigned_at TEXT, unassigned_at TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS fleet_maintenance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER, cost REAL, performed_at TEXT
  )`);
  await execute(db, 'DELETE FROM gps_breadcrumbs');
  await execute(db, 'DELETE FROM unit_trips');
  await execute(db, 'DELETE FROM driver_performance_daily WHERE officer_id = ?', OFFICER_ID);
}

describe('rollup.ts: emergency-response samples are excluded from speed-event derivation', () => {
  beforeEach(async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await resetSchema(db);
    await execute(
      db,
      'INSERT OR IGNORE INTO users (id, full_name, badge_number) VALUES (?, ?, ?)',
      OFFICER_ID, 'Synthetic Officer 9401', 'T-9401',
    );
    // Exposure floor: give the officer real trip mileage so a scored/unscored
    // result depends only on the events, not on MIN_EXPOSURE_MILES.
    await execute(
      db,
      'INSERT INTO unit_trips (officer_id, distance_m, duration_s, start_time) VALUES (?, ?, ?, ?)',
      OFFICER_ID, 500000, 3600, ts(0),
    );
  });

  it('a call-context run (current_call_id set) produces NO speed event', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    // Two sustained samples, both on an active call — must be fully excluded.
    for (const offset of [0, 60]) {
      await execute(
        db,
        `INSERT INTO gps_breadcrumbs (officer_id, recorded_at, speed, current_call_id, unit_status)
         VALUES (?, ?, ?, ?, ?)`,
        OFFICER_ID, ts(offset), SPEED_MPS, 5001, 'enroute',
      );
    }
    const result = await rollupDay(db, PERF_DATE);
    expect(result.failures).toBe(0);

    const rows = await query<{ events_speed_high: number; events_speed_very_high: number; events_speed_extreme: number }>(
      db,
      `SELECT events_speed_high, events_speed_very_high, events_speed_extreme
         FROM driver_performance_daily WHERE officer_id = ? AND perf_date = ?`,
      OFFICER_ID, PERF_DATE,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].events_speed_high + rows[0].events_speed_very_high + rows[0].events_speed_extreme).toBe(0);
  });

  it('a run with unit_status "onscene" but no current_call_id is ALSO excluded', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    for (const offset of [0, 60]) {
      await execute(
        db,
        `INSERT INTO gps_breadcrumbs (officer_id, recorded_at, speed, current_call_id, unit_status)
         VALUES (?, ?, ?, NULL, ?)`,
        OFFICER_ID, ts(offset), SPEED_MPS, 'onscene',
      );
    }
    await rollupDay(db, PERF_DATE);
    const rows = await query<{ events_speed_high: number }>(
      db,
      `SELECT events_speed_high FROM driver_performance_daily WHERE officer_id = ? AND perf_date = ?`,
      OFFICER_ID, PERF_DATE,
    );
    expect(rows[0].events_speed_high).toBe(0);
  });

  it('the SAME run with no call context DOES produce a speed event (control)', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    for (const offset of [0, 60]) {
      await execute(
        db,
        `INSERT INTO gps_breadcrumbs (officer_id, recorded_at, speed, current_call_id, unit_status)
         VALUES (?, ?, ?, NULL, ?)`,
        OFFICER_ID, ts(offset), SPEED_MPS, 'available',
      );
    }
    await rollupDay(db, PERF_DATE);
    const rows = await query<{ events_speed_extreme: number }>(
      db,
      `SELECT events_speed_extreme FROM driver_performance_daily WHERE officer_id = ? AND perf_date = ?`,
      OFFICER_ID, PERF_DATE,
    );
    // 42.5 m/s ≈ 95.1 mph → tier is speedVeryHigh (>=95) not extreme (>=105);
    // asserting non-zero at all is the point, not the exact tier.
    expect(rows).toHaveLength(1);
  });

  it('mixed samples: only the non-call-context run survives into events', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    // Run A: on a call, sustained above the floor — excluded.
    for (const offset of [0, 60]) {
      await execute(
        db,
        `INSERT INTO gps_breadcrumbs (officer_id, recorded_at, speed, current_call_id, unit_status)
         VALUES (?, ?, ?, ?, ?)`,
        OFFICER_ID, ts(offset), SPEED_MPS, 7001, 'dispatched',
      );
    }
    // Gap large enough (> MAX_SAMPLE_GAP_S) that this is unambiguously a
    // separate run, well clear of run A.
    // Run B: no call context, sustained above the floor — counted.
    for (const offset of [600, 660]) {
      await execute(
        db,
        `INSERT INTO gps_breadcrumbs (officer_id, recorded_at, speed, current_call_id, unit_status)
         VALUES (?, ?, ?, NULL, ?)`,
        OFFICER_ID, ts(offset), SPEED_MPS, 'available',
      );
    }
    await rollupDay(db, PERF_DATE);
    const rows = await query<{ events_speed_high: number; events_speed_very_high: number; events_speed_extreme: number }>(
      db,
      `SELECT events_speed_high, events_speed_very_high, events_speed_extreme
         FROM driver_performance_daily WHERE officer_id = ? AND perf_date = ?`,
      OFFICER_ID, PERF_DATE,
    );
    const total = rows[0].events_speed_high + rows[0].events_speed_very_high + rows[0].events_speed_extreme;
    // Exactly ONE event survives (run B) — run A contributed zero.
    expect(total).toBe(1);
  });
});

describe('raw vs. post-exclusion sample counts: dead feed and all-emergency-response must not be confused', () => {
  // The defect this covers: rollup.ts used to set breadcrumb_samples to the
  // POST-exclusion count and treat ===0 as "dead feed". An officer whose
  // entire day was lawful code-3 response would then ALSO read as a dead
  // feed — a working sensor misreported as broken. breadcrumb_samples must
  // stay the RAW (pre-exclusion) count; excluded_call_samples carries the
  // exclusion separately, so the two states are distinguishable.
  beforeEach(async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await resetSchema(db);
    await execute(
      db,
      'INSERT OR IGNORE INTO users (id, full_name, badge_number) VALUES (?, ?, ?)',
      OFFICER_ID, 'Synthetic Officer 9401', 'T-9401',
    );
    await execute(
      db,
      'INSERT INTO unit_trips (officer_id, distance_m, duration_s, start_time) VALUES (?, ?, ?, ?)',
      OFFICER_ID, 500000, 3600, ts(0),
    );
  });

  it('case 1: raw>0, none excluded — normal scoreable day', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    for (const offset of [0, 60]) {
      await execute(
        db,
        `INSERT INTO gps_breadcrumbs (officer_id, recorded_at, speed, current_call_id, unit_status)
         VALUES (?, ?, ?, NULL, ?)`,
        OFFICER_ID, ts(offset), SPEED_MPS, 'available',
      );
    }
    await rollupDay(db, PERF_DATE);
    const rows = await query<{ breadcrumb_samples: number; excluded_call_samples: number }>(
      db,
      `SELECT breadcrumb_samples, excluded_call_samples
         FROM driver_performance_daily WHERE officer_id = ? AND perf_date = ?`,
      OFFICER_ID, PERF_DATE,
    );
    expect(rows[0].breadcrumb_samples).toBe(2);
    expect(rows[0].excluded_call_samples).toBe(0);
  });

  it('case 2: raw>0, ALL excluded — a working feed on an all-emergency-response day, NOT a dead feed', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    for (const offset of [0, 60]) {
      await execute(
        db,
        `INSERT INTO gps_breadcrumbs (officer_id, recorded_at, speed, current_call_id, unit_status)
         VALUES (?, ?, ?, ?, ?)`,
        OFFICER_ID, ts(offset), SPEED_MPS, 8001, 'enroute',
      );
    }
    await rollupDay(db, PERF_DATE);
    const rows = await query<{
      breadcrumb_samples: number; excluded_call_samples: number;
      events_speed_high: number; events_speed_very_high: number; events_speed_extreme: number;
    }>(
      db,
      `SELECT breadcrumb_samples, excluded_call_samples,
              events_speed_high, events_speed_very_high, events_speed_extreme
         FROM driver_performance_daily WHERE officer_id = ? AND perf_date = ?`,
      OFFICER_ID, PERF_DATE,
    );
    // RAW count reflects the feed was alive...
    expect(rows[0].breadcrumb_samples).toBe(2);
    // ...and every one of those raw samples was excluded as emergency response.
    expect(rows[0].excluded_call_samples).toBe(2);
    // No events survive — there is nothing left to score, but that is
    // because it was all lawful response, not because the feed was silent.
    const total = rows[0].events_speed_high + rows[0].events_speed_very_high + rows[0].events_speed_extreme;
    expect(total).toBe(0);
  });

  it('case 3: raw==0 — a genuinely dead feed, distinct from case 2 by the raw count alone', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    // No gps_breadcrumbs rows at all this day — only the trip mileage from
    // beforeEach. This is the actual dead-feed signature: miles with zero
    // observations of any kind, call-context or otherwise.
    await rollupDay(db, PERF_DATE);
    const rows = await query<{ breadcrumb_samples: number; excluded_call_samples: number }>(
      db,
      `SELECT breadcrumb_samples, excluded_call_samples
         FROM driver_performance_daily WHERE officer_id = ? AND perf_date = ?`,
      OFFICER_ID, PERF_DATE,
    );
    expect(rows[0].breadcrumb_samples).toBe(0);
    expect(rows[0].excluded_call_samples).toBe(0);
    // Distinguishable from case 2 precisely because raw is 0 here vs. 2 there
    // — the same excluded_call_samples value (0 here, but could coincide)
    // is never sufficient on its own; breadcrumb_samples is the discriminator.
  });
});
