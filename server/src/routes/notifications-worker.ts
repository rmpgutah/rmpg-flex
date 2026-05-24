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

  // PUT /api/notifications/:id/read - Mark notification as read
  api.put('/:id/read', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid notification ID', code: 'INVALID_NOTIFICATION_ID' }, 400);

    const notification = await db.prepare(
      'SELECT * FROM notifications WHERE id = ? AND user_id = ?'
    ).get(id, user.userId) as any;

    if (!notification) {
      return c.json({ error: 'Notification not found', code: 'NOTIFICATION_NOT_FOUND' }, 404);
    }

    if (notification.is_read) {
      return c.json({ message: 'Already marked as read' });
    }

    await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id);
    return c.json({ message: 'Marked as read' });
  });

  // POST /api/notifications/mark-all-read
  api.post('/mark-all-read', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const result = await db.prepare(
      'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0'
    ).run(user.userId);
    return c.json({ message: 'All notifications marked as read', count: result.meta.changes });
  });

  app.route('/api/notifications', api);
}
