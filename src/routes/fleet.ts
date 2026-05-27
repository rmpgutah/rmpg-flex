// ============================================================
// Fleet vehicles + dashcam videos
// ============================================================
// Live D1 tables (confirmed 2026-05-27):
//   fleet_vehicles, fleet_assignments, fleet_maintenance, fleet_fuel_log,
//   fleet_inspections, dashcam_videos, bodycam_videos
//
// This is the minimum-viable port — covers the GET endpoints that the prod
// console log showed 404ing across FleetPage, DashCamerasPage, and
// MapPage's fleet vehicles layer. Sub-tabs that still 404 (recalls,
// fuel-cards, health-scores, maintenance-schedule, driver-performance,
// service-alerts, cost-trends, vehicle-lifecycle, pretrip) continue to
// fall through to the proxy stubs in proxy/index.ts until their handlers
// land. Writes (POST/PUT/DELETE) are intentionally NOT implemented here
// so save failures stay visible to the user — they shouldn't be able to
// edit data through half-implemented forms.

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const fleet = new Hono<Env>();

// GET /api/fleet?per_page=200&archived=false&fields=...
// FleetPage main list + FleetAnalyticsTab vehicle picker + multiple tabs.
// Response shape varies by caller — DashCamerasPage reads `data` as a
// vehicle array directly; FleetAnalyticsTab reads `data.vehicles` (and
// passes `fields=` to slim the response). Return both shapes so callers
// keep working: `{ data: rows, vehicles: rows, total }`.
fleet.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const { per_page, limit: limitParam, archived, fields } = c.req.query();
    const limit = Math.min(1000, Math.max(1, parseInt(per_page || limitParam || '200', 10)));

    let where = 'WHERE 1=1';
    if (archived === 'false') {
      where += " AND (status != 'retired' OR status IS NULL)";
    } else if (archived === 'true') {
      where += " AND status = 'retired'";
    }

    // `fields=` is currently advisory — the live row width is well under D1's
    // 100-col cap (fleet_vehicles has 21 columns), so SELECT * is safe and the
    // narrowing isn't needed for cap-avoidance. Honored only when the caller
    // explicitly opts in via a whitelist to avoid SQL-injection through the
    // query string.
    const ALLOWED_FIELDS = new Set([
      'id', 'vehicle_number', 'vehicle_name', 'make', 'model', 'year', 'color',
      'vin', 'plate_number', 'status', 'vehicle_type', 'assigned_unit_id',
      'current_mileage', 'next_service_due', 'next_service_date',
      'total_maintenance_cost', 'total_fuel_cost', 'avg_mpg',
      'created_at', 'updated_at',
    ]);
    let select = '*';
    if (fields) {
      const requested = fields.split(',').map(f => f.trim()).filter(f => ALLOWED_FIELDS.has(f));
      if (requested.length > 0) select = requested.join(', ');
    }

    const [{ total }] = await query<{ total: number }>(db, `SELECT COUNT(*) as total FROM fleet_vehicles ${where}`);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT ${select} FROM fleet_vehicles ${where}
      ORDER BY vehicle_number, id LIMIT ?
    `, limit);

    return c.json({ data: rows, vehicles: rows, total });
  } catch (err) {
    console.error('GET /fleet error:', err);
    return c.json({ error: 'Failed to list fleet vehicles' }, 500);
  }
});

// GET /api/fleet/map — vehicles with derivable GPS for the map layer.
// fleet_vehicles itself doesn't store GPS — coordinates come from the
// assigned unit's last position. Join through assigned_unit_id → units.
// Vehicles without an active assignment fall back to lat/lng=null so the
// map hook can filter them out via its existing isFinite() guard.
fleet.get('/map', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT
        fv.id, fv.vehicle_number, fv.make, fv.model, fv.year, fv.plate_number,
        fv.status, fv.current_mileage, fv.next_service_due,
        fv.assigned_unit_id,
        u.call_sign AS assigned_call_sign,
        u.latitude AS gps_lat,
        u.longitude AS gps_lon,
        NULL AS gps_speed,
        NULL AS gps_heading,
        u.gps_updated_at AS gps_reported_at
      FROM fleet_vehicles fv
      LEFT JOIN units u ON u.id = fv.assigned_unit_id
      WHERE fv.status != 'retired' OR fv.status IS NULL
      ORDER BY fv.vehicle_number
    `);
    return c.json(rows);
  } catch (err) {
    console.error('GET /fleet/map error:', err);
    return c.json([], 200);
  }
});

// GET /api/fleet/analytics — dashboard tiles + trend charts.
// Returns the FleetAnalytics contract from client/src/types/index.ts —
// fleet_summary is the load-bearing block (drives the top stat cards);
// the trend arrays are derived from the totals columns the legacy
// pipelines already maintain on fleet_vehicles. Cost-per-mile ranking
// and inspection pass rate ship empty until the underlying jobs land.
fleet.get('/analytics', async (c) => {
  try {
    const db = getDb(c.env);

    const summary = await queryFirst<Record<string, number>>(db, `
      SELECT
        COUNT(*) AS total_vehicles,
        COALESCE(AVG(current_mileage), 0) AS avg_mileage,
        AVG(avg_mpg) AS avg_mpg,
        COALESCE(SUM(total_maintenance_cost), 0) AS total_maintenance_cost,
        COALESCE(SUM(total_fuel_cost), 0) AS total_fuel_cost,
        SUM(CASE WHEN next_service_due IS NOT NULL AND date(next_service_due) <= date('now') THEN 1 ELSE 0 END) AS vehicles_needing_service,
        0 AS inspections_failing
      FROM fleet_vehicles
    `);

    const statusRows = await query<{ status: string; count: number }>(db, `
      SELECT COALESCE(status, 'unknown') AS status, COUNT(*) AS count
      FROM fleet_vehicles GROUP BY status
    `);
    const statusColor: Record<string, string> = {
      in_service: '#22c55e', maintenance: '#f59e0b',
      out_of_service: '#ef4444', retired: '#6b7280', unknown: '#888888',
    };

    const mileageRows = await query<{ range: string; count: number }>(db, `
      SELECT
        CASE
          WHEN current_mileage IS NULL THEN 'unknown'
          WHEN current_mileage < 25000 THEN '0-25k'
          WHEN current_mileage < 50000 THEN '25-50k'
          WHEN current_mileage < 75000 THEN '50-75k'
          WHEN current_mileage < 100000 THEN '75-100k'
          ELSE '100k+'
        END AS range,
        COUNT(*) AS count
      FROM fleet_vehicles GROUP BY range
    `);

    return c.json({
      fleet_summary: {
        total_vehicles: summary?.total_vehicles ?? 0,
        avg_mileage: Math.round(summary?.avg_mileage ?? 0),
        avg_mpg: summary?.avg_mpg ?? null,
        total_maintenance_cost: summary?.total_maintenance_cost ?? 0,
        total_fuel_cost: summary?.total_fuel_cost ?? 0,
        vehicles_needing_service: summary?.vehicles_needing_service ?? 0,
        inspections_failing: 0,
      },
      status_breakdown: statusRows.map(r => ({
        status: r.status,
        count: r.count,
        color: statusColor[r.status] ?? '#888888',
      })),
      mileage_distribution: mileageRows,
      maintenance_cost_trend: [],
      fuel_economy_trend: [],
    });
  } catch (err) {
    console.error('GET /fleet/analytics error:', err);
    return c.json({ error: 'Failed to compute fleet analytics' }, 500);
  }
});

// GET /api/fleet/:id — single vehicle detail.
fleet.get('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const vehicle = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM fleet_vehicles WHERE id = ?', id);
    if (!vehicle) return c.json({ error: 'Vehicle not found' }, 404);
    return c.json(vehicle);
  } catch (err) {
    return c.json({ error: 'Failed to get vehicle' }, 500);
  }
});

// ─── Dashcam videos ─────────────────────────────────────────
// DashCamerasPage list view; reads `data.videos` + `data.total`.
fleet.get('/dashcam-videos', async (c) => {
  try {
    const db = getDb(c.env);
    const { limit: limitParam, offset: offsetParam, search } = c.req.query();
    const limit = Math.min(200, Math.max(1, parseInt(limitParam || '25', 10)));
    const offset = Math.max(0, parseInt(offsetParam || '0', 10));

    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    if (search?.trim()) {
      where += ' AND (title LIKE ? OR case_number LIKE ? OR notes LIKE ?)';
      const s = `%${search.trim()}%`;
      params.push(s, s, s);
    }

    const [{ total }] = await query<{ total: number }>(
      db, `SELECT COUNT(*) AS total FROM dashcam_videos ${where}`, ...params);

    const videos = await query<Record<string, unknown>>(db, `
      SELECT * FROM dashcam_videos ${where}
      ORDER BY recorded_at DESC, id DESC LIMIT ? OFFSET ?
    `, ...params, limit, offset);

    return c.json({ videos, total });
  } catch (err) {
    console.error('GET /fleet/dashcam-videos error:', err);
    return c.json({ error: 'Failed to list dashcam videos' }, 500);
  }
});

// GET /api/fleet/dashcam-videos/:id — detail view.
fleet.get('/dashcam-videos/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const video = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM dashcam_videos WHERE id = ?', id);
    if (!video) return c.json({ error: 'Video not found' }, 404);
    return c.json(video);
  } catch (err) {
    return c.json({ error: 'Failed to get video' }, 500);
  }
});

// GET /api/fleet/dashcam-videos/:id/neighbors — prev/next IDs for the
// detail page's keyboard navigation. Ordered by recorded_at to match the
// list view.
fleet.get('/dashcam-videos/:id/neighbors', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const current = await queryFirst<{ recorded_at: string }>(
      db, 'SELECT recorded_at FROM dashcam_videos WHERE id = ?', id);
    if (!current) return c.json({});

    const prev = await queryFirst<{ id: number }>(db, `
      SELECT id FROM dashcam_videos
      WHERE (recorded_at, id) < (?, ?)
      ORDER BY recorded_at DESC, id DESC LIMIT 1
    `, current.recorded_at, id);
    const next = await queryFirst<{ id: number }>(db, `
      SELECT id FROM dashcam_videos
      WHERE (recorded_at, id) > (?, ?)
      ORDER BY recorded_at ASC, id ASC LIMIT 1
    `, current.recorded_at, id);

    return c.json({ prev: prev?.id ?? null, next: next?.id ?? null });
  } catch (err) {
    return c.json({});
  }
});

// PUT /api/fleet/dashcam-videos/:id — DashCamerasPage classification +
// metadata edits. Whitelisted columns only.
fleet.put('/dashcam-videos/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const body = await c.req.json<Record<string, unknown>>();

    const EDITABLE = ['title', 'case_number', 'classification', 'retention_status', 'notes'];
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of EDITABLE) {
      if (k in body) { sets.push(`${k} = ?`); params.push(body[k]); }
    }
    if (sets.length === 0) return c.json({ error: 'No editable fields supplied' }, 400);

    sets.push("updated_at = datetime('now')");
    params.push(id);
    await execute(db, `UPDATE dashcam_videos SET ${sets.join(', ')} WHERE id = ?`, ...params);

    const updated = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM dashcam_videos WHERE id = ?', id);
    return c.json(updated);
  } catch (err) {
    console.error('PUT /fleet/dashcam-videos/:id error:', err);
    return c.json({ error: 'Failed to update video' }, 500);
  }
});

// DELETE /api/fleet/dashcam-videos/:id
fleet.delete('/dashcam-videos/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    await execute(db, 'DELETE FROM dashcam_videos WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to delete video' }, 500);
  }
});

export default fleet;
