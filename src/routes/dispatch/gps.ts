import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute, executeBatch } from '../../utils/db';
import { emitAlert } from '../../utils/alertHub';
import { applyTripEvent, type ApplyArgs } from '../../utils/tripStore';
import { type IncomingFix } from '../../utils/tripTelemetry';
import type { TripEvent } from '../../utils/tripEngine';

const gps = new Hono<Env>();

// Normalize a GPS point from either client format ({ lat, lng }) or
// server-previous format ({ latitude, longitude }). Returns normalized
// { latitude, longitude, ... } so the rest of the handler only sees one shape.
function norm(pt: Record<string, unknown>): { latitude: number; longitude: number; accuracy?: number; heading?: number; speed?: number; timestamp?: string; source?: string } {
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

    const points = rawPoints.map(norm);
    const lastPt = points[points.length - 1];

    // Unit identity: officer → units row. Take-home officers (has_take_home = 1
    // on the user) bypass the unit requirement and return a sentinel so the
    // client gets unitId = null but the breadcrumbs still persist.
    const userRow = await queryFirst<{ has_take_home: number }>(db,
      'SELECT has_take_home FROM users WHERE id = ?', userId);
    const isTakeHome = userRow?.has_take_home === 1;

    const unit = await queryFirst<{ id: number; call_sign: string; status: string; gps_source: string | null; vehicle_id: string | null }>(db,
      'SELECT id, call_sign, status, gps_source, vehicle_id FROM units WHERE officer_id = ? LIMIT 1', userId);

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
      sql: `INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude, accuracy, heading, speed, call_sign, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      bindings: [unitId, userId, pt.latitude, pt.longitude, pt.accuracy ?? null, pt.heading ?? null, pt.speed ?? null, callSign],
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

    // Trip engine: feed every fix through applyTripEvent so the pure engine
    // creates/closes unit_trips rows. The cron sweep closes orphaned trips;
    // live GPS writes are what OPEN and append them.
    if (unitId) {
      for (const pt of points) {
        const ts = pt.timestamp ? Date.parse(pt.timestamp.replace(' ', 'T') + 'Z') : Date.now();
        if (!isNaN(ts) && pt.latitude != null && pt.longitude != null) {
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
                prevLat: pt.latitude, prevLng: pt.longitude,
              },
            });
          } catch { /* trip engine is non-fatal — never break GPS write */ }
        }
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

// GET /dispatch/gps/units-with-trails — units that have recent breadcrumb data.
gps.get('/units-with-trails', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT DISTINCT g.unit_id AS id, u.call_sign
       FROM gps_breadcrumbs g
       JOIN units u ON u.id = g.unit_id
       WHERE g.recorded_at >= datetime('now', '-8 hours')
       ORDER BY u.call_sign`);
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
       JOIN units u ON JSON_EXTRACT(cfs.assigned_unit_ids, '$[0]') = u.id
       LEFT JOIN users usr ON usr.id = u.officer_id
       LEFT JOIN gps_breadcrumbs g ON g.unit_id = u.id
         AND g.recorded_at >= cfs.received_at
         AND (cfs.closed_at IS NULL OR g.recorded_at <= cfs.closed_at)
       WHERE (cfs.vehicle_pursuit = 1 OR cfs.foot_pursuit = 1)
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
