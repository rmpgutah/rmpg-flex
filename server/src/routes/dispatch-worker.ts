// ============================================================
// RMPG Flex — Dispatch Routes (Cloudflare Workers / Hono)
// ============================================================
// Ported from server/src/routes/dispatch/*.ts for Workers runtime.
// Uses D1 (async) instead of better-sqlite3 (sync).
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramStr, paramNum } from '../worker-middleware/d1Helpers';
import { localNow } from '../worker-middleware/timeUtils';

// ── Helpers ─────────────────────────────────────────────────
function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function toBoolInt(val: any): number {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'string') return val === 'false' || val === '0' || val === '' ? 0 : 1;
  return val ? 1 : 0;
}

// ── App ─────────────────────────────────────────────────────
export function mountDispatchRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();

  // All dispatch routes require auth
  api.use('/*', authenticateToken);

  // ── Index creation (runs on first request) ──────────────
  let indexesCreated = false;
  async function ensureIndexes(db: D1Db): Promise<void> {
    if (indexesCreated) return;
    try {
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_calls_lat_lng_created ON calls_for_service(latitude, longitude, created_at)`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_gps_breadcrumbs_unit_recorded ON gps_breadcrumbs(unit_id, recorded_at)`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_gps_breadcrumbs_call_sign_recorded ON gps_breadcrumbs(call_sign, recorded_at)`).run();
      indexesCreated = true;
    } catch { /* non-fatal */ }
  }

  // ═══════════════════════════════════════════════════════════
  // CALLS
  // ═══════════════════════════════════════════════════════════

  // GET /api/dispatch/calls - List calls with filters
  api.get('/calls', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    await ensureIndexes(db);

    const query = c.req.query();
    const {
      status, priority, startDate, endDate, propertyId, search, archived,
      page = '1', limit = '50',
    } = query;

    const VALID_CALL_STATUSES = ['pending', 'dispatched', 'enroute', 'onscene', 'cleared', 'closed', 'cancelled', 'archived'];
    const statusList = status ? String(status).split(',').map(s => s.trim()).filter(Boolean) : [];
    if (statusList.length > 0 && statusList.some(s => !VALID_CALL_STATUSES.includes(s))) {
      return c.json({ error: 'Invalid status filter', code: 'INVALID_STATUS_FILTER' }, 400);
    }
    const VALID_CALL_PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
    if (priority && !VALID_CALL_PRIORITIES.includes(String(priority).toUpperCase())) {
      return c.json({ error: 'Invalid priority filter', code: 'INVALID_PRIORITY_FILTER' }, 400);
    }
    if (propertyId) {
      const pid = parseInt(String(propertyId), 10);
      if (isNaN(pid) || pid < 1) return c.json({ error: 'Invalid propertyId', code: 'INVALID_PROPERTYID' }, 400);
    }

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (statusList.length === 1) {
      whereClause += ' AND c.status = ?';
      params.push(statusList[0]);
    } else if (statusList.length > 1) {
      whereClause += ` AND c.status IN (${statusList.map(() => '?').join(',')})`;
      params.push(...statusList);
    }
    if (priority) {
      whereClause += ' AND c.priority = ?';
      params.push(priority);
    }
    if (startDate) {
      whereClause += ' AND c.created_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND c.created_at <= ?';
      params.push(endDate);
    }
    if (propertyId) {
      whereClause += ' AND c.property_id = ?';
      params.push(propertyId);
    }
    if (search) {
      whereClause += " AND (c.call_number LIKE ? ESCAPE '\\' OR c.incident_type LIKE ? ESCAPE '\\' OR c.location_address LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\')";
      const s = `%${escapeLike(String(search))}%`;
      params.push(s, s, s, s);
    }

    if (archived === 'true') {
      whereClause += " AND c.status = 'archived'";
    } else if (archived !== 'all') {
      whereClause += " AND c.status != 'archived'";
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100000, Math.max(1, (parseInt(limit as string, 10)) || 100000));
    const offset = (pageNum - 1) * limitNum;

    const countRow = await db.prepare(`SELECT COUNT(*) as total FROM calls_for_service c ${whereClause}`).get(...params);

    const calls = await db.prepare(`
      SELECT c.*, p.name as property_name, u.full_name as dispatcher_name,
        cl.name as client_name,
        (SELECT i.incident_number FROM incidents i WHERE i.call_id = c.id ORDER BY i.id DESC LIMIT 1) as incident_number,
        (SELECT COUNT(*) FROM call_persons cp
          JOIN persons per ON cp.person_id = per.id
          WHERE cp.call_id = c.id
            AND per.flags IS NOT NULL
            AND per.flags LIKE '%ACTIVE_WARRANT%') as has_active_warrant
      FROM calls_for_service c
      LEFT JOIN properties p ON c.property_id = p.id
      LEFT JOIN users u ON c.dispatcher_id = u.id
      LEFT JOIN clients cl ON COALESCE(c.client_id, p.client_id) = cl.id
      ${whereClause}
      ORDER BY
        ${archived === 'true'
          ? 'c.call_number DESC'
          : "COALESCE(c.priority_score, CASE c.priority WHEN 'P1' THEN 400 WHEN 'P2' THEN 300 WHEN 'P3' THEN 200 WHEN 'P4' THEN 100 END) DESC, c.created_at DESC"
        }
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);

    const user = c.get('user');
    const callerPiiRoles = new Set(['admin', 'manager', 'supervisor', 'officer', 'dispatcher']);
    const showCallerPii = callerPiiRoles.has(user?.role || '');
    const safeCalls = showCallerPii
      ? calls
      : (calls as any[]).map(({ caller_name, caller_phone, caller_address, ...rest }: any) => rest);

    const total = (countRow as any)?.total ?? 0;
    return c.json({
      data: safeCalls,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: limitNum > 0 ? Math.ceil(total / limitNum) : 0,
      },
    });
  });

  // GET /api/dispatch/calls/active — Shortcut for active calls
  api.get('/calls/active', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const rows = await db.prepare(`
      SELECT c.*, u.full_name as dispatcher_name, p.name as property_name,
        cl.name as client_name
      FROM calls_for_service c
      LEFT JOIN users u ON c.dispatcher_id = u.id
      LEFT JOIN properties p ON c.property_id = p.id
      LEFT JOIN clients cl ON COALESCE(c.client_id, p.client_id) = cl.id
      WHERE c.status IN ('dispatched', 'enroute', 'onscene', 'pending', 'open')
      ORDER BY
        COALESCE(c.priority_score, CASE c.priority WHEN 'P1' THEN 400 WHEN 'P2' THEN 300 WHEN 'P3' THEN 200 WHEN 'P4' THEN 100 END) DESC,
        c.created_at DESC
      LIMIT 200
    `).all();
    return c.json(rows);
  });

  // GET /api/dispatch/calls/:id - Get single call
  api.get('/calls/:id', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const call = await db.prepare(`
      SELECT c.*, p.name as property_name, p.address as property_address,
        p.gate_code, p.alarm_code, p.emergency_contact, p.post_orders, p.hazard_notes,
        u.full_name as dispatcher_name,
        cl.name as client_name
      FROM calls_for_service c
      LEFT JOIN properties p ON c.property_id = p.id
      LEFT JOIN users u ON c.dispatcher_id = u.id
      LEFT JOIN clients cl ON COALESCE(c.client_id, p.client_id) = cl.id
      WHERE c.id = ?
    `).get(id);

    if (!call) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);

    let assignedUnits: any[] = [];
    try {
      const parsed = JSON.parse((call as any).assigned_unit_ids || '[]');
      const unitIds = (Array.isArray(parsed) ? parsed : []).filter((id: any) => typeof id === 'number' && !isNaN(id));
      if (unitIds.length > 0) {
        const placeholders = unitIds.map(() => '?').join(',');
        assignedUnits = await db.prepare(`
          SELECT u.*, usr.full_name as officer_name, usr.badge_number
          FROM units u LEFT JOIN users usr ON u.officer_id = usr.id
          WHERE u.id IN (${placeholders}) LIMIT 1000
        `).all(...unitIds);
      }
    } catch { /* non-fatal */ }

    const incidents = await db.prepare(`SELECT id, incident_number, incident_type, status, created_at FROM incidents WHERE call_id = ? LIMIT 1000`).all(id);
    const activity = await db.prepare(`
      SELECT al.*, u.full_name as user_name FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.entity_type = 'call' AND al.entity_id = ? ORDER BY al.created_at DESC LIMIT 1000
    `).all(id);

    let visit_history: any[] = [];
    if ((call as any).incident_type === 'pso_client_request') {
      visit_history = await db.prepare('SELECT * FROM call_visit_history WHERE call_id = ? ORDER BY visit_number ASC').all(id);
    }

    const firstIncidentNumber = (incidents as any[]).length > 0 ? (incidents as any[])[0].incident_number : null;

    return c.json({
      ...call,
      incident_number: (call as any).incident_number || firstIncidentNumber,
      assigned_units: assignedUnits,
      related_incidents: incidents,
      activity,
      visit_history,
    });
  });

  // ═══════════════════════════════════════════════════════════
  // GPS
  // ═══════════════════════════════════════════════════════════

  // POST /api/dispatch/gps - Batch GPS position update
  api.post('/gps', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    let body: any;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body', code: 'INVALID_JSON' }, 400); }

    interface GpsPoint { lat: number; lng: number; accuracy: number | null; heading: number | null; speed: number | null; timestamp: string | null; }

    let points: GpsPoint[];

    if (Array.isArray(body?.points) && body.points.length > 0) {
      const rawPoints = body.points.slice(0, 60);
      for (const pt of rawPoints) {
        if (pt === null || typeof pt !== 'object' || Array.isArray(pt)) {
          return c.json({ error: 'Each point must be an object with lat/lng', code: 'EACH_POINT_MUST_BE' }, 400);
        }
      }
      points = rawPoints.filter((pt: any) => pt.lat != null && pt.lng != null).map((pt: any) => ({
        lat: Number(pt.lat), lng: Number(pt.lng),
        accuracy: pt.accuracy != null ? Number(pt.accuracy) : null,
        heading: pt.heading != null ? Number(pt.heading) : null,
        speed: pt.speed != null ? Number(pt.speed) : null,
        timestamp: typeof pt.timestamp === 'string' && pt.timestamp.length <= 50 ? pt.timestamp : null,
      }));
    } else if (body.latitude != null && body.longitude != null) {
      const lat = Number(body.latitude);
      const lng = Number(body.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return c.json({ error: 'latitude and longitude must be valid numbers', code: 'LATITUDE_AND_LONGITUDE_MUST' }, 400);
      }
      points = [{ lat, lng, accuracy: body.accuracy != null ? Number(body.accuracy) : null, heading: body.heading != null ? Number(body.heading) : null, speed: body.speed != null ? Number(body.speed) : null, timestamp: null }];
    } else {
      return c.json({ error: 'latitude/longitude or points[] required', code: 'LATITUDELONGITUDE_OR_POINTS_REQUIRED' }, 400);
    }

    const validPoints = points.filter((p) => p.lat != null && p.lng != null && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180);
    if (validPoints.length === 0) return c.json({ error: 'No valid GPS points provided', code: 'NO_VALID_GPS_POINTS' }, 400);

    // Find or auto-create unit
    let unit = await db.prepare('SELECT id, call_sign, status FROM units WHERE officer_id = ?').get(user.userId) as any;
    if (!unit) {
      const userInfo = await db.prepare('SELECT badge_number, username, full_name FROM users WHERE id = ?').get(user.userId) as any;
      const callSign = userInfo?.badge_number || userInfo?.username || `P-${user.userId}`;
      const csConflict = await db.prepare('SELECT id FROM units WHERE call_sign = ?').get(callSign) as any;
      const finalCallSign = csConflict ? `${callSign}-${user.userId}` : callSign;
      try { await db.prepare(`INSERT INTO units (call_sign, officer_id, status) VALUES (?, ?, 'available')`).run(finalCallSign, user.userId); } catch { /* unique constraint race */ }
      unit = await db.prepare('SELECT id, call_sign, status FROM units WHERE officer_id = ?').get(user.userId) as any;
      if (!unit) return c.json({ error: 'Failed to create or find unit', code: 'FAILED_TO_CREATE_OR' }, 500);
    }

    const latest = validPoints[validPoints.length - 1];
    await db.prepare(`UPDATE units SET latitude = ?, longitude = ?, gps_source = ?, gps_updated_at = ? WHERE id = ?`)
      .run(latest.lat, latest.lng, 'browser_desktop', localNow(), unit.id);

    // Insert breadcrumbs
    for (const pt of validPoints) {
      await db.prepare(`
        INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude, accuracy, heading, speed,
          unit_status, call_sign, gps_source, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now','localtime')))
      `).run(unit.id, user.userId, pt.lat, pt.lng, pt.accuracy, pt.heading, pt.speed, unit.status, unit.call_sign, 'browser_desktop', pt.timestamp);
    }

    return c.json({ ok: true, unit_id: unit.id, call_sign: unit.call_sign, inserted: validPoints.length });
  });

  // GET /api/dispatch/gps/my-unit - Get current user's assigned unit
  api.get('/gps/my-unit', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const unit = await db.prepare(`
      SELECT u.id, u.call_sign, u.status, u.latitude, u.longitude
      FROM units u WHERE u.officer_id = ?
    `).get(user.userId);
    return c.json(unit || null);
  });

  // GET /api/dispatch/gps/trail/:unitId - Get GPS breadcrumb trail
  api.get('/gps/trail/:unitId', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const unitId = paramNum(c.req.param('unitId'));
    if (isNaN(unitId)) return c.json({ error: 'Invalid unit ID', code: 'INVALID_UNIT_ID' }, 400);
    const hours = Math.min(Math.max(parseInt(c.req.query('hours') || '8', 10) || 8, 1), 72);

    const rows = await db.prepare(`
      SELECT latitude, longitude, accuracy, heading, speed,
        unit_status, call_sign, officer_name, badge_number,
        current_call_id, current_call_number, current_call_type, recorded_at
      FROM gps_breadcrumbs
      WHERE unit_id = ? AND recorded_at >= datetime('now', 'localtime', '-' || ? || ' hours')
      ORDER BY recorded_at ASC LIMIT 10000
    `).all(unitId, hours);

    return c.json(rows);
  });

  // GET /api/dispatch/gps/trails - Get breadcrumb trails for all active units
  api.get('/gps/trails', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const hours = Math.min(Math.max(parseInt(c.req.query('hours') || '8', 10) || 8, 1), 72);

    const rows = await db.prepare(`
      SELECT b.unit_id, b.call_sign, b.latitude, b.longitude, b.accuracy,
        b.heading, b.speed, b.unit_status, b.officer_name, b.badge_number,
        b.current_call_number, b.current_call_type, b.recorded_at,
        b.road_name, b.nearest_intersection
      FROM gps_breadcrumbs b
      JOIN units u ON b.unit_id = u.id
      WHERE b.recorded_at >= datetime('now', 'localtime', '-' || ? || ' hours')
      ORDER BY b.unit_id, b.recorded_at ASC LIMIT 50000
    `).all(hours);

    const trails: Record<number, any> = {};
    for (const row of rows as any[]) {
      if (!trails[row.unit_id]) {
        trails[row.unit_id] = { unit_id: row.unit_id, call_sign: row.call_sign, officer_name: row.officer_name || '', badge_number: row.badge_number || '', points: [] };
      }
      trails[row.unit_id].points.push({
        lat: row.latitude, lng: row.longitude, accuracy: row.accuracy,
        heading: row.heading, speed: row.speed, status: row.unit_status,
        call_number: row.current_call_number, call_type: row.current_call_type,
        time: row.recorded_at, road_name: row.road_name || null, intersection: row.nearest_intersection || null,
      });
    }

    return c.json(Object.values(trails));
  });

  // GET /api/dispatch/gps/dwell-times
  api.get('/gps/dwell-times', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const units = await db.prepare(`
      SELECT id, call_sign, latitude, longitude, status FROM units
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND status != 'off_duty' LIMIT 1000
    `).all() as any[];

    if (units.length === 0) return c.json([]);
    return c.json(units.map((u: any) => ({ call_sign: u.call_sign, latitude: u.latitude, longitude: u.longitude, dwell_minutes: 0, status: u.status })));
  });

  // GET /api/dispatch/gps/units-with-trails
  api.get('/gps/units-with-trails', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const hours = Math.min(Math.max(parseInt(c.req.query('hours') || '8', 10) || 8, 1), 72);
    const hoursStr = `-${hours} hours`;

    const units = await db.prepare(`
      SELECT u.id, u.call_sign, u.status, u.officer_id, usr.full_name as officer_name,
        (SELECT COUNT(*) FROM gps_breadcrumbs b WHERE b.unit_id = u.id AND b.recorded_at >= datetime('now','localtime', ?)) as trail_points,
        (SELECT b.latitude FROM gps_breadcrumbs b WHERE b.unit_id = u.id ORDER BY b.recorded_at DESC LIMIT 1) as last_lat,
        (SELECT b.longitude FROM gps_breadcrumbs b WHERE b.unit_id = u.id ORDER BY b.recorded_at DESC LIMIT 1) as last_lng,
        (SELECT b.recorded_at FROM gps_breadcrumbs b WHERE b.unit_id = u.id ORDER BY b.recorded_at DESC LIMIT 1) as last_seen
      FROM units u LEFT JOIN users usr ON u.officer_id = usr.id
      WHERE u.status != 'off_duty' ORDER BY u.call_sign
    `).all(hoursStr);

    return c.json(units);
  });

  // GET /api/dispatch/gps/speed-violations
  api.get('/gps/speed-violations', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    const db = new D1Db(c.env.DB);
    const hours = Math.min(Math.max(parseInt(c.req.query('hours') || '24', 10) || 24, 1), 168);
    const unacknowledged = c.req.query('unacknowledged');

    let whereClause = `sv.recorded_at >= datetime('now','localtime','-${hours} hours')`;
    if (unacknowledged === 'true') whereClause += ' AND sv.acknowledged_by IS NULL';
    else if (unacknowledged === 'false') whereClause += ' AND sv.acknowledged_by IS NOT NULL';

    const rows = await db.prepare(`
      SELECT sv.*, u.full_name as ack_by_name FROM speed_violations sv
      LEFT JOIN users u ON sv.acknowledged_by = u.id WHERE ${whereClause}
      ORDER BY sv.recorded_at DESC LIMIT 500
    `).all();

    return c.json(rows);
  });

  // ═══════════════════════════════════════════════════════════
  // UNITS
  // ═══════════════════════════════════════════════════════════

  // GET /api/dispatch/units - List all units
  api.get('/units', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const units = await db.prepare(`
      SELECT u.*, usr.full_name as officer_name, usr.badge_number,
        c.call_number, c.incident_type as current_call_type, c.location_address as current_call_location
      FROM units u
      LEFT JOIN users usr ON u.officer_id = usr.id
      LEFT JOIN calls_for_service c ON u.current_call_id = c.id
      ORDER BY u.call_sign
    `).all();
    return c.json(units);
  });

  // GET /api/dispatch/units/:id - Get single unit
  api.get('/units/:id', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const unit = await db.prepare(`
      SELECT u.*, usr.full_name as officer_name, usr.badge_number,
        c.call_number, c.incident_type as current_call_type
      FROM units u
      LEFT JOIN users usr ON u.officer_id = usr.id
      LEFT JOIN calls_for_service c ON u.current_call_id = c.id
      WHERE u.id = ?
    `).get(id);
    if (!unit) return c.json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' }, 404);
    return c.json(unit);
  });

  // ═══════════════════════════════════════════════════════════
  // AGGREGATES
  // ═══════════════════════════════════════════════════════════

  // GET /api/dispatch/aggregates - Dispatch dashboard stats
  api.get('/aggregates', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);

    const [callsCount, unitsCount, pendingCount, onsceneCount] = await Promise.all([
      db.prepare("SELECT COUNT(*) as total FROM calls_for_service WHERE status != 'archived'").get(),
      db.prepare("SELECT COUNT(*) as total FROM units WHERE status != 'off_duty'").get(),
      db.prepare("SELECT COUNT(*) as total FROM calls_for_service WHERE status = 'pending'").get(),
      db.prepare("SELECT COUNT(*) as total FROM calls_for_service WHERE status = 'onscene'").get(),
    ]);

    return c.json({
      total_calls: (callsCount as any)?.total ?? 0,
      active_units: (unitsCount as any)?.total ?? 0,
      pending_calls: (pendingCount as any)?.total ?? 0,
      onscene_calls: (onsceneCount as any)?.total ?? 0,
    });
  });

  // ═══════════════════════════════════════════════════════════
  // GEOGRAPHY
  // ═══════════════════════════════════════════════════════════

  // GET /api/dispatch/geography/tree - Full geography tree
  api.get('/geography/tree', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const areas = await db.prepare('SELECT * FROM dispatch_areas ORDER BY sort_order, name').all();
    const result: any[] = [];
    for (const area of areas as any[]) {
      const sectors = await db.prepare('SELECT * FROM dispatch_sectors WHERE area_id = ? ORDER BY sort_order, name').all(area.id);
      const sectorList: any[] = [];
      for (const sector of sectors as any[]) {
        const zones = await db.prepare('SELECT * FROM dispatch_zones WHERE sector_id = ? ORDER BY sort_order, name').all(sector.id);
        const zoneList: any[] = [];
        for (const zone of zones as any[]) {
          const beats = await db.prepare('SELECT * FROM dispatch_beats WHERE zone_id = ? ORDER BY sort_order, name').all(zone.id);
          zoneList.push({ ...zone, beats });
        }
        sectorList.push({ ...sector, zones: zoneList });
      }
      result.push({ ...area, sectors: sectorList });
    }
    return c.json(result);
  });

  // GET /api/dispatch/geography/areas
  api.get('/geography/areas', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const areas = await db.prepare('SELECT * FROM dispatch_areas ORDER BY sort_order, name').all();
    return c.json(areas);
  });

  // GET /api/dispatch/geography/sectors
  api.get('/geography/sectors', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const areaId = c.req.query('area_id');
    let sectors;
    if (areaId) {
      sectors = await db.prepare('SELECT * FROM dispatch_sectors WHERE area_id = ? ORDER BY sort_order, name').all(areaId);
    } else {
      sectors = await db.prepare('SELECT * FROM dispatch_sectors ORDER BY sort_order, name').all();
    }
    return c.json(sectors);
  });

  // GET /api/dispatch/geography/zones
  api.get('/geography/zones', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const sectorId = c.req.query('sector_id');
    let zones;
    if (sectorId) {
      zones = await db.prepare('SELECT * FROM dispatch_zones WHERE sector_id = ? ORDER BY sort_order, name').all(sectorId);
    } else {
      zones = await db.prepare('SELECT * FROM dispatch_zones ORDER BY sort_order, name').all();
    }
    return c.json(zones);
  });

  // GET /api/dispatch/geography/beats
  api.get('/geography/beats', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const zoneId = c.req.query('zone_id');
    let beats;
    if (zoneId) {
      beats = await db.prepare('SELECT * FROM dispatch_beats WHERE zone_id = ? ORDER BY sort_order, name').all(zoneId);
    } else {
      beats = await db.prepare('SELECT * FROM dispatch_beats ORDER BY sort_order, name').all();
    }
    return c.json(beats);
  });

  // GET /api/dispatch/geography/codes - 10-codes / signal codes
  api.get('/geography/codes', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const codes = await db.prepare('SELECT * FROM dispatch_codes ORDER BY code').all();
    return c.json(codes);
  });

  // ═══════════════════════════════════════════════════════════
  // PANIC
  // ═══════════════════════════════════════════════════════════

  // GET /api/dispatch/panic - List active panic alerts
  api.get('/panic', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const panics = await db.prepare(`
      SELECT p.*, u.full_name as officer_name, u.badge_number
      FROM panic_alerts p LEFT JOIN users u ON p.officer_id = u.id
      WHERE p.acknowledged_at IS NULL ORDER BY p.created_at DESC LIMIT 100
    `).all();
    return c.json(panics);
  });

  // ═══════════════════════════════════════════════════════════
  // CALL ACTIONS (read-only endpoints)
  // ═══════════════════════════════════════════════════════════

  // GET /api/dispatch/calls/:id/persons - Persons linked to a call
  api.get('/calls/:id/persons', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const callId = paramNum(c.req.param('id'));
    const persons = await db.prepare(`
      SELECT cp.*, p.* FROM call_persons cp
      JOIN persons p ON cp.person_id = p.id WHERE cp.call_id = ?
    `).all(callId);
    return c.json(persons);
  });

  // GET /api/dispatch/calls/:id/vehicles - Vehicles linked to a call
  api.get('/calls/:id/vehicles', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const callId = paramNum(c.req.param('id'));
    const vehicles = await db.prepare(`
      SELECT cv.*, v.* FROM call_vehicles cv
      JOIN vehicles_records v ON cv.vehicle_id = v.id WHERE cv.call_id = ?
    `).all(callId);
    return c.json(vehicles);
  });

  // GET /api/dispatch/calls/search - Search calls
  api.get('/calls/search', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query('q') || '';
    if (q.length < 2) return c.json([]);

    const calls = await db.prepare(`
      SELECT c.*, p.name as property_name
      FROM calls_for_service c
      LEFT JOIN properties p ON c.property_id = p.id
      WHERE c.call_number LIKE ? OR c.location_address LIKE ? OR c.description LIKE ? OR c.incident_type LIKE ?
      ORDER BY c.created_at DESC LIMIT 50
    `).all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);

    return c.json(calls);
  });

  // GET /api/dispatch/calls/check-duplicate
  api.get('/calls/check-duplicate', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const address = c.req.query('address') || '';
    if (address.length < 3) return c.json({ duplicates: [], count: 0 });

    const normalized = String(address).toUpperCase().replace(/\s+/g, ' ').trim();
    const duplicates = await db.prepare(`
      SELECT id, call_number, incident_type, priority, status, location_address, created_at
      FROM calls_for_service
      WHERE status NOT IN ('cleared','closed','cancelled','archived')
        AND UPPER(REPLACE(location_address, '  ', ' ')) LIKE ? ESCAPE '\\'
      ORDER BY created_at DESC LIMIT 5
    `).all(`%${escapeLike(normalized)}%`);

    return c.json({ duplicates, count: (duplicates as any[]).length });
  });

  // GET /api/dispatch/calls/export - CSV export (returns JSON for Workers)
  api.get('/calls/export', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    const db = new D1Db(c.env.DB);
    const rows = await db.prepare(`
      SELECT c.call_number, c.incident_type, c.priority, c.status, c.caller_name,
        c.location_address, c.description, c.source, c.disposition, c.created_at, c.cleared_at
      FROM calls_for_service c ORDER BY c.created_at DESC LIMIT 50000
    `).all();
    return c.json(rows);
  });

  // Mount all dispatch routes under /dispatch
  app.route('/api/dispatch', api);
}
