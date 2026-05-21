// Stub: Incident routes for Workers (read-only endpoints ported)
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum } from '../worker-middleware/d1Helpers';

export function mountIncidentRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/incidents - List incidents
  api.get('/', async (c) => {
    const db = new D1Db(c.env.DB);
    const status = c.req.query('status');
    let where = '1=1';
    const params: any[] = [];
    if (status) { where += ' AND i.status = ?'; params.push(status); }

    const incidents = await db.prepare(`
      SELECT i.*, u.full_name as officer_name, p.name as property_name
      FROM incidents i LEFT JOIN users u ON i.officer_id = u.id LEFT JOIN properties p ON i.property_id = p.id
      WHERE ${where} ORDER BY i.created_at DESC LIMIT 200
    `).all(...params);
    return c.json(incidents);
  });

  // GET /api/incidents/:id/full
  api.get('/:id/full', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const incident = await db.prepare('SELECT i.*, u.full_name as officer_name FROM incidents i LEFT JOIN users u ON i.officer_id = u.id WHERE i.id = ?').get(id);
    if (!incident) return c.json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }, 404);

    const [offenses, officers, links] = await Promise.all([
      db.prepare('SELECT * FROM incident_offenses WHERE incident_id = ?').all(id),
      db.prepare('SELECT io.*, u.full_name as officer_name FROM incident_officers io LEFT JOIN users u ON io.officer_user_id = u.id WHERE io.incident_id = ?').all(id),
      db.prepare('SELECT * FROM incident_links WHERE incident_id = ?').all(id),
    ]);

    return c.json({ ...incident, offenses, officers, links });
  });

  // GET /api/incidents/stats
  api.get('/stats', async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const [total, byStatus, byPriority, recent] = await Promise.all([
        db.prepare('SELECT COUNT(*) as count FROM incidents').get(),
        db.prepare('SELECT status, COUNT(*) as count FROM incidents GROUP BY status').all(),
        db.prepare('SELECT priority, COUNT(*) as count FROM incidents GROUP BY priority').all(),
        db.prepare("SELECT COUNT(*) as count FROM incidents WHERE created_at >= datetime('now','localtime','-7 days')").get(),
      ]);
      return c.json({
        total: (total as any)?.count || 0,
        by_status: byStatus,
        by_priority: byPriority,
        recent_7d: (recent as any)?.count || 0,
      });
    } catch { return c.json({ total: 0, by_status: [], by_priority: [], recent_7d: 0 }); }
  });

  app.route('/api/incidents', api);
}
