import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken } from '../middleware/auth';
import { broadcast } from '../utils/websocket';
import { localNow } from '../utils/timeUtils';

const router = Router();

router.use(authenticateToken);

// ─── HELPER: CREATE NOTIFICATION ─────────────────────

export function createNotification(
  userId: number,
  type: string,
  title: string,
  body: string | null,
  entityType: string | null,
  entityId: number | null,
  priority: 'normal' | 'high' | 'critical'
): void {
  try {
    const db = getDb();

    const result = db.prepare(`
      INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id, priority, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, type, title, body, entityType, entityId, priority, localNow());

    const notification = db.prepare(
      'SELECT * FROM notifications WHERE id = ?'
    ).get(result.lastInsertRowid);

    broadcast('notifications', 'notification', { userId, notification });
  } catch (error) {
    console.error('Error creating notification:', error);
  }
}

// ─── HELPER: CREATE NOTIFICATION FOR ROLES ──────────

/**
 * Create a notification for all users matching any of the given roles.
 * Optionally exclude a specific user (e.g. the actor who triggered the event).
 */
export function createNotificationForRoles(
  roles: string[],
  type: string,
  title: string,
  body: string | null,
  entityType: string | null,
  entityId: number | null,
  priority: 'normal' | 'high' | 'critical',
  _eventKey?: string,
  excludeUserId?: number,
): void {
  try {
    const db = getDb();
    const placeholders = roles.map(() => '?').join(',');
    let query = `SELECT id FROM users WHERE role IN (${placeholders}) AND status = 'active'`;
    const params: any[] = [...roles];
    if (excludeUserId) {
      query += ' AND id != ?';
      params.push(excludeUserId);
    }
    const users = db.prepare(query).all(...params) as { id: number }[];
    for (const user of users) {
      createNotification(user.id, type, title, body, entityType, entityId, priority);
    }
  } catch (error) {
    console.error('Error creating notification for roles:', error);
  }
}

// ─── ROUTES ──────────────────────────────────────────

// GET /api/notifications - Get current user's notifications (paginated)
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      page = '1',
      per_page = '25',
      type,
      is_read,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const perPageNum = Math.min(100, Math.max(1, parseInt(per_page as string, 10) || 25));
    const offset = (pageNum - 1) * perPageNum;

    const conditions: string[] = ['n.user_id = ?'];
    const params: any[] = [req.user!.userId];

    if (type) {
      conditions.push('n.type = ?');
      params.push(type);
    }

    if (is_read !== undefined && is_read !== '') {
      const readValue = parseInt(is_read as string, 10);
      if (readValue === 1) {
        conditions.push('n.is_read = 1');
      } else {
        conditions.push('n.is_read = 0');
      }
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // Get total count
    const countRow = db.prepare(`
      SELECT COUNT(*) as total
      FROM notifications n
      ${whereClause}
    `).get(...params) as any;
    const total = countRow?.total || 0;
    const totalPages = Math.ceil(total / perPageNum);

    // Get paginated data
    const data = db.prepare(`
      SELECT
        n.id,
        n.user_id,
        n.type,
        n.title,
        n.body,
        n.entity_type,
        n.entity_id,
        n.priority,
        n.is_read,
        n.created_at
      FROM notifications n
      ${whereClause}
      ORDER BY n.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, perPageNum, offset);

    res.json({
      data,
      pagination: {
        page: pageNum,
        per_page: perPageNum,
        total,
        totalPages,
      },
    });
  } catch (error: any) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to get notifications', code: 'GET_NOTIFICATIONS_ERROR' });
  }
});

// GET /api/notifications/unread-count - Get unread notification count
router.get('/unread-count', (req: Request, res: Response) => {
  try {
    const db = getDb();

    const row = db.prepare(`
      SELECT COUNT(*) as count
      FROM notifications
      WHERE user_id = ? AND is_read = 0
    `).get(req.user!.userId) as any;

    res.json({ count: row?.count || 0 });
  } catch (error: any) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: 'Failed to get unread count', code: 'GET_UNREAD_COUNT_ERROR' });
  }
});

// PUT /api/notifications/:id/read - Mark notification as read
router.put('/:id/read', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid notification ID', code: 'INVALID_NOTIFICATION_ID' }); return; }

    // Verify the notification belongs to the current user
    const notification = db.prepare(
      'SELECT * FROM notifications WHERE id = ? AND user_id = ?'
    ).get(id, req.user!.userId) as any;

    if (!notification) {
      res.status(404).json({ error: 'Notification not found', code: 'NOTIFICATION_NOT_FOUND' });
      return;
    }

    if (notification.is_read) {
      res.json({ message: 'Already marked as read' });
      return;
    }

    db.prepare(`
      UPDATE notifications SET is_read = 1 WHERE id = ?
    `).run(req.params.id);

    res.json({ message: 'Marked as read' });
  } catch (error: any) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Failed to mark notification read', code: 'MARK_NOTIFICATION_READ_ERROR' });
  }
});

// POST /api/notifications/mark-all-read - Mark all notifications as read
router.post('/mark-all-read', (req: Request, res: Response) => {
  try {
    const db = getDb();

    const result = db.prepare(`
      UPDATE notifications SET is_read = 1
      WHERE user_id = ? AND is_read = 0
    `).run(req.user!.userId);

    res.json({ message: 'All notifications marked as read', count: result.changes });
  } catch (error: any) {
    console.error('Mark all read error:', error);
    res.status(500).json({ error: 'Failed to mark all read', code: 'MARK_ALL_READ_ERROR' });
  }
});

// DELETE /api/notifications/:id - Delete a notification
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid notification ID', code: 'INVALID_NOTIFICATION_ID' }); return; }

    // Verify the notification belongs to the current user
    const notification = db.prepare(
      'SELECT * FROM notifications WHERE id = ? AND user_id = ?'
    ).get(id, req.user!.userId) as any;

    if (!notification) {
      res.status(404).json({ error: 'Notification not found', code: 'NOTIFICATION_NOT_FOUND' });
      return;
    }

    db.prepare('DELETE FROM notifications WHERE id = ?').run(req.params.id);

    res.json({ message: 'Notification deleted' });
  } catch (error: any) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: 'Failed to delete notification', code: 'DELETE_NOTIFICATION_ERROR' });
  }
});

export default router;
