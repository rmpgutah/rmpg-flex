// Reports routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db } from '../worker-middleware/d1Helpers';

export function mountReportsRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/reports/stats
  api.get('/stats', async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const [calls, incidents, citations, warrants] = await Promise.all([
        db.prepare('SELECT COUNT(*) as count FROM calls_for_service').get(),
        db.prepare('SELECT COUNT(*) as count FROM incidents').get(),
        db.prepare('SELECT COUNT(*) as count FROM citations').get(),
        db.prepare('SELECT COUNT(*) as count FROM warrants').get(),
      ]);
      return c.json({
        calls: (calls as any)?.count || 0,
        incidents: (incidents as any)?.count || 0,
        citations: (citations as any)?.count || 0,
        warrants: (warrants as any)?.count || 0,
      });
    } catch { return c.json({ calls: 0, incidents: 0, citations: 0, warrants: 0 }); }
  });

  // GET /api/reports/dashboard
  api.get('/dashboard', async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const [todayCalls, activeCalls, activeUnits] = await Promise.all([
        db.prepare("SELECT COUNT(*) as count FROM calls_for_service WHERE created_at >= datetime('now','localtime','-1 day')").get(),
        db.prepare("SELECT COUNT(*) as count FROM calls_for_service WHERE status IN ('dispatched','enroute','onscene')").get(),
        db.prepare("SELECT COUNT(*) as count FROM units WHERE status != 'offline'").get(),
      ]);
      return c.json({
        today_calls: (todayCalls as any)?.count || 0,
        active_calls: (activeCalls as any)?.count || 0,
        active_units: (activeUnits as any)?.count || 0,
      });
    } catch { return c.json({ today_calls: 0, active_calls: 0, active_units: 0 }); }
  });

  // GET /api/reports/list
  api.get('/list', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const limit = Math.min(1000, Math.max(1, parseInt(c.req.query('limit') || '100', 10) || 100));
      const rows = await db.prepare(`
        SELECT id, report_number, incident_id, author_id, report_type, created_at
        FROM supplemental_reports ORDER BY created_at DESC LIMIT ?
      `).all(limit);
      return c.json(rows);
    } catch { return c.json([]); }
  });

  app.route('/api/reports', api);
}
