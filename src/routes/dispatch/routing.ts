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
  location: string | null;
  description: string | null;
  assigned_unit_ids: string | null;
}

// POST /optimize — build an ordered route over the unit's active CFS calls.
routing.post('/optimize', async (c) => {
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
    // assigned_unit_ids is a JSON int array on calls_for_service — small working
    // set, so membership is filtered in JS rather than string-LIKE SQL.
    const candidates = await query<CallRow>(db, `
      SELECT id, call_number, incident_type, priority, status, latitude, longitude,
             location, description, assigned_unit_ids
      FROM calls_for_service
      WHERE status IN ('pending','on_hold','dispatched','enroute','onscene')
      ORDER BY created_at ASC LIMIT 500`);
    const mine = candidates.filter((call) => {
      try {
        const assigned = JSON.parse(call.assigned_unit_ids || '[]') as Array<number | string>;
        return assigned.some((a) => String(a) === String(unitId));
      } catch { return false; }
    });
    const routable = mine.filter((call) => call.latitude != null && call.longitude != null);
    const skipped = mine.length - routable.length;

    let warning: string | undefined;
    if (mine.length === 0) warning = 'No active calls are assigned to this unit.';
    else if (routable.length === 0) warning = 'Assigned calls have no GPS coordinates — nothing to route.';
    else if (skipped > 0) warning = `${skipped} assigned call(s) skipped — no GPS coordinates.`;

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
      location_address: s.call.location || '',
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
    console.error('POST /dispatch/routing/optimize failed:', err);
    return c.json({ error: 'Failed to optimize route', detail: (err as Error)?.message }, 500);
  }
});

// POST /save — persist the built route (supersedes prior active routes for the unit).
routing.post('/save', async (c) => {
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
        (c as any).var?.user?.id ?? null,
      )
      .run();
    return c.json({ success: true, id: result.meta.last_row_id });
  } catch (err) {
    console.error('POST /dispatch/routing/save failed:', err);
    return c.json({ error: 'Failed to save route', detail: (err as Error)?.message }, 500);
  }
});

// GET /unit/:unitId — latest active saved routes (newest first).
routing.get('/unit/:unitId', async (c) => {
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
    console.error('GET /dispatch/routing/unit failed:', err);
    return c.json({ error: 'Failed to load saved routes', detail: (err as Error)?.message }, 500);
  }
});

// POST /:id/complete-stop — mark one waypoint done; completes the route when
// every stop is done.
routing.post('/:id/complete-stop', async (c) => {
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
    console.error('POST /dispatch/routing/complete-stop failed:', err);
    return c.json({ error: 'Failed to complete stop', detail: (err as Error)?.message }, 500);
  }
});

export default routing;
