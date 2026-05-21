// Notifications routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, localNow } from '../worker-middleware/d1Helpers';

export function mountNotificationRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/notifications
  api.get('/', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    try {
      const limit = Math.min(1000, Math.max(1, parseInt(c.req.query('limit') || '100', 10) || 100));
      const rows = await db.prepare(`
        SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
      `).all(user.userId, limit);
      return c.json(rows);
    } catch { return c.json([]); }
  });

  // GET /api/notifications/unread-count
  api.get('/unread-count', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    try {
      const row = await db.prepare("SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND (is_read = 0 OR read_at IS NULL)").get(user.userId) as any;
      return c.json({ count: row?.count || 0 });
    } catch { return c.json({ count: 0 }); }
  });

  // POST /api/notifications/mark-read
  api.post('/mark-read', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    try {
      await db.prepare("UPDATE notifications SET is_read = 1, read_at = ? WHERE user_id = ? AND is_read = 0").run(localNow(), user.userId);
      return c.json({ success: true });
    } catch { return c.json({ error: 'Failed to mark read' }, 500); }
  });

  // GET /api/notifications/rules
  api.get('/rules', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const rows = await db.prepare('SELECT * FROM notification_rules ORDER BY created_at DESC').all();
      return c.json(rows);
    } catch { return c.json([]); }
  });

  app.route('/api/notifications', api);
}
