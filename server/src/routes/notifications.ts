import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { broadcast } from '../utils/websocket';
import { localNow } from '../utils/timeUtils';
import { auditLog } from '../utils/auditLogger';

const router = Router();

router.use(authenticateToken);

// Audit 2026-04-11: 3 handlers (snooze, snoozed-due, stats) reference a
// `snoozed_until` column that the notifications table never had. Every
// snooze action returned 500 and notifications stats were broken. The
// canonical lazy column-add pattern lets us survive without a separate
// database.ts migration.
let snoozedUntilEnsured = false;
function ensureSnoozedUntilColumn(db: any) {
  if (snoozedUntilEnsured) return;
  try {
    const cols = db.prepare("PRAGMA table_info(notifications)").all() as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'snoozed_until')) {
      db.prepare("ALTER TABLE notifications ADD COLUMN snoozed_until TEXT").run();
    }
    snoozedUntilEnsured = true;
  } catch (e) {
    // If the table doesn't exist yet (initialization order), try again on next call
  }
}

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
      per_page = '100000',
      type,
      is_read,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const perPageNum = Math.min(100000, Math.max(1, (parseInt(per_page as string, 10)) || 100000));
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
    const id = parseInt(req.params.id as string, 10);
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
    const id = parseInt(req.params.id as string, 10);
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

// ── Upgrade 9: Notification categories ──────────────────────────
router.get('/categories', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const categories = db.prepare(`
      SELECT type as category, COUNT(*) as total,
        SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread
      FROM notifications
      WHERE user_id = ?
      GROUP BY type
      ORDER BY unread DESC, total DESC
    `).all(req.user!.userId);

    res.json({ data: categories });
  } catch (error: any) {
    console.error('Notification categories error:', error);
    res.status(500).json({ error: 'Failed to get categories', code: 'GET_CATEGORIES_ERROR' });
  }
});

// ── Upgrade 10: Snooze / remind later ───────────────────────────
router.put('/:id/snooze', (req: Request, res: Response) => {
  try {
    const db = getDb();
    ensureSnoozedUntilColumn(db);
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid notification ID', code: 'INVALID_NOTIFICATION_ID' }); return; }

    const { snooze_until } = req.body;
    if (!snooze_until) {
      res.status(400).json({ error: 'snooze_until is required (ISO timestamp)', code: 'SNOOZE_UNTIL_REQUIRED' });
      return;
    }

    // Verify ownership
    const notification = db.prepare(
      'SELECT * FROM notifications WHERE id = ? AND user_id = ?'
    ).get(id, req.user!.userId) as any;
    if (!notification) {
      res.status(404).json({ error: 'Notification not found', code: 'NOTIFICATION_NOT_FOUND' });
      return;
    }

    db.prepare('UPDATE notifications SET snoozed_until = ?, is_read = 1 WHERE id = ?')
      .run(snooze_until, id);

    res.json({ message: 'Notification snoozed', snoozed_until: snooze_until });
  } catch (error: any) {
    console.error('Snooze notification error:', error);
    res.status(500).json({ error: 'Failed to snooze notification', code: 'SNOOZE_NOTIFICATION_ERROR' });
  }
});

// ── Upgrade 11: Get snoozed notifications that are now due ──────
router.get('/snoozed-due', (req: Request, res: Response) => {
  try {
    const db = getDb();
    ensureSnoozedUntilColumn(db);
    const now = localNow();

    const due = db.prepare(`
      SELECT * FROM notifications
      WHERE user_id = ? AND snoozed_until IS NOT NULL AND snoozed_until <= ?
      ORDER BY snoozed_until ASC
    `).all(req.user!.userId, now);

    // Clear snooze for due notifications and mark as unread
    if ((due as any[]).length > 0) {
      const ids = (due as any[]).map((n: any) => n.id);
      db.prepare(`
        UPDATE notifications SET snoozed_until = NULL, is_read = 0
        WHERE id IN (${ids.map(() => '?').join(',')})
      `).run(...ids);
    }

    res.json({ data: due, count: (due as any[]).length });
  } catch (error: any) {
    console.error('Snoozed due error:', error);
    res.status(500).json({ error: 'Failed to get snoozed notifications', code: 'GET_SNOOZED_ERROR' });
  }
});

// ── Upgrade 12: Notification preferences per user ───────────────
router.get('/preferences', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const prefs = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'notification_preferences'"
    ).get(`notif_prefs_${req.user!.userId}`) as any;

    const defaults = {
      dispatch_updates: true,
      incident_updates: true,
      bolo_alerts: true,
      system_alerts: true,
      message_notifications: true,
      shift_reminders: true,
      report_notifications: true,
      email_digest: false,
      sound_enabled: true,
      desktop_notifications: true,
      quiet_hours_start: null as string | null,
      quiet_hours_end: null as string | null,
    };

    if (prefs?.config_value) {
      try {
        const saved = JSON.parse(prefs.config_value);
        res.json({ ...defaults, ...saved });
      } catch {
        res.json(defaults);
      }
    } else {
      res.json(defaults);
    }
  } catch (error: any) {
    console.error('Get notification preferences error:', error);
    res.status(500).json({ error: 'Failed to get preferences', code: 'GET_PREFERENCES_ERROR' });
  }
});

router.put('/preferences', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const key = `notif_prefs_${req.user!.userId}`;
    const value = JSON.stringify(req.body);

    // Upsert
    db.prepare(
      "DELETE FROM system_config WHERE config_key = ? AND category = 'notification_preferences'"
    ).run(key);
    db.prepare(`
      INSERT INTO system_config (config_key, config_value, category, sort_order, created_at, updated_at)
      VALUES (?, ?, 'notification_preferences', 0, ?, ?)
    `).run(key, value, now, now);

    res.json({ message: 'Preferences saved', preferences: req.body });
  } catch (error: any) {
    console.error('Save notification preferences error:', error);
    res.status(500).json({ error: 'Failed to save preferences', code: 'SAVE_PREFERENCES_ERROR' });
  }
});

// ── Upgrade 13: Critical alert escalation ───────────────────────
router.post('/escalate', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { notification_id, escalate_to_roles } = req.body;

    if (!notification_id) {
      res.status(400).json({ error: 'notification_id required', code: 'NOTIFICATION_ID_REQUIRED' });
      return;
    }

    const notification = db.prepare('SELECT * FROM notifications WHERE id = ?').get(notification_id) as any;
    if (!notification) {
      res.status(404).json({ error: 'Notification not found', code: 'NOTIFICATION_NOT_FOUND' });
      return;
    }

    const roles = escalate_to_roles || ['admin', 'manager', 'supervisor'];
    const placeholders = roles.map(() => '?').join(',');
    const users = db.prepare(
      `SELECT id FROM users WHERE role IN (${placeholders}) AND status = 'active' AND id != ?`
    ).all(...roles, req.user!.userId) as { id: number }[];

    const now = localNow();
    let created = 0;
    for (const user of users) {
      createNotification(
        user.id,
        'escalation',
        `ESCALATED: ${notification.title}`,
        `Escalated by ${req.user!.fullName}: ${notification.body || notification.title}`,
        notification.entity_type,
        notification.entity_id,
        'critical'
      );
      created++;
    }

    res.json({ message: 'Notification escalated', recipients: created });
  } catch (error: any) {
    console.error('Escalate notification error:', error);
    res.status(500).json({ error: 'Failed to escalate notification', code: 'ESCALATE_NOTIFICATION_ERROR' });
  }
});

// ── Upgrade 14: Notification statistics ─────────────────────────
router.get('/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();
    ensureSnoozedUntilColumn(db);

    const byType = db.prepare(`
      SELECT type, COUNT(*) as total,
        SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread
      FROM notifications WHERE user_id = ?
      GROUP BY type ORDER BY total DESC
    `).all(req.user!.userId);

    const byPriority = db.prepare(`
      SELECT priority, COUNT(*) as total,
        SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread
      FROM notifications WHERE user_id = ?
      GROUP BY priority
    `).all(req.user!.userId);

    const recent7Days = db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM notifications WHERE user_id = ? AND created_at >= datetime('now', '-7 days')
      GROUP BY date ORDER BY date
    `).all(req.user!.userId);

    const totalUnread = db.prepare(`
      SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0
    `).get(req.user!.userId) as any;

    const totalSnoozed = db.prepare(`
      SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND snoozed_until IS NOT NULL AND snoozed_until > ?
    `).get(req.user!.userId, localNow()) as any;

    res.json({
      byType,
      byPriority,
      recent7Days,
      totalUnread: totalUnread?.count || 0,
      totalSnoozed: totalSnoozed?.count || 0,
    });
  } catch (error: any) {
    console.error('Notification stats error:', error);
    res.status(500).json({ error: 'Failed to get notification stats', code: 'NOTIFICATION_STATS_ERROR' });
  }
});

// ── Upgrade 15: Bulk delete old notifications ───────────────────
router.post('/cleanup', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days_old = 30 } = req.body;

    const result = db.prepare(`
      DELETE FROM notifications
      WHERE user_id = ? AND is_read = 1 AND created_at <= datetime('now', '-' || ? || ' days')
    `).run(req.user!.userId, days_old);

    res.json({ deleted: result.changes });
  } catch (error: any) {
    console.error('Cleanup notifications error:', error);
    res.status(500).json({ error: 'Failed to cleanup notifications', code: 'CLEANUP_NOTIFICATIONS_ERROR' });
  }
});

// ── Upgrade 16: Delete all read notifications ───────────────────
router.post('/delete-read', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const result = db.prepare(`
      DELETE FROM notifications WHERE user_id = ? AND is_read = 1
    `).run(req.user!.userId);

    res.json({ deleted: result.changes });
  } catch (error: any) {
    console.error('Delete read error:', error);
    res.status(500).json({ error: 'Failed to delete read notifications', code: 'DELETE_READ_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// GOD MODE: Admin Notification Control
// ════════════════════════════════════════════════════════════

// GET /notifications/admin/all — View all users' notifications
router.get('/admin/all', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(100000, Math.max(1, (parseInt(String(req.query.limit || '100'), 10)) || 100000));
    const offset = parseInt(String(req.query.offset || '0'), 10);
    const userId = req.query.user_id ? parseInt(String(req.query.user_id), 10) : null;

    let where = '1=1';
    const params: any[] = [];
    if (userId) { where += ' AND n.user_id = ?'; params.push(userId); }

    const rows = db.prepare(`
      SELECT n.*, u.username, u.full_name
      FROM notifications n
      LEFT JOIN users u ON n.user_id = u.id
      WHERE ${where}
      ORDER BY n.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const total = (db.prepare(`SELECT COUNT(*) as count FROM notifications n WHERE ${where}`).get(...params) as any)?.count || 0;

    res.json({ notifications: rows, total, limit, offset });
  } catch (error: any) {
    console.error('Admin notifications error:', error);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

// DELETE /notifications/admin/bulk — Bulk delete notifications
router.delete('/admin/bulk', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_id, before_date, type } = req.body || {};

    let where = '1=1';
    const params: any[] = [];
    if (user_id) { where += ' AND user_id = ?'; params.push(user_id); }
    if (before_date) { where += ' AND created_at < ?'; params.push(before_date); }
    if (type) { where += ' AND type = ?'; params.push(type); }

    const result = db.prepare(`DELETE FROM notifications WHERE ${where}`).run(...params);

    auditLog(req, 'ADMIN_BULK_DELETE_NOTIFICATIONS', 'notification', 0,
      `Bulk deleted ${result.changes} notifications (user_id:${user_id || 'all'}, before:${before_date || 'any'}, type:${type || 'all'})`);

    res.json({ success: true, deleted: result.changes });
  } catch (error: any) {
    console.error('Bulk delete notifications error:', error);
    res.status(500).json({ error: 'Failed to bulk delete' });
  }
});

// POST /notifications/admin/broadcast — Send notification to all users or specific roles
router.post('/admin/broadcast', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { title, message, type = 'admin_broadcast', priority = 'normal', target_roles } = req.body;

    if (!title || !message) { res.status(400).json({ error: 'Title and message required' }); return; }

    let users;
    if (target_roles && Array.isArray(target_roles) && target_roles.length > 0) {
      const placeholders = target_roles.map(() => '?').join(',');
      users = db.prepare(`SELECT id FROM users WHERE status = 'active' AND role IN (${placeholders})`).all(...target_roles) as any[];
    } else {
      users = db.prepare("SELECT id FROM users WHERE status = 'active'").all() as any[];
    }

    const now = localNow();
    const insert = db.prepare(`INSERT INTO notifications (user_id, type, title, body, priority, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`);

    const tx = db.transaction(() => {
      for (const u of users) {
        insert.run(u.id, type, title, message, priority, now);
      }
    });
    tx();

    auditLog(req, 'ADMIN_BROADCAST_NOTIFICATION', 'notification', 0,
      `Broadcast to ${users.length} users: "${title}" (roles: ${target_roles?.join(',') || 'all'})`);

    // Also broadcast via WebSocket
    try {
      broadcast('notifications', 'notification:broadcast', { title, message, type, priority, from: req.user!.username });
    } catch {}

    res.json({ success: true, sent_to: users.length });
  } catch (error: any) {
    console.error('Broadcast notification error:', error);
    res.status(500).json({ error: 'Broadcast failed' });
  }
});

export default router;
