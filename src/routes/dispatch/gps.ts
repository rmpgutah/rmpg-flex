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
              vehicleId: unit?.vehicle_id ? Number(unit.vehicle_id) || null : null,
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
    return c.json({ error: 'GPS update failed' }, 500);
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

export default gps;
