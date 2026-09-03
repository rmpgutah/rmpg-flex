// ============================================================
// Dispatch CFS route planner — /api/dispatch/routing
// ============================================================
// Backs client/src/pages/RouteBuilderPage.tsx, whose four endpoints
// (optimize / save / unit/:unitId / :id/complete-stop) were never
// mounted on any server — every button on /route-builder 404'd.
//
// POST /optimize        { unit_id, priority_weighted? } → ordered waypoints
// POST /save            persist a built route          → { success, id }
// GET  /unit/:unitId    latest active saved routes      → SavedRoute[]
// POST /:id/complete-stop { call_id }                   → { success }
//
// Ordering = nearest-neighbor + 2-opt (src/utils/routeOptimizer.ts),
// haversine objective; the client overlays Mapbox Directions (via the
// /api/mapbox proxy) for the road polyline + traffic ETA.
import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { optimizeStops, estimateDriveMinutes } from '../../utils/routeOptimizer';
import { requireRole } from '../../middleware/auth';
import { log } from '../../utils/logger';
import { dbErrorResponse } from '../../utils/dbErrors';

const routing = new Hono<Env>();

// Boot reconciler — deploy migrations are continue-on-error, so the route
// self-heals the table (same pattern as alpr_captures / assessor columns).
let tableEnsured = false;
async function ensureTable(db: D1Database): Promise<void> {
  if (tableEnsured) return;
  await execute(db, `
    CREATE TABLE IF NOT EXISTS dispatch_unit_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unit_id TEXT NOT NULL,
      origin_lat REAL,
      origin_lng REAL,
      waypoints_json TEXT NOT NULL DEFAULT '[]',
      optimized_order_json TEXT NOT NULL DEFAULT '[]',
      total_distance_miles REAL DEFAULT 0,
      estimated_time_minutes INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  await execute(db,
    'CREATE INDEX IF NOT EXISTS idx_dispatch_unit_routes_unit ON dispatch_unit_routes(unit_id, status)');
  tableEnsured = true;
}

interface CallRow {
  id: number;
  call_number: string;
  incident_type: string | null;
  priority: string | null;
  status: string;
  latitude: number | null;
  longitude: number | null;
  // The live column is `location_address` — there is no `location` column on
  // calls_for_service (verified via pragma_table_info: location_address,
  // location_building, location_floor, location_room). Selecting `location`
  // made every /optimize call fail with "no such column: location".
  location_address: string | null;
  description: string | null;
  assigned_unit_ids: string | null;
}

// POST /optimize — build an ordered route over the unit's active CFS calls.
routing.post('/optimize', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<{ unit_id?: string | number; priority_weighted?: boolean }>().catch(() => ({} as any));
    const unitId = body.unit_id;
    if (unitId == null || unitId === '') return c.json({ error: 'unit_id is required' }, 400);
    const priorityWeighted = body.priority_weighted !== false;

    const unit = await queryFirst<{ id: number; call_sign: string; latitude: number | null; longitude: number | null }>(
      db, 'SELECT id, call_sign, latitude, longitude FROM units WHERE id = ?', unitId);
    if (!unit) return c.json({ error: 'Unit not found' }, 404);

    // Active workload: calls assigned to this unit that are still being worked.
    // H10: push the unit-membership filter into SQL using json_each so only
    // calls actually assigned to this unit are returned — previously LIMIT 500
    // returned up to 500 agency-wide active calls and then JS-filtered them,
    // meaning a busy agency could push the target unit's calls past the cap.
    const CAP = 200;
    const candidates = await query<CallRow>(db, `
      SELECT id, call_number, incident_type, priority, status, latitude, longitude,
             location_address, description, assigned_unit_ids
      FROM calls_for_service
      WHERE status IN ('pending','dispatched','enroute','onscene')
        AND EXISTS (
          SELECT 1 FROM json_each(assigned_unit_ids) je WHERE je.value = ?
        )
      ORDER BY created_at ASC LIMIT ?`, Number(unitId), CAP + 1);

    const hitCap = candidates.length > CAP;
    if (hitCap) candidates.splice(CAP);

    const routable = candidates.filter((call) => call.latitude != null && call.longitude != null);
    const skipped = candidates.length - routable.length;

    let warning: string | undefined;
    if (candidates.length === 0) warning = 'No active calls are available to route.';
    else if (routable.length === 0) warning = 'Active calls have no GPS coordinates — nothing to route.';
    else if (skipped > 0) warning = `${skipped} call(s) skipped — no GPS coordinates.`;
    if (hitCap) warning = [warning, `Route capped at ${CAP} calls. Some calls may be excluded.`].filter(Boolean).join(' ');

    // Origin: the unit's live position, else the first routable call.
    let origin = unit.latitude != null && unit.longitude != null
      ? { lat: unit.latitude, lng: unit.longitude }
      : null;
    if (!origin && routable.length > 0) {
      origin = { lat: routable[0].latitude!, lng: routable[0].longitude! };
      warning = [warning, 'Unit has no GPS fix — routing from the first call.'].filter(Boolean).join(' ');
    }
    if (!origin) origin = { lat: 40.7608, lng: -111.891 }; // downtown SLC fallback

    const stops = routable.map((call) => ({
      id: call.id,
      latitude: call.latitude!,
      longitude: call.longitude!,
      priority: call.priority,
      call,
    }));
    const { ordered, legsMiles, totalMiles } = optimizeStops(origin, stops, priorityWeighted);

    const waypoints = ordered.map((s, i) => ({
      stop_number: i + 1,
      call_id: s.call.id,
      call_number: s.call.call_number,
      incident_type: s.call.incident_type || 'other',
      priority: s.call.priority || 'P3',
      latitude: s.latitude,
      longitude: s.longitude,
      location_address: s.call.location_address || '',
      status: s.call.status,
      description: s.call.description || undefined,
      distance_from_prev_miles: Math.round(legsMiles[i] * 100) / 100,
      completed: false,
    }));

    return c.json({
      unit_id: String(unitId),
      origin,
      optimized_order: waypoints.map((w) => w.call_id),
      waypoints,
      total_distance_miles: Math.round(totalMiles * 100) / 100,
      estimated_time_minutes: estimateDriveMinutes(totalMiles, waypoints.length),
      algorithm: 'nearest-neighbor+2-opt',
      priority_weighted: priorityWeighted,
      ...(warning ? { warning } : {}),
    });
  } catch (err) {
    log.error('POST /dispatch/routing/optimize failed', {}, err as Error);
    return dbErrorResponse(c, err, 'Failed to optimize route');
  }
});

// POST /save — persist the built route (supersedes prior active routes for the unit).
routing.post('/save', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    await ensureTable(db);
    const body = await c.req.json<any>();
    const unitId = body?.unit_id;
    const waypoints = Array.isArray(body?.waypoints_json) ? body.waypoints_json : [];
    if (unitId == null || unitId === '') return c.json({ error: 'unit_id is required' }, 400);
    if (waypoints.length === 0) return c.json({ error: 'waypoints_json must be a non-empty array' }, 400);

    await execute(db,
      "UPDATE dispatch_unit_routes SET status = 'superseded', updated_at = datetime('now') WHERE unit_id = ? AND status = 'active'",
      String(unitId));
    const result = await getDb(c.env).prepare(`
      INSERT INTO dispatch_unit_routes
        (unit_id, origin_lat, origin_lng, waypoints_json, optimized_order_json,
         total_distance_miles, estimated_time_minutes, notes, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`)
      .bind(
        String(unitId),
        body.origin_lat ?? null,
        body.origin_lng ?? null,
        JSON.stringify(waypoints),
        JSON.stringify(Array.isArray(body.optimized_order_json) ? body.optimized_order_json : []),
        Number(body.total_distance_miles) || 0,
        Math.round(Number(body.estimated_time_minutes)) || 0,
        String(body.notes || ''),
        c.get('userId') ?? null,
      )
      .run();
    return c.json({ success: true, id: result.meta.last_row_id });
  } catch (err) {
    log.error('POST /dispatch/routing/save failed', {}, err as Error);
    return dbErrorResponse(c, err, 'Failed to save route');
  }
});

// GET /unit/:unitId — latest active saved routes (newest first).
routing.get('/unit/:unitId', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    await ensureTable(db);
    const rows = await query(db, `
      SELECT id, unit_id, origin_lat, origin_lng, waypoints_json,
             total_distance_miles, estimated_time_minutes, notes, status, created_at
      FROM dispatch_unit_routes
      WHERE unit_id = ? AND status = 'active'
      ORDER BY created_at DESC, id DESC LIMIT 5`, c.req.param('unitId'));
    return c.json(rows);
  } catch (err) {
    log.error('GET /dispatch/routing/unit failed', {}, err as Error);
    return dbErrorResponse(c, err, 'Failed to load saved routes');
  }
});

// POST /:id/complete-stop — mark one waypoint done; completes the route when
// every stop is done.
routing.post('/:id/complete-stop', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    await ensureTable(db);
    const id = c.req.param('id');
    const { call_id } = await c.req.json<{ call_id?: number | string }>().catch(() => ({} as any));
    if (call_id == null) return c.json({ error: 'call_id is required' }, 400);

    const row = await queryFirst<{ id: number; waypoints_json: string }>(
      db, 'SELECT id, waypoints_json FROM dispatch_unit_routes WHERE id = ?', id);
    if (!row) return c.json({ error: 'Route not found' }, 404);

    let waypoints: any[] = [];
    try { waypoints = JSON.parse(row.waypoints_json || '[]'); } catch { waypoints = []; }
    const now = new Date().toISOString();
    let found = false;
    for (const w of waypoints) {
      if (String(w.call_id) === String(call_id)) {
        w.completed = true;
        w.completed_at = now;
        found = true;
      }
    }
    if (!found) return c.json({ error: 'Stop not on this route' }, 404);

    const allDone = waypoints.length > 0 && waypoints.every((w) => w.completed);
    await execute(db, `
      UPDATE dispatch_unit_routes
      SET waypoints_json = ?, status = ?, updated_at = datetime('now')
      WHERE id = ?`,
      JSON.stringify(waypoints), allDone ? 'completed' : 'active', id);
    return c.json({ success: true, completed_route: allDone });
  } catch (err) {
    log.error('POST /dispatch/routing/complete-stop failed', {}, err as Error);
    return dbErrorResponse(c, err, 'Failed to complete stop');
  }
});

export default routing;
