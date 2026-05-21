// Comms routes for Workers (bolos, activity feed)
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken } from '../worker-middleware/auth';
import { D1Db, localNow } from '../worker-middleware/d1Helpers';

export function mountCommsRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/comms/bolos/active
  api.get('/bolos/active', async (c) => {
    const db = new D1Db(c.env.DB);
    const bolos = await db.prepare(`
      SELECT b.*, u.full_name as issued_by_name FROM bolos b
      LEFT JOIN users u ON b.issued_by = u.id
      WHERE b.status = 'active' AND (b.expires_at IS NULL OR b.expires_at > ?)
      ORDER BY CASE b.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 END, b.created_at DESC
      LIMIT 1000
    `).all(localNow());
    return c.json(bolos);
  });

  // GET /api/comms/activity-feed
  api.get('/activity-feed', async (c) => {
    const db = new D1Db(c.env.DB);
    const { limit = '50', offset = '0', entityType } = c.req.query();
    const limitNum = Math.min(100000, Math.max(1, parseInt(limit, 10) || 100000));
    const offsetNum = parseInt(offset, 10) || 0;

    let whereClause = '';
    const params: any[] = [];
    if (entityType) { whereClause = 'WHERE al.entity_type = ?'; params.push(entityType); }

    const countRow = await db.prepare(`SELECT COUNT(*) as total FROM activity_log al ${whereClause}`).get(...params) as any;
    const activity = await db.prepare(`
      SELECT al.*, u.full_name as user_name, u.badge_number, u.role as user_role
      FROM activity_log al LEFT JOIN users u ON al.user_id = u.id
      ${whereClause} ORDER BY al.created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limitNum, offsetNum);

    return c.json({ data: activity, total: (countRow as any)?.total ?? 0, limit: limitNum, offset: offsetNum });
  });

  app.route('/api/comms', api);
}
