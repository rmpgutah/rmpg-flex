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
