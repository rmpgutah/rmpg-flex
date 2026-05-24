// Reports routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db } from '../worker-middleware/d1Helpers';

export function mountReportsRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/reports/dashboard
  api.get('/dashboard', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');

    const [activeCalls, todayCalls, unitsOnDuty, totalUnits, pendingReports, activeBolos, unreadMessages, avgResponse, callsByPriority, callsByStatus, recentActivity, officersOnDuty, callsByHour] = await Promise.all([
      db.prepare("SELECT COUNT(*) as count FROM calls_for_service WHERE status IN ('pending', 'dispatched', 'enroute', 'onscene')").get(),
      db.prepare("SELECT COUNT(*) as count FROM calls_for_service WHERE DATE(created_at) = DATE('now')").get(),
      db.prepare("SELECT COUNT(*) as count FROM units WHERE status != 'off_duty'").get(),
      db.prepare('SELECT COUNT(*) as count FROM units').get(),
      db.prepare("SELECT COUNT(*) as count FROM incidents WHERE status IN ('submitted', 'under_review')").get(),
      db.prepare("SELECT COUNT(*) as count FROM bolos WHERE status = 'active'").get(),
      db.prepare('SELECT COUNT(*) as count FROM messages WHERE to_user_id = ? AND read_at IS NULL').get(user.userId),
      db.prepare("SELECT AVG((julianday(onscene_at) - julianday(created_at)) * 24 * 60) as avg_minutes FROM calls_for_service WHERE onscene_at IS NOT NULL AND DATE(created_at) = DATE('now')").get(),
      db.prepare("SELECT priority, COUNT(*) as count FROM calls_for_service WHERE DATE(created_at) = DATE('now') GROUP BY priority ORDER BY priority").all(),
      db.prepare("SELECT status, COUNT(*) as count FROM calls_for_service WHERE DATE(created_at) = DATE('now') GROUP BY status").all(),
      db.prepare('SELECT al.*, u.full_name as user_name FROM activity_log al LEFT JOIN users u ON al.user_id = u.id ORDER BY al.created_at DESC LIMIT 10').all(),
      db.prepare('SELECT u.id, u.full_name, u.badge_number, un.call_sign, un.status as unit_status, un.latitude, un.longitude FROM units un JOIN users u ON un.officer_id = u.id WHERE un.status != \'off_duty\' LIMIT 1000').all(),
      db.prepare("SELECT strftime('%H', created_at) as hour, COUNT(*) as count FROM calls_for_service WHERE DATE(created_at) = DATE('now') GROUP BY hour ORDER BY hour").all(),
    ]);

    return c.json({
      activeCalls: (activeCalls as any)?.count ?? 0,
      todayCalls: (todayCalls as any)?.count ?? 0,
      unitsOnDuty: (unitsOnDuty as any)?.count ?? 0,
      totalUnits: (totalUnits as any)?.count ?? 0,
      pendingReports: (pendingReports as any)?.count ?? 0,
      activeBolos: (activeBolos as any)?.count ?? 0,
      unreadMessages: (unreadMessages as any)?.count ?? 0,
      avgResponseMinutes: (avgResponse as any)?.avg_minutes ? Math.round((avgResponse as any).avg_minutes * 10) / 10 : null,
      callsByPriority,
      callsByStatus,
      recentActivity,
      officersOnDuty,
      callsByHour,
    });
  });

  // GET /api/reports/stats (alias for dashboard)
  api.get('/stats', async (c) => {
    const db = new D1Db(c.env.DB);
    const [activeCalls, totalUnits] = await Promise.all([
      db.prepare("SELECT COUNT(*) as count FROM calls_for_service WHERE status IN ('pending','dispatched','enroute','onscene')").get(),
      db.prepare('SELECT COUNT(*) as count FROM units').get(),
    ]);
    return c.json({
      activeCalls: (activeCalls as any)?.count ?? 0,
      totalUnits: (totalUnits as any)?.count ?? 0,
    });
  });

  // GET /api/reports/officer-activity
  api.get('/officer-activity', async (c) => {
    const db = new D1Db(c.env.DB);
    const { startDate, endDate } = c.req.query();

    let dateFilter = '';
    const params: any[] = [];
    if (startDate) { dateFilter += ' AND created_at >= ?'; params.push(startDate); }
    if (endDate) { dateFilter += ' AND created_at <= ?'; params.push(endDate); }

    const officers = await db.prepare(`
      SELECT id, full_name, badge_number, role FROM users
      WHERE role IN ('officer', 'supervisor') AND status = 'active'
      ORDER BY full_name LIMIT 1000
    `).all() as any[];

    const metrics = await Promise.all(officers.map(async (officer: any) => {
      const incidents = await db.prepare(`SELECT COUNT(*) as count FROM incidents WHERE officer_id = ? ${dateFilter}`).get(officer.id, ...params) as any;
      const incidentsByStatus = await db.prepare(`SELECT status, COUNT(*) as count FROM incidents WHERE officer_id = ? ${dateFilter} GROUP BY status`).all(officer.id, ...params);
      const hours = await db.prepare(`SELECT SUM(total_hours) as total FROM time_entries WHERE officer_id = ? AND status = 'completed' ${dateFilter.replace('created_at', 'clock_in')}`).get(officer.id, ...params) as any;
      const unit = await db.prepare('SELECT id FROM units WHERE officer_id = ?').get(officer.id) as any;
      let callsResponded = 0;
      if (unit) {
        const callCount = await db.prepare(`SELECT COUNT(*) as count FROM calls_for_service WHERE assigned_unit_ids LIKE ? ${dateFilter}`).get(`%${unit.id}%`, ...params) as any;
        callsResponded = callCount.count;
      }
      return {
        officer_id: officer.id, full_name: officer.full_name,
        badge_number: officer.badge_number, role: officer.role,
        incidents_written: incidents.count,
        incidents_by_status: incidentsByStatus,
        calls_responded: callsResponded,
        total_hours: hours.total ? Math.round(hours.total * 100) / 100 : 0,
      };
    }));

    return c.json(metrics);
  });

  // GET /api/reports/shift-comparison
  api.get('/shift-comparison', async (c) => {
    const db = new D1Db(c.env.DB);
    const days = Math.max(1, Math.min(90, parseInt(c.req.query('days') || '30', 10)));
    const offset = `-${days} days`;

    const shifts = [
      { name: 'Day', startHour: 6, endHour: 14 },
      { name: 'Swing', startHour: 14, endHour: 22 },
      { name: 'Night', startHour: 22, endHour: 6 },
    ];

    const results = await Promise.all(shifts.map(async (shift) => {
      const hourCondition = shift.name === 'Night'
        ? `(CAST(strftime('%H', created_at) AS INTEGER) >= ${shift.startHour} OR CAST(strftime('%H', created_at) AS INTEGER) < ${shift.endHour})`
        : `CAST(strftime('%H', created_at) AS INTEGER) >= ${shift.startHour} AND CAST(strftime('%H', created_at) AS INTEGER) < ${shift.endHour}`;

      const stats = await db.prepare(`
        SELECT COUNT(*) as calls,
          ROUND(AVG(CASE WHEN onscene_at IS NOT NULL THEN (julianday(onscene_at) - julianday(created_at)) * 1440 END), 1) as avg_response
        FROM calls_for_service
        WHERE created_at >= DATE('now', ?) AND ${hourCondition}
      `).get(offset) as any;

      const incidents = await db.prepare(`
        SELECT COUNT(*) as count FROM incidents
        WHERE created_at >= DATE('now', ?) AND ${hourCondition}
      `).get(offset) as any;

      return { shift: shift.name, hours: `${String(shift.startHour).padStart(2, '0')}00-${String(shift.endHour).padStart(2, '0')}00`, calls: stats.calls, avgResponseMin: stats.avg_response, incidents: incidents.count };
    }));

    return c.json({ period_days: days, shifts: results });
  });

  // GET /api/reports/clearance-rate
  api.get('/clearance-rate', async (c) => {
    const db = new D1Db(c.env.DB);
    const days = Math.max(1, Math.min(365, parseInt(c.req.query('days') || '30', 10)));
    const offset = `-${days} days`;

    const result = await db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status IN ('approved', 'closed') THEN 1 ELSE 0 END) as cleared,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status IN ('submitted', 'under_review') THEN 1 ELSE 0 END) as pending
      FROM incidents WHERE created_at >= DATE('now', ?)
    `).get(offset) as any;

    return c.json({ total: result.total, cleared: result.cleared, active: result.active, pending: result.pending, rate: result.total > 0 ? Math.round((result.cleared / result.total) * 100) : 0 });
  });

  // GET /api/reports/patrol-coverage
  api.get('/patrol-coverage', async (c) => {
    const db = new D1Db(c.env.DB);
    const totalBeats = await db.prepare('SELECT COUNT(DISTINCT property_id) as count FROM patrol_checkpoints WHERE is_active = 1').get() as any;
    const coveredBeats = await db.prepare("SELECT COUNT(DISTINCT pc.property_id) as count FROM patrol_scans ps JOIN patrol_checkpoints pc ON ps.checkpoint_id = pc.id WHERE ps.scanned_at >= datetime('now', '-8 hours')").get() as any;
    const activeUnits = await db.prepare("SELECT u.call_sign, u.status, u.latitude, u.longitude, us.full_name as officer_name, us.badge_number FROM units u LEFT JOIN users us ON u.officer_id = us.id WHERE u.status NOT IN ('off_duty', 'out_of_service') LIMIT 1000").all() as any;

    return c.json({ totalBeats: totalBeats?.count || 0, coveredBeats: coveredBeats?.count || 0, coverage: totalBeats?.count > 0 ? Math.round(((coveredBeats?.count || 0) / totalBeats.count) * 100) : 0, activeUnits });
  });

  // GET /api/reports/evidence-pending
  api.get('/evidence-pending', async (c) => {
    const db = new D1Db(c.env.DB);
    const [pending, byStatus] = await Promise.all([
      db.prepare("SELECT COUNT(*) as count FROM evidence WHERE status IN ('collected', 'pending', 'in_lab')").get() as any,
      db.prepare("SELECT status, COUNT(*) as count FROM evidence WHERE status IN ('collected', 'pending', 'in_lab', 'released', 'destroyed') GROUP BY status ORDER BY count DESC").all(),
    ]);
    return c.json({ pending: pending?.count || 0, byStatus });
  });

  // GET /api/reports/upcoming-court
  api.get('/upcoming-court', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const upcoming = await db.prepare(`
        SELECT ce.*, u.full_name as officer_name FROM court_events ce
        LEFT JOIN users u ON ce.created_by = u.id
        WHERE ce.event_date >= DATE('now') AND ce.event_date <= DATE('now', '+7 days')
        ORDER BY ce.event_date ASC LIMIT 1000
      `).all();
      return c.json({ count: (upcoming as any[]).length, upcoming });
    } catch (err: any) {
      return c.json({ count: 0, upcoming: [] });
    }
  });

  // GET /api/reports/overdue-reports
  api.get('/overdue-reports', async (c) => {
    const db = new D1Db(c.env.DB);
    const [overdue, overdueList] = await Promise.all([
      db.prepare("SELECT COUNT(*) as count FROM incidents WHERE status = 'draft' AND created_at <= DATE('now', '-3 days')").get() as any,
      db.prepare("SELECT i.id, i.incident_number, i.incident_type, i.created_at, u.full_name as officer_name FROM incidents i LEFT JOIN users u ON i.officer_id = u.id WHERE i.status = 'draft' AND i.created_at <= DATE('now', '-3 days') ORDER BY i.created_at ASC LIMIT 20").all(),
    ]);
    return c.json({ count: overdue?.count || 0, overdueList });
  });

  // GET /api/reports/patrol-tracking
  api.get('/patrol-tracking', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const unitId = c.req.query('unitId');
      const officerId = c.req.query('officerId');
      const startDate = c.req.query('startDate');
      const endDate = c.req.query('endDate');
      const hours = parseInt(c.req.query('hours') || '8', 10) || 8;

      const haversineM = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
        const R = 6371000;
        const toRad = (d: number) => (d * Math.PI) / 180;
        const dLat = toRad(lat2 - lat1);
        const dLng = toRad(lng2 - lng1);
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      };

      const headingCardinal = (deg: number | null): string | null => {
        if (deg == null) return null;
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
      };

      let dateClause: string;
      const params: any[] = [];

      if (startDate && endDate) {
        dateClause = `b.recorded_at >= ? AND b.recorded_at <= ?`;
        params.push(startDate, endDate);
      } else {
        dateClause = `b.recorded_at >= datetime('now', 'localtime', '-' || ? || ' hours')`;
        params.push(hours);
      }

      let whereExtra = '';
      if (unitId) {
        whereExtra += ' AND b.unit_id = ?';
        params.push(parseInt(unitId, 10));
      }
      if (officerId) {
        whereExtra += ' AND b.officer_id = ?';
        params.push(parseInt(officerId, 10));
      }

      const rows = await db.prepare(`
        SELECT b.id, b.unit_id, b.officer_id, b.latitude, b.longitude, b.accuracy,
          b.heading, b.speed, b.unit_status, b.call_sign, b.officer_name,
          b.badge_number, b.current_call_id, b.current_call_number,
          b.current_call_type, b.road_name, b.nearest_intersection,
          b.recorded_at, COALESCE(b.source, 'unknown') as source
        FROM gps_breadcrumbs b
        WHERE ${dateClause} ${whereExtra}
        ORDER BY b.unit_id, b.recorded_at ASC
        LIMIT 1000
      `).all(...params) as any[];

      const trailMap: Record<number, { raw: any[]; info: { call_sign: string; officer_name: string; badge_number: string; officer_id: number } }> = {};

      for (const row of rows) {
        if (!trailMap[row.unit_id]) {
          trailMap[row.unit_id] = {
            raw: [],
            info: {
              call_sign: row.call_sign || '',
              officer_name: row.officer_name || '',
              badge_number: row.badge_number || '',
              officer_id: row.officer_id,
            }
          };
        }
        trailMap[row.unit_id].raw.push(row);
      }

      const trails: any[] = [];
      const MAX_ACCURACY = 150;
      const MAX_SPEED = 80;
      const MIN_DISTANCE = 3;

      for (const [unitIdStr, data] of Object.entries(trailMap)) {
        const uId = parseInt(unitIdStr, 10);
        const processedPoints: any[] = [];
        let totalDistanceM = 0;
        let maxSpeed = 0;
        let movingPoints = 0;
        let stationaryPoints = 0;
        const sourceBreakdown: Record<string, number> = {};

        for (let i = 0; i < data.raw.length; i++) {
          const curr = data.raw[i];
          if (curr.accuracy && curr.accuracy > MAX_ACCURACY) continue;

          const prev = processedPoints[processedPoints.length - 1];
          let dist = null;
          let timeDelta = null;
          let speedMps = curr.speed || 0;

          if (prev) {
            dist = haversineM(prev.lat, prev.lng, curr.latitude, curr.longitude);
            timeDelta = (new Date(curr.recorded_at).getTime() - new Date(prev.time).getTime()) / 1000;

            if (dist > 0 && timeDelta > 0) {
              const derivedSpeed = dist / timeDelta;
              if (derivedSpeed < MAX_SPEED && !curr.speed) {
                speedMps = derivedSpeed;
              }
            }
          }

          const speedMph = speedMps * 2.23694;
          if (speedMph > maxSpeed && speedMph < 120) {
            maxSpeed = speedMph;
          }

          const isStationary = dist !== null && dist < MIN_DISTANCE;
          if (isStationary) stationaryPoints++;
          else movingPoints++;

          if (dist !== null && !isStationary) {
            totalDistanceM += dist;
          }

          const source = curr.source || 'unknown';
          sourceBreakdown[source] = (sourceBreakdown[source] || 0) + 1;

          processedPoints.push({
            id: curr.id,
            lat: curr.latitude,
            lng: curr.longitude,
            accuracy: curr.accuracy,
            heading: curr.heading,
            heading_cardinal: headingCardinal(curr.heading),
            speed: speedMps,
            speed_mph: Math.round(speedMph * 10) / 10,
            status: curr.unit_status,
            call_sign: curr.call_sign || data.info.call_sign,
            officer_name: curr.officer_name || data.info.officer_name,
            badge_number: curr.badge_number || data.info.badge_number,
            current_call_id: curr.current_call_id,
            current_call_number: curr.current_call_number,
            current_call_type: curr.current_call_type,
            time: curr.recorded_at,
            distance_from_prev_meters: dist !== null ? Math.round(dist * 10) / 10 : null,
            time_delta_seconds: timeDelta,
            is_stationary: isStationary,
            road_name: curr.road_name,
            nearest_intersection: curr.nearest_intersection,
            source,
            cumulative_distance_miles: Math.round((totalDistanceM / 1609.34) * 100) / 100,
          });
        }

        let durationMin = 0;
        if (processedPoints.length >= 2) {
          const first = new Date(processedPoints[0].time).getTime();
          const last = new Date(processedPoints[processedPoints.length - 1].time).getTime();
          durationMin = Math.round((last - first) / (60000));
        }

        const avgSpeed = movingPoints > 0
          ? processedPoints.reduce((acc, p) => acc + (p.is_stationary ? 0 : p.speed_mph || 0), 0) / movingPoints
          : 0;

        trails.push({
          unit_id: uId,
          call_sign: data.info.call_sign,
          officer_name: data.info.officer_name,
          badge_number: data.info.badge_number,
          officer_id: data.info.officer_id,
          points: processedPoints,
          stats: {
            total_points: processedPoints.length,
            stationary_points: stationaryPoints,
            moving_points: movingPoints,
            total_distance_miles: Math.round((totalDistanceM / 1609.34) * 100) / 100,
            max_speed_mph: Math.round(maxSpeed * 10) / 10,
            avg_speed_mph: Math.round(avgSpeed * 10) / 10,
            duration_minutes: durationMin,
            source_breakdown: sourceBreakdown,
          },
        });
      }

      return c.json(trails);
    } catch (err: any) {
      return c.json({ error: 'Failed to generate patrol tracking report', code: 'PATROL_TRACKING_ERROR' }, 500);
    }
  });

  // GET /api/reports/response-times — cutover-parity stub
  // Replaces the /src/ stubs.ts hardcoded `[]`. Real implementation TODO.
  api.get('/response-times', async (_c) => _c.json([]));

  app.route('/api/reports', api);
}
