import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute, executeBatch } from '../../utils/db';
import { emitAlert } from '../../utils/alertHub';
import { applyTripEvent } from '../../utils/tripStore';

const gps = new Hono<Env>();

// POST /dispatch/gps - Submit GPS breadcrumb
gps.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const body = await c.req.json<any>();

    // ── Coordinate field normalization (CRITICAL) ──
    // The client (useGpsTracking) sends each breadcrumb as { lat, lng, … }; some
    // callers use { latitude, longitude }. This handler previously read ONLY
    // latitude/longitude, so once POST /api/dispatch/gps was routed to THIS
    // (rewrite) worker off the legacy worker, every point's coords resolved to
    // undefined → D1 rejects an `undefined` bind → the handler threw 500
    // "GPS update failed". Breadcrumbs never persisted and units vanished from
    // the dispatch map FLEET-WIDE. Accept both names and drop any point without
    // finite coords so one bad point can't 500 the whole batch.
    const rawPoints: any[] = Array.isArray(body?.points) ? body.points : [body];
    const points = rawPoints
      .map((p: any) => ({
        latitude: Number(p?.lat ?? p?.latitude),
        longitude: Number(p?.lng ?? p?.longitude),
        accuracy: p?.accuracy ?? null,
        heading: p?.heading ?? null,
        speed: p?.speed ?? null,
        timestamp: p?.timestamp ?? null,   // ADD — client ISO ts, for intra-batch dt
      }))
      .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
      // Cap to the most-recent N — a large post-offline backlog replayed at once
      // could otherwise exceed the D1 batch / Workers subrequest budget.
      .slice(-200);
    if (!points.length) return c.json({ error: 'No valid GPS points' }, 400);

    // Get user's unit info (status carried into the live frame so the map can
    // color a freshly-rebuilt heading arrow without a second lookup).
    const unit = await queryFirst<{ id: number; call_sign: string; status: string | null;
      latitude: number | null; longitude: number | null; officer_id: number | null;
      vehicle_id: number | null; gps_source: string | null }>(db,
      'SELECT id, call_sign, status, latitude, longitude, officer_id, vehicle_id, gps_source FROM units WHERE officer_id = ? LIMIT 1', userId);

    // Take-home vehicle fallback: officers with a take-home vehicle don't need
    // a dispatch unit assignment to send GPS breadcrumbs for trip logging.
    if (!unit) {
      const user = await queryFirst<{ take_home_vehicle_id: number | null }>(db,
        'SELECT take_home_vehicle_id FROM users WHERE id = ?', userId);
      if (user?.take_home_vehicle_id) {
        // Take-home user — accept breadcrumbs without a unit (for nav trip logging).
        // No trip engine, no emitAlert, no unit mirror — just persist breadcrumbs.
        let inserted = 0;
        try {
          await executeBatch(db, points.map((pt) => ({
            sql: `INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude, accuracy, heading, speed, call_sign, recorded_at)
                  VALUES (NULL, ?, ?, ?, ?, ?, ?, 'take-home', datetime('now'))`,
            bindings: [userId, pt.latitude, pt.longitude, pt.accuracy, pt.heading, pt.speed],
          })));
          inserted = points.length;
        } catch (err) {
          console.warn('[gps] take-home breadcrumb batch failed:', err);
        }
        return c.json({
          inserted,
          accepted: points.length,
          unit: { id: null, call_sign: null, status: 'take_home', gps_source: 'browser', take_home: true },
        }, 201);
      }
      return c.json({ error: 'No assigned unit' }, 400);
    }
    // Capture the prior position BEFORE the unit-row mirror UPDATE below
    // overwrites units.latitude/longitude — the trip engine needs the real
    // pre-batch position as the running `prev` for the first fix.
    const prevLat0 = unit.latitude;
    const prevLng0 = unit.longitude;

    // Breadcrumb trail — ONE batched write, BEST-EFFORT. This try/catch sits
    // BEFORE the unit-row mirror below, so a trail failure can never skip the
    // position write or the client's 200 success ack (which advances
    // lastSentAt → clears the red GPS LED). The old per-point loop inside the
    // outer try meant one failed insert 500'd the whole request and froze the
    // unit position. (Restores the #978 hardening dropped in the #977×#978 merge.)
    let inserted = 0;
    try {
      await executeBatch(db, points.map((pt) => ({
        sql: `INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude, accuracy, heading, speed, call_sign, recorded_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        bindings: [unit.id, userId, pt.latitude, pt.longitude, pt.accuracy, pt.heading, pt.speed, unit.call_sign],
      })));
      inserted = points.length;
    } catch (err) {
      console.warn('[gps] breadcrumb batch failed (non-fatal — position mirror still runs):', err);
    }

    // Mirror the latest fix onto the unit row.
    const lastPt = points[points.length - 1];
    if (lastPt) {
      // Mirror heading/speed too (the map's nav-cursor arrow + speed label read
      // unit.gps_heading / unit.gps_speed; columns added in migration 0065).
      const heading = lastPt.heading;
      const speed = lastPt.speed;
      await execute(db,
        "UPDATE units SET latitude = ?, longitude = ?, gps_heading = ?, gps_speed = ?, gps_source = 'gps', gps_updated_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        lastPt.latitude, lastPt.longitude, heading, speed, unit.id);
      // Live fan-out so the map unit pin moves (and the arrow rotates) without a
      // 7s poll, and recommended-units re-ranks on fresh GPS. /dispatch is
      // excluded from the generic data_changed sync, and gps was previously
      // silent — pins froze. One small frame per fix; consumers debounce.
      try {
        await emitAlert(c.env, 'unit_position', {
          action: 'gps_update',
          unit_id: unit.id,
          lat: lastPt.latitude,
          lng: lastPt.longitude,
          heading,
          speed,
          unit: {
            id: unit.id, call_sign: unit.call_sign, status: unit.status,
            latitude: lastPt.latitude, longitude: lastPt.longitude,
            gps_heading: heading, gps_speed: speed, gps_source: 'gps',
          },
        });
      } catch { /* never break the write */ }
    }

    // Trip segmentation — feed every fix in the batch to the pure engine: opens a
    // PATROL on movement, appends + rolls up telemetry, lazy-closes an idle PATROL.
    try {
      const nowMs = Date.now();
      const ENGINE_MAX = 60;
      const enginePoints = points.length > ENGINE_MAX ? points.slice(-ENGINE_MAX) : points;
      if (enginePoints.length < points.length) {
        console.warn(`[gps] trip engine processed last ${enginePoints.length}/${points.length} fixes (offline-replay cap)`);
      }
      const tsList = enginePoints.map((p) => Date.parse(String(p.timestamp ?? '')));
      const lastTs = tsList[tsList.length - 1];
      const lastValid = Number.isFinite(lastTs);
      const fixTs = (i: number): number => {
        const ti = tsList[i];
        if (lastValid && Number.isFinite(ti)) return nowMs - (lastTs - ti);
        return nowMs - (enginePoints.length - 1 - i) * 1000;
      };
      let pLat = prevLat0;
      let pLng = prevLng0;
      for (let i = 0; i < enginePoints.length; i++) {
        const pt = enginePoints[i];
        await applyTripEvent({
          db, env: c.env, unitId: unit.id, officerId: unit.officer_id, vehicleId: unit.vehicle_id,
          event: { kind: 'gps', fix: { lat: pt.latitude, lng: pt.longitude, speed: pt.speed, heading: pt.heading, ts: fixTs(i) } },
          ctx: { curLat: pt.latitude, curLng: pt.longitude, prevLat: pLat, prevLng: pLng },
        });
        pLat = pt.latitude;
        pLng = pt.longitude;
      }
      await execute(db,
        `UPDATE gps_breadcrumbs SET trip_id = (SELECT id FROM unit_trips WHERE unit_id = ? AND status = 'active' ORDER BY start_time DESC LIMIT 1)
         WHERE unit_id = ? AND trip_id IS NULL AND recorded_at >= datetime('now','-60 seconds')`,
        unit.id, unit.id);
    } catch (e) { console.warn('[gps] trip engine non-fatal:', e); }

    // Echo the caller's resolved unit back on the (non-stubbed) write path so
    // the client can learn "which unit am I?" without relying on GET
    // /dispatch/gps/my-unit — a path an edge stub (rmpg-premise-stub) can shadow
    // with a hollow {unit:null}, which otherwise leaves the NAVIGATE/Trips UI
    // stuck on "No unit assigned" even though the unit exists and GPS is flowing.
    return c.json({
      inserted,
      accepted: points.length,
      unit: {
        id: unit.id,
        call_sign: unit.call_sign,
        status: unit.status,
        gps_source: unit.gps_source ?? 'gps',
      },
    }, 201);
  } catch (err) {
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
gps.get('/my-unit', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const unit = await queryFirst<Record<string, unknown>>(db,
      'SELECT u.*, usr.full_name as officer_name FROM units u LEFT JOIN users usr ON u.officer_id = usr.id WHERE u.officer_id = ? LIMIT 1', userId);
    // Take-home vehicle fallback: officers with a take-home vehicle don't need
    // a dispatch unit assignment to log trips / send GPS breadcrumbs.
    if (!unit) {
      const user = await queryFirst<{ take_home_vehicle_id: number | null }>(db,
        'SELECT take_home_vehicle_id FROM users WHERE id = ?', userId);
      if (user?.take_home_vehicle_id) {
        const veh = await queryFirst<Record<string, unknown>>(db,
          `SELECT id, vehicle_number, make, model, plate_number, status, current_mileage
           FROM fleet_vehicles WHERE id = ? AND take_home = 1`, user.take_home_vehicle_id);
        if (veh) {
          return c.json({
            id: null, call_sign: null, status: 'take_home',
            take_home: true, vehicle: veh,
            message: 'Take-home vehicle — trip logging available',
          });
        }
      }
      return c.json({ message: 'No unit assigned' }, 404);
    }
    return c.json(unit);
  } catch (err) {
    return c.json({ error: 'Failed' }, 500);
  }
});

export default gps;
