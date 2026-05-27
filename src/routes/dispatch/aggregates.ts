import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst } from '../../utils/db';
import { LIST_VIEW_COLUMNS } from './calls';

// Shared with /dispatch/calls — keeps the queue rows shape-compatible with
// the list rows the dispatch panel already knows how to render.
const LIST_VIEW_SELECT = LIST_VIEW_COLUMNS.map(col => `c.${col}`).join(', ');

const aggregates = new Hono<Env>();

// GET /dispatch/aggregates - Dashboard stats
aggregates.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const [totals] = await query<Record<string, number>>(db, `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('pending','dispatched','enroute','onscene') THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'dispatched' THEN 1 ELSE 0 END) as dispatched,
        SUM(CASE WHEN status = 'enroute' THEN 1 ELSE 0 END) as enroute,
        SUM(CASE WHEN status = 'onscene' THEN 1 ELSE 0 END) as onscene,
        SUM(CASE WHEN priority = 'P1' AND status NOT IN ('cleared','closed','cancelled','archived') THEN 1 ELSE 0 END) as p1_count,
        SUM(CASE WHEN priority = 'P2' AND status NOT IN ('cleared','closed','cancelled','archived') THEN 1 ELSE 0 END) as p2_count,
        SUM(CASE WHEN priority = 'P3' AND status NOT IN ('cleared','closed','cancelled','archived') THEN 1 ELSE 0 END) as p3_count
      FROM calls_for_service
    `);

    const [unitStats] = await query<Record<string, number>>(db, `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
        SUM(CASE WHEN status IN ('dispatched','enroute','onscene') THEN 1 ELSE 0 END) as committed,
        SUM(CASE WHEN status = 'off_duty' THEN 1 ELSE 0 END) as off_duty
      FROM units
    `);

    const [todayCalls] = await query<{ count: number }>(db, "SELECT COUNT(*) as count FROM calls_for_service WHERE date(created_at) = date('now')");

    return c.json({
      calls: { ...totals, today: todayCalls?.count ?? 0 },
      units: unitStats,
    });
  } catch (err) {
    return c.json({ error: 'Failed to get aggregates' }, 500);
  }
});

// GET /dispatch/disposition-stats
aggregates.get('/disposition-stats', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT COALESCE(disposition, 'Not Set') as disposition, COUNT(*) as count
      FROM calls_for_service WHERE status IN ('cleared','closed')
      GROUP BY disposition ORDER BY count DESC
    `);
    return c.json(rows);
  } catch (err) {
    return c.json({ error: 'Failed' }, 500);
  }
});

// GET /dispatch/queue - Active calls queue (alias for map page)
aggregates.get('/queue', async (c) => {
  try {
    const db = getDb(c.env);
    // Narrow projection — D1 caps result sets at 100 cols and
    // calls_for_service alone is at the cap. See dispatch/calls.ts.
    const rows = await query<Record<string, unknown>>(db, `
      SELECT ${LIST_VIEW_SELECT}, u.full_name as dispatcher_name
      FROM calls_for_service c
      LEFT JOIN users u ON c.dispatcher_id = u.id
      WHERE c.status IN ('dispatched','enroute','onscene','pending','open')
      ORDER BY c.created_at DESC
      LIMIT 200
    `);
    return c.json(rows);
  } catch (err) {
    console.error('Queue error:', err);
    return c.json({ error: 'Failed to get active calls', details: String(err) }, 500);
  }
});

// GET /dispatch/districts - Flat geography list for map coloring
aggregates.get('/districts', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT
        ds.id AS sector_id,
        ds.sector_code,
        ds.sector_name,
        ds.color AS sector_color,
        dz.id AS zone_db_id,
        dz.zone_code AS zone_id,
        dz.zone_name,
        db.id AS beat_db_id,
        db.beat_code AS beat_id,
        db.beat_name,
        db.beat_descriptor,
        db.dispatch_code,
        da.id AS area_id,
        da.area_name,
        da.area_code
      FROM dispatch_beats db
      JOIN dispatch_zones dz ON dz.id = db.zone_id
      JOIN dispatch_sectors ds ON ds.id = dz.sector_id
      JOIN dispatch_areas da ON da.id = ds.area_id
      WHERE db.active = 1 AND dz.active = 1 AND ds.active = 1
      ORDER BY da.sort_order, ds.sort_order, dz.sort_order, db.sort_order
    `);
    return c.json(rows);
  } catch (err) {
    return c.json([]);
  }
});

export default aggregates;
