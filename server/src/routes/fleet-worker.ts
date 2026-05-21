// Stub: Fleet routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum } from '../worker-middleware/d1Helpers';

export function mountFleetRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/fleet/vehicles
  api.get('/vehicles', async (c) => {
    const db = new D1Db(c.env.DB);
    const vehicles = await db.prepare('SELECT * FROM fleet_vehicles ORDER BY id').all();
    return c.json(vehicles);
  });

  // GET /api/fleet/vehicles/:id
  api.get('/vehicles/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const vehicle = await db.prepare('SELECT * FROM fleet_vehicles WHERE id = ?').get(id);
    if (!vehicle) return c.json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' }, 404);
    return c.json(vehicle);
  });

  // GET /api/fleet/stats
  api.get('/stats', async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const count = await db.prepare('SELECT COUNT(*) as total FROM fleet_vehicles').get() as any;
      const active = await db.prepare('SELECT COUNT(*) as total FROM fleet_vehicles WHERE status = "active"').get() as any;
      return c.json({ total: count?.total || 0, active: active?.total || 0 });
    } catch {
      return c.json({ total: 0, active: 0 });
    }
  });

  // GET /api/fleet/maintenance 
  api.get('/maintenance', async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const items = await db.prepare('SELECT * FROM fleet_maintenance ORDER BY service_date DESC LIMIT 100').all();
      return c.json(items);
    } catch {
      return c.json([]);
    }
  });

  // GET /api/fleet/fuel-logs
  api.get('/fuel-logs', async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const logs = await db.prepare('SELECT * FROM fleet_fuel_log ORDER BY fuel_date DESC LIMIT 100').all();
      return c.json(logs);
    } catch {
      return c.json([]);
    }
  });

  // GET /api/fleet/inspections
  api.get('/inspections', async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const items = await db.prepare('SELECT * FROM fleet_inspections ORDER BY inspection_date DESC LIMIT 100').all();
      return c.json(items);
    } catch {
      return c.json([]);
    }
  });

  // GET /api/fleet/damage-reports
  api.get('/damage-reports', async (c) => {
    return c.json([]);
  });

  app.route('/api/fleet', api);
}
