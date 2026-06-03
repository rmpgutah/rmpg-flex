import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute, executeBatch } from '../../utils/db';
import { emitAlert } from '../../utils/alertHub';

const gps = new Hono<Env>();

// POST /dispatch/gps - Submit GPS breadcrumb
gps.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const body = await c.req.json<{ latitude: number; longitude: number; accuracy?: number; heading?: number; speed?: number } | { points: Array<{ latitude: number; longitude: number; accuracy?: number; heading?: number; speed?: number }> }>();

    const rawPoints = 'points' in body ? body.points : [body];
    // Keep only the most recent MAX_POINTS valid fixes. After a long offline
    // stretch the client replays a large failover backlog; bounding it keeps the
    // single batched write below within the D1 batch / Workers subrequest budget
    // so a big backlog can't 500 the whole upload (which froze the client's
    // lastSentAt → the footer GPS LED stuck red).
    const MAX_POINTS = 200;
    const points = (Array.isArray(rawPoints) ? rawPoints : [])
      .filter((p) => p && Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude)))
      .slice(-MAX_POINTS);
    if (!points.length) return c.json({ error: 'No valid points' }, 400);

    // Get user's unit info (status carried into the live frame so the map can
    // color a freshly-rebuilt heading arrow without a second lookup).
    const unit = await queryFirst<{ id: number; call_sign: string; status: string | null }>(db,
      'SELECT id, call_sign, status FROM units WHERE officer_id = ? LIMIT 1', userId);

    if (!unit) return c.json({ error: 'No assigned unit' }, 400);

    // Breadcrumb trail — ONE batched write (not N sequential round-trips), and
    // BEST-EFFORT: this try/catch sits BEFORE the unit-row mirror below, so a
    // trail failure can never skip the position write or the client's success
    // ack. (The old per-point loop inside the same try as the mirror meant one
    // failed insert 500'd the whole request and froze the unit position.)
    let inserted = 0;
    try {
      await executeBatch(db, points.map((pt) => ({
        sql: `INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude, accuracy, heading, speed, call_sign, recorded_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        bindings: [unit.id, userId, pt.latitude, pt.longitude, pt.accuracy ?? null, pt.heading ?? null, pt.speed ?? null, unit.call_sign],
      })));
      inserted = points.length;
    } catch (err) {
      console.warn('[gps] breadcrumb batch failed (non-fatal — position mirror still runs):', err);
    }

    // Mirror the latest fix onto the unit row. The map filters officer pins by
    // `u.latitude != null` and closest-unit/anomaly logic reads u.latitude/
    // longitude/gps_updated_at — breadcrumbs alone never updated the unit, so
    // pins never plotted and proximity logic saw no position.
    const lastPt = points[points.length - 1];
    if (lastPt && lastPt.latitude != null && lastPt.longitude != null) {
      // Mirror heading/speed too (the map's nav-cursor arrow + speed label read
      // unit.gps_heading / unit.gps_speed; columns added in migration 0065).
      const heading = lastPt.heading ?? null;
      const speed = lastPt.speed ?? null;
      await execute(db,
        "UPDATE units SET latitude = ?, longitude = ?, gps_heading = ?, gps_speed = ?, gps_source = 'gps', gps_updated_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        lastPt.latitude, lastPt.longitude, heading, speed, unit.id);
      // Live fan-out so the map unit pin moves (and the arrow rotates) without a
      // 7s poll, and recommended-units re-ranks on fresh GPS. /dispatch is
      // excluded from the generic data_changed sync, and gps was previously
      // silent — pins froze. One small frame per fix; consumers debounce.
      //
      // CRITICAL: this MUST go through AlertHubDO (the shared cross-worker bus),
      // not broadcastAll(). The client's live socket is /api/alerts-ws on THIS
      // (rewrite) worker via the global AlertHubDO; broadcastAll() only reaches
      // routes/ws.ts's per-isolate map, which is empty because the main /api/ws
      // socket lives on the LEGACY worker — so broadcastAll() delivered to 0
      // clients (dead). emitAlert() fans out via env.ALERT_HUB exactly like
      // panic, so every connected console/MDT actually receives the position.
      // Message type 'unit_position' / action 'gps_update' (see report); the DO
      // broadcasts any non-panic frame and skips the forced-ack lifecycle.
      // Best-effort: a fan-out failure must never fail the breadcrumb write.
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

    return c.json({ inserted, accepted: points.length }, 201);
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
    if (!unit) return c.json({ message: 'No unit assigned' }, 404);
    return c.json(unit);
  } catch (err) {
    return c.json({ error: 'Failed' }, 500);
  }
});

export default gps;
