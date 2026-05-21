// Reports routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken } from '../worker-middleware/auth';
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

  app.route('/api/reports', api);
}
