// src/utils/tripStore.ts
// The ONLY I/O layer for trip logging: loads the active trip, runs the pure
// decide() engine, applies its intents to D1 (unit_trips + telemetry rollups via
// accumulate), and broadcasts trip_update. Honors the engine's CALLER WRITE
// CONTRACT. Stateless per call — all accumulator continuity lives in row columns.
import { log } from './logger';
import { query, queryFirst, execute } from './db';
import { emitAlert } from './alertHub';
import { decide, type ActiveTrip, type TripEvent, type EngineCtx } from './tripEngine';
import { accumulate, type TripAgg, type IncomingFix } from './tripTelemetry';
import { setFleetOdometer, accrueFleetOdometer, vehicleOdometerForUnit } from './fleetOdometer';
import { getSuggestedMileage, deriveEndMileage } from './mileageAnchor';

type DB = D1Database;
const iso = (epochMs: number) => new Date(epochMs).toISOString().replace('T', ' ').slice(0, 19);
const epoch = (s: string | null): number | null =>
  (s ? Date.parse(s.replace(' ', 'T') + 'Z') : null);

export interface ApplyArgs {
  db: DB;
  env: { ALERT_HUB?: DurableObjectNamespace };
  unitId: number;
  officerId?: number | null;
  vehicleId?: number | null;
  event: TripEvent;
  ctx: Omit<EngineCtx, 'now'> & { now?: number };
  startMileage?: number | null;
  endMileage?: number | null;
}

async function loadActive(db: DB, unitId: number): Promise<ActiveTrip | null> {
  const row = await queryFirst<{
    id: number; trip_type: ActiveTrip['trip_type']; call_id: number | null;
    anchor_lat: number | null; anchor_lng: number | null;
    last_move_at: string | null; last_fix_ts: string | null;
  }>(db,
    `SELECT id, trip_type, call_id, anchor_lat, anchor_lng, last_move_at, last_fix_ts
     FROM unit_trips WHERE unit_id = ? AND status = 'active' ORDER BY start_time DESC LIMIT 1`, unitId);
  if (!row) return null;
  return {
    id: row.id, trip_type: row.trip_type, call_id: row.call_id,
    anchor_lat: row.anchor_lat, anchor_lng: row.anchor_lng,
    last_move_at: epoch(row.last_move_at), last_fix_ts: epoch(row.last_fix_ts),
  };
}

/** Apply one trip event (one status transition OR one gps fix). */
export async function applyTripEvent(args: ApplyArgs): Promise<void> {
  const { db, env, unitId } = args;
  const active = await loadActive(db, unitId);
  const now = args.ctx.now ?? Date.now();
  const ctx = { ...args.ctx, now } as EngineCtx;
  const d = decide(args.event, active, ctx);

  if (d.close) {
    // Pull what we need to (a) compute duration + avg_speed at close, and
    // (b) decide whether this trip is detector noise worth discarding.
    const c = await queryFirst<{ start_time: string | null; speed_sum: number; fix_count: number; trip_type: string; distance_m: number | null; vehicle_id: number | null }>(
      db, 'SELECT start_time, speed_sum, fix_count, trip_type, distance_m, vehicle_id FROM unit_trips WHERE id = ?', d.close.tripId);
    const durS = c ? Math.max(0, Math.round((d.close.endTs - (epoch(c.start_time) ?? d.close.endTs)) / 1000)) : null;
    const avg = c && c.fix_count > 0 ? c.speed_sum / c.fix_count : null;

    // Noise discard: a PATROL trip that accumulated < HALF_MILE_METERS is
    // not real travel for audit / billing purposes — it's the parking-lot
    // shuffle, an officer pulling forward 50ft between buildings, a single-
    // fix sweep close, or a 4-hour parked-engine session that crossed the
    // patrol detector's accel threshold once. Below 0.5 mi the GPS jitter
    // budget can account for the entire "distance" with no actual travel.
    //
    // CALL_RESPONSE trips are NEVER discarded; a 0-mile dispatch is real
    // audit data. Idle-timeout / stale closures get checked too because
    // those reasons can fire on a freshly-opened trip that never moved.
    //
    // History of the threshold:
    //   v1 (pre-2026-06-21): <50m AND <180s — let parked-engine 4-hour
    //     sessions through as "0.0 mi" rows that cluttered the chain.
    //   v2 (#1465): distance_m <= 0 OR (<50m AND <180s) — caught the
    //     literal-zero case but missed 0.1-mi/0.3-mi micro-shuffles.
    //   v3 (this change): distance_m <= HALF_MILE_METERS, unconditional
    //     on duration. Operator request after seeing both classes of
    //     noise side-by-side on the live Mileage Audit chain.
    const HALF_MILE_METERS = 805; // 0.5 mi * 1609.344 / 1000, rounded
    const isNoise =
      c &&
      c.trip_type === 'patrol' &&
      (c.distance_m == null || c.distance_m <= HALF_MILE_METERS);

    if (isNoise) {
      await execute(db, "DELETE FROM unit_trips WHERE id = ? AND status = 'active'", d.close.tripId);
      // No broadcast: any 'opened' frame we emitted earlier was for a row
      // that no longer exists. The dispatch badge polls on a rollup, so a
      // missing trip self-heals on the next refresh — emitting a 'closed'
      // would mislead the client into rendering the ghost row.
    } else {
      // Auto-stamp end_mileage on patrol trips whose caller didn't pass one.
      // CFS routes hand the engine a real odometer (calls.ts on 'enroute');
      // patrol-detected trips never did — so every PATROL row showed "—" in
      // the trip log. Derive end = start + distance_m/1609.34 when the trip
      // already has a stamped start_mileage and the distance is sane (the
      // outlier guard rejects >75mi single-trip distances so one bad GPS run
      // can't poison the anchor for the rest of the shift).
      let endMileage: number | null = args.endMileage != null && Number.isFinite(args.endMileage)
        ? (args.endMileage as number) : null;
      let endMileageDerived = false;
      if (endMileage == null && c?.trip_type === 'patrol') {
        const startMileage = await queryFirst<{ start_mileage: number | null }>(
          db, 'SELECT start_mileage FROM unit_trips WHERE id = ?', d.close.tripId);
        const derived = deriveEndMileage(startMileage?.start_mileage ?? null, c.distance_m);
        if (derived) { endMileage = derived.endMileage; endMileageDerived = true; }
        else if (startMileage?.start_mileage != null && c.distance_m != null && c.distance_m > 0) {
          console.warn('[tripStore] patrol trip', d.close.tripId, 'rejected end_mileage auto-stamp',
            'distance_m=', c.distance_m, '(>75mi outlier guard)');
        }
      }
      const setMileage = endMileage != null;
      await execute(db,
        `UPDATE unit_trips SET status='closed', end_time=?, end_lat=?, end_lng=?, close_reason=?,
           duration_s=?, avg_speed=?${setMileage ? ', end_mileage=?' : ''}, updated_at=datetime('now')
         WHERE id=? AND status='active'`,
        iso(d.close.endTs), d.close.endLat, d.close.endLng, d.close.reason, durS, avg,
        ...(setMileage ? [endMileage] : []), d.close.tripId);
      // Roll the trip's GPS-measured distance onto the fleet odometer. An
      // explicit end_mileage (a real odometer reading) is authoritative and
      // re-anchors instead of accruing — see fleetOdometer.ts semantics. A
      // derived end_mileage is also authoritative for the anchor: it's
      // start_mileage + GPS distance, the same math accrueFleetOdometer does.
      if (setMileage) await setFleetOdometer(db, c?.vehicle_id ?? args.vehicleId, endMileage);
      else await accrueFleetOdometer(db, c?.vehicle_id ?? args.vehicleId, c?.distance_m ?? null);
      await broadcastTrip(env, db, d.close.tripId, 'closed');
      void endMileageDerived; // reserved for future audit annotation

      // FlexCam: auto-capture footage on trip close. With flexcam_full_drive ON,
      // capture EVERY camera-mapped trip (the full drive, road camera); when OFF,
      // keep the call-tied-only behavior. Best-effort — must never disrupt trip close.
      try {
        const closed = await queryFirst<{ unit_id: number; call_id: number | null; call_number: string | null; start_time: string; end_time: string }>(
          db, 'SELECT unit_id, call_id, call_number, start_time, end_time FROM unit_trips WHERE id=?', d.close.tripId);
        const fullDrive = await queryFirst<{ config_value: string }>(
          db, "SELECT config_value FROM system_config WHERE config_key='flexcam_full_drive' AND category='integrations' AND is_active=1 LIMIT 1").catch(() => null);
        const fullDriveOn = fullDrive?.config_value === 'true';
        const callTied = !!(closed && (closed.call_id || closed.call_number));
        if (closed && (fullDriveOn || callTied)) {
          const map = await queryFirst<{ cpg_camera_id: number | null; cpg_device_id: string }>(
            db, 'SELECT cpg_camera_id, cpg_device_id FROM cpg_device_mappings WHERE unit_id=? AND is_active=1 LIMIT 1', closed.unit_id);
          const assetId = map?.cpg_camera_id ?? 0;
          const fromTs = Date.parse(closed.start_time + 'Z');
          const toTs = Date.parse(closed.end_time + 'Z');
          if (assetId && Number.isFinite(fromTs) && Number.isFinite(toTs) && toTs > fromTs) {
            const { enqueueFootage } = await import('./footage/captureOrchestrator');
            // `env` here is typed narrowly (alert-hub only) but is the full Worker
            // Bindings object at runtime (routes pass c.env). enqueueFootage only
            // touches env.DB + optional ClearPath bindings, all present at runtime.
            await enqueueFootage(env as unknown as import('../types').Bindings, {
              assetId, unitId: closed.unit_id, cpgDeviceId: map!.cpg_device_id,
              tripId: String(d.close.tripId), callId: closed.call_id ?? null, fromTs, toTs,
              reason: 'trip_auto', channels: ['outside'],
              title: `Trip ${d.close.tripId}${closed.call_number ? ' · Call ' + closed.call_number : ''}`,
            });
          }
        }
      } catch (e) { console.error('[flexcam] trip auto-capture skipped:', (e as Error)?.message); }
    }
  }

  if (d.open) {
    // Pull a suggested start_mileage when the caller didn't pass one. CFS
    // routes always pass the call's starting_mileage (snapshot of the live
    // fleet_vehicles.current_mileage at enroute); patrol-detected trips have
    // nothing to pass, so the column went NULL and PATROL rows showed "—".
    //
    // Source order matters here. fleet_vehicles.current_mileage is the LIVE
    // running odometer — both calls.ts (via setFleetOdometer) and our own
    // d.close branch keep it up to date in real time. mileage_anchor, by
    // contrast, is only ever written by admin /mileage/fix actions, so it
    // freezes between corrections. The first cut of this code pulled from
    // the anchor and produced PATROL rows ~60 mi behind CFS rows in the
    // trip log (PR #1464 → bug observed on prod). Read fleet_vehicles first,
    // exactly like calls.ts does, and fall back to the anchor only when the
    // unit has no assigned vehicle. Both paths now share one source of
    // truth, so the interleaved chain stays continuous.
    let startMileage: number | null = args.startMileage != null && Number.isFinite(args.startMileage)
      ? (args.startMileage as number) : null;
    if (startMileage == null && d.open.type === 'patrol') {
      startMileage = await vehicleOdometerForUnit(db, unitId);
      if (startMileage == null) {
        const suggestion = await getSuggestedMileage(db, args.officerId ?? null, unitId);
        if (suggestion) startMileage = suggestion.suggested_mileage;
      }
    }
    const res = await execute(db,
      `INSERT INTO unit_trips (unit_id, officer_id, vehicle_id, trip_type, status, call_id, call_number, call_type,
         prev_trip_id, start_time, start_lat, start_lng, start_mileage,
         anchor_lat, anchor_lng, last_move_at, last_fix_ts, prev_lat, prev_lng, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      unitId, args.officerId ?? null, args.vehicleId ?? null, d.open.type,
      d.open.callId ?? null, d.open.callNumber ?? null, d.open.callType ?? null,
      d.open.prevTripId ?? null, iso(d.open.startTs), d.open.startLat, d.open.startLng,
      startMileage, d.open.startLat, d.open.startLng, iso(d.open.startTs), iso(d.open.startTs),
      d.open.startLat, d.open.startLng);
    const newId = res.meta?.last_row_id as number | undefined;
    if (newId) await broadcastTrip(env, db, newId, 'opened');
  }

  if (d.append) {
    // No broadcast here: the gps path loops every fix in a batch, so a per-fix
    // broadcast would add an awaited Durable-Object round-trip per fix to a hot
    // endpoint. Open/close broadcasts (rare) stay; the dispatch badge polls for
    // live rollups. broadcastTrip is still used by the open/close branches.
    await applyAppend(db, d.append.tripId, d.append.fix, d.updateAnchor);
  }
}

async function applyAppend(db: DB, tripId: number, fix: IncomingFix, updateAnchor?: { lat: number; lng: number; at: number }) {
  const row = await queryFirst<{
    distance_m: number; max_speed: number; speed_sum: number; fix_count: number; max_lat_g: number;
    harsh_accel_count: number; harsh_brake_count: number; harsh_corner_count: number; stop_count: number;
    anchor_lat: number | null; anchor_lng: number | null; last_move_at: string | null;
    last_fix_ts: string | null; prev_lat: number | null; prev_lng: number | null;
    prev_mph: number | null; prev_bearing: number | null;
  }>(db,
    `SELECT distance_m, max_speed, speed_sum, fix_count, max_lat_g, harsh_accel_count, harsh_brake_count,
            harsh_corner_count, stop_count, anchor_lat, anchor_lng, last_move_at,
            last_fix_ts, prev_lat, prev_lng, prev_mph, prev_bearing FROM unit_trips WHERE id = ?`, tripId);
  if (!row) return;
  const agg: TripAgg = {
    distance_m: row.distance_m, max_speed: row.max_speed, speed_sum: row.speed_sum, fix_count: row.fix_count,
    max_lat_g: row.max_lat_g, harsh_accel_count: row.harsh_accel_count, harsh_brake_count: row.harsh_brake_count,
    harsh_corner_count: row.harsh_corner_count, stop_count: row.stop_count,
    prev_lat: row.prev_lat, prev_lng: row.prev_lng, prev_ts: epoch(row.last_fix_ts),
    prev_mph: row.prev_mph, prev_bearing: row.prev_bearing, was_moving: false,
  };
  const next = accumulate(agg, fix);
  const anchorLat = updateAnchor?.lat ?? row.anchor_lat;
  const anchorLng = updateAnchor?.lng ?? row.anchor_lng;
  const lastMoveAt = updateAnchor ? iso(updateAnchor.at) : row.last_move_at;
  await execute(db,
    `UPDATE unit_trips SET distance_m=?, max_speed=?, speed_sum=?, fix_count=?, max_lat_g=?,
       harsh_accel_count=?, harsh_brake_count=?, harsh_corner_count=?, stop_count=?,
       anchor_lat=?, anchor_lng=?, last_move_at=?, last_fix_ts=?,
       prev_lat=?, prev_lng=?, prev_mph=?, prev_bearing=?, updated_at=datetime('now') WHERE id=?`,
    next.distance_m, next.max_speed, next.speed_sum, next.fix_count, next.max_lat_g,
    next.harsh_accel_count, next.harsh_brake_count, next.harsh_corner_count, next.stop_count,
    anchorLat, anchorLng, lastMoveAt, iso(fix.ts),
    next.prev_lat, next.prev_lng, next.prev_mph, next.prev_bearing, tripId);
}

async function broadcastTrip(env: { ALERT_HUB?: DurableObjectNamespace }, db: DB, tripId: number, action: 'opened' | 'appended' | 'closed') {
  try {
    const trip = await queryFirst<{ unit_id: number }>(db, 'SELECT * FROM unit_trips WHERE id = ?', tripId);
    if (trip) await emitAlert(env, 'trip_update', { action, unit_id: trip.unit_id, trip });
  } catch { /* never break the write */ }
}

/** Cron sweep: idle/stale-close active trips whose unit warrants it. */
export async function sweepTrips(db: DB, env: { ALERT_HUB?: DurableObjectNamespace }, now = Date.now()): Promise<number> {
  const rows = await query<{ unit_id: number; latitude: number | null; longitude: number | null }>(db,
    `SELECT ut.unit_id, u.latitude, u.longitude
     FROM unit_trips ut JOIN units u ON u.id = ut.unit_id WHERE ut.status = 'active'`);
  let closed = 0;
  for (const r of rows) {
    const before = await queryFirst<{ id: number }>(db, "SELECT id FROM unit_trips WHERE unit_id=? AND status='active' LIMIT 1", r.unit_id);
    await applyTripEvent({ db, env, unitId: r.unit_id, event: { kind: 'sweep' },
      ctx: { now, curLat: r.latitude, curLng: r.longitude, prevLat: r.latitude, prevLng: r.longitude } });
    const after = await queryFirst<{ id: number }>(db, "SELECT id FROM unit_trips WHERE id=? AND status='closed'", before?.id);
    if (after) closed++;
  }
  return closed;
}
