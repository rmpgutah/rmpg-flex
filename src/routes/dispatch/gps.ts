import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute, executeBatch } from '../../utils/db';
import { emitAlert } from '../../utils/alertHub';
import { haversineM } from '../../utils/tripTelemetry';
import { applyTripEvent, type ApplyArgs } from '../../utils/tripStore';
import { setFleetOdometer, vehicleOdometerForUnit } from '../../utils/fleetOdometer';
import { type IncomingFix } from '../../utils/tripTelemetry';
import type { TripEvent } from '../../utils/tripEngine';

const gps = new Hono<Env>();

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

gps.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
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
      console.warn(`[gps] dropped ${normalized.length - points.length} fix(es) with non-finite coords`);
    }
    if (points.length === 0) {
      // Every point was invalid — succeed with 0 stored so the client clears
      // these unrecoverable fixes instead of re-queuing garbage forever.
      return c.json({ inserted: 0, accepted: 0, dropped: normalized.length }, 200);
    }
    const lastPt = points[points.length - 1];

    // Unit identity: officer → units row. Take-home officers (has_take_home = 1
    // on the user) bypass the unit requirement and return a sentinel so the
    // client gets unitId = null but the breadcrumbs still persist.
    const userRow = await queryFirst<{ has_take_home: number }>(db,
      'SELECT has_take_home FROM users WHERE id = ?', userId);
    const isTakeHome = userRow?.has_take_home === 1;

    const unit = await queryFirst<{ id: number; call_sign: string; status: string; gps_source: string | null; vehicle_id: string | null; on_foot: number | null }>(db,
      'SELECT id, call_sign, status, gps_source, vehicle_id, current_call_id, on_foot FROM units WHERE officer_id = ? LIMIT 1', userId);

    if (!unit && !isTakeHome) return c.json({ error: 'No assigned unit' }, 400);

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

    // Batch-insert breadcrumbs — single D1 round-trip instead of N.
    const stmts = points.map((pt) => ({
      sql: `INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude, accuracy, heading, speed, call_sign, activity, activity_confidence, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      bindings: [unitId, userId, pt.latitude, pt.longitude, pt.accuracy ?? null, pt.heading ?? null, pt.speed ?? null, callSign, pt.activity ?? null, pt.activity_confidence ?? null],
    }));
    const results = await executeBatch(db, stmts);
    const inserted = results.map((r) => Number(r.meta.last_row_id)).filter(Boolean);
    // Mirror latest fix onto units row, including heading + speed so the
    // NavigationPage map turning arrow and speed label work.
    if (lastPt && lastPt.latitude != null && lastPt.longitude != null && unitId) {
      await execute(db,
        `UPDATE units SET latitude = ?, longitude = ?, gps_heading = ?, gps_speed = ?,
           gps_updated_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
        lastPt.latitude, lastPt.longitude,
        lastPt.heading ?? null, lastPt.speed ?? null,
        unitId);
    }

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

    // ── GPS auto status transitions ───────────────────────────
    // DISPATCHED → ENROUTE when the unit starts moving (≥3 m/s ≈ 7 mph), and
    // DISPATCHED/ENROUTE → ONSCENE on arrival (within 75 m of the call's
    // coordinates — comfortably above typical ±35 m fix accuracy). The call
    // row follows in lockstep (status + COALESCE'd enroute_at/onscene_at
    // timeline stamps) since the board and call timeline read the call.
    // Manual transitions always win: we only ever move FORWARD from the
    // unit's current status, and only while the call itself is still in an
    // engaged status. Best-effort — never breaks the breadcrumb write.
    if (unitId && unit && (unit as any).current_call_id != null
        && lastPt && lastPt.latitude != null && lastPt.longitude != null
        && (unit.status === 'dispatched' || unit.status === 'enroute')) {
      try {
        const callId = (unit as any).current_call_id as number;
        const call = await queryFirst<{ id: number; status: string; latitude: number | null; longitude: number | null; starting_mileage: number | null; ending_mileage: number | null }>(
          db, 'SELECT id, status, latitude, longitude, starting_mileage, ending_mileage FROM calls_for_service WHERE id = ?', callId);
        if (call && ['dispatched', 'enroute', 'onscene'].includes(call.status)) {
          let next: 'enroute' | 'onscene' | null = null;
          if (call.latitude != null && call.longitude != null
              && haversineM(lastPt.latitude, lastPt.longitude, call.latitude, call.longitude) <= 75) {
            next = 'onscene';
          } else if (unit.status === 'dispatched'
              && typeof lastPt.speed === 'number' && lastPt.speed >= 3) {
            next = 'enroute';
          }
          if (next && next !== unit.status) {
            await execute(db,
              `UPDATE units SET status = ?, last_status_change = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
              next, unitId);
            const timeField = next === 'enroute' ? 'enroute_at' : 'onscene_at';
            await execute(db,
              `UPDATE calls_for_service SET status = ?, status_changed_at = datetime('now'),
                      ${timeField} = COALESCE(${timeField}, datetime('now')), updated_at = datetime('now')
                WHERE id = ? AND status IN ('dispatched','enroute')`,
              next, callId);
            (unit as any).status = next; // echo the fresh status in the response

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
              console.warn('[gps] auto-mileage failed (non-fatal):', err);
            }

            await emitAlert(c.env, 'dispatch_update', {
              action: 'unit_status_changed',
              unit: { id: unitId, call_sign: callSign, status: next, current_call_id: callId },
            });
          }
        }
      } catch (err) {
        console.warn('[gps] auto status transition failed (non-fatal):', err);
      }
    }

    // Trip engine: feed every fix through applyTripEvent so the pure engine
    // creates/closes unit_trips rows. The cron sweep closes orphaned trips;
    // live GPS writes are what OPEN and append them.
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
        } catch { /* trip engine is non-fatal — never break GPS write */ }
        prevLat = pt.latitude;
        prevLng = pt.longitude;
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
            const placeholders = inserted.map(() => '?').join(',');
            await execute(db,
              `UPDATE gps_breadcrumbs SET trip_id = ?
               WHERE id IN (${placeholders}) AND trip_id IS NULL`,
              activeTrip.id, ...inserted);
          }
        } catch { /* non-fatal — replay degrades, GPS write still succeeds */ }
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
    } catch { /* non-fatal */ }

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
    console.error('[gps] POST failed:', err);
    const detail = err instanceof Error ? err.message : String(err);
    if (err && typeof err === 'object' && 'code' in err) {
      const code = (err as any).code;
      console.error('[gps] D1 error code:', code);
    }
    return c.json({ error: 'GPS update failed', detail }, 500);
  }
});

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

// GET /dispatch/gps/current - Latest position per unit
gps.get('/current', async (c) => {
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
    console.error('[gps] GET /current failed:', err);
    return c.json({ error: 'Failed to get GPS' }, 500);
  }
});

// GET /dispatch/gps/my-unit
//
// CROSS-INTEGRATION NOTE (Claude Opus 4.8 — d3001d25):
//   Returns the calling user's assigned unit if one exists. The
//   NAV page + DispatchMiniMap use this to resolve the officer's
//   call sign and GPS source for the instrument panel + vehicle
//   marker. The response shape is the full units row joined with
//   the officer's name from users.
//
//   The pre-Claude version returned { message: 'No unit assigned' }
//   with a 404 status code, which causes apiFetch to reject. The
//   useGpsTracking + NavPage consumers both .catch() this, so it
//   didn't crash the page — but the NavPage instrument panel
//   rendered "No unit assigned" permanently even when the unit
//   existed (the 404 is swallowed as a rejection, so the consumer
//   never retries). Now returns 200 with a null unit so the
//   consumer can distinguish "no unit yet" from "fetch error".
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
    console.error('[gps] GET /my-unit failed:', err);
    return c.json({ error: 'Failed' }, 500);
  }
});

// GET /dispatch/gps/my-vehicle — return the assigned fleet vehicle
// for the calling user's unit, with the vehicle row + latest GPS
// breadcrumb position (lat, lng, gps_updated_at) so the NAV panel
// can render the vehicle marker on the mini-map and show speed/
// heading in the instrument cluster.
//
// CROSS-INTEGRATION (Claude Opus 4.8 — d3001d25):
//   The pre-Claude DispatchMiniMap had no awareness of "which car
//   does this officer drive right now" — it plotted the unit's GPS
//   pin but couldn't add the vehicle outline. This endpoint bridges
//   officer → unit → fleet_vehicle → gps_breadcrumb in one call,
//   read by useNavTravel (or the DispatchMiniMap on non-nav pages)
//   to render the gold-border vehicle marker.
//
//   Steps: (1) units.officer_id = user.id → unit.id
//          (2) fleet_vehicles.assigned_unit_id = unit.id → vehicle
//          (3) gps_breadcrumbs.unit_id = unit.id, MAX(recorded_at)
//              → latest position fix
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
    console.error('[gps] GET /my-vehicle failed:', err);
    return c.json({ error: 'Failed' }, 500);
  }
});

// GET /dispatch/gps/dwell-times — units that have been stationary for a while.
gps.get('/dwell-times', async (c) => {
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
  } catch (err) { return c.json([]); }
});

// GET /dispatch/gps/speed-zones — recent high-speed events by zone.
gps.get('/speed-zones', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT g.unit_id, u.call_sign, g.speed, g.latitude, g.longitude, g.recorded_at
       FROM gps_breadcrumbs g
       JOIN units u ON u.id = g.unit_id
       WHERE g.speed > 45 AND g.recorded_at >= datetime('now', '-4 hours')
       ORDER BY g.speed DESC LIMIT 100`);
    return c.json(rows);
  } catch (err) { return c.json([]); }
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
gps.get('/trails', async (c) => {
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
    console.error('[gps] GET /trails failed:', err);
    return c.json([]);
  }
});

// GET /dispatch/gps/history?unit_id&from&to — historical trail for the
// replay panel. from/to are 'YYYY-MM-DD HH:MM:SS' local-style strings; the
// breadcrumb recorded_at is UTC SQLite text, so we compare lexically — the
// client sends a full datetime range and tolerates edge drift.
gps.get('/history', async (c) => {
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
    console.error('[gps] GET /history failed:', err);
    return c.json({ error: 'Failed to load GPS history' }, 500);
  }
});

// GET /dispatch/gps/units-with-trails — units that have breadcrumb data.
// Returns the replay panel's UnitOption contract: { unit_id, call_sign,
// officer_name, badge_number, earliest, latest, point_count }. The previous
// shape ({ id, call_sign }) left unit_id undefined in the picker, so the
// replay query always fired with unit_id=undefined and found nothing.
// Window: 30 days (the panel replays history, not just the live shift).
gps.get('/units-with-trails', async (c) => {
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
  } catch (err) { return c.json([]); }
});

// GET /dispatch/gps/speed-violations — recent speed violations for the map overlay.
gps.get('/speed-violations', async (c) => {
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
  } catch { return c.json([]); }
});

// POST /dispatch/gps/speed-violations/:id/acknowledge
gps.post('/speed-violations/:id/acknowledge', async (c) => {
  // Speed violations are derived from breadcrumbs, not a separate table.
  // Acknowledge is a no-op until we add a speed_violation_acks table.
  return c.json({ success: true, id: c.req.param('id') });
});

// GET /dispatch/gps/pursuit-segments — recent pursuit track segments.
gps.get('/pursuit-segments', async (c) => {
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
  } catch { return c.json([]); }
});

// GET /dispatch/gps/speed-heatmap — grid-aggregated speed data for map overlay.
gps.get('/speed-heatmap', async (c) => {
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
  } catch { return c.json([]); }
});

// ── GET /dispatch/gps/history-map — breadcrumb trail for a unit ─
gps.get('/history-map', async (c) => {
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
  } catch { return c.json({ unit_id: unitId, hours, points: [] }); }
});

export default gps;
