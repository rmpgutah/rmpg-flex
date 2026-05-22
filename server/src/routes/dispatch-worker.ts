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
import { auditLog } from '../worker-middleware/auditLogger';
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

    // Broadcast GPS update via WebSocket
    try {
      const { broadcastUnitUpdate } = await import('../worker-middleware/websocket');
      broadcastUnitUpdate({ action: 'gps_update', unit_id: unit.id, call_sign: unit.call_sign, latitude: latest.lat, longitude: latest.lng, heading: latest.heading, speed: latest.speed, status: unit.status, gps_updated_at: localNow() });
    } catch { /* ws module may not be available */ }

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
    try {
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
    } catch (err: any) {
      if (err?.message?.includes('no such table')) return c.json([]);
      return c.json({ error: 'Speed violations query failed' }, 500);
    }
  });

  // GET /api/dispatch/gps/speed-zones — List all speed zones
  api.get('/gps/speed-zones', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare('SELECT * FROM speed_zones ORDER BY name').all();
      return c.json(rows);
    } catch (err: any) {
      if (err?.message?.includes('no such table')) return c.json([]);
      return c.json({ error: 'Failed to fetch speed zones' }, 500);
    }
  });

  // GET /api/dispatch/gps/pursuit-segments — Detect high-speed pursuit sequences
  api.get('/gps/pursuit-segments', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const hours = Math.min(Math.max(parseInt(c.req.query('hours') || '8', 10) || 8, 1), 72);
      const unitId = c.req.query('unit_id') ? parseInt(c.req.query('unit_id')!, 10) : null;
      const PURSUIT_SPEED_MPS = 26.8;
      const MIN_POINTS = 3;

      let whereClause = `b.recorded_at >= datetime('now','localtime','-${hours} hours') AND b.speed >= ${PURSUIT_SPEED_MPS}`;
      const params: any[] = [];
      if (unitId && !isNaN(unitId)) { whereClause += ' AND b.unit_id = ?'; params.push(unitId); }

      const rows = await db.prepare(`
        SELECT b.unit_id, b.call_sign, b.officer_name, b.badge_number,
          b.latitude, b.longitude, b.speed, b.heading, b.recorded_at,
          b.current_call_number, b.current_call_type
        FROM gps_breadcrumbs b
        WHERE ${whereClause}
        ORDER BY b.unit_id, b.recorded_at ASC
        LIMIT 10000
      `).all(...params) as any[];

      const segments: any[] = [];
      let current: any[] = [];
      let lastUnitId: number | null = null;
      let lastTime: number | null = null;

      for (const row of rows) {
        const rowTime = new Date(row.recorded_at).getTime();
        if (row.unit_id !== lastUnitId || (lastTime && (rowTime - lastTime) > 60000)) {
          if (current.length >= MIN_POINTS) {
            const first = current[0];
            const last = current[current.length - 1];
            const durationSec = (new Date(last.recorded_at).getTime() - new Date(first.recorded_at).getTime()) / 1000;
            const avgSpeed = current.reduce((s, p) => s + (p.speed || 0), 0) / current.length;
            const maxSpeed = Math.max(...current.map(p => p.speed || 0));
            segments.push({
              unit_id: first.unit_id, call_sign: first.call_sign, officer_name: first.officer_name,
              badge_number: first.badge_number, start_time: first.recorded_at, end_time: last.recorded_at,
              duration_seconds: durationSec, avg_speed_mps: Math.round(avgSpeed * 10) / 10,
              max_speed_mps: Math.round(maxSpeed * 10) / 10, points: current.length,
              start_lat: first.latitude, start_lng: first.longitude, end_lat: last.latitude, end_lng: last.longitude,
              call_number: first.current_call_number, call_type: first.current_call_type,
            });
          }
          current = [];
        }
        current.push(row);
        lastUnitId = row.unit_id;
        lastTime = rowTime;
      }
      if (current.length >= MIN_POINTS) {
        const first = current[0];
        const last = current[current.length - 1];
        const durationSec = (new Date(last.recorded_at).getTime() - new Date(first.recorded_at).getTime()) / 1000;
        const avgSpeed = current.reduce((s, p) => s + (p.speed || 0), 0) / current.length;
        const maxSpeed = Math.max(...current.map(p => p.speed || 0));
        segments.push({
          unit_id: first.unit_id, call_sign: first.call_sign, officer_name: first.officer_name,
          badge_number: first.badge_number, start_time: first.recorded_at, end_time: last.recorded_at,
          duration_seconds: durationSec, avg_speed_mps: Math.round(avgSpeed * 10) / 10,
          max_speed_mps: Math.round(maxSpeed * 10) / 10, points: current.length,
          start_lat: first.latitude, start_lng: first.longitude, end_lat: last.latitude, end_lng: last.longitude,
          call_number: first.current_call_number, call_type: first.current_call_type,
        });
      }

      return c.json(segments);
    } catch (err: any) {
      if (err?.message?.includes('no such table') || err?.message?.includes('no such column')) return c.json([]);
      return c.json({ error: 'Pursuit segments query failed' }, 500);
    }
  });

  // GET /api/dispatch/queue — Active dispatch queue with priority scoring
  api.get('/queue', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const calls = await db.prepare(`
        SELECT c.*, p.name as property_name, u.full_name as dispatcher_name,
          ROUND((julianday('now','localtime') - julianday(c.created_at)) * 24 * 60, 1) as age_minutes,
          c.priority_score, c.response_time_seconds
        FROM calls_for_service c
        LEFT JOIN properties p ON c.property_id = p.id
        LEFT JOIN users u ON c.dispatcher_id = u.id
        WHERE c.status IN ('pending', 'dispatched', 'enroute', 'onscene', 'on_hold')
        ORDER BY
          CASE c.status WHEN 'on_hold' THEN 1 ELSE 0 END,
          COALESCE(c.priority_score, CASE c.priority WHEN 'P1' THEN 400 WHEN 'P2' THEN 300 WHEN 'P3' THEN 200 WHEN 'P4' THEN 100 END) DESC,
          c.created_at ASC
        LIMIT 200
      `).all() as any[];

      const expectedMinutes: Record<string, number> = { P1: 8, P2: 15, P3: 30, P4: 60 };
      const enriched = calls.map((c: any) => {
        const expected = expectedMinutes[c.priority] || 30;
        const isOverdue = c.age_minutes && c.age_minutes > expected && c.status === 'pending';
        return { ...c, _overdue: isOverdue, _expected_response_minutes: expected };
      });

      return c.json(enriched);
    } catch (err: any) {
      if (err?.message?.includes('no such table')) return c.json([]);
      return c.json({ error: 'Queue query failed' }, 500);
    }
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

  // GET /api/dispatch/stats - Full dispatch stats (from aggregates.ts)
  api.get('/stats', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);

    const [callsByStatus, callsByPriority, unitsByStatus, activeCalls, todayTotal, avgResponseTime, pendingCalls, oldestPending, avgDispatchDelay, onHoldCount, p1Today, resolvedToday, responseByPriority] = await Promise.all([
      db.prepare("SELECT status, COUNT(*) as count FROM calls_for_service WHERE DATE(created_at) = DATE('now') GROUP BY status").all(),
      db.prepare("SELECT priority, COUNT(*) as count FROM calls_for_service WHERE DATE(created_at) = DATE('now') GROUP BY priority").all(),
      db.prepare('SELECT status, COUNT(*) as count FROM units GROUP BY status').all(),
      db.prepare("SELECT COUNT(*) as count FROM calls_for_service WHERE status IN ('pending', 'dispatched', 'enroute', 'onscene', 'on_hold')").get(),
      db.prepare("SELECT COUNT(*) as count FROM calls_for_service WHERE DATE(created_at) = DATE('now')").get(),
      db.prepare("SELECT AVG((julianday(onscene_at) - julianday(created_at)) * 24 * 60) as avg_minutes FROM calls_for_service WHERE onscene_at IS NOT NULL AND DATE(created_at) = DATE('now')").get(),
      db.prepare("SELECT COUNT(*) as count FROM calls_for_service WHERE status = 'pending'").get(),
      db.prepare("SELECT ROUND((julianday('now') - julianday(created_at)) * 24 * 60, 1) as age_minutes FROM calls_for_service WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1").get(),
      db.prepare("SELECT ROUND(AVG((julianday(dispatched_at) - julianday(created_at)) * 24 * 60), 1) as avg_minutes FROM calls_for_service WHERE dispatched_at IS NOT NULL AND DATE(created_at) = DATE('now') AND (julianday(dispatched_at) - julianday(created_at)) * 24 * 60 > 0 AND (julianday(dispatched_at) - julianday(created_at)) * 24 * 60 < 720").get(),
      db.prepare("SELECT COUNT(*) as count FROM calls_for_service WHERE status = 'on_hold'").get(),
      db.prepare("SELECT COUNT(*) as count FROM calls_for_service WHERE priority = 'P1' AND DATE(created_at) = DATE('now')").get(),
      db.prepare("SELECT COUNT(*) as count FROM calls_for_service WHERE status IN ('cleared', 'closed') AND DATE(created_at) = DATE('now')").get(),
      db.prepare("SELECT priority, ROUND(AVG((julianday(onscene_at) - julianday(created_at)) * 24 * 60), 1) as avg_minutes, COUNT(*) as count FROM calls_for_service WHERE onscene_at IS NOT NULL AND DATE(created_at) = DATE('now') AND (julianday(onscene_at) - julianday(created_at)) * 24 * 60 > 0 AND (julianday(onscene_at) - julianday(created_at)) * 24 * 60 < 720 GROUP BY priority").all(),
    ]);

    return c.json({
      activeCalls: (activeCalls as any)?.count ?? 0,
      todayTotal: (todayTotal as any)?.count ?? 0,
      avgResponseMinutes: (avgResponseTime as any)?.avg_minutes ? Math.round((avgResponseTime as any).avg_minutes * 10) / 10 : null,
      callsByStatus,
      callsByPriority,
      unitsByStatus,
      pendingCalls: (pendingCalls as any)?.count || 0,
      oldestPendingMinutes: (oldestPending as any)?.age_minutes || null,
      avgDispatchDelayMinutes: (avgDispatchDelay as any)?.avg_minutes || null,
      onHoldCalls: (onHoldCount as any)?.count || 0,
      p1CallsToday: (p1Today as any)?.count || 0,
      resolvedToday: (resolvedToday as any)?.count || 0,
      responseByPriority,
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
    const { category, search } = c.req.query();
    let query = 'SELECT * FROM dispatch_codes WHERE 1=1';
    const params: any[] = [];
    if (category && category !== 'all') { query += ' AND category = ?'; params.push(category); }
    if (search) { const s = `%${search}%`; query += ' AND (code LIKE ? OR description LIKE ?)'; params.push(s, s); }
    query += ' ORDER BY sort_order, code';
    const codes = await db.prepare(query).all(...params);
    return c.json(codes);
  });

  // GET /api/dispatch/geography/codes/lookup/:code
  api.get('/geography/codes/lookup/:code', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const code = c.req.param('code');
    const result = await db.prepare('SELECT * FROM dispatch_codes WHERE code = ?').get(code);
    if (!result) return c.json({ found: false });
    return c.json({ found: true, ...(result as object) });
  });

  // POST /api/dispatch/geography/areas
  api.post('/geography/areas', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    const body = await c.req.json();
    const { area_code, area_name, color, description, commander, notes, sort_order } = body;
    if (!area_code || !area_name) return c.json({ error: 'area_code and area_name required' }, 400);
    try {
      const result = await db.prepare('INSERT INTO dispatch_areas (area_code, area_name, color, description, commander, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)').run(area_code, area_name, color || '#6366f1', description, commander, notes, sort_order || 0);
      return c.json({ success: true, id: result.meta?.last_row_id });
    } catch (err: any) {
      if (err?.message?.includes('UNIQUE')) return c.json({ error: 'Area code already exists' }, 409);
      return c.json({ error: 'Failed to create area' }, 500);
    }
  });

  // PUT /api/dispatch/geography/areas/:id
  api.put('/geography/areas/:id', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = parseInt(c.req.param('id') || '0', 10);
    const old = await db.prepare('SELECT * FROM dispatch_areas WHERE id = ?').get(id);
    if (!old) return c.json({ error: 'Area not found' }, 404);
    const body = await c.req.json();
    const fields = ['area_code', 'area_name', 'color', 'description', 'commander', 'notes', 'sort_order', 'active'];
    const updates: string[] = [];
    const values: any[] = [];
    for (const f of fields) { if (body[f] !== undefined) { updates.push(`${f} = ?`); values.push(body[f]); } }
    if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);
    updates.push('updated_at = ?'); values.push(new Date().toISOString().slice(0, 19));
    values.push(id);
    await db.prepare(`UPDATE dispatch_areas SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return c.json({ success: true });
  });

  // DELETE /api/dispatch/geography/areas/:id
  api.delete('/geography/areas/:id', requireRole('admin'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = parseInt(c.req.param('id') || '0', 10);
    await db.prepare('UPDATE dispatch_sectors SET area_id = NULL WHERE area_id = ?').run(id);
    await db.prepare('DELETE FROM dispatch_areas WHERE id = ?').run(id);
    return c.json({ success: true });
  });

  // POST /api/dispatch/geography/sectors
  api.post('/geography/sectors', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    const body = await c.req.json();
    const sector_code = body.sector_code || '';
    const sector_name = body.sector_name || '';
    const { area_id, color, description, supervisor, radio_channel, notes, sort_order } = body;
    if (!sector_code || !sector_name) return c.json({ error: 'sector_code and sector_name required' }, 400);
    try {
      const result = await db.prepare('INSERT INTO dispatch_sectors (sector_code, sector_name, area_id, color, description, supervisor, radio_channel, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(sector_code, sector_name, area_id || null, color || '#888888', description, supervisor, radio_channel, notes, sort_order || 0);
      return c.json({ success: true, id: result.meta?.last_row_id });
    } catch (err: any) {
      if (err?.message?.includes('UNIQUE')) return c.json({ error: 'Sector code already exists' }, 409);
      return c.json({ error: 'Failed to create sector' }, 500);
    }
  });

  // PUT /api/dispatch/geography/sectors/:id
  api.put('/geography/sectors/:id', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = parseInt(c.req.param('id') || '0', 10);
    const old = await db.prepare('SELECT * FROM dispatch_sectors WHERE id = ?').get(id);
    if (!old) return c.json({ error: 'Sector not found' }, 404);
    const body = await c.req.json();
    const fields = ['sector_code', 'sector_name', 'area_id', 'color', 'description', 'supervisor', 'radio_channel', 'notes', 'sort_order', 'active'];
    const updates: string[] = [];
    const values: any[] = [];
    for (const f of fields) { if (body[f] !== undefined) { updates.push(`${f} = ?`); values.push(body[f]); } }
    if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);
    updates.push('updated_at = ?'); values.push(new Date().toISOString().slice(0, 19));
    values.push(id);
    await db.prepare(`UPDATE dispatch_sectors SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return c.json({ success: true });
  });

  // DELETE /api/dispatch/geography/sectors/:id
  api.delete('/geography/sectors/:id', requireRole('admin'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = parseInt(c.req.param('id') || '0', 10);
    await db.prepare('UPDATE dispatch_zones SET sector_id = NULL WHERE sector_id = ?').run(id);
    await db.prepare('DELETE FROM dispatch_sectors WHERE id = ?').run(id);
    return c.json({ success: true });
  });

  // POST /api/dispatch/geography/zones
  api.post('/geography/zones', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    const body = await c.req.json();
    const { zone_code, zone_name, sector_id, color, description, primary_unit, backup_unit, radio_channel, hazard_notes, notes, population_estimate, sq_miles, sort_order } = body;
    if (!zone_code || !zone_name) return c.json({ error: 'zone_code and zone_name required' }, 400);
    try {
      const result = await db.prepare('INSERT INTO dispatch_zones (zone_code, zone_name, sector_id, color, description, primary_unit, backup_unit, radio_channel, hazard_notes, notes, population_estimate, sq_miles, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(zone_code, zone_name, sector_id || null, color, description, primary_unit, backup_unit, radio_channel, hazard_notes, notes, population_estimate, sq_miles, sort_order || 0);
      return c.json({ success: true, id: result.meta?.last_row_id });
    } catch (err: any) {
      if (err?.message?.includes('UNIQUE')) return c.json({ error: 'Zone code already exists' }, 409);
      return c.json({ error: 'Failed to create zone' }, 500);
    }
  });

  // PUT /api/dispatch/geography/zones/:id
  api.put('/geography/zones/:id', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = parseInt(c.req.param('id') || '0', 10);
    const old = await db.prepare('SELECT * FROM dispatch_zones WHERE id = ?').get(id);
    if (!old) return c.json({ error: 'Zone not found' }, 404);
    const body = await c.req.json();
    const fields = ['zone_code', 'zone_name', 'sector_id', 'color', 'description', 'primary_unit', 'backup_unit', 'radio_channel', 'hazard_notes', 'notes', 'population_estimate', 'sq_miles', 'sort_order', 'active'];
    const updates: string[] = [];
    const values: any[] = [];
    for (const f of fields) { if (body[f] !== undefined) { updates.push(`${f} = ?`); values.push(body[f]); } }
    if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);
    updates.push('updated_at = ?'); values.push(new Date().toISOString().slice(0, 19));
    values.push(id);
    await db.prepare(`UPDATE dispatch_zones SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return c.json({ success: true });
  });

  // DELETE /api/dispatch/geography/zones/:id
  api.delete('/geography/zones/:id', requireRole('admin'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = parseInt(c.req.param('id') || '0', 10);
    await db.prepare('UPDATE dispatch_beats SET zone_id = NULL WHERE zone_id = ?').run(id);
    await db.prepare('DELETE FROM dispatch_zones WHERE id = ?').run(id);
    return c.json({ success: true });
  });

  // POST /api/dispatch/geography/beats
  api.post('/geography/beats', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    const body = await c.req.json();
    const { beat_code, beat_name, beat_descriptor, zone_id, dispatch_code, color, assigned_unit, backup_unit, hazard_notes, premise_alerts, patrol_frequency, priority_modifier, population_estimate, sq_miles, notes, sort_order } = body;
    if (!beat_code || !beat_name) return c.json({ error: 'beat_code and beat_name required' }, 400);
    try {
      const result = await db.prepare('INSERT INTO dispatch_beats (beat_code, beat_name, beat_descriptor, zone_id, dispatch_code, color, assigned_unit, backup_unit, hazard_notes, premise_alerts, patrol_frequency, priority_modifier, population_estimate, sq_miles, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(beat_code, beat_name, beat_descriptor, zone_id || null, dispatch_code, color, assigned_unit, backup_unit, hazard_notes, premise_alerts || null, patrol_frequency || 'normal', priority_modifier || 0, population_estimate, sq_miles, notes, sort_order || 0);
      return c.json({ success: true, id: result.meta?.last_row_id });
    } catch (err: any) {
      if (err?.message?.includes('UNIQUE')) return c.json({ error: 'Beat code already exists' }, 409);
      return c.json({ error: 'Failed to create beat' }, 500);
    }
  });

  // PUT /api/dispatch/geography/beats/:id
  api.put('/geography/beats/:id', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = parseInt(c.req.param('id') || '0', 10);
    const old = await db.prepare('SELECT * FROM dispatch_beats WHERE id = ?').get(id);
    if (!old) return c.json({ error: 'Beat not found' }, 404);
    const body = await c.req.json();
    const fields = ['beat_code', 'beat_name', 'beat_descriptor', 'zone_id', 'dispatch_code', 'color', 'assigned_unit', 'backup_unit', 'hazard_notes', 'premise_alerts', 'patrol_frequency', 'priority_modifier', 'population_estimate', 'sq_miles', 'notes', 'sort_order', 'active'];
    const updates: string[] = [];
    const values: any[] = [];
    for (const f of fields) { if (body[f] !== undefined) { updates.push(`${f} = ?`); values.push(body[f]); } }
    if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);
    updates.push('updated_at = ?'); values.push(new Date().toISOString().slice(0, 19));
    values.push(id);
    await db.prepare(`UPDATE dispatch_beats SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return c.json({ success: true });
  });

  // DELETE /api/dispatch/geography/beats/:id
  api.delete('/geography/beats/:id', requireRole('admin'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = parseInt(c.req.param('id') || '0', 10);
    await db.prepare('DELETE FROM dispatch_beats WHERE id = ?').run(id);
    return c.json({ success: true });
  });

  // POST /api/dispatch/geography/codes
  api.post('/geography/codes', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    const body = await c.req.json();
    const { code, description, category, priority, color, requires_backup, officer_safety, ems_needed, fire_needed, notes, sort_order } = body;
    if (!code || !description) return c.json({ error: 'code and description required' }, 400);
    try {
      const result = await db.prepare('INSERT INTO dispatch_codes (code, description, category, priority, color, requires_backup, officer_safety, ems_needed, fire_needed, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(code, description, category || 'general', priority || 'P3', color || '#6b7280', requires_backup ? 1 : 0, officer_safety ? 1 : 0, ems_needed ? 1 : 0, fire_needed ? 1 : 0, notes, sort_order || 0);
      return c.json({ success: true, id: result.meta?.last_row_id });
    } catch (err: any) {
      if (err?.message?.includes('UNIQUE')) return c.json({ error: 'Dispatch code already exists' }, 409);
      return c.json({ error: 'Failed to create dispatch code' }, 500);
    }
  });

  // PUT /api/dispatch/geography/codes/:id
  api.put('/geography/codes/:id', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = parseInt(c.req.param('id') || '0', 10);
    const old = await db.prepare('SELECT * FROM dispatch_codes WHERE id = ?').get(id);
    if (!old) return c.json({ error: 'Dispatch code not found' }, 404);
    const body = await c.req.json();
    const fields = ['code', 'description', 'category', 'priority', 'color', 'requires_backup', 'officer_safety', 'ems_needed', 'fire_needed', 'notes', 'sort_order', 'active'];
    const updates: string[] = [];
    const values: any[] = [];
    for (const f of fields) { if (body[f] !== undefined) { updates.push(`${f} = ?`); values.push(body[f]); } }
    if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);
    updates.push('updated_at = ?'); values.push(new Date().toISOString().slice(0, 19));
    values.push(id);
    await db.prepare(`UPDATE dispatch_codes SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return c.json({ success: true });
  });

  // DELETE /api/dispatch/geography/codes/:id
  api.delete('/geography/codes/:id', requireRole('admin'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = parseInt(c.req.param('id') || '0', 10);
    await db.prepare('DELETE FROM dispatch_codes WHERE id = ?').run(id);
    return c.json({ success: true });
  });

  // GET /api/dispatch/geography/premise-alerts
  api.get('/geography/premise-alerts', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const { address, lat, lng, radius } = c.req.query();
    let query = 'SELECT * FROM premise_alerts WHERE active = 1';
    const params: any[] = [];
    if (address) { const s = `%${address}%`; query += " AND address LIKE ? ESCAPE '\\'"; params.push(s); }
    else if (lat && lng) {
      const r = radius ? parseFloat(radius) : 0.005;
      query += ' AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?';
      params.push(parseFloat(lat) - r, parseFloat(lat) + r, parseFloat(lng) - r, parseFloat(lng) + r);
    }
    query += " AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY alert_level DESC, created_at DESC LIMIT 100";
    const alerts = await db.prepare(query).all(...params);
    return c.json(alerts);
  });

  // POST /api/dispatch/geography/premise-alerts
  api.post('/geography/premise-alerts', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const body = await c.req.json();
    const { address, latitude, longitude, alert_type, alert_level, title, description, flags, expires_at } = body;
    if (!address || !title) return c.json({ error: 'address and title required' }, 400);
    const userId = c.get('user')?.userId;
    try {
      const result = await db.prepare('INSERT INTO premise_alerts (address, latitude, longitude, alert_type, alert_level, title, description, flags, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(address, latitude, longitude, alert_type || 'caution', alert_level || 'info', title, description, JSON.stringify(flags || []), expires_at, userId);
      return c.json({ success: true, id: result.meta?.last_row_id });
    } catch { return c.json({ error: 'Failed to create premise alert' }, 500); }
  });

  // PUT /api/dispatch/geography/premise-alerts/:id
  api.put('/geography/premise-alerts/:id', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = parseInt(c.req.param('id') || '0', 10);
    const old = await db.prepare('SELECT * FROM premise_alerts WHERE id = ?').get(id);
    if (!old) return c.json({ error: 'Premise alert not found' }, 404);
    const body = await c.req.json();
    const fields = ['address', 'latitude', 'longitude', 'alert_type', 'alert_level', 'title', 'description', 'flags', 'expires_at', 'active'];
    const updates: string[] = [];
    const values: any[] = [];
    for (const f of fields) {
      if (body[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(f === 'flags' ? JSON.stringify(body[f]) : body[f]);
      }
    }
    if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);
    updates.push('updated_at = ?'); values.push(new Date().toISOString().slice(0, 19));
    values.push(id);
    await db.prepare(`UPDATE premise_alerts SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return c.json({ success: true });
  });

  // DELETE /api/dispatch/geography/premise-alerts/:id
  api.delete('/geography/premise-alerts/:id', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = parseInt(c.req.param('id') || '0', 10);
    await db.prepare('DELETE FROM premise_alerts WHERE id = ?').run(id);
    return c.json({ success: true });
  });

  // GET /api/dispatch/geography/stats
  api.get('/geography/stats', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const days = Math.max(1, Math.min(365, parseInt(c.req.query().days || '30', 10) || 30));
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    try {
      const sectionStats = await db.prepare(`SELECT c.sector_id as code, COALESCE(ds.sector_name, c.sector_id) as name, COUNT(*) as total_calls, SUM(CASE WHEN c.priority = 'P1' THEN 1 ELSE 0 END) as p1_calls, SUM(CASE WHEN c.priority = 'P2' THEN 1 ELSE 0 END) as p2_calls, SUM(CASE WHEN c.status NOT IN ('closed','archived','cancelled') THEN 1 ELSE 0 END) as active_calls FROM calls_for_service c LEFT JOIN dispatch_sectors ds ON ds.sector_code = c.sector_id WHERE c.created_at >= ? AND c.sector_id IS NOT NULL AND c.sector_id != '' GROUP BY c.sector_id ORDER BY total_calls DESC`).all(cutoff);
      const zoneStats = await db.prepare(`SELECT c.zone_id as code, COALESCE(dz.zone_name, c.zone_id) as name, c.sector_id, COUNT(*) as total_calls, SUM(CASE WHEN c.status NOT IN ('closed','archived','cancelled') THEN 1 ELSE 0 END) as active_calls FROM calls_for_service c LEFT JOIN dispatch_zones dz ON dz.zone_code = c.zone_id WHERE c.created_at >= ? AND c.zone_id IS NOT NULL AND c.zone_id != '' GROUP BY c.zone_id ORDER BY total_calls DESC`).all(cutoff);
      const beatStats = await db.prepare(`SELECT c.beat_id as code, COALESCE(db2.beat_name, c.beat_id) as name, c.zone_id, COUNT(*) as total_calls, SUM(CASE WHEN c.status NOT IN ('closed','archived','cancelled') THEN 1 ELSE 0 END) as active_calls FROM calls_for_service c LEFT JOIN dispatch_beats db2 ON db2.beat_code = c.beat_id WHERE c.created_at >= ? AND c.beat_id IS NOT NULL AND c.beat_id != '' GROUP BY c.beat_id ORDER BY total_calls DESC`).all(cutoff);
      return c.json({ days, section_stats: sectionStats, zone_stats: zoneStats, beat_stats: beatStats, top_types: [] });
    } catch { return c.json({ days, section_stats: [], zone_stats: [], beat_stats: [], top_types: [] }); }
  });

  // GET /api/dispatch/geography/identify
  api.get('/geography/identify', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const lat = parseFloat(c.req.query().lat || '0');
    const lng = parseFloat(c.req.query().lng || '0');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return c.json({ error: 'Valid lat and lng required' }, 400);
    try {
      const beatRecord = await db.prepare(`SELECT b.*, z.zone_code, z.zone_name, s.sector_code, s.sector_name, a.area_code, a.area_name FROM dispatch_beats b LEFT JOIN dispatch_zones z ON z.id = b.zone_id LEFT JOIN dispatch_sectors s ON s.id = z.sector_id LEFT JOIN dispatch_areas a ON a.id = s.area_id WHERE b.beat_code LIKE ? LIMIT 1`).get(`%${Math.floor(lat * 100)}%`);
      const alerts = await db.prepare(`SELECT * FROM premise_alerts WHERE active = 1 AND (expires_at IS NULL OR expires_at > datetime('now')) AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ? ORDER BY alert_level DESC LIMIT 5`).all(lat - 0.003, lat + 0.003, lng - 0.003, lng + 0.003);
      if (beatRecord) {
        return c.json({ found: true, area: { code: (beatRecord as any).area_code, name: (beatRecord as any).area_name }, sector: { code: (beatRecord as any).sector_code, name: (beatRecord as any).sector_name }, zone: { code: (beatRecord as any).zone_code, name: (beatRecord as any).zone_name }, beat: { code: (beatRecord as any).beat_code, name: (beatRecord as any).beat_name, descriptor: (beatRecord as any).beat_descriptor, dispatch_code: (beatRecord as any).dispatch_code, assigned_unit: (beatRecord as any).assigned_unit, hazard_notes: (beatRecord as any).hazard_notes }, premise_alerts: alerts });
      }
      return c.json({ found: false, premise_alerts: alerts });
    } catch { return c.json({ found: false }); }
  });

  // ═══════════════════════════════════════════════════════════
  // PANIC
  // ═══════════════════════════════════════════════════════════

  // GET /api/dispatch/panic - List active (unacknowledged) panic alerts
  api.get('/panic', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const panics = await db.prepare(`
      SELECT p.*, u.full_name as officer_name, u.badge_number
      FROM panic_alerts p LEFT JOIN users u ON p.user_id = u.id
      WHERE p.acknowledged_at IS NULL ORDER BY p.created_at DESC LIMIT 100
    `).all();
    return c.json(panics);
  });

  // GET /api/dispatch/panic/active - All active panics (including acknowledged but unresolved)
  api.get('/panic/active', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const panics = await db.prepare(`
      SELECT p.*, u.full_name as officer_name, u.badge_number
      FROM panic_alerts p LEFT JOIN users u ON p.user_id = u.id
      WHERE p.resolved_at IS NULL ORDER BY p.created_at DESC LIMIT 100
    `).all();
    return c.json(panics);
  });

  // POST /api/dispatch/panic — Emergency PANIC button
  api.post('/panic', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const { latitude, longitude, message, trigger_method } = await c.req.json();

      const userInfo = await db.prepare('SELECT id, full_name, badge_number FROM users WHERE id = ?').get(user.userId) as any;
      if (!userInfo) return c.json({ error: 'User not found', code: 'USER_NOT_FOUND' }, 404);

      if (message != null && (typeof message !== 'string' || message.length > 500)) {
        return c.json({ error: 'Message must be a string of 500 characters or less', code: 'INVALID_MESSAGE' }, 400);
      }

      const now = localNow();
      const callNumber = `PAN-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
      const locationAddress = latitude != null && longitude != null && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
        ? `GPS: ${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}`
        : 'Unknown location';
      const description = `PANIC ALARM — Officer ${userInfo.full_name} (Badge: ${userInfo.badge_number || 'N/A'}) triggered emergency alert.${message ? ' Message: ' + message : ''}`;

      // Create call
      const callResult = await db.prepare(`
        INSERT INTO calls_for_service (call_number, incident_type, priority, status, caller_name, location_address, latitude, longitude, description, source, dispatcher_id, created_at, dispatched_at)
        VALUES (?, 'officer_assist', 'P1', 'dispatched', ?, ?, ?, ?, ?, 'panic', ?, ?, ?)
      `).run(callNumber, userInfo.full_name, locationAddress, latitude ?? null, longitude ?? null, description, user.userId, now, now);

      const callId = Number(callResult.meta.last_row_id);

      // Auto-assign officer's unit
      const unit = await db.prepare('SELECT id, call_sign FROM units WHERE officer_id = ?').get(user.userId) as any;
      if (unit) {
        const unitIds = JSON.stringify([unit.id]);
        await db.prepare('UPDATE units SET status = ?, current_call_id = ?, last_status_change = ? WHERE id = ?').run('dispatched', callId, now, unit.id);
        await db.prepare('UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?').run(unitIds, callId);
      }

      // Insert panic_alerts record
      const panicResult = await db.prepare(`
        INSERT INTO panic_alerts (user_id, call_id, trigger_method, message, latitude, longitude, location_address, status, escalation_level, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?)
      `).run(user.userId, callId, trigger_method || 'ui_button', message || null, latitude ?? null, longitude ?? null, locationAddress, now, now);

      const panicId = Number(panicResult.meta.last_row_id);

      const call = await db.prepare(`SELECT c.*, u.full_name as dispatcher_name FROM calls_for_service c LEFT JOIN users u ON c.dispatcher_id = u.id WHERE c.id = ?`).get(callId);

      return c.json({ success: true, message: 'Panic alert sent — dispatch call created', call_number: callNumber, call_id: callId, panic_id: panicId, call });
    } catch (error: any) {
      return c.json({ error: 'Internal server error', code: 'PANIC_ERROR' }, 500);
    }
  });

  // POST /api/dispatch/panic/:id/acknowledge — Acknowledge a panic alert
  api.post('/panic/:id/acknowledge', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const panicId = paramNum(c.req.param('id'));
      if (isNaN(panicId)) return c.json({ error: 'Invalid panic ID', code: 'INVALID_ID' }, 400);

      const panic = await db.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(panicId) as any;
      if (!panic) return c.json({ error: 'Panic alert not found', code: 'NOT_FOUND' }, 404);
      if (panic.status !== 'active') return c.json({ error: `Panic alert is already ${panic.status}`, code: 'INVALID_STATUS' }, 409);

      const now = localNow();
      await db.prepare('UPDATE panic_alerts SET status = ?, acknowledged_at = ?, acknowledged_by = ?, updated_at = ? WHERE id = ?').run('acknowledged', now, user.userId, now, panicId);

      return c.json({ success: true, message: 'Panic alert acknowledged' });
    } catch (error: any) {
      return c.json({ error: 'Internal server error', code: 'PANIC_ACK_ERROR' }, 500);
    }
  });

  // POST /api/dispatch/panic/:id/resolve — Resolve a panic alert
  api.post('/panic/:id/resolve', requireRole('admin', 'supervisor', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const panicId = paramNum(c.req.param('id'));
      if (isNaN(panicId)) return c.json({ error: 'Invalid panic ID', code: 'INVALID_ID' }, 400);

      const { resolution_notes } = await c.req.json();
      if (!resolution_notes || typeof resolution_notes !== 'string' || resolution_notes.trim().length < 10) {
        return c.json({ error: 'Resolution notes are required (minimum 10 characters)', code: 'INVALID_NOTES' }, 400);
      }

      const panic = await db.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(panicId) as any;
      if (!panic) return c.json({ error: 'Panic alert not found', code: 'NOT_FOUND' }, 404);
      if (panic.status === 'resolved' || panic.status === 'cancelled' || panic.status === 'false_alarm') {
        return c.json({ error: `Panic alert is already ${panic.status}`, code: 'INVALID_STATUS' }, 409);
      }

      const now = localNow();
      await db.prepare('UPDATE panic_alerts SET status = ?, resolved_at = ?, resolved_by = ?, resolution_notes = ?, updated_at = ? WHERE id = ?')
        .run('resolved', now, user.userId, resolution_notes.trim(), now, panicId);

      return c.json({ success: true, message: 'Panic alert resolved' });
    } catch (error: any) {
      return c.json({ error: 'Internal server error', code: 'PANIC_RESOLVE_ERROR' }, 500);
    }
  });

  // POST /api/dispatch/panic/:id/cancel — Officer cancels own panic
  api.post('/panic/:id/cancel', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const panicId = paramNum(c.req.param('id'));
      if (isNaN(panicId)) return c.json({ error: 'Invalid panic ID', code: 'INVALID_ID' }, 400);

      const panic = await db.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(panicId) as any;
      if (!panic) return c.json({ error: 'Panic alert not found', code: 'NOT_FOUND' }, 404);
      if (panic.user_id !== user.userId) return c.json({ error: 'Only the triggering officer can cancel their own panic alert', code: 'FORBIDDEN' }, 403);
      if (panic.status !== 'active') return c.json({ error: `Panic alert is already ${panic.status} and cannot be cancelled`, code: 'INVALID_STATUS' }, 409);

      const now = localNow();
      await db.prepare('UPDATE panic_alerts SET status = ?, updated_at = ? WHERE id = ?').run('cancelled', now, panicId);

      return c.json({ success: true, message: 'Panic alert cancelled' });
    } catch (error: any) {
      return c.json({ error: 'Internal server error', code: 'PANIC_CANCEL_ERROR' }, 500);
    }
  });

  // POST /api/dispatch/panic/:id/false-alarm — Mark as false alarm
  api.post('/panic/:id/false-alarm', requireRole('admin', 'supervisor', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const panicId = paramNum(c.req.param('id'));
      if (isNaN(panicId)) return c.json({ error: 'Invalid panic ID', code: 'INVALID_ID' }, 400);

      const { resolution_notes } = await c.req.json();
      if (!resolution_notes || typeof resolution_notes !== 'string' || resolution_notes.trim().length < 10) {
        return c.json({ error: 'Resolution notes are required (minimum 10 characters)', code: 'INVALID_NOTES' }, 400);
      }

      const panic = await db.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(panicId) as any;
      if (!panic) return c.json({ error: 'Panic alert not found', code: 'NOT_FOUND' }, 404);
      if (panic.status === 'resolved' || panic.status === 'cancelled' || panic.status === 'false_alarm') {
        return c.json({ error: `Panic alert is already ${panic.status}`, code: 'INVALID_STATUS' }, 409);
      }

      const now = localNow();
      await db.prepare('UPDATE panic_alerts SET status = ?, resolution_notes = ?, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?')
        .run('false_alarm', resolution_notes.trim(), user.userId, now, now, panicId);

      return c.json({ success: true, message: 'Panic alert marked as false alarm' });
    } catch (error: any) {
      return c.json({ error: 'Internal server error', code: 'PANIC_FALSE_ALARM_ERROR' }, 500);
    }
  });

  // GET /api/dispatch/panic/history — Historical panic log
  api.get('/panic/history', requireRole('admin', 'supervisor', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const limit = Math.min(100000, Math.max(1, parseInt(c.req.query('limit') || '100000', 10)));
      const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10));

      const total = ((await db.prepare('SELECT COUNT(*) as count FROM panic_alerts').get()) as any)?.count || 0;
      const data = await db.prepare(`
        SELECT pa.*, u.full_name as officer_name, u.badge_number as officer_badge,
          ack.full_name as acknowledged_by_name, res.full_name as resolved_by_name
        FROM panic_alerts pa
        LEFT JOIN users u ON pa.user_id = u.id
        LEFT JOIN users ack ON pa.acknowledged_by = ack.id
        LEFT JOIN users res ON pa.resolved_by = res.id
        ORDER BY pa.created_at DESC LIMIT ? OFFSET ?
      `).all(limit, offset);

      return c.json({ data, total, limit, offset });
    } catch (error: any) {
      return c.json({ error: 'Internal server error', code: 'PANIC_HISTORY_ERROR' }, 500);
    }
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

  // ═══════════════════════════════════════════════════════════
  // WRITE ROUTES
  // ═══════════════════════════════════════════════════════════

  // POST /api/dispatch/calls - Create a new call
  api.post('/calls', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    let body: any;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body', code: 'INVALID_JSON' }, 400); }

    const {
      incident_type, priority, location_address,
      latitude, longitude, narrative, caller_name, caller_phone, caller_address,
      description, property_id, client_id, reported_by, initial_notes,
      created_at: customCreatedAt, status: customStatus,
    } = body;

    if (!incident_type || !priority || !location_address) {
      return c.json({ error: 'incident_type, priority, and location_address are required', code: 'MISSING_FIELDS' }, 400);
    }

    const normalizedPriority = String(priority).toUpperCase();
    if (!['P1', 'P2', 'P3', 'P4'].includes(normalizedPriority)) {
      return c.json({ error: 'Invalid priority. Must be P1, P2, P3, or P4', code: 'INVALID_PRIORITY' }, 400);
    }

    const validStatuses = ['pending', 'dispatched', 'enroute', 'onscene', 'cleared', 'closed', 'cancelled', 'archived'];
    const status = customStatus && validStatuses.includes(customStatus) ? customStatus : 'pending';

    const now = localNow();

    // Generate call number: CFS-YY-NNNNN
    const yy = String(new Date().getFullYear()).slice(-2);
    const prefix = `${yy}-CFS`;
    const lastRow = await db.prepare(
      `SELECT call_number FROM calls_for_service WHERE call_number LIKE ? ORDER BY id DESC LIMIT 1`
    ).get(`${prefix}%`) as any;
    let nextNum = 1;
    if (lastRow) {
      const match = (lastRow.call_number || '').match(/\d{2}-CFS(\d{5})/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    const callNumber = `${prefix}${String(nextNum).padStart(5, '0')}`;

    const result = await db.prepare(`
      INSERT INTO calls_for_service (
        call_number, incident_type, priority, status,
        location_address, latitude, longitude,
        narrative, caller_name, caller_phone, caller_address,
        description, property_id, client_id, reported_by, initial_notes,
        created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      callNumber,
      String(incident_type || '').trim().toLowerCase().replace(/\s+/g, '_'),
      normalizedPriority,
      status,
      String(location_address || ''),
      latitude != null ? Number(latitude) : null,
      longitude != null ? Number(longitude) : null,
      narrative || null,
      caller_name || null,
      caller_phone || null,
      caller_address || null,
      description || null,
      property_id != null ? Number(property_id) : null,
      client_id != null ? Number(client_id) : null,
      reported_by || null,
      initial_notes || null,
      user.userId,
      customCreatedAt || now,
    );

    const callId = result.meta.last_row_id;
    const call = await db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(callId);

    await auditLog(db, c, 'CREATE', 'call', callId!, `Created call ${callNumber}`);

    return c.json(call, 201);
  });

  // POST /api/dispatch/calls/:id/assign-unit - Assign a unit to a call
  api.post('/calls/:id/assign-unit', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const callId = paramNum(c.req.param('id'));
    if (isNaN(callId)) return c.json({ error: 'Invalid call ID', code: 'INVALID_CALL_ID' }, 400);

    const call = await db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(callId) as any;
    if (!call) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);

    let body: any;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body', code: 'INVALID_JSON' }, 400); }

    const { unit_id } = body;
    if (!unit_id) return c.json({ error: 'unit_id is required', code: 'UNITID_IS_REQUIRED' }, 400);

    const unit = await db.prepare('SELECT * FROM units WHERE id = ?').get(Number(unit_id)) as any;
    if (!unit) return c.json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' }, 404);

    if (['off_duty', 'out_of_service'].includes(unit.status)) {
      return c.json({ error: `Unit ${unit.call_sign} is ${unit.status.replace(/_/g, ' ')} and cannot be assigned`, code: 'UNIT_UNAVAILABLE' }, 409);
    }

    const now = localNow();
    let currentUnits: number[] = [];
    try {
      const parsed = JSON.parse(call.assigned_unit_ids || '[]');
      currentUnits = (Array.isArray(parsed) ? parsed : []).filter((n: any) => typeof n === 'number' && !isNaN(n));
    } catch { /* ignore parse errors */ }

    const unitIdNum = Number(unit_id);
    if (isNaN(unitIdNum)) return c.json({ error: 'Invalid unit_id', code: 'INVALID_UNITID' }, 400);
    if (!currentUnits.includes(unitIdNum)) currentUnits.push(unitIdNum);

    await db.prepare(`
      UPDATE calls_for_service SET
        status = CASE WHEN status = 'pending' THEN 'dispatched' ELSE status END,
        assigned_unit_ids = ?,
        dispatched_at = COALESCE(dispatched_at, ?),
        dispatcher_id = COALESCE(dispatcher_id, ?)
      WHERE id = ?
    `).run(JSON.stringify(currentUnits), now, user.userId, callId);

    await db.prepare(`
      UPDATE units SET status = 'dispatched', current_call_id = ?, last_status_change = ? WHERE id = ?
    `).run(callId, now, unit_id);

    await auditLog(db, c, 'UNIT_ASSIGNED', 'call', callId, `Assigned ${unit.call_sign} to ${call.call_number}`);

    const updated = await db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(callId);
    return c.json(updated);
  });

  // POST /api/dispatch/calls/:id/status - Update call status
  api.post('/calls/:id/status', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const callId = paramNum(c.req.param('id'));
    if (isNaN(callId)) return c.json({ error: 'Invalid call ID', code: 'INVALID_CALL_ID' }, 400);

    const call = await db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(callId) as any;
    if (!call) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);

    let body: any;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body', code: 'INVALID_JSON' }, 400); }

    const { status, notes, disposition } = body;
    if (!status) return c.json({ error: 'status is required', code: 'STATUS_IS_REQUIRED' }, 400);

    const validStatuses = ['pending', 'dispatched', 'enroute', 'onscene', 'cleared', 'closed', 'cancelled', 'archived', 'on_hold'];
    if (!validStatuses.includes(status)) {
      return c.json({ error: 'Invalid status', code: 'INVALID_STATUS', valid: validStatuses }, 400);
    }

    const now = localNow();
    const timestampField: Record<string, string> = {
      dispatched: 'dispatched_at', enroute: 'enroute_at', onscene: 'onscene_at',
      cleared: 'cleared_at', closed: 'closed_at', archived: 'archived_at',
    };
    const tsField = timestampField[status];

    let updateQuery = `UPDATE calls_for_service SET status = ?, status_changed_at = ?`;
    const updateParams: any[] = [status, now];

    if (tsField) {
      updateQuery += `, ${tsField} = COALESCE(${tsField}, ?)`;
      updateParams.push(now);
    }
    if (notes) {
      updateQuery += `, notes = ?`;
      updateParams.push(notes);
    }
    if (disposition) {
      updateQuery += `, disposition = ?`;
      updateParams.push(disposition);
    }

    updateQuery += ` WHERE id = ?`;
    updateParams.push(callId);

    await db.prepare(updateQuery).run(...updateParams);
    await auditLog(db, c, 'STATUS_CHANGE', 'call', callId, `Status changed to ${status} on ${call.call_number}`);

    const updated = await db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(callId);
    return c.json(updated);
  });

  // GET /api/dispatch/disposition-stats - Disposition counts
  api.get('/disposition-stats', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const shiftStart = new Date();
      shiftStart.setHours(shiftStart.getHours() - 12);
      const stats = await db.prepare(`
        SELECT disposition, COUNT(*) as count
        FROM calls_for_service
        WHERE disposition IS NOT NULL AND disposition != '' AND cleared_at >= ?
        GROUP BY disposition ORDER BY count DESC
      `).all(shiftStart.toISOString());
      return c.json(stats);
    } catch (err: any) {
      return c.json({ error: 'Failed to get disposition stats' }, 500);
    }
  });

  // Mount all dispatch routes under /dispatch
  app.route('/api/dispatch', api);
}
