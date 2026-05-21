// Fleet routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db } from '../worker-middleware/d1Helpers';

export function mountFleetRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/fleet
  api.get('/', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const limit = Math.min(1000, Math.max(1, parseInt(c.req.query('limit') || '100', 10) || 100));
      const rows = await db.prepare('SELECT * FROM fleet_vehicles ORDER BY unit_number LIMIT ?').all(limit);
      return c.json(rows);
    } catch { return c.json([]); }
  });

  // GET /api/fleet/vehicles
  api.get('/vehicles', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const rows = await db.prepare('SELECT * FROM fleet_vehicles ORDER BY unit_number').all();
      return c.json(rows);
    } catch { return c.json([]); }
  });

  // GET /api/fleet/stats
  api.get('/stats', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const [total, active, maintenance] = await Promise.all([
        db.prepare('SELECT COUNT(*) as count FROM fleet_vehicles').get(),
        db.prepare("SELECT COUNT(*) as count FROM fleet_vehicles WHERE status = 'active'").get(),
        db.prepare("SELECT COUNT(*) as count FROM fleet_vehicles WHERE status = 'maintenance'").get(),
      ]);
      return c.json({
        total: (total as any)?.count || 0,
        active: (active as any)?.count || 0,
        maintenance: (maintenance as any)?.count || 0,
      });
    } catch { return c.json({ total: 0, active: 0, maintenance: 0 }); }
  });

  app.route('/api/fleet', api);
}
