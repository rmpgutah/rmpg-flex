// Stub: Personnel routes for Workers (read-only endpoints ported)
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum } from '../worker-middleware/d1Helpers';

export function mountPersonnelRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/personnel/users - List users
  api.get('/users', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    const users = await db.prepare(`SELECT id, username, first_name, last_name, full_name, email, role, badge_number, phone, status, avatar_url, created_at FROM users ORDER BY full_name`).all();
    return c.json(users);
  });

  // GET /api/personnel/users/:id
  api.get('/users/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const user = await db.prepare('SELECT id, username, first_name, last_name, full_name, email, role, badge_number, phone, status, avatar_url, created_at FROM users WHERE id = ?').get(id);
    if (!user) return c.json({ error: 'User not found', code: 'USER_NOT_FOUND' }, 404);
    return c.json(user);
  });

  // GET /api/personnel/roster
  api.get('/roster', async (c) => {
    const db = new D1Db(c.env.DB);
    const roster = await db.prepare(`SELECT id, username, full_name, role, badge_number, status FROM users WHERE status = 'active' ORDER BY badge_number`).all();
    return c.json(roster);
  });

  app.route('/api/personnel', api);
}
