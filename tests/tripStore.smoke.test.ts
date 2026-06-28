// tripStore.smoke.test.ts
// Proves the I/O applier wires decide() → SQL without throwing. Behavior of the
// pure modules (engine state machine, telemetry accumulator) is covered by
// tripEngine.test.ts / tripTelemetry.test.ts — this only asserts that
// applyTripEvent loads the active trip, runs the engine, and emits the right
// kind of write (INSERT on open, UPDATE on append) against a recording D1 fake
// shaped like the real src/utils/db.ts helper call pattern
// (db.prepare(sql).bind(...).first()/.all()/.run()).
import { describe, it, expect } from 'vitest';
import { recordingDb } from './helpers/fakeD1';
import { applyTripEvent } from '../src/utils/tripStore';

// ALERT_HUB intentionally absent → emitAlert() is a no-op (binding-absent guard),
// so broadcastTrip never touches a DO in tests.
const env = {};

describe('tripStore.applyTripEvent (I/O smoke)', () => {
  it('(a) enroute status with no active trip → opens a CALL_RESPONSE (INSERT) without throwing', async () => {
    // No active trip: loadActive's SELECT returns nothing (no canned match).
    const { db, calls } = recordingDb([]);

    await expect(
      applyTripEvent({
        db,
        env,
        unitId: 19,
        officerId: 3,
        event: { kind: 'status', status: 'enroute' },
        ctx: {
          now: 1_700_000_000_000,
          curLat: 40.76, curLng: -111.89,
          prevLat: 40.76, prevLng: -111.89,
          callId: 42, callNumber: '26-0613', callType: 'alarm',
        },
        startMileage: 12_345,
      }),
    ).resolves.toBeUndefined();

    // The open intent must have produced exactly one INSERT into unit_trips.
    const inserts = calls.filter((c) => /INSERT INTO unit_trips/i.test(c.sql));
    expect(inserts.length).toBe(1);
    expect(inserts[0].args).toContain('call_response');
  });

  it('(a.1) zero-distance PATROL close (parked engine running) → DELETE noise discard regardless of duration', async () => {
    // Reproduces the prod bug from the 2026-06-20 Mileage Audit screenshot:
    // dozens of "92,957 → 92,957  0.0 mi" rows landed on prod because the old
    // noise filter required (<50m AND <180s). A parked-engine-running session
    // exceeded 180s, slipping past the duration gate, and closed as a 0-mile
    // PATROL row that cluttered every chain view. The tighter filter (added
    // after PR #1464) catches distance_m == 0 even when duration is long.
    const activeRow = {
      id: 99, trip_type: 'patrol', call_id: null,
      anchor_lat: 40.76, anchor_lng: -111.89,
      last_move_at: '2026-06-20 19:00:00', last_fix_ts: '2026-06-20 22:50:00',
    };
    const closeRow = {
      // long parked session: 4 hours, ZERO meters travelled.
      start_time: '2026-06-20 19:00:00',
      speed_sum: 0, fix_count: 480, trip_type: 'patrol',
      distance_m: 0, vehicle_id: 7,
    };
    const { db, calls } = recordingDb([
      { match: /SELECT id, trip_type, call_id, anchor_lat, anchor_lng/, rows: [activeRow] },
      { match: /SELECT start_time, speed_sum, fix_count, trip_type, distance_m/, rows: [closeRow] },
    ]);

    await applyTripEvent({
      db, env, unitId: 19, vehicleId: 7,
      event: { kind: 'sweep' },
      ctx: { now: Date.parse('2026-06-20T23:00:00Z'), curLat: 40.76, curLng: -111.89, prevLat: 40.76, prevLng: -111.89 },
    });

    const deletes = calls.filter((c) => /DELETE FROM unit_trips/i.test(c.sql));
    const updates = calls.filter((c) => /UPDATE unit_trips SET status='closed'/i.test(c.sql));
    expect(deletes.length).toBe(1);
    expect(updates.length).toBe(0); // never CLOSED — discarded as noise
  });

  it('(a.1b) sub-0.5 mi PATROL close (parking-lot shuffle) → DELETE noise discard', async () => {
    // Operator-requested widening (2026-06-21): 0.1/0.3 mi micro-trips
    // landed alongside the literal-zero rows on prod (parking-lot crawl,
    // building-to-building reposition). The HALF_MILE_METERS threshold in
    // tripStore catches anything <= 805 m so they don't clutter the chain.
    // last_move_at is set 30 min before ctx.now so sweep's IDLE check fires.
    const activeRow = {
      id: 101, trip_type: 'patrol', call_id: null,
      anchor_lat: 40.76, anchor_lng: -111.89,
      last_move_at: '2026-06-20 19:00:00', last_fix_ts: '2026-06-20 19:30:00',
    };
    const closeRow = {
      start_time: '2026-06-20 19:00:00',
      speed_sum: 30, fix_count: 12, trip_type: 'patrol',
      distance_m: 480, // ~0.3 mi — parking-lot shuffle
      vehicle_id: 7,
    };
    const { db, calls } = recordingDb([
      { match: /SELECT id, trip_type, call_id, anchor_lat, anchor_lng/, rows: [activeRow] },
      { match: /SELECT start_time, speed_sum, fix_count, trip_type, distance_m/, rows: [closeRow] },
    ]);

    await applyTripEvent({
      db, env, unitId: 19, vehicleId: 7,
      event: { kind: 'sweep' },
      ctx: { now: Date.parse('2026-06-20T19:30:00Z'), curLat: 40.76, curLng: -111.89, prevLat: 40.76, prevLng: -111.89 },
    });

    expect(calls.filter((c) => /DELETE FROM unit_trips/i.test(c.sql)).length).toBe(1);
    expect(calls.filter((c) => /UPDATE unit_trips SET status='closed'/i.test(c.sql)).length).toBe(0);
  });

  it('(a.1c) PATROL close at the 805 m threshold → DELETE (inclusive boundary)', async () => {
    // Boundary check: distance_m == HALF_MILE_METERS must still be noise.
    // 805 m == 0.500194 mi which displays as "0.5 mi" in the chain; an
    // exclusive boundary would let it through as a real row.
    const activeRow = {
      id: 102, trip_type: 'patrol', call_id: null,
      anchor_lat: 40.76, anchor_lng: -111.89,
      last_move_at: '2026-06-20 19:00:00', last_fix_ts: '2026-06-20 19:30:00',
    };
    const closeRow = {
      start_time: '2026-06-20 19:00:00',
      speed_sum: 30, fix_count: 12, trip_type: 'patrol',
      distance_m: 805, vehicle_id: 7,
    };
    const { db, calls } = recordingDb([
      { match: /SELECT id, trip_type, call_id, anchor_lat, anchor_lng/, rows: [activeRow] },
      { match: /SELECT start_time, speed_sum, fix_count, trip_type, distance_m/, rows: [closeRow] },
    ]);

    await applyTripEvent({
      db, env, unitId: 19, vehicleId: 7,
      event: { kind: 'sweep' },
      ctx: { now: Date.parse('2026-06-20T19:30:00Z'), curLat: 40.76, curLng: -111.89, prevLat: 40.76, prevLng: -111.89 },
    });

    expect(calls.filter((c) => /DELETE FROM unit_trips/i.test(c.sql)).length).toBe(1);
    expect(calls.filter((c) => /UPDATE unit_trips SET status='closed'/i.test(c.sql)).length).toBe(0);
  });

  it('(a.2) PATROL close just above the threshold (~0.6 mi) → UPDATE to closed (not noise)', async () => {
    // Sanity check the inclusive boundary: 1000 m is just past the threshold
    // and must close normally. Real-travel rows must not accidentally land
    // in the discard branch.
    const activeRow = {
      id: 100, trip_type: 'patrol', call_id: null,
      anchor_lat: 40.76, anchor_lng: -111.89,
      last_move_at: '2026-06-20 19:00:00', last_fix_ts: '2026-06-20 19:30:00',
    };
    const closeRow = {
      start_time: '2026-06-20 19:00:00',
      speed_sum: 600, fix_count: 60, trip_type: 'patrol',
      distance_m: 1_000, // ~0.62 mi — past the 0.5 mi noise threshold
      vehicle_id: 7,
    };
    const { db, calls } = recordingDb([
      { match: /SELECT id, trip_type, call_id, anchor_lat, anchor_lng/, rows: [activeRow] },
      { match: /SELECT start_time, speed_sum, fix_count, trip_type, distance_m/, rows: [closeRow] },
      { match: /SELECT \* FROM unit_trips WHERE id = \?/, rows: [{ unit_id: 19, id: 100 }] },
    ]);

    await applyTripEvent({
      db, env, unitId: 19, vehicleId: 7,
      event: { kind: 'sweep' },
      ctx: { now: Date.parse('2026-06-20T19:30:00Z'), curLat: 40.76, curLng: -111.89, prevLat: 40.76, prevLng: -111.89 },
    });

    const deletes = calls.filter((c) => /DELETE FROM unit_trips/i.test(c.sql));
    const updates = calls.filter((c) => /UPDATE unit_trips SET status='closed'/i.test(c.sql));
    expect(deletes.length).toBe(0);
    expect(updates.length).toBe(1); // closed, not discarded
  });

  it('(b) gps fix on an existing active PATROL trip → appends (UPDATE) exercising accumulate', async () => {
    // Active patrol trip far enough from the fix to stay within-radius append,
    // with seeded continuity columns so accumulate folds against a real prev.
    const activeRow = {
      id: 7, trip_type: 'patrol', call_id: null,
      anchor_lat: 40.7600, anchor_lng: -111.8900,
      last_move_at: '2023-11-14 22:13:00', last_fix_ts: '2023-11-14 22:13:15',
    };
    // The full accumulator-state row applyAppend reads back before folding.
    const aggRow = {
      distance_m: 120, max_speed: 13.4, speed_sum: 40.2, fix_count: 3, max_lat_g: 0.1,
      harsh_accel_count: 0, harsh_brake_count: 0, harsh_corner_count: 0, stop_count: 0,
      anchor_lat: 40.7600, anchor_lng: -111.8900,
      last_move_at: '2023-11-14 22:13:00', last_fix_ts: '2023-11-14 22:13:15',
      prev_lat: 40.7601, prev_lng: -111.8901, prev_mph: 22, prev_bearing: 45,
    };

    const { db, calls } = recordingDb([
      // loadActive
      { match: /SELECT id, trip_type, call_id, anchor_lat, anchor_lng, last_move_at, last_fix_ts\s+FROM unit_trips WHERE unit_id = \? AND status = 'active'/, rows: [activeRow] },
      // applyAppend's accumulator-state read
      { match: /SELECT distance_m, max_speed, speed_sum, fix_count, max_lat_g/, rows: [aggRow] },
      // broadcastTrip
      { match: /SELECT \* FROM unit_trips WHERE id = \?/, rows: [{ unit_id: 19, id: 7 }] },
    ]);

    await expect(
      applyTripEvent({
        db,
        env,
        unitId: 19,
        event: {
          kind: 'gps',
          fix: { lat: 40.7605, lng: -111.8905, speed: 11, heading: null, ts: 1_700_000_020_000 },
        },
        ctx: {
          now: 1_700_000_020_000,
          curLat: 40.7605, curLng: -111.8905,
          prevLat: 40.7601, prevLng: -111.8901,
        },
      }),
    ).resolves.toBeUndefined();

    // The append intent must have produced an UPDATE to unit_trips.
    const updates = calls.filter((c) => /UPDATE unit_trips SET distance_m/i.test(c.sql));
    expect(updates.length).toBe(1);
    // …and it must write the accumulator-continuity columns back (the whole point
    // of stateless-batch continuity): prev_lat/prev_lng/prev_mph/prev_bearing.
    expect(/prev_lat=\?, prev_lng=\?, prev_mph=\?, prev_bearing=\?/.test(updates[0].sql)).toBe(true);
  });
});
