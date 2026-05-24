import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';

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
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-6 hours'))`,
        unit.id, userId, pt.latitude, pt.longitude, pt.accuracy ?? null, pt.heading ?? null, pt.speed ?? null, unit.call_sign
      );
      inserted.push(Number(result.meta.last_row_id));
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
        WHERE recorded_at > datetime('now', '-6 hours', '-5 minutes')
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
