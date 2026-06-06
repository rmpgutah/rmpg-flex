import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';

const gps = new Hono<Env>();

// POST /dispatch/gps - Submit GPS breadcrumb
/**
 * Normalize a client-supplied breadcrumb to the {latitude, longitude, ...}
 * shape gps.ts inserts into gps_breadcrumbs. The React client uses
 * `{lat, lng, ...}` (matches the QueuedPoint type in useGpsTracking.ts
 * and is what the local storage failover queue persists), while the
 * Hono route was originally typed as `{latitude, longitude, ...}`. The
 * mismatch caused every POST to 500 with "NOT NULL constraint failed:
 * gps_breadcrumbs.latitude" because `pt.latitude` came back undefined.
 * Accept either key so the contract is forgiving across clients
 * (Toughbook Electron, browser mobile, desktop WiFi) without a
 * coordinate-system rename churn across the bundle.
 */
function normalizePoint(raw: Record<string, unknown>): {
  latitude: number; longitude: number; accuracy: number | null; heading: number | null; speed: number | null;
} {
  const lat = typeof raw.latitude === 'number' ? raw.latitude
    : typeof raw.lat === 'number' ? raw.lat
    : NaN;
  const lng = typeof raw.longitude === 'number' ? raw.longitude
    : typeof raw.lng === 'number' ? raw.lng
    : NaN;
  return {
    latitude: lat,
    longitude: lng,
    accuracy: typeof raw.accuracy === 'number' ? raw.accuracy : null,
    heading: typeof raw.heading === 'number' ? raw.heading : null,
    speed: typeof raw.speed === 'number' ? raw.speed : null,
  };
}

export { normalizePoint as _normalizePointForTest };

gps.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const body = await c.req.json<
      | { latitude?: number; longitude?: number; lat?: number; lng?: number; accuracy?: number; heading?: number; speed?: number }
      | { points: Array<Record<string, unknown>> }
    >();

    const rawPoints = 'points' in body ? body.points : [body as Record<string, unknown>];
    if (!rawPoints.length) return c.json({ error: 'No points' }, 400);

    const points = rawPoints.map(normalizePoint);
    const bad = points.findIndex((p) => !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude));
    if (bad >= 0) {
      return c.json({ error: `Invalid coordinates at index ${bad}` }, 400);
    }

    // Get user's unit info
    const unit = await queryFirst<{ id: number; call_sign: string }>(db,
      'SELECT id, call_sign FROM units WHERE officer_id = ? LIMIT 1', userId);

    if (!unit) return c.json({ error: 'No assigned unit' }, 400);

    const inserted: number[] = [];
    for (const pt of points) {
      const result = await execute(db,
        `INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude, accuracy, heading, speed, call_sign, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        unit.id, userId, pt.latitude, pt.longitude, pt.accuracy ?? null, pt.heading ?? null, pt.speed ?? null, unit.call_sign
      );
      inserted.push(Number(result.meta.last_row_id));
    }

    // Mirror the latest fix onto the unit row. The map filters officer pins by
    // `u.latitude != null` and closest-unit/anomaly logic reads u.latitude/
    // longitude/gps_updated_at — breadcrumbs alone never updated the unit, so
    // pins never plotted and proximity logic saw no position.
    const lastPt = points[points.length - 1];
    if (lastPt && lastPt.latitude != null && lastPt.longitude != null) {
      await execute(db,
        "UPDATE units SET latitude = ?, longitude = ?, gps_updated_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        lastPt.latitude, lastPt.longitude, unit.id);
    }

    return c.json({
      inserted: inserted.length,
      // Echo the unit so the client's `pickUnit(result)` (useGpsTracking.ts
      // sendBatch) can populate unitId/call_sign from the write path. The
      // canonical GET /dispatch/gps/my-unit read can be shadowed by the
      // rmpg-premise-stub edge worker returning a hollow {unit:null}; the
      // POST echo is never stubbed, so this is what actually feeds the
      // NAVIGATE/Trips UI.
      unit: { id: unit.id, call_sign: unit.call_sign },
    }, 201);
  } catch (err) {
    // Log the underlying D1/SQL message — without this every batch send failure
    // showed up in `wrangler tail` as a bare "GPS update failed" with no way
    // to tell NOT NULL violations from auth gaps from transient D1 locks.
    // The shape mirrors the global onError in src/index.ts so log filters
    // (e.g. searching for "Unhandled in POST /api/dispatch/gps") work.
    console.error('GPS breadcrumb write failed (userId=' + c.get('userId') + '):', err);
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
              g.heading AS gps_heading, g.speed_mph AS gps_speed, g.recorded_at AS gps_updated_at
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
                g.heading AS gps_heading, g.speed_mph AS gps_speed, g.recorded_at AS gps_updated_at
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
    return c.json({ error: 'Failed' }, 500);
  }
});

export default gps;
