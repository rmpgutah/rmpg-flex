// Notifications routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken } from '../worker-middleware/auth';
import { D1Db } from '../worker-middleware/d1Helpers';

export function mountNotificationRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/notifications/unread-count
  api.get('/unread-count', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const row = await db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0').get(user.userId) as any;
    return c.json({ count: row?.count || 0 });
  });

  app.route('/api/notifications', api);
}
