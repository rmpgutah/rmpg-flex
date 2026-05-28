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

// GET /dispatch/queue - Active calls queue (MapPage + dashboards).
// Mirrors the legacy enrichment: age_minutes + _overdue + _expected_response_minutes,
// computed in JS from priority + status + age. Uses LIST_VIEW_COLUMNS to dodge
// the 100-column D1 cap that 500'd the legacy `SELECT c.*` handler.
aggregates.get('/queue', async (c) => {
  try {
    const db = getDb(c.env);
    // Narrow projection — D1 caps result sets at 100 cols and
    // calls_for_service alone is at the cap. See dispatch/calls.ts.
    const rows = await query<Record<string, unknown>>(db, `
      SELECT ${LIST_VIEW_SELECT},
        p.name as property_name, u.full_name as dispatcher_name
      FROM calls_for_service c
      LEFT JOIN properties p ON c.property_id = p.id
      LEFT JOIN users u ON c.dispatcher_id = u.id
      WHERE c.status IN ('pending', 'dispatched', 'enroute', 'onscene', 'on_hold')
      ORDER BY
        CASE c.status WHEN 'on_hold' THEN 1 ELSE 0 END,
        COALESCE(c.priority_score, CASE c.priority WHEN 'P1' THEN 400 WHEN 'P2' THEN 300 WHEN 'P3' THEN 200 WHEN 'P4' THEN 100 END) DESC,
        c.created_at ASC
      LIMIT 200
    `);

    const expectedMinutes: Record<string, number> = { P1: 8, P2: 15, P3: 30, P4: 60 };
    const nowMs = Date.now();
    const enriched = rows.map((r) => {
      const createdAt = r.created_at ? Date.parse(String(r.created_at)) : null;
      const ageMinutes = createdAt != null && !Number.isNaN(createdAt)
        ? Math.round(((nowMs - createdAt) / 60_000) * 10) / 10
        : null;
      const expected = expectedMinutes[String(r.priority)] ?? 30;
      const isOverdue = ageMinutes != null && ageMinutes > expected && r.status === 'pending';
      return { ...r, age_minutes: ageMinutes, _overdue: isOverdue, _expected_response_minutes: expected };
    });
    return c.json(enriched);
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

// GET /dispatch/aggregates/call-volume?days=7
// Daily call counts for the dashboard's multi-day volume trend.
// Projects only date(created_at) + COUNT, so it sidesteps the 100-column
// D1 result-set cap that calls_for_service sits at. Returns rows for days
// that had calls; the client zero-fills the gaps so the chart is contiguous.
aggregates.get('/call-volume', async (c) => {
  try {
    const db = getDb(c.env);
    const raw = Number.parseInt(c.req.query('days') ?? '', 10);
    const days = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 90) : 7;
    const rows = await query<{ date: string; count: number }>(db, `
      SELECT date(created_at) AS date, COUNT(*) AS count
        FROM calls_for_service
       WHERE created_at >= datetime('now', ?)
       GROUP BY date(created_at)
       ORDER BY date ASC
    `, `-${days} days`);
    return c.json({ days, by_day: rows });
  } catch (err) {
    return c.json({ days: 0, by_day: [] });
  }
});

// GET /dispatch/aggregates/by-zone?days=7
// Call volume grouped by the denormalised zone_beat label on each call.
// Used by the dashboard's calls-by-zone heat list. NULL/blank labels roll
// up into 'Unassigned' so the total always reconciles with call_volume.
aggregates.get('/by-zone', async (c) => {
  try {
    const db = getDb(c.env);
    const raw = Number.parseInt(c.req.query('days') ?? '', 10);
    const days = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 90) : 7;
    const rows = await query<{ zone: string; count: number }>(db, `
      SELECT COALESCE(NULLIF(TRIM(zone_beat), ''), 'Unassigned') AS zone,
             COUNT(*) AS count
        FROM calls_for_service
       WHERE created_at >= datetime('now', ?)
       GROUP BY zone
       ORDER BY count DESC
       LIMIT 12
    `, `-${days} days`);
    return c.json({ days, by_zone: rows });
  } catch (err) {
    return c.json({ days: 0, by_zone: [] });
  }
});

export default aggregates;
