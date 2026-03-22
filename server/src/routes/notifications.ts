import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { sendToUser } from '../utils/websocket';
import { localNow } from '../utils/timeUtils';
import { sendNotificationEmail } from '../utils/emailSender';
import { validateParamId } from '../middleware/sanitize';
import { auditLog } from '../utils/auditLogger';
import { sendCsv } from '../utils/csvExport';

const router = Router();

router.use(authenticateToken);

// ─── USER PREFERENCE HELPERS ─────────────────────────

// Map notification type → user_preferences column prefix
// e.g., type 'dispatch' → checks notify_dispatch_inapp / notify_dispatch_email
const TYPE_TO_PREF_KEY: Record<string, string> = {
  dispatch: 'dispatch',
  bolo: 'bolo',
  warrant: 'warrant',
  system: 'system',
  message: 'system',
  credential_expiry: 'credential',
  patrol_missed: 'dispatch',
  login_alert: 'system',
  security: 'system',
};

/**
 * Check if a user's quiet hours are currently active.
 * quiet_hours_start / quiet_hours_end are stored as "HH:MM" strings.
 */
function isInQuietHours(quietStart: string | null, quietEnd: string | null): boolean {
  if (!quietStart || !quietEnd) return false;
  // Use Mountain Time (America/Denver) — the operational timezone for all RMPG officers
  const now = new Date();
  const mtNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Denver' }));
  const currentMinutes = mtNow.getHours() * 60 + mtNow.getMinutes();

  const sp = quietStart.split(':').map(Number);
  const ep = quietEnd.split(':').map(Number);
  const sh = sp[0], sm = sp[1];
  const eh = ep[0], em = ep[1];
  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return false;
  const start = sh * 60 + sm;
  const end = eh * 60 + em;

  // Handle overnight quiet hours (e.g., 22:00 - 06:00)
  if (start <= end) {
    return currentMinutes >= start && currentMinutes < end;
  }
  return currentMinutes >= start || currentMinutes < end;
}

/**
 * Get a user's notification preferences. Returns null if no preferences
 * are set (meaning all defaults apply — all notifications enabled).
 */
function getUserNotifPrefs(db: any, userId: number): any | null {
  try {
    return db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId) || null;
  } catch {
    return null; // Table may not exist in older DB versions
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
  priority: 'normal' | 'high' | 'critical',
  triggerEvent?: string,
): void {
  try {
    const db = getDb();

    // ── Check user preferences ──
    const prefs = getUserNotifPrefs(db, userId);
    const prefKey = TYPE_TO_PREF_KEY[type] || type;

    // Check quiet hours — critical notifications bypass quiet hours
    if (prefs && priority !== 'critical') {
      if (isInQuietHours(prefs.quiet_hours_start, prefs.quiet_hours_end)) {
        return; // Suppress during quiet hours (non-critical only)
      }
    }

    // Check in-app notification preference
    if (prefs) {
      const inappCol = `notify_${prefKey}_inapp`;
      if (inappCol in prefs && prefs[inappCol] === 0) {
        // User disabled in-app for this type — still check email below
        if (triggerEvent) {
          _sendEmailIfEnabled(db, userId, prefs, prefKey, triggerEvent, title, body);
        }
        return;
      }
    }

    const result = db.prepare(`
      INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id, priority, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, type, title, body, entityType, entityId, priority, localNow());

    const notification = db.prepare(
      'SELECT * FROM notifications WHERE id = ?'
    ).get(Number(result.lastInsertRowid));

    // Send directly to target user — not broadcast to all clients
    if (notification) sendToUser(userId, 'notification', notification);

    // ── Email delivery ──
    if (triggerEvent) {
      _sendEmailIfEnabled(db, userId, prefs, prefKey, triggerEvent, title, body);
    }
  } catch (error: any) {
    console.error('Error creating notification:', error?.message || 'Unknown error');
  }
}

/**
 * Internal: send notification email if user preferences allow it
 * and a matching notification rule exists.
 */
function _sendEmailIfEnabled(
  db: any,
  userId: number,
  prefs: any | null,
  prefKey: string,
  triggerEvent: string,
  title: string,
  body: string | null,
): void {
  // Check email preference — if user disabled email for this type, skip
  if (prefs) {
    const emailCol = `notify_${prefKey}_email`;
    if (emailCol in prefs && prefs[emailCol] === 0) {
      return;
    }
  }

  try {
    const emailRules = db.prepare(`
      SELECT * FROM notification_rules
      WHERE trigger_event = ? AND is_active = 1
        AND notification_type IN ('email', 'both')
    `).all(triggerEvent) as any[];

    for (const rule of emailRules) {
      let isTarget = false;

      try {
        const userIds = JSON.parse(rule.target_user_ids || '[]');
        if (Array.isArray(userIds) && userIds.includes(userId)) {
          isTarget = true;
        }
      } catch { /* ignore parse errors */ }

      if (!isTarget) {
        try {
          const roles = JSON.parse(rule.target_roles || '[]');
          if (Array.isArray(roles) && roles.length > 0) {
            const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any;
            if (user && roles.includes(user.role)) {
              isTarget = true;
            }
          }
        } catch { /* ignore parse errors */ }
      }

      if (isTarget) {
        sendNotificationEmail(userId, title, body || '').catch(err => {
          console.error(`[Notifications] Email delivery failed for user ${userId}:`, err?.message || err);
        });
      }
    }
  } catch (emailErr: any) {
    console.error('[Notifications] Email rule check failed:', emailErr.message);
  }
}

// ─── HELPER: NOTIFY ALL USERS IN GIVEN ROLES ────────

/**
 * Create a notification for every active user whose role matches one of
 * the supplied roles. Optionally excludes a single user (the actor) so
 * they don't notify themselves.
 */
export function createNotificationForRoles(
  roles: string[],
  type: string,
  title: string,
  body: string | null,
  entityType: string | null,
  entityId: number | null,
  priority: 'normal' | 'high' | 'critical',
  triggerEvent?: string,
  excludeUserId?: number,
): void {
  try {
    const db = getDb();
    const placeholders = roles.map(() => '?').join(',');
    const users = db.prepare(
      `SELECT id FROM users WHERE role IN (${placeholders}) AND status = 'active'`
    ).all(...roles) as { id: number }[];

    for (const user of users) {
      if (excludeUserId && user.id === excludeUserId) continue;
      createNotification(user.id, type, title, body, entityType, entityId, priority, triggerEvent);
    }
  } catch (err: any) {
    console.error('[Notifications] createNotificationForRoles failed:', err?.message || err);
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
      const VALID_NOTIF_TYPES = ['dispatch', 'bolo', 'warrant', 'system', 'message', 'credential_expiry', 'patrol_missed', 'login_alert', 'security', 'trespass'];
      if (!VALID_NOTIF_TYPES.includes(String(type))) {
        res.status(400).json({ error: `Invalid notification type. Must be one of: ${VALID_NOTIF_TYPES.join(', ')}` });
        return;
      }
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

    const countRow = db.prepare(`
      SELECT COUNT(*) as total
      FROM notifications n
      ${whereClause}
    `).get(...params) as any;
    const total = countRow?.total || 0;
    const totalPages = Math.ceil(total / perPageNum);

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
    console.error('Get notifications error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
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
    console.error('Get unread count error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/notifications/:id/read - Mark notification as read
router.put('/:id/read', validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();

    const notification = db.prepare(
      'SELECT * FROM notifications WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.user!.userId) as any;

    if (!notification) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }

    if (notification.is_read) {
      res.json({ message: 'Already marked as read' });
      return;
    }

    db.prepare(`
      UPDATE notifications SET is_read = 1 WHERE id = ?
    `).run(req.params.id);

    sendToUser(req.user!.userId, 'notification:read', { id: Number(req.params.id) });

    auditLog(req, 'UPDATE', 'user', req.params.id, `Marked notification #${req.params.id} as read`);

    res.json({ message: 'Marked as read' });
  } catch (error: any) {
    console.error('Mark notification read error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
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

    sendToUser(req.user!.userId, 'notification:allRead', { count: result.changes });

    auditLog(req, 'UPDATE', 'user', req.user!.userId, `Marked all notifications as read (${result.changes} updated)`);

    res.json({ message: 'All notifications marked as read', count: result.changes });
  } catch (error: any) {
    console.error('Mark all read error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/notifications/:id - Delete a notification
router.delete('/:id', validateParamId, (req: Request, res: Response) => {
  try {
    const db = getDb();

    const notification = db.prepare(
      'SELECT * FROM notifications WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.user!.userId) as any;

    if (!notification) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }

    db.prepare('DELETE FROM notifications WHERE id = ?').run(req.params.id);

    sendToUser(req.user!.userId, 'notification:deleted', { id: Number(req.params.id) });

    auditLog(req, 'DELETE', 'user', req.params.id, `Deleted notification #${req.params.id}`);

    res.json({ message: 'Notification deleted' });
  } catch (error: any) {
    console.error('Delete notification error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── CSV EXPORT ──────────────────────────────────────────

// GET /api/notifications/export/csv — Export notification history
router.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT n.id, n.type, n.title, n.body, n.entity_type, n.entity_id,
        n.priority, n.is_read, n.created_at,
        u.full_name as user_name
      FROM notifications n
      LEFT JOIN users u ON n.user_id = u.id
      ORDER BY n.created_at DESC LIMIT 10000
    `).all();
    sendCsv(res, 'notifications_export.csv', [
      { key: 'id', header: 'ID' },
      { key: 'user_name', header: 'User' },
      { key: 'type', header: 'Type' },
      { key: 'title', header: 'Title' },
      { key: 'body', header: 'Body' },
      { key: 'entity_type', header: 'Entity Type' },
      { key: 'entity_id', header: 'Entity ID' },
      { key: 'priority', header: 'Priority' },
      { key: 'is_read', header: 'Read' },
      { key: 'created_at', header: 'Created At' },
    ], rows);
  } catch (error: any) {
    res.status(500).json({ error: 'Export failed' });
  }
});

export default router;
