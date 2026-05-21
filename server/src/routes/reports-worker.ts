// Reports routes for Workers (dashboard)
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

  app.route('/api/reports', api);
}
