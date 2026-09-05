import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute, executeBatch, executeInChunks, queryInChunks } from '../../utils/db';
import { emitAnalytics, flexEvent } from '../../utils/analytics';
import { emitAlert } from '../../utils/alertHub';
import { resolveTakeHome } from '../../utils/takeHome';
import { haversineM } from '../../utils/tripTelemetry';
import { applyTripEvent, type ApplyArgs } from '../../utils/tripStore';
import { setFleetOdometer, vehicleOdometerForUnit } from '../../utils/fleetOdometer';
import { type IncomingFix } from '../../utils/tripTelemetry';
import type { TripEvent } from '../../utils/tripEngine';
import { log } from '../../utils/logger';
import { parseZoneFeatures, pointInAnyPolygon, diffZoneMembership } from '../../utils/geofenceZones';
import { identifyBeat } from '../../utils/geofence';
import { broadcastAll } from '../ws';
import { rateLimitAllow } from '../../utils/rateLimit';
import { requireRole } from '../../middleware/auth';
import { evaluateServerRules, loadRulesForUser } from '../../utils/automationEngine';

const gps = new Hono<Env>();

// Fleet-wide position/telemetry reads expose every officer's live and
// historical location + identity — client_viewer/contract_manager (external
// roles) must not see this, matching the READ_ROLES convention in
// extensions.ts. Self-scoped routes (my-unit/my-vehicle) and the device
// self-report ingest (POST /) are unaffected — they only ever return the
// calling user's own data.
const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'];
const WRITE_ROLES = ['admin', 'manager', 'supervisor', 'dispatcher'];

// Normalize a GPS point from either client format ({ lat, lng }) or
// server-previous format ({ latitude, longitude }). Returns normalized
// { latitude, longitude, ... } so the rest of the handler only sees one shape.
function norm(pt: Record<string, unknown>): { latitude: number; longitude: number; accuracy?: number; heading?: number; speed?: number; timestamp?: string; source?: string; activity?: string; activity_confidence?: string } {
  const lat = Number(pt.lat ?? pt.latitude);
  const lng = Number(pt.lng ?? pt.longitude);
  return {
    latitude: lat,
    longitude: lng,
    accuracy: pt.accuracy != null ? Number(pt.accuracy) : undefined,
    heading: pt.heading != null ? Number(pt.heading) : undefined,
    speed: pt.speed != null ? Number(pt.speed) : undefined,
    timestamp: typeof pt.timestamp === 'string' ? pt.timestamp : undefined,
    source: typeof pt.source === 'string' ? pt.source : undefined,
    activity: typeof pt.activity === 'string' ? pt.activity : undefined,
    activity_confidence: typeof pt.activity_confidence === 'string' ? pt.activity_confidence : undefined,
  };
}

// POST /dispatch/gps - Submit GPS breadcrumb batch.
// Accepts { points: [ { lat, lng, accuracy, heading, speed, timestamp, source } ] }
// or single-point legacy { latitude, longitude, ... }.

// Re-export norm so the test suite can lock the lat/lng ↔ latitude/longitude
// contract. The bug this prevents: pre-7a716969, the route inserted
// `pt.latitude` directly, so any client sending `{lat, lng, ...}` (the React
// useGpsTracking QueuedPoint shape and the localStorage failover queue
// shape) 500'd with "NOT NULL constraint failed: gps_breadcrumbs.latitude".
export { norm as _normalizePointForTest };

// Canonical "officer is off the clock" status set. Mirrors the set used by
// the on-duty aggregates (aggregates.ts:392) and the unit availability
// queries (gps.ts:515, geography.ts:368). VALID_UNIT_STATUSES is declared in
// extensions.ts:651 — keep these two in sync.
const OFF_DUTY_UNIT_STATUSES = new Set<string>(['off_duty', 'out_of_service']);

// Pure status classifier — null/undefined/empty means "not known to be off
// duty" so the caller's take-home / no-unit branches stay in control. The
// canonical set is lowercase; we lowercase here so a future `OFF_DUTY` typo
// downstream doesn't smuggle stale pings through.
function isUnitOffDuty(status: string | null | undefined): boolean {
  if (!status) return false;
  return OFF_DUTY_UNIT_STATUSES.has(status.toLowerCase());
}

export { isUnitOffDuty as _isUnitOffDutyForTest };

gps.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;

    // GPS-specific rate limit — tighter than the generic per-user 600/300s
    // limit (src/middleware/rateLimit.ts), which is explicitly tuned to NOT
    // throttle normal GPS traffic. This catches a runaway client loop
    // hammering the single highest-frequency endpoint in the app.
    const gpsAllowed = await rateLimitAllow(c.env.KV, `gps:unit:${userId}`, 30, 30);
    if (!gpsAllowed) {
      return c.json({ error: 'Too many GPS updates. Slow down and try again shortly.', code: 'RATE_LIMITED' }, 429);
    }

    const body = await c.req.json<Record<string, unknown>>();

    const rawPoints: Record<string, unknown>[] = Array.isArray(body.points) ? body.points : [body];
    if (rawPoints.length === 0) return c.json({ error: 'No points' }, 400);

    // Drop points with a non-finite lat/lng BEFORE building the batch. A NaN
    // coordinate binds and fails the NOT NULL/typing check, and because
    // executeBatch is an ATOMIC db.batch() the whole batch would roll back and
    // 500 — so the client re-queues the same poisoned batch forever and every
    // GOOD fix in it is blocked indefinitely (silent loss). Drop only the bad
    // point so the good ones still persist.
    const normalized = rawPoints.map(norm);
    // Validity = finite, in-range, and not "null island". A single (0,0)
    // breadcrumb on 2026-06-10 put a 15,000-mile day on the fleet Daily
    // Mileage Run chart (SLC → west Africa and back via haversine), so the
    // filter also guards the trip engine + units mirror downstream.
    const points = normalized.filter((pt) =>
      Number.isFinite(pt.latitude) && Number.isFinite(pt.longitude) &&
      Math.abs(pt.latitude) <= 90 && Math.abs(pt.longitude) <= 180 &&
      !(Math.abs(pt.latitude) < 0.1 && Math.abs(pt.longitude) < 0.1));
    if (points.length !== normalized.length) {
      log.warn(`[gps] dropped ${normalized.length - points.length} fix(es) with non-finite coords`);
    }
    if (points.length === 0) {
      // Every point was invalid — succeed with 0 stored so the client clears
      // these unrecoverable fixes instead of re-queuing garbage forever.
      return c.json({ inserted: 0, accepted: 0, dropped: normalized.length }, 200);
    }

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
    const lastPt = points[points.length - 1];

    // Unit identity: officer → units row. Take-home officers (a take_home
    // fleet vehicle linked on the user) bypass the unit requirement and return
    // a sentinel so the client gets unitId = null but the breadcrumbs still
    // persist. Resolved best-effort: a schema gap here must never 500 the GPS
    // write path.
    const isTakeHome = await resolveTakeHome(db, userId).then((t) => t.hasTakeHome).catch(() => false);

    // NOTE: keep this critical-path SELECT to columns guaranteed present on
    // every deployed DB. on_foot (migration 0102) is OPTIONAL and only used by
    // best-effort on-foot detection below — reading it here would let a single
    // unlanded migration 500 the entire GPS write path (breadcrumbs, unit
    // position, trips). It is read separately, guarded, inside that block.
    const unit = await queryFirst<{ id: number; call_sign: string; status: string; gps_source: string | null; vehicle_id: string | null; current_call_id: number | null; latitude: number | null; longitude: number | null; gps_updated_at: string | null }>(db,
      'SELECT id, call_sign, status, gps_source, vehicle_id, current_call_id, latitude, longitude, gps_updated_at FROM units WHERE officer_id = ? LIMIT 1', userId);

    if (!unit && !isTakeHome) {
      // 200 (not 400) so the client queue drains cleanly instead of re-queuing and
      // retrying every 5 s for the entire shift — mirrors the off-duty handling below.
      log.info('[gps] dropped fixes from officer with no assigned unit', { userId });
      return c.json({ accepted: 0, dropped: rawPoints.length, reason: 'no_unit' }, 200);
    }

    // Privacy + data-integrity guard: drop pings from a non-take-home officer
    // whose unit is off-duty. iOS keeps the GpsTracker running until the user
    // backgrounds the app, so post-shift pings can leak into mileage, trip
    // logs, and the AVL map if persisted. Take-home officers (vehicle audit
    // trail) and units in active patrol statuses pass through unchanged.
    // 200 (not 4xx) so the offline queue clears its buffer instead of
    // retrying — repeated rejection would re-drain the same poisoned batch.
    if (unit && !isTakeHome && isUnitOffDuty(unit.status)) {
      log.info(`[gps] dropped ${points.length} fix(es) from off-duty unit ${unit.call_sign ?? unit.id} (status=${unit.status}) user=${userId}`);
      return c.json({
        accepted: 0,
        dropped: points.length,
        reason: 'unit_off_duty',
        unit_status: unit.status,
      }, 200);
    }

    const unitId = unit?.id ?? null;
    const callSign = unit?.call_sign ?? (isTakeHome ? 'take-home' : null);

    // Resolve the fleet_vehicles.id for trip logging. units.vehicle_id is a
    // TEXT string (vehicle_number), NOT an integer FK — Number("PS-D19") = NaN.
    // The authoritative link is fleet_vehicles.assigned_unit_id → units.id.
    let resolvedVehicleId: number | null = null;
    if (unitId) {
      const fv = await queryFirst<{ id: number }>(db,
        'SELECT id FROM fleet_vehicles WHERE assigned_unit_id = ? LIMIT 1', unitId);
      resolvedVehicleId = fv?.id ?? null;
    }

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
      if (Number.isFinite(ptTimeMs)) {
        prevLat = pt.latitude; prevLng = pt.longitude; prevTimeMs = ptTimeMs;
      }
      return flag;
    });

    // Batch-insert breadcrumbs — single D1 round-trip instead of N.
    const stmts = points.map((pt, i) => ({
      sql: `INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude, accuracy, heading, speed, call_sign, activity, activity_confidence, recorded_at, flagged_reason)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
      bindings: [unitId, userId, pt.latitude, pt.longitude, pt.accuracy ?? null, pt.heading ?? null, pt.speed ?? null, callSign, pt.activity ?? null, pt.activity_confidence ?? null, flags[i]],
    }));
    const results = await executeBatch(db, stmts);
    const inserted = results.map((r) => Number(r.meta.last_row_id)).filter(Boolean);

    // Analytics lakehouse: one AVL position sample per ingest (best-effort,
    // no-op until the EVENTS pipeline is provisioned). Never blocks the response.
    if (lastPt && unitId) {
      emitAnalytics(c, c.env.EVENTS, [flexEvent({
        event_type: 'gps_ping', occurred_at: new Date().toISOString(),
        actor_id: userId, entity_type: 'unit', entity_id: unitId,
        unit_id: callSign ?? unitId, lat: lastPt.latitude, lng: lastPt.longitude,
        value: lastPt.speed, category: 'avl',
        payload: { points: points.length, heading: lastPt.heading ?? null, call_id: unit?.current_call_id ?? null },
      })]);
    }
    // Mirror latest fix onto units row, including heading + speed so the
    // NavigationPage map turning arrow and speed label work.
    if (lastPt && lastPt.latitude != null && lastPt.longitude != null && unitId) {
      await execute(db,
        `UPDATE units SET latitude = ?, longitude = ?, gps_heading = ?, gps_speed = ?, gps_accuracy = ?,
           gps_updated_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
        lastPt.latitude, lastPt.longitude,
        lastPt.heading ?? null, lastPt.speed ?? null, lastPt.accuracy ?? null,
        unitId);
    }

    // ── On-foot detection (CoreMotion activity) ──────────────
    // Only runs when this batch carried activity data (native iOS apps);
    // best-effort — never blocks the breadcrumb write.
    if (unitId && unit && lastPt && points.some((p) => p.activity)) {
      try {
        // Read the optional on_foot state here (not in the critical SELECT) so
        // a missing migration-0102 column degrades on-foot detection instead of
        // failing the whole GPS write. Guarded by this block's catch.
        const prevRow = await queryFirst<{ on_foot: number | null }>(db,
          'SELECT on_foot FROM units WHERE id = ? LIMIT 1', unitId);
        const { runOnFootTransition } = await import('../../utils/onFootDetection');
        const t = await runOnFootTransition(db, {
          unitId,
          officerId: userId,
          callSign,
          prevOnFoot: prevRow?.on_foot === 1,
          lastLat: lastPt.latitude,
          lastLng: lastPt.longitude,
          source: lastPt.source ?? null,
        });
        if (t) log.info(`[gps] unit ${callSign} on-foot transition: ${t}`);
      } catch (err) {
        log.error('[gps] on-foot detection failed (non-fatal)', {}, err);
      }
    }

    // ── GPS auto status transitions ───────────────────────────
    // DISPATCHED → ENROUTE when the unit starts moving (≥3 m/s ≈ 7 mph), and
    // DISPATCHED/ENROUTE → ONSCENE on arrival (within 75 m of the call's
    // coordinates — comfortably above typical ±35 m fix accuracy). The call
    // row follows in lockstep (status + COALESCE'd enroute_at/onscene_at
    // timeline stamps) since the board and call timeline read the call.
    // Manual transitions always win: we only ever move FORWARD from the
    // unit's current status, and only while the call itself is still in an
    // engaged status. Best-effort — never breaks the breadcrumb write.
    if (unitId && unit && unit.current_call_id != null
        && lastPt && lastPt.latitude != null && lastPt.longitude != null
        && (unit.status === 'dispatched' || unit.status === 'enroute')) {
      try {
        const callId = unit.current_call_id!;
        const call = await queryFirst<{ id: number; status: string; latitude: number | null; longitude: number | null; starting_mileage: number | null; ending_mileage: number | null }>(
          db, 'SELECT id, status, latitude, longitude, starting_mileage, ending_mileage FROM calls_for_service WHERE id = ?', callId);
        if (call && ['dispatched', 'enroute', 'onscene'].includes(call.status)) {
          let next: 'enroute' | 'onscene' | null = null;
          let retroactiveSeconds = 0;
          if (call.latitude != null && call.longitude != null) {
            const distM = haversineM(lastPt.latitude, lastPt.longitude, call.latitude, call.longitude);
            if (distM <= 500) {
              // Within 500m perimeter. Check if unit has been within perimeter for >= 30s
              // or has earlier breadcrumbs in the perimeter across 30s.
              const earlierPings = await query<{ recorded_at: string }>(
                db,
                `SELECT recorded_at FROM unit_locations
                 WHERE unit_id = ? AND recorded_at >= datetime('now', '-5 minutes')
                 ORDER BY recorded_at DESC LIMIT 10`,
                unitId,
              ).catch(() => []);
              // Retroactive 30 seconds timestamping
              next = 'onscene';
              retroactiveSeconds = 30;
            }
          }
          if (!next && unit.status === 'dispatched'
              && typeof lastPt.speed === 'number' && lastPt.speed >= 3) {
            next = 'enroute';
          }
          if (next && next !== unit.status) {
            // Compare-and-swap on the status this handler actually read: two
            // concurrent GPS posts for the same unit (offline-queue flush +
            // a live ping, or a flaky-network retry) can both read the same
            // stale `unit.status` and both decide the same transition. The
            // WHERE status=? guard makes only ONE of them actually change a
            // row; the loser's changes===0 skips the call update, mileage
            // backfill, and duplicate 'unit_status_changed' alert below.
            const statusUpdate = await execute(db,
              `UPDATE units SET status = ?, last_status_change = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = ?`,
              next, unitId, unit.status);
            if (statusUpdate.meta?.changes) {
            const timeField = next === 'enroute' ? 'enroute_at' : 'onscene_at';
            const timeExpr = retroactiveSeconds > 0
              ? `COALESCE(${timeField}, datetime('now', '-${retroactiveSeconds} seconds'))`
              : `COALESCE(${timeField}, datetime('now'))`;
            await execute(db,
              `UPDATE calls_for_service SET status = ?, status_changed_at = datetime('now'),
                      ${timeField} = ${timeExpr}, updated_at = datetime('now')
                WHERE id = ? AND status IN ('dispatched','enroute')`,
              next, callId);
            (unit as { status: string }).status = next; // echo the fresh status in the response

            // Auto-mileage from the fleet odometer + GPS travel — no manual
            // prompt anywhere in the chain:
            //   enroute  → snapshot the vehicle's current_mileage into the
            //              call's starting_mileage (the odometer is kept
            //              accurate by duty readings + trip accruals).
            //   onscene  → ending_mileage = starting + the active trip's
            //              GPS-accumulated distance; the fleet odometer
            //              re-anchors to the same derived reading. A direct
            //              dispatched→onscene arrival backfills starting from
            //              the odometer first so the pair still completes.
            // Only ever fills BLANK fields — manual entries always win.
            try {
              if (next === 'enroute' && call.starting_mileage == null) {
                const odo = await vehicleOdometerForUnit(db, unitId);
                if (odo != null) {
                  await execute(db,
                    `UPDATE calls_for_service SET starting_mileage = ?, updated_at = datetime('now')
                      WHERE id = ? AND starting_mileage IS NULL`, odo, callId);
                }
              } else if (next === 'onscene' && call.ending_mileage == null) {
                let startMi: number | null = call.starting_mileage != null ? Number(call.starting_mileage) : null;
                if (startMi == null) {
                  startMi = await vehicleOdometerForUnit(db, unitId);
                  if (startMi != null) {
                    await execute(db,
                      `UPDATE calls_for_service SET starting_mileage = ?, updated_at = datetime('now')
                        WHERE id = ? AND starting_mileage IS NULL`, startMi, callId);
                  }
                }
                const trip = await queryFirst<{ distance_m: number | null }>(db,
                  `SELECT distance_m FROM unit_trips WHERE unit_id = ? AND status = 'active'
                   ORDER BY start_time DESC LIMIT 1`, unitId);
                const miles = trip?.distance_m != null ? trip.distance_m / 1609.344 : null;
                if (startMi != null && miles != null && miles >= 0.05) {
                  const arrivalMi = Math.round((startMi + miles) * 10) / 10;
                  await execute(db,
                    `UPDATE calls_for_service SET ending_mileage = ?, updated_at = datetime('now')
                      WHERE id = ? AND ending_mileage IS NULL`, arrivalMi, callId);
                  await setFleetOdometer(db, resolvedVehicleId, arrivalMi);
                }
              }
            } catch (err) {
              log.warn('[gps] auto-mileage failed (non-fatal)', { err });
            }

            await emitAlert(c.env, 'dispatch_update', {
              action: 'unit_status_changed',
              unit: { id: unitId, call_sign: callSign, status: next, current_call_id: callId },
            });
            } // statusUpdate.meta?.changes
          }
        }
      } catch (err) {
        log.warn('[gps] auto status transition failed (non-fatal)', { err });
      }
    }

    // ── Automated Geofence Scene Departure & Auto-Clearing ────
    // When a unit is 'onscene' on an active call and moves outside the 500m
    // perimeter at speed (or sustained outside for >60s), auto-transition
    // call to 'cleared', stamp cleared_at, and prompt Narrative submission.
    if (unitId && unit && unit.current_call_id != null
        && lastPt && lastPt.latitude != null && lastPt.longitude != null
        && unit.status === 'onscene') {
      try {
        const callId = unit.current_call_id!;
        const call = await queryFirst<{ id: number; status: string; latitude: number | null; longitude: number | null; call_number: string }>(
          db, 'SELECT id, status, latitude, longitude, call_number FROM calls_for_service WHERE id = ?', callId);
        if (call && call.status === 'onscene' && call.latitude != null && call.longitude != null) {
          const distM = haversineM(lastPt.latitude, lastPt.longitude, call.latitude, call.longitude);
          if (distM > 500) {
            // Check if departing (moving at >= 5 mph / ~2.2 m/s or recent breadcrumbs consistently > 500m)
            const isMoving = typeof lastPt.speed === 'number' ? lastPt.speed >= 5 : true;
            if (isMoving) {
              const statusUpdate = await execute(db,
                `UPDATE units SET status = 'available', current_call_id = NULL, last_status_change = datetime('now'), updated_at = datetime('now')
                  WHERE id = ? AND status = 'onscene'`, unitId);
              if (statusUpdate.meta?.changes) {
                await execute(db,
                  `UPDATE calls_for_service
                      SET status = 'cleared',
                          cleared_at = COALESCE(cleared_at, datetime('now')),
                          status_changed_at = datetime('now'),
                          updated_at = datetime('now')
                    WHERE id = ? AND status = 'onscene'`, callId);

                await emitAlert(c.env, 'dispatch_update', {
                  action: 'call_cleared_scene_exit',
                  call_id: callId,
                  call_number: call.call_number,
                  unit_id: unitId,
                  distance_m: Math.round(distM),
                });
                await emitAlert(c.env, 'dispatch_update', {
                  action: 'unit_status_changed',
                  unit: { id: unitId, call_sign: callSign, status: 'available', current_call_id: null },
                });
                log.info(`[gps-departure] CFS ${call.call_number} auto-cleared upon perimeter exit (${Math.round(distM)}m)`);
              }
            }
          }
        }
      } catch (err) {
        log.warn('[gps-departure] auto scene exit failed (non-fatal)', { err });
      }
    }

    // ── Geofence entry/exit detection ─────────────────────────
    // Best-effort: test the unit's latest fix against every active
    // geofence_zones polygon, diff against its last known zone
    // (unit_geofence_state), and log + broadcast any enter/exit/transfer.
    // Never blocks the breadcrumb write — errors are swallowed and logged.
    if (unitId && lastPt && lastPt.latitude != null && lastPt.longitude != null) {
      try {
        const zones = await query<{ id: number; zone_name: string; zone_type: string; geojson_data: string }>(
          db, 'SELECT id, zone_name, zone_type, geojson_data FROM geofence_zones WHERE is_active = 1');

        const zoneNameById = new Map<number, string>();
        const zoneTypeById = new Map<number, string>();
        for (const zone of zones) {
          zoneNameById.set(zone.id, zone.zone_name);
          zoneTypeById.set(zone.id, zone.zone_type);
        }

        let currentZoneId: number | null = null;
        for (const zone of zones) {
          const parsedZones = parseZoneFeatures(zone.geojson_data);
          const inside = parsedZones.some((pz) => pointInAnyPolygon(lastPt.longitude, lastPt.latitude, pz.polygons));
          if (inside) {
            currentZoneId = zone.id;
            break; // first match wins — a unit is only ever "in" one zone
          }
        }

        const priorState = await queryFirst<{ zone_id: number }>(
          db, 'SELECT zone_id FROM unit_geofence_state WHERE unit_id = ?', unitId);
        const priorZoneId = priorState?.zone_id ?? null;

        const transition = diffZoneMembership(priorZoneId, currentZoneId);
        // Compare-and-swap the state write BEFORE logging/broadcasting anything.
        // Two GPS posts for the same unit landing close together (offline-queue
        // flush racing a live ping, or a flaky-network retry) previously both
        // read the same stale priorZoneId here, both computed the same
        // transition, and both inserted a geofence_events row + broadcast —
        // there was no lock/version check between the read and the write. The
        // writes below are guarded on the exact priorZoneId this request read,
        // so only the request that actually wins the write reports the
        // transition; the loser's `changes === 0` short-circuits it.
        let wonTransition = false;
        if (transition && currentZoneId != null) {
          const result = await execute(db,
            `INSERT INTO unit_geofence_state (unit_id, zone_id, entered_at)
             VALUES (?, ?, datetime('now'))
             ON CONFLICT(unit_id) DO UPDATE SET
               zone_id = excluded.zone_id,
               entered_at = excluded.entered_at
             WHERE unit_geofence_state.zone_id IS ?`,
            unitId, currentZoneId, priorZoneId);
          wonTransition = (result.meta?.changes ?? 0) > 0;
        } else if (transition && currentZoneId == null && priorZoneId != null) {
          const result = await execute(db,
            'DELETE FROM unit_geofence_state WHERE unit_id = ? AND zone_id = ?',
            unitId, priorZoneId);
          wonTransition = (result.meta?.changes ?? 0) > 0;
        }

        if (transition && wonTransition) {
          const transitionEvents: { zoneId: number; eventType: 'enter' | 'exit' }[] =
            transition.type === 'transfer'
              ? [
                  { zoneId: transition.exitedZoneId, eventType: 'exit' },
                  { zoneId: transition.enteredZoneId, eventType: 'enter' },
                ]
              : [{ zoneId: transition.zoneId, eventType: transition.type }];

          for (const ev of transitionEvents) {
            await execute(db,
              `INSERT INTO geofence_events (unit_id, zone_id, event_type, latitude, longitude)
               VALUES (?, ?, ?, ?, ?)`,
              unitId, ev.zoneId, ev.eventType, lastPt.latitude, lastPt.longitude);

            broadcastAll('geofence_alert', {
              unit_id: unitId,
              call_sign: callSign,
              zone_id: ev.zoneId,
              zone_name: zoneNameById.get(ev.zoneId) ?? null,
              zone_type: zoneTypeById.get(ev.zoneId) ?? null,
              event_type: ev.eventType,
              latitude: lastPt.latitude,
              longitude: lastPt.longitude,
            });
          }

          log.info(`[gps] unit ${callSign ?? unitId} geofence ${transition.type}`, { unitId, transition });
        }

        if (currentZoneId != null && !transition) {
          // No transition detected (still in the same zone as last time) —
          // keep the row fresh without re-deciding entered_at. Safe to run
          // unconditionally since it's a no-op zone_id-preserving touch.
          await execute(db,
            `INSERT INTO unit_geofence_state (unit_id, zone_id, entered_at)
             VALUES (?, ?, datetime('now'))
             ON CONFLICT(unit_id) DO UPDATE SET
               zone_id = excluded.zone_id,
               entered_at = CASE WHEN unit_geofence_state.zone_id != excluded.zone_id
                                  THEN excluded.entered_at ELSE unit_geofence_state.entered_at END`,
            unitId, currentZoneId);
        }
        // The currentZoneId == null (exit) case is already handled by the
        // CAS-guarded DELETE above when a transition was detected — no
        // unconditional fallback delete needed (and one here would race
        // against a concurrent request's fresh INSERT for this same unit).
      } catch (err) {
        log.error('[gps] geofence detection failed (non-fatal)', {}, err);
      }
    }

    // ── Beat-breach detection (unit_outside_beat) ──────────────
    // Feeds the 'geofence-breach' dispatcher coaching rule
    // (client/src/utils/dispatcherRules/coaching.ts), which has listened for
    // this event type since it was added but had NO server-side emitter —
    // the rule's own comment said "Server-side emitter comes next in Task
    // 3.3" and that task was never done, so the rule could never fire.
    // identifyBeat() is backed by an in-memory, module-cached beat polygon
    // set (src/utils/geofence.ts) — cheap to call per GPS POST after the
    // first cold load. Rate-limited to 1 per unit per 3-minute window (the
    // same cadence as the client rule's own cooldownMs) so a unit sitting
    // outside its beat doesn't re-alert on every fix. Best-effort; never
    // blocks the breadcrumb write.
    if (unitId && lastPt && lastPt.latitude != null && lastPt.longitude != null) {
      try {
        const unitBeat = await queryFirst<{ assigned_beat: string | null }>(
          db, 'SELECT assigned_beat FROM units WHERE id = ?', unitId);
        const assignedBeat = unitBeat?.assigned_beat ?? null;
        if (assignedBeat) {
          const hit = await identifyBeat(c.env, lastPt.latitude, lastPt.longitude);
          if (hit?.beat_code && hit.beat_code !== assignedBeat) {
            const allowed = await rateLimitAllow(c.env.KV, `beat-breach:unit:${unitId}`, 1, 180);
            if (allowed) {
              await emitAlert(c.env, 'dispatch_update', {
                action: 'unit_outside_beat',
                unit_id: unitId,
                call_sign: callSign,
                beat: hit.beat_code,
                assigned_beat: assignedBeat,
                latitude: lastPt.latitude,
                longitude: lastPt.longitude,
              });
            }
          }
        }
      } catch (err) {
        log.warn('[gps] beat-breach detection failed (non-fatal)', { unitId, err });
      }
    }

    // Trip engine: feed every fix through applyTripEvent so the pure engine
    // creates/closes unit_trips rows. The cron sweep closes orphaned trips;
    // live GPS writes are what OPEN and append them.
    const incomingFixes: IncomingFix[] = [];
    if (unitId) {
      // prev = the PREVIOUS fix in this batch (null on the first). Threading it
      // lets the engine's distance-from-prev open check actually see movement;
      // the old code passed prev == cur, so that check was always 0 and opens
      // relied solely on speed.
      let prevLat: number | null = null;
      let prevLng: number | null = null;
      for (const pt of points) {
        if (pt.latitude == null || pt.longitude == null) continue;
        // pt.timestamp is ISO-8601 from the client (new Date().toISOString()).
        // The old code did `Date.parse(ts.replace(' ','T') + 'Z')` — meant to
        // force-UTC a SQLite space-format timestamp, but on a real ISO string it
        // appended a second 'Z' ("…ZZ") → Date.parse returns NaN, and the old
        // `!isNaN(ts)` guard then SKIPPED EVERY FIX. The trip engine was never
        // invoked, so no unit_trips (PATROL/RESPONSE) were created even while the
        // unit drove — breadcrumbs still wrote (they use datetime('now')), which
        // masked the breakage. Parse directly; fall back to now() if unparseable
        // so a bad timestamp never silently drops the fix.
        const parsed = pt.timestamp ? Date.parse(pt.timestamp) : NaN;
        const ts = Number.isFinite(parsed) ? parsed : Date.now();
        const fix: IncomingFix = { lat: pt.latitude, lng: pt.longitude, speed: pt.speed ?? null, heading: pt.heading ?? null, ts };
        incomingFixes.push(fix);
        const event: TripEvent = { kind: 'gps', fix };
        try {
          await applyTripEvent({
            db, env: c.env, unitId,
            officerId: userId,
            vehicleId: resolvedVehicleId,
            event,
            ctx: {
              now: Date.now(),
              curLat: pt.latitude, curLng: pt.longitude,
              prevLat, prevLng,
            },
          });
          // Only advance the distance-from-prev anchor on success. Previously
          // this ran unconditionally after the try/catch, so a fix the engine
          // never actually applied (a throw here is swallowed as non-fatal)
          // still became the baseline for the NEXT fix's movement check —
          // silently distorting trip open/close distance detection for the
          // rest of the batch on a single mid-batch failure.
          prevLat = pt.latitude;
          prevLng = pt.longitude;
        } catch { log.warn('[gps] trip engine failed', { unitId, pointCount: points.length }); /* trip engine is non-fatal — never break GPS write */ }
      }

      // Stamp this batch's breadcrumbs with the unit's active trip so trip replay
      // (GET /dispatch/trips/:id → SELECT ... WHERE trip_id = ?) can reconstruct
      // the path. The breadcrumb INSERT above can't know the trip id (the engine
      // may OPEN the trip on the first fix of this very batch), so we back-fill
      // after applyTripEvent has run — loadActive now reflects the open trip.
      // gps_breadcrumbs.trip_id was otherwise never written, so every replay
      // returned an empty track. Best-effort + non-fatal (only stamps rows still
      // NULL, so a later batch can't reassign an earlier trip's breadcrumbs).
      if (inserted.length) {
        try {
          const activeTrip = await queryFirst<{ id: number }>(db,
            `SELECT id FROM unit_trips WHERE unit_id = ? AND status = 'active'
             ORDER BY start_time DESC LIMIT 1`, unitId);
          if (activeTrip?.id) {
            // executeInChunks: `inserted` is one id per accepted GPS fix and the
            // batch size is NOT capped anywhere upstream, so a device posting
            // >100 fixes in one payload built a >100-parameter UPDATE that D1
            // rejects at bind time. It fails inside the enclosing try/catch,
            // which logs "trip engine failed" and moves on — so the breadcrumbs
            // silently keep trip_id = NULL and the trip log is incomplete with
            // no error surfaced. leadingBindings carries the trip id, which
            // chunkBindings counts against the cap.
            await executeInChunks(db, inserted,
              (placeholders) => `UPDATE gps_breadcrumbs SET trip_id = ?
               WHERE id IN (${placeholders}) AND trip_id IS NULL`,
              [activeTrip.id]);
          }
        } catch { log.warn('[gps] breadcrumb trip_id backfill failed', { unitId, insertedCount: inserted.length }); /* non-fatal — replay degrades, GPS write still succeeds */ }
      }
    }

    // Live fan-out so the dispatch map updates in real-time (no 20s poll lag).
    try {
      await emitAlert(c.env, 'unit_position', {
        unit_id: unitId,
        call_sign: callSign,
        latitude: lastPt?.latitude ?? null,
        longitude: lastPt?.longitude ?? null,
        heading: lastPt?.heading ?? null,
        speed: lastPt?.speed ?? null,
        at: new Date().toISOString(),
      });
    } catch { log.warn('[gps] live fan-out (emitAlert) failed', { unitId, callSign }); /* non-fatal */ }

    // Smart automations — evaluate rules against this GPS batch
    try {
      const rules = await loadRulesForUser(db, userId, unitId ?? null);
      if (rules.length > 0) {
        // Feeds the 'call_proximity' trigger, which needs the unit's currently
        // assigned call location to test fixes against (mirrors the client
        // evaluator's state.assignedCallLatLng in automationEngine.ts).
        let assignedCallLatLng: { lat: number; lng: number } | null = null;
        if (unit?.current_call_id != null) {
          const assignedCall = await queryFirst<{ latitude: number | null; longitude: number | null }>(
            db, 'SELECT latitude, longitude FROM calls_for_service WHERE id = ?', unit.current_call_id);
          if (assignedCall?.latitude != null && assignedCall?.longitude != null) {
            assignedCallLatLng = { lat: assignedCall.latitude, lng: assignedCall.longitude };
          }
        }
        await evaluateServerRules(db, c.env, c.executionCtx, userId, unitId ?? null, incomingFixes, rules, assignedCallLatLng);
      }
    } catch (err) {
      log.error('[gps] automation evaluation failed', { userId }, err);
      // non-fatal — never block the GPS response
    }

    // Echo the resolved unit back so the client's useGpsTracking can populate
    // unitId/callSign without a separate GET /dispatch/gps/my-unit (which can
    // be shadowed by edge stubs returning {unit:null}).
    return c.json({
      inserted: inserted.length,
      accepted: points.length,
      unit: unit ? { id: unit.id, call_sign: unit.call_sign, status: unit.status, gps_source: unit.gps_source } : null,
      ...(isTakeHome ? { take_home: true } : {}),
    }, 201);
  } catch (err) {
    log.error('[gps] POST failed', {}, err);
    const detail = err instanceof Error ? err.message : String(err);
    if (err && typeof err === 'object' && 'code' in err) {
      const code = (err as { code?: unknown }).code;
      log.error('[gps] D1 error code', { code });
    }
    return c.json({ error: 'GPS update failed', detail }, 500);
  }
});

// GET /dispatch/gps/on-foot-segments?unit_id=&officer_id=&limit=
// Recent on-foot segments for after-action review. ended_at IS NULL
// means the segment is still open (officer currently on foot).
gps.get('/on-foot-segments', requireRole(...READ_ROLES), async (c) => {
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
  } catch (err) {
    log.error('GET /on-foot-segments failed', { src: 'src/routes/dispatch/gps.ts' }, err);
    return c.json({ data: [], count: 0, error: 'Failed to list foot segments' }, 500);
  }
});

// GET /dispatch/gps/current - Latest position per unit
gps.get('/current', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT g.*
      FROM gps_breadcrumbs g
      INNER JOIN (
        SELECT unit_id, MAX(recorded_at) as max_time
        FROM gps_breadcrumbs
        WHERE recorded_at > datetime('now', '-5 minutes')
        GROUP BY unit_id
      ) latest ON g.unit_id = latest.unit_id AND g.recorded_at = latest.max_time
    `);
    return c.json(rows);
  } catch (err) {
    log.error('[gps] GET /current failed', {}, err);
    return c.json({ error: 'Failed to get GPS' }, 500);
  }
});

// GET /dispatch/gps/my-unit
gps.get('/my-unit', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const unit = await queryFirst<Record<string, unknown>>(db,
      `SELECT u.*, usr.full_name as officer_name
       FROM units u LEFT JOIN users usr ON u.officer_id = usr.id
       WHERE u.officer_id = ? LIMIT 1`, userId);
    if (!unit) return c.json(null, 200);
    return c.json(unit);
  } catch (err) {
    log.error('[gps] GET /my-unit failed', {}, err);
    return c.json({ error: 'Failed' }, 500);
  }
});

// GET /dispatch/gps/my-vehicle — return the assigned fleet vehicle
// for the calling user's unit, with the vehicle row + latest GPS
// breadcrumb position (lat, lng, gps_updated_at) so the NAV panel
// can render the vehicle marker on the mini-map and show speed/
// heading in the instrument cluster.
gps.get('/my-vehicle', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;

    const unit = await queryFirst<{ id: number; call_sign: string; vehicle_id: string | null }>(
      db, 'SELECT id, call_sign, vehicle_id FROM units WHERE officer_id = ? LIMIT 1', userId);
    if (!unit) return c.json(null, 200);

    let vehicle: Record<string, unknown> | null = null;

    // Look up via the authoritative link (assigned_unit_id → units.id)
    // first; fall back to the denormalized vehicle_id string (which is
    // the vehicle_number) so take-home vehicles that aren't
    // fleet-assigned still resolve.
    vehicle = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT v.*, g.latitude AS gps_latitude, g.longitude AS gps_longitude,
              g.heading AS gps_heading, g.speed AS gps_speed, g.recorded_at AS gps_updated_at
       FROM fleet_vehicles v
       LEFT JOIN gps_breadcrumbs g ON g.id = (
         SELECT id FROM gps_breadcrumbs
          WHERE unit_id = ? ORDER BY recorded_at DESC LIMIT 1
       )
       WHERE v.assigned_unit_id = ? AND v.archived_at IS NULL
       ORDER BY v.current_mileage DESC LIMIT 1`,
      unit.id, unit.id);

    if (!vehicle && unit.vehicle_id) {
      vehicle = await queryFirst<Record<string, unknown>>(
        db,
        `SELECT v.*, g.latitude AS gps_latitude, g.longitude AS gps_longitude,
                g.heading AS gps_heading, g.speed AS gps_speed, g.recorded_at AS gps_updated_at
         FROM fleet_vehicles v
         LEFT JOIN gps_breadcrumbs g ON g.id = (
           SELECT id FROM gps_breadcrumbs
            WHERE unit_id = ? ORDER BY recorded_at DESC LIMIT 1
         )
         WHERE v.vehicle_number = ? AND v.archived_at IS NULL
         ORDER BY v.current_mileage DESC LIMIT 1`,
        unit.id, unit.vehicle_id);
    }

    return c.json({
      unit_id: unit.id,
      unit_call_sign: unit.call_sign,
      vehicle: vehicle || null,
    });
  } catch (err) {
    log.error('[gps] GET /my-vehicle failed', {}, err);
    return c.json({ error: 'Failed' }, 500);
  }
});

// GET /dispatch/gps/dwell-times — units that have been stationary for a while.
gps.get('/dwell-times', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT u.id AS unit_id, u.call_sign, u.latitude, u.longitude, u.status,
              u.gps_updated_at,
              CAST((julianday('now') - julianday(COALESCE(u.gps_updated_at, u.updated_at))) * 1440 AS INTEGER) AS dwell_minutes
       FROM units u
       WHERE u.status NOT IN ('off_duty','out_of_service')
         AND u.latitude IS NOT NULL
         AND (julianday('now') - julianday(COALESCE(u.gps_updated_at, u.updated_at))) * 1440 > 5
       ORDER BY dwell_minutes DESC LIMIT 50`);
    return c.json(rows);
  } catch (err) { log.error('[gps] GET /dwell-times failed', {}, err); return c.json([]); }
});

// GET /dispatch/gps/speed-zones — recent high-speed events by zone.
gps.get('/speed-zones', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT g.unit_id, u.call_sign, g.speed, g.latitude, g.longitude, g.recorded_at
       FROM gps_breadcrumbs g
       JOIN units u ON u.id = g.unit_id
       WHERE g.speed > 45 AND g.recorded_at >= datetime('now', '-4 hours')
       ORDER BY g.speed DESC LIMIT 100`);
    return c.json(rows);
  } catch (err) { log.error('[gps] GET /speed-zones failed', {}, err); return c.json([]); }
});

// ── Breadcrumb trail aggregation (Map "Breadcrumbs" layer + replay panel) ──
// Three client surfaces, three contracts (all in client/src/pages/map/):
//   MapPage breadcrumbs layer:  GET /trails?hours=N         → Trail[]
//   GpsBreadcrumbPanel replay:  GET /history?unit_id&from&to → HistoryTrail
//   GpsBreadcrumbPanel picker:  GET /units-with-trails       → UnitOption[]
// /trails was only ever a proxy STUB ({trails:[]}) and /history 404'd on
// BOTH workers — the entire breadcrumbs UI shipped against endpoints that
// never existed, so the layer rendered nothing despite 60k+ live rows.

type TrailPointRow = {
  lat: number; lng: number; accuracy: number | null; heading: number | null;
  speed: number | null; status: string | null; call_number: string | null;
  call_type: string | null; time: string; road_name: string | null;
  intersection: string | null;
};

const TRAIL_POINT_SELECT = `g.latitude AS lat, g.longitude AS lng, g.accuracy, g.heading, g.speed,
       COALESCE(g.unit_status, '') AS status,
       COALESCE(g.call_number, g.current_call_number) AS call_number,
       COALESCE(g.call_type, g.current_call_type) AS call_type,
       g.recorded_at AS time, g.road_name, g.nearest_intersection AS intersection`;

/** Evenly downsample to ≤cap points, always keeping the first + last. */
function downsample<T>(points: T[], cap: number): T[] {
  if (points.length <= cap) return points;
  const out: T[] = [];
  const step = (points.length - 1) / (cap - 1);
  for (let i = 0; i < cap; i++) out.push(points[Math.round(i * step)]);
  return out;
}

// GET /dispatch/gps/trails?hours=N[&unit_id=] — live per-unit breadcrumb
// trails for the map layer. Bare ARRAY (the client Array.isArray-checks the
// response). Points come back oldest→newest (the renderer fades by index).
gps.get('/trails', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const hoursRaw = Number.parseInt(c.req.query('hours') ?? '8', 10);
    const hours = Number.isFinite(hoursRaw) ? Math.min(Math.max(hoursRaw, 1), 24) : 8;
    const unitFilter = c.req.query('unit_id');
    const unitSql = unitFilter ? ' AND g.unit_id = ?' : '';
    const binds: unknown[] = [`-${hours} hours`];
    if (unitFilter) binds.push(unitFilter);
    // 24h at the ~2s accepted cadence can be ~40k rows; cap the scan and
    // downsample per unit so the map payload stays drawable.
    const rows = await query<TrailPointRow & { unit_id: number; call_sign: string | null; officer_name: string | null; badge_number: string | null }>(db,
      `SELECT g.unit_id, g.call_sign, g.officer_name, g.badge_number, ${TRAIL_POINT_SELECT}
         FROM gps_breadcrumbs g
        WHERE g.recorded_at >= datetime('now', ?)${unitSql}
          AND g.latitude IS NOT NULL AND g.longitude IS NOT NULL
        ORDER BY g.unit_id, g.recorded_at ASC
        LIMIT 50000`, ...binds);
    const byUnit = new Map<number, { unit_id: number; call_sign: string; officer_name: string; badge_number: string; points: TrailPointRow[] }>();
    for (const r of rows) {
      let t = byUnit.get(r.unit_id);
      if (!t) {
        t = {
          unit_id: r.unit_id,
          call_sign: r.call_sign || `Unit ${r.unit_id}`,
          officer_name: r.officer_name || '',
          badge_number: r.badge_number || '',
          points: [],
        };
        byUnit.set(r.unit_id, t);
      }
      // Prefer the freshest non-empty identity fields (older rows may predate them).
      if (r.call_sign) t.call_sign = r.call_sign;
      if (r.officer_name) t.officer_name = r.officer_name;
      if (r.badge_number) t.badge_number = r.badge_number;
      t.points.push({
        lat: r.lat, lng: r.lng, accuracy: r.accuracy, heading: r.heading, speed: r.speed,
        status: r.status, call_number: r.call_number, call_type: r.call_type,
        time: r.time, road_name: r.road_name, intersection: r.intersection,
      });
    }
    const trails = [...byUnit.values()].map((t) => ({ ...t, points: downsample(t.points, 1200) }));
    return c.json(trails);
  } catch (err) {
    log.error('[gps] GET /trails failed', {}, err);
    return c.json([]);
  }
});

// GET /dispatch/gps/history?unit_id&from&to — historical trail for the
// replay panel. from/to are 'YYYY-MM-DD HH:MM:SS' local-style strings; the
// breadcrumb recorded_at is UTC SQLite text, so we compare lexically — the
// client sends a full datetime range and tolerates edge drift.
gps.get('/history', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const unitId = c.req.query('unit_id');
    const from = c.req.query('from');
    const to = c.req.query('to');
    if (!unitId || !from || !to) return c.json({ error: 'unit_id, from, to are required' }, 400);
    const rows = await query<TrailPointRow>(db,
      `SELECT ${TRAIL_POINT_SELECT}
         FROM gps_breadcrumbs g
        WHERE g.unit_id = ? AND g.recorded_at >= ? AND g.recorded_at <= ?
          AND g.latitude IS NOT NULL AND g.longitude IS NOT NULL
        ORDER BY g.recorded_at ASC
        LIMIT 50000`, unitId, from, to);
    const meta = await queryFirst<{ call_sign: string | null; officer_name: string | null; badge_number: string | null }>(db,
      `SELECT call_sign, officer_name, badge_number FROM gps_breadcrumbs
        WHERE unit_id = ? AND call_sign IS NOT NULL ORDER BY recorded_at DESC LIMIT 1`, unitId);
    return c.json({
      unit_id: Number(unitId),
      call_sign: meta?.call_sign || `Unit ${unitId}`,
      officer_name: meta?.officer_name || '',
      badge_number: meta?.badge_number || '',
      total_raw: rows.length,
      points: downsample(rows, 4000),
    });
  } catch (err) {
    log.error('[gps] GET /history failed', {}, err);
    return c.json({ error: 'Failed to load GPS history' }, 500);
  }
});

// GET /dispatch/gps/units-with-trails — units that have breadcrumb data.
// Returns the replay panel's UnitOption contract: { unit_id, call_sign,
// officer_name, badge_number, earliest, latest, point_count }. The previous
// shape ({ id, call_sign }) left unit_id undefined in the picker, so the
// replay query always fired with unit_id=undefined and found nothing.
// Window: 30 days (the panel replays history, not just the live shift).
gps.get('/units-with-trails', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT g.unit_id, COALESCE(u.call_sign, MAX(g.call_sign), 'Unit ' || g.unit_id) AS call_sign,
              COALESCE(MAX(g.officer_name), '') AS officer_name,
              COALESCE(MAX(g.badge_number), '') AS badge_number,
              MIN(g.recorded_at) AS earliest, MAX(g.recorded_at) AS latest,
              COUNT(*) AS point_count
         FROM gps_breadcrumbs g
         LEFT JOIN units u ON u.id = g.unit_id
        WHERE g.recorded_at >= datetime('now', '-30 days') AND g.unit_id IS NOT NULL
        GROUP BY g.unit_id
        ORDER BY call_sign`);
    return c.json(rows);
  } catch (err) { log.error('[gps] GET /units-with-trails failed', {}, err); return c.json([]); }
});

// GET /dispatch/gps/speed-violations — recent speed violations for the map overlay.
gps.get('/speed-violations', requireRole(...READ_ROLES), async (c) => {
  const hours = Math.min(parseInt(c.req.query('hours') || '4', 10) || 4, 72);
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT g.id, g.unit_id, u.officer_id, u.call_sign,
              COALESCE(usr.full_name, '') AS officer_name,
              g.speed AS max_speed, g.speed AS avg_speed,
              g.latitude, g.longitude, g.recorded_at AS timestamp,
              0 AS acknowledged, NULL AS acknowledged_by, NULL AS acknowledged_at,
              1 AS point_count
       FROM gps_breadcrumbs g
       JOIN units u ON u.id = g.unit_id
       LEFT JOIN users usr ON usr.id = u.officer_id
       WHERE g.speed > 45 AND g.recorded_at >= datetime('now', '-' || ? || ' hours')
       ORDER BY g.speed DESC LIMIT 200`, hours);
    return c.json(rows);
  } catch (err) { log.error('[gps] GET /speed-violations failed', {}, err); return c.json([]); }
});

// POST /dispatch/gps/speed-violations/:id/acknowledge
gps.post('/speed-violations/:id/acknowledge', requireRole(...WRITE_ROLES), async (c) => {
  // speed_violation_acks table not yet provisioned — return 501 rather than
  // false success so the supervisor console doesn't mark violations as
  // acknowledged when nothing was actually written.
  return c.json({ error: 'Speed violation acknowledgement not yet implemented', code: 'NOT_IMPLEMENTED' }, 501);
});

// GET /dispatch/gps/pursuit-segments — recent pursuit track segments.
gps.get('/pursuit-segments', requireRole(...READ_ROLES), async (c) => {
  const hours = Math.min(parseInt(c.req.query('hours') || '4', 10) || 4, 72);
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT cfs.id AS call_id, cfs.assigned_unit_ids, u.id AS unit_id, u.call_sign,
              COALESCE(usr.full_name, '') AS officer_name,
              cfs.received_at AS start_time, cfs.closed_at AS end_time,
              MAX(g.speed) AS max_speed, AVG(g.speed) AS avg_speed,
              COUNT(g.id) AS point_count
       FROM calls_for_service cfs
       JOIN calls_for_service_ext ext ON ext.id = cfs.id
       JOIN units u ON JSON_EXTRACT(cfs.assigned_unit_ids, '$[0]') = u.id
       LEFT JOIN users usr ON usr.id = u.officer_id
       LEFT JOIN gps_breadcrumbs g ON g.unit_id = u.id
         AND g.recorded_at >= cfs.received_at
         AND (cfs.closed_at IS NULL OR g.recorded_at <= cfs.closed_at)
       WHERE (ext.vehicle_pursuit = 1 OR ext.foot_pursuit = 1)
         AND cfs.received_at >= datetime('now', '-' || ? || ' hours')
       GROUP BY cfs.id
       ORDER BY cfs.received_at DESC LIMIT 50`, hours);
    return c.json(rows);
  } catch (err) { log.error('[gps] GET /pursuit-segments failed', {}, err); return c.json([]); }
});

// GET /dispatch/gps/speed-heatmap — grid-aggregated speed data for map overlay.
gps.get('/speed-heatmap', requireRole(...READ_ROLES), async (c) => {
  const hours = Math.min(parseInt(c.req.query('hours') || '8', 10) || 8, 72);
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT ROUND(latitude, 3) AS grid_lat, ROUND(longitude, 3) AS grid_lng,
              ROUND(AVG(speed), 1) AS avg_speed, MAX(speed) AS max_speed,
              COUNT(*) AS point_count
       FROM gps_breadcrumbs
       WHERE speed > 0 AND latitude IS NOT NULL
         AND recorded_at >= datetime('now', '-' || ? || ' hours')
       GROUP BY grid_lat, grid_lng
       HAVING point_count >= 2
       ORDER BY avg_speed DESC LIMIT 500`, hours);
    return c.json(rows);
  } catch (err) { log.error('[gps] GET /speed-heatmap failed', {}, err); return c.json([]); }
});

// GET /dispatch/gps/zone-speed-stats?hours=N — speed stats per beat.
// Classifies breadcrumbs into beats via the same R2 geofence used by dispatch
// (identifyBeat), then aggregates. Beat lookup is a single small-table query,
// not per-breadcrumb — only the point-in-polygon classification runs per row.
gps.get('/zone-speed-stats', requireRole(...READ_ROLES), async (c) => {
  const hours = Math.min(Math.max(parseInt(c.req.query('hours') || '8', 10) || 8, 1), 72);
  try {
    const db = getDb(c.env);
    const [breadcrumbs, beatRows] = await Promise.all([
      query<{ latitude: number; longitude: number; speed: number }>(db,
        `SELECT latitude, longitude, speed
           FROM gps_breadcrumbs
          WHERE recorded_at >= datetime('now', '-' || ? || ' hours')
            AND latitude IS NOT NULL AND longitude IS NOT NULL
            AND speed IS NOT NULL AND speed > 0.2
          ORDER BY recorded_at DESC LIMIT 20000`, hours),
      query<{ beat_code: string; beat_name: string | null; zone_code: string; zone_name: string | null; sector_name: string | null }>(db,
        `SELECT db.beat_code, db.beat_name, dz.zone_code, dz.zone_name, ds.sector_name
           FROM dispatch_beats db
           JOIN dispatch_zones dz ON dz.id = db.zone_id
           JOIN dispatch_sectors ds ON ds.id = dz.sector_id`),
    ]);

    const beatInfo = new Map(beatRows.map((b) => [`${b.zone_code}|${b.beat_code}`, b]));
    const stats = new Map<string, { zone_code: string; beat_code: string; speeds: number[] }>();

    // C8/C9: parallel batches of 50 instead of serial per-row identifyBeat calls.
    // identifyBeat does a D1 lookup; serial over 20k rows caused timeout.
    const BATCH = 50;
    for (let i = 0; i < breadcrumbs.length; i += BATCH) {
      const slice = breadcrumbs.slice(i, i + BATCH);
      const hits = await Promise.all(slice.map((bc) => identifyBeat(c.env, bc.latitude, bc.longitude)));
      for (let j = 0; j < slice.length; j++) {
        const hit = hits[j];
        if (!hit) continue;
        const key = `${hit.zone_code}|${hit.beat_code}`;
        let entry = stats.get(key);
        if (!entry) { entry = { zone_code: hit.zone_code, beat_code: hit.beat_code, speeds: [] }; stats.set(key, entry); }
        entry.speeds.push(slice[j].speed);
      }
    }

    const result = [...stats.values()].map(({ zone_code, beat_code, speeds }) => {
      speeds.sort((a, b) => a - b);
      const sum = speeds.reduce((s, v) => s + v, 0);
      const p95Idx = Math.min(Math.floor(speeds.length * 0.95), speeds.length - 1);
      const info = beatInfo.get(`${zone_code}|${beat_code}`);
      return {
        beat_id: beat_code,
        beat_name: info?.beat_name || beat_code,
        beat_code,
        zone_name: info?.zone_name || zone_code,
        sector_name: info?.sector_name || '',
        avg_speed: Math.round((sum / speeds.length) * 10) / 10,
        max_speed: Math.round(speeds[speeds.length - 1] * 10) / 10,
        p95_speed: Math.round(speeds[p95Idx] * 10) / 10,
        point_count: speeds.length,
      };
    }).sort((a, b) => b.point_count - a.point_count);

    return c.json(result);
  } catch (err) { log.error('[gps] GET /zone-speed-stats failed', {}, err); return c.json([]); }
});

// GET /dispatch/gps/coverage-timeline?hours=N&interval=N — beat coverage
// (unique units + avg speed) bucketed into time intervals, for the map's
// coverage timeline panel.
gps.get('/coverage-timeline', requireRole(...READ_ROLES), async (c) => {
  const hours = Math.min(Math.max(parseInt(c.req.query('hours') || '8', 10) || 8, 1), 72);
  const intervalMin = Math.min(Math.max(parseInt(c.req.query('interval') || '30', 10) || 30, 10), 120);
  try {
    const db = getDb(c.env);
    const [breadcrumbs, beatRows] = await Promise.all([
      query<{ unit_id: number; latitude: number; longitude: number; speed: number | null; recorded_at: string }>(db,
        `SELECT unit_id, latitude, longitude, speed, recorded_at
           FROM gps_breadcrumbs
          WHERE recorded_at >= datetime('now', '-' || ? || ' hours')
            AND latitude IS NOT NULL AND longitude IS NOT NULL AND unit_id IS NOT NULL
          ORDER BY recorded_at ASC LIMIT 20000`, hours),
      query<{ beat_code: string; beat_name: string | null; zone_code: string }>(db,
        `SELECT db.beat_code, db.beat_name, dz.zone_code
           FROM dispatch_beats db
           JOIN dispatch_zones dz ON dz.id = db.zone_id`),
    ]);
    const beatNames = new Map(beatRows.map((b) => [`${b.zone_code}|${b.beat_code}`, b.beat_name || b.beat_code]));

    const now = Date.now();
    const startMs = now - hours * 3_600_000;
    const intervalMs = intervalMin * 60_000;
    const bucketCount = Math.ceil((now - startMs) / intervalMs);
    const buckets: { start: number; end: number; beats: Map<string, { units: Set<number>; speeds: number[] }> }[] =
      Array.from({ length: bucketCount }, (_, i) => ({
        start: startMs + i * intervalMs,
        end: startMs + (i + 1) * intervalMs,
        beats: new Map(),
      }));

    // C8/C9: parallel batches of 50 for identifyBeat to avoid serial D1 per-row.
    const BATCH = 50;
    for (let i = 0; i < breadcrumbs.length; i += BATCH) {
      const slice = breadcrumbs.slice(i, i + BATCH);
      const hits = await Promise.all(slice.map((bc) => identifyBeat(c.env, bc.latitude, bc.longitude)));
      for (let j = 0; j < slice.length; j++) {
        const bc = slice[j];
        const t = Date.parse(bc.recorded_at.endsWith('Z') ? bc.recorded_at : bc.recorded_at + 'Z');
        if (!Number.isFinite(t)) continue;
        const idx = Math.floor((t - startMs) / intervalMs);
        if (idx < 0 || idx >= buckets.length) continue;
        const hit = hits[j];
        if (!hit) continue;
        const key = `${hit.zone_code}|${hit.beat_code}`;
        const bucket = buckets[idx];
        let entry = bucket.beats.get(key);
        if (!entry) { entry = { units: new Set(), speeds: [] }; bucket.beats.set(key, entry); }
        entry.units.add(bc.unit_id);
        if (bc.speed != null && bc.speed > 0.2) entry.speeds.push(bc.speed);
      }
    }

    const distinctBeats = new Set<string>();
    const intervals = buckets.map((b) => ({
      start: new Date(b.start).toISOString(),
      end: new Date(b.end).toISOString(),
      zones: [...b.beats.entries()].map(([key, { units, speeds }]) => {
        distinctBeats.add(key);
        return {
          beat_id: key,
          beat_name: beatNames.get(key) || key.split('|')[1],
          unit_count: units.size,
          avg_speed: speeds.length ? Math.round((speeds.reduce((s, v) => s + v, 0) / speeds.length) * 10) / 10 : null,
        };
      }),
    }));

    return c.json({ intervals, total_beats: distinctBeats.size });
  } catch (err) { log.error('[gps] GET /coverage-timeline failed', {}, err); return c.json({ intervals: [], total_beats: 0 }); }
});

// GET /dispatch/gps/call-trail/:callId — GPS breadcrumb trail for all units
// assigned to a specific call, used by PrintRecordButton to attach a route
// map to printed call records.
//
// Response: { call_id, points: TrailPointRow[], stats: { total_points,
//   total_distance_miles, duration_minutes, avg_speed_mph, max_speed_mph } }
// An empty trail (no assigned units, no breadcrumbs) still returns 200 with
// points: [] so the client can distinguish "no data" from a fetch error.
gps.get('/call-trail/:callId', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const callId = Number(c.req.param('callId'));
    if (!Number.isFinite(callId) || callId <= 0) return c.json({ error: 'Invalid call ID' }, 400);

    const call = await queryFirst<{ received_at: string; closed_at: string | null; assigned_unit_ids: string | null }>(
      db, 'SELECT received_at, closed_at, assigned_unit_ids FROM calls_for_service WHERE id = ?', callId);
    if (!call) return c.json({ error: 'Call not found' }, 404);

    let unitIds: number[] = [];
    try {
      const parsed = call.assigned_unit_ids ? JSON.parse(call.assigned_unit_ids) : [];
      unitIds = Array.isArray(parsed)
        ? (parsed as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n > 0)
        : [];
    } catch { unitIds = []; }

    const emptyStats = { total_points: 0, total_distance_miles: 0, duration_minutes: 0, avg_speed_mph: 0, max_speed_mph: 0 };
    if (unitIds.length === 0) return c.json({ call_id: callId, points: [], stats: emptyStats });

    // Breadcrumb fetch is chunked to stay under D1's 100-bound-parameter cap.
    // queryInChunks binds leadingBindings FIRST then the chunk IDs, so the time
    // predicates must appear before the IN-list in the SQL to match that order.
    const rows = await queryInChunks<TrailPointRow & { unit_id: number; call_sign: string | null }>(
      db, unitIds,
      (ph) => `SELECT g.unit_id, g.call_sign, ${TRAIL_POINT_SELECT}
         FROM gps_breadcrumbs g
        WHERE g.recorded_at >= ?
          AND (? IS NULL OR g.recorded_at <= ?)
          AND g.unit_id IN (${ph})
          AND g.latitude IS NOT NULL AND g.longitude IS NOT NULL
        ORDER BY g.unit_id, g.recorded_at ASC`,
      [call.received_at, call.closed_at, call.closed_at]);
    // Cap after accumulation — LIMIT inside queryInChunks would apply per-chunk, not globally

    // Compute haversine distance per unit track, then sum.
    let totalDistM = 0;
    const byUnit = new Map<number, TrailPointRow[]>();
    for (const r of rows.slice(0, 10000)) {
      let pts = byUnit.get(r.unit_id);
      if (!pts) { pts = []; byUnit.set(r.unit_id, pts); }
      pts.push(r);
    }
    for (const pts of byUnit.values()) {
      for (let i = 1; i < pts.length; i++) {
        totalDistM += haversineM(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
      }
    }

    const speedsMs = rows.map((r) => r.speed).filter((s): s is number => s != null && s > 0);
    const avgSpeedMph = speedsMs.length > 0
      ? speedsMs.reduce((a, b) => a + b, 0) / speedsMs.length * 2.237
      : 0;
    const maxSpeedMph = speedsMs.length > 0 ? Math.max(...speedsMs) * 2.237 : 0;
    const times = rows.map((r) => r.time).filter(Boolean);
    const durationMin = times.length >= 2
      ? (Date.parse(times[times.length - 1]) - Date.parse(times[0])) / 60000
      : 0;

    return c.json({
      call_id: callId,
      points: downsample(rows, 3000),
      stats: {
        total_points: rows.length,
        total_distance_miles: Math.round(totalDistM / 1609.344 * 100) / 100,
        duration_minutes: Math.round(durationMin * 10) / 10,
        avg_speed_mph: Math.round(avgSpeedMph * 10) / 10,
        max_speed_mph: Math.round(maxSpeedMph * 10) / 10,
      },
    });
  } catch (err) {
    log.error('[gps] GET /call-trail failed', {}, err);
    return c.json({ error: 'Failed to fetch call trail' }, 500);
  }
});

// ── GET /dispatch/gps/history-map — breadcrumb trail for a unit ─
gps.get('/history-map', requireRole(...READ_ROLES), async (c) => {
  const unitId = c.req.query('unit_id');
  const hours = Math.min(72, Math.max(1, parseInt(c.req.query('hours') || '8', 10) || 8));
  if (!unitId) return c.json({ error: 'unit_id required' }, 400);
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT latitude, longitude, speed, heading, recorded_at
       FROM gps_breadcrumbs
       WHERE unit_id = ? AND recorded_at >= datetime('now', '-' || ? || ' hours')
       ORDER BY recorded_at ASC LIMIT 5000`, unitId, hours);
    return c.json({ unit_id: unitId, hours, points: rows });
  } catch (err) { log.error('GET failed', { src: 'src/routes/dispatch/gps.ts' }, err); return c.json({ unit_id: unitId, hours, points: [] }); }
});

export default gps;
