import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { validateParamId, validateParamIdMiddleware } from '../middleware/sanitize';
import { parseDeviceName, createSecurityNotification } from '../utils/deviceFingerprint';
import { isPasswordExpired, isPasswordExpiringSoon } from '../utils/passwordExpiry';
import { getBlockedIps, unblockIp } from '../middleware/rateLimiter';
import { localNow } from '../utils/timeUtils';
import { auditLog } from '../utils/auditLogger';
import { broadcast } from '../utils/websocket';
import { sendCsv } from '../utils/csvExport';

const router = Router();

// ─── GET /api/auth/security/status ──────────────────
router.get('/status', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;

    const user = db.prepare(`
      SELECT totp_enabled, totp_setup_required, password_expires_at, password_changed_at, force_password_change
      FROM users WHERE id = ?
    `).get(userId) as any;

    const backupCount = db.prepare(
      'SELECT COUNT(*) as count FROM user_backup_codes WHERE user_id = ? AND is_used = 0'
    ).get(userId) as { count: number };

    const sessionCount = db.prepare(
      'SELECT COUNT(*) as count FROM sessions WHERE user_id = ? AND is_active = 1'
    ).get(userId) as { count: number };

    const deviceCount = db.prepare(
      'SELECT COUNT(*) as count FROM trusted_devices WHERE user_id = ? AND trusted_until > ?'
    ).get(userId, localNow()) as { count: number };

    const unreadNotifs = db.prepare(
      'SELECT COUNT(*) as count FROM security_notifications WHERE user_id = ? AND is_read = 0'
    ).get(userId) as { count: number };

    res.json({
      totpEnabled: user?.totp_enabled === 1,
      totpSetupRequired: user?.totp_setup_required === 1,
      backupCodesRemaining: backupCount.count,
      activeSessions: sessionCount.count,
      trustedDevices: deviceCount.count,
      passwordExpiresAt: user?.password_expires_at || null,
      passwordExpiringSoon: user ? isPasswordExpiringSoon(user) : false,
      passwordExpired: user ? isPasswordExpired(user) : false,
      passwordChangedAt: user?.password_changed_at || null,
      forcePasswordChange: user?.force_password_change === 1,
      unreadSecurityNotifications: unreadNotifs.count,
    });
  } catch (error: any) {
    console.error('Security status error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to security status', code: 'SECURITY_STATUS_ERROR' });
  }
});


// ─── GET /api/auth/security/login-history ────────────
router.get('/login-history', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;
    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 200);
    const offset = Math.max(0, Math.min(parseInt(String(req.query.offset || '0'), 10), 10000));

    const userRow = db.prepare('SELECT username FROM users WHERE id = ?')
      .get(userId) as { username: string } | undefined;

    if (!userRow) {
      res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      return;
    }

    const rows = db.prepare(`
      SELECT id, ip_address, user_agent, device_fingerprint, success, failure_reason, created_at
      FROM login_attempts
      WHERE username = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(userRow.username, limit, offset);

    const total = db.prepare(
      'SELECT COUNT(*) as count FROM login_attempts WHERE username = ?'
    ).get(userRow.username) as { count: number };

    res.json({
      entries: rows,
      total: total.count,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error('Login history error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to login history', code: 'LOGIN_HISTORY_ERROR' });
  }
});


// ─── GET /api/auth/security/trusted-devices ──────────
router.get('/trusted-devices', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const devices = db.prepare(`
      SELECT id, device_name, ip_address, trusted_until, last_used_at, created_at
      FROM trusted_devices
      WHERE user_id = ? AND trusted_until > ?
      ORDER BY last_used_at DESC
    
      LIMIT 1000
    `).all(req.user!.userId, localNow());

    res.json(devices);
  } catch (error: any) {
    console.error('Trusted devices error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to trusted devices', code: 'TRUSTED_DEVICES_ERROR' });
  }
});


// ─── DELETE /api/auth/security/trusted-devices/:id ───
router.delete('/trusted-devices/:id', validateParamIdMiddleware, authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const deviceId = parseInt(req.params.id as string, 10);
    if (isNaN(deviceId)) { res.status(400).json({ error: 'Invalid device ID', code: 'INVALID_DEVICE_ID' }); return; }
    const result = db.prepare(
      'DELETE FROM trusted_devices WHERE id = ? AND user_id = ?'
    ).run(deviceId, req.user!.userId);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Device not found', code: 'DEVICE_NOT_FOUND' });
      return;
    }

    createSecurityNotification(
      req.user!.userId,
      'device_revoked',
      'Trusted device removed',
      'A trusted device was removed from your account.',
      req.ip || 'unknown'
    );

    auditLog(req, 'DELETE', 'user', deviceId, `Removed trusted device #${deviceId}`);
    broadcast('admin', 'security:updated', { action: 'device_removed', deviceId });
    res.json({ message: 'Trusted device removed' });
  } catch (error: any) {
    console.error('Remove device error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to remove device', code: 'REMOVE_DEVICE_ERROR' });
  }
});


// ─── GET /api/auth/security/notifications ────────────
router.get('/notifications', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 200);
    const offset = Math.max(0, Math.min(parseInt(String(req.query.offset || '0'), 10), 10000));

    const rows = db.prepare(`
      SELECT id, event_type, title, details, ip_address, device_info, is_read, created_at
      FROM security_notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(req.user!.userId, limit, offset);

    const total = db.prepare(
      'SELECT COUNT(*) as count FROM security_notifications WHERE user_id = ?'
    ).get(req.user!.userId) as { count: number };

    res.json({ notifications: rows, total: total.count, limit, offset });
  } catch (error: any) {
    console.error('Security notifications error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to security notifications', code: 'SECURITY_NOTIFICATIONS_ERROR' });
  }
});


// ─── PUT /api/auth/security/notifications/:id/read ───
router.put('/notifications/:id/read', validateParamIdMiddleware, authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const notifId = parseInt(req.params.id as string, 10);
    if (isNaN(notifId)) { res.status(400).json({ error: 'Invalid notification ID', code: 'INVALID_NOTIFICATION_ID' }); return; }
    const result = db.prepare(
      'UPDATE security_notifications SET is_read = 1 WHERE id = ? AND user_id = ?'
    ).run(notifId, req.user!.userId);

    if (result.changes === 0) { res.status(404).json({ error: 'Notification not found', code: 'NOTIFICATION_NOT_FOUND' }); return; }

    auditLog(req, 'UPDATE', 'user', notifId, `Marked security notification #${notifId} as read`);

    res.json({ message: 'Marked as read' });
  } catch (error: any) {
    console.error('Mark notification read error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to mark notification read', code: 'MARK_NOTIFICATION_READ_ERROR' });
  }
});


// ─── PUT /api/auth/security/notifications/read-all ───
router.put('/notifications/read-all', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare(
      'UPDATE security_notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0'
    ).run(req.user!.userId);

    auditLog(req, 'UPDATE', 'user', req.user!.userId, 'Marked all security notifications as read');

    res.json({ message: 'All marked as read' });
  } catch (error: any) {
    console.error('Mark all read error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to mark all read', code: 'MARK_ALL_READ_ERROR' });
  }
});

// ─── GET /api/auth/security/blocked-ips ──────────────
// Admin-only endpoint to view currently blocked IPs from rate limiter
router.get('/blocked-ips', authenticateToken, requireRole('admin'), (_req: Request, res: Response) => {
  try {
    const blocked = getBlockedIps();
    res.json({ blocked, count: blocked.length });
  } catch (error: any) {
    console.error('Get blocked IPs error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get blocked ips', code: 'GET_BLOCKED_IPS_ERROR' });
  }
});

// ─── POST /api/auth/security/unblock-ip ──────────────
// Admin-only endpoint to unblock a specific IP or all IPs
router.post('/unblock-ip', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { ip } = req.body || {};

    // Validate IP format if provided
    if (ip !== undefined && ip !== null) {
      if (typeof ip !== 'string' || ip.length > 45) {
        res.status(400).json({ error: 'Invalid IP address format', code: 'INVALID_IP_ADDRESS_FORMAT' });
        return;
      }
      // Basic IP format check (IPv4 or IPv6)
      if (!/^[\d.:a-fA-F]+$/.test(ip)) {
        res.status(400).json({ error: 'IP address contains invalid characters', code: 'IP_ADDRESS_CONTAINS_INVALID' });
        return;
      }
    }

    const count = unblockIp(ip || undefined);
    const msg = ip ? `Unblocked IP ${ip}` : `Unblocked all ${count} IPs`;
    console.log(`[Security] ${msg} — by ${req.user!.username}`);

    auditLog(req, 'UPDATE', 'user', 0, msg);
    broadcast('admin', 'security:updated', { action: 'ip_unblocked', ip, count });
    res.json({ success: true, message: msg, unblocked: count });
  } catch (error: any) {
    console.error('Unblock IP error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to unblock ip', code: 'UNBLOCK_IP_ERROR' });
  }
});

// ─── GET /api/auth/security/recent-threats ──────────────
// Admin-only endpoint showing recent login failures grouped by IP
router.get('/recent-threats', authenticateToken, requireRole('admin'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const threats = db.prepare(`
      SELECT ip_address, COUNT(*) as attempts,
        GROUP_CONCAT(DISTINCT username) as targeted_accounts,
        MAX(created_at) as last_attempt
      FROM login_attempts
      WHERE success = 0 AND created_at > datetime('now', 'localtime', '-24 hours')
      GROUP BY ip_address
      HAVING attempts >= 3
      ORDER BY attempts DESC
      LIMIT 50
    `).all();
    res.json(threats);
  } catch (error: any) {
    console.error('Recent threats error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to recent threats', code: 'RECENT_THREATS_ERROR' });
  }
});

// ─── CSV EXPORT ──────────────────────────────────────────

// GET /api/auth/security/export/csv — Export security events (login attempts)
router.get('/export/csv', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, username, ip_address, user_agent, device_fingerprint,
        success, failure_reason, created_at
      FROM login_attempts
      ORDER BY created_at DESC LIMIT 10000
    `).all();
    sendCsv(res, 'security_events_export.csv', [
      { key: 'id', header: 'ID' },
      { key: 'username', header: 'Username' },
      { key: 'ip_address', header: 'IP Address' },
      { key: 'user_agent', header: 'User Agent' },
      { key: 'device_fingerprint', header: 'Device Fingerprint' },
      { key: 'success', header: 'Success' },
      { key: 'failure_reason', header: 'Failure Reason' },
      { key: 'created_at', header: 'Created At' },
    ], rows);
  } catch (error: any) {
    res.status(500).json({ error: 'Export failed', code: 'EXPORT_FAILED' });
  }
});

export default router;
