import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { broadcastAll } from '../ws';

const gps = new Hono<Env>();

// POST /dispatch/gps - Submit GPS breadcrumb
gps.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const body = await c.req.json<{ latitude: number; longitude: number; accuracy?: number; heading?: number; speed?: number } | { points: Array<{ latitude: number; longitude: number; accuracy?: number; heading?: number; speed?: number }> }>();

    const points = 'points' in body ? body.points : [body];
    if (!points.length) return c.json({ error: 'No points' }, 400);

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
      // Live fan-out so the map unit pin moves without a 7s poll, and
      // recommended-units re-ranks on fresh GPS. /dispatch is excluded from the
      // generic data_changed sync, and gps was previously silent — pins froze.
      // One small frame per fix; the map/recommended consumers debounce.
      try {
        broadcastAll('dispatch_update', {
          action: 'unit_position_update',
          unit_id: unit.id,
          unit: { id: unit.id, call_sign: unit.call_sign, latitude: lastPt.latitude, longitude: lastPt.longitude },
        });
      } catch { /* never break the write */ }
    }

    return c.json({ inserted: inserted.length }, 201);
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
