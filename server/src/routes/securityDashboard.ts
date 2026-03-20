import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { validateParamId } from '../middleware/sanitize';
import { parseDeviceName, createSecurityNotification } from '../utils/deviceFingerprint';
import { isPasswordExpired, isPasswordExpiringSoon } from '../utils/passwordExpiry';
import { getBlockedIps, unblockIp } from '../middleware/rateLimiter';
import { localNow } from '../utils/timeUtils';

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
    res.status(500).json({ error: 'Internal server error' });
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
      res.status(404).json({ error: 'User not found' });
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
    res.status(500).json({ error: 'Internal server error' });
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
    `).all(req.user!.userId, localNow());

    res.json(devices);
  } catch (error: any) {
    console.error('Trusted devices error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ─── DELETE /api/auth/security/trusted-devices/:id ───
router.delete('/trusted-devices/:id', validateParamId, authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const deviceId = parseInt(req.params.id as string, 10);
    if (isNaN(deviceId)) { res.status(400).json({ error: 'Invalid device ID' }); return; }
    const result = db.prepare(
      'DELETE FROM trusted_devices WHERE id = ? AND user_id = ?'
    ).run(deviceId, req.user!.userId);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }

    createSecurityNotification(
      req.user!.userId,
      'device_revoked',
      'Trusted device removed',
      'A trusted device was removed from your account.',
      req.ip || 'unknown'
    );

    res.json({ message: 'Trusted device removed' });
  } catch (error: any) {
    console.error('Remove device error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ─── PUT /api/auth/security/notifications/:id/read ───
router.put('/notifications/:id/read', validateParamId, authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const notifId = parseInt(req.params.id as string, 10);
    if (isNaN(notifId)) { res.status(400).json({ error: 'Invalid notification ID' }); return; }
    const result = db.prepare(
      'UPDATE security_notifications SET is_read = 1 WHERE id = ? AND user_id = ?'
    ).run(notifId, req.user!.userId);

    if (result.changes === 0) { res.status(404).json({ error: 'Notification not found' }); return; }
    res.json({ message: 'Marked as read' });
  } catch (error: any) {
    console.error('Mark notification read error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ─── PUT /api/auth/security/notifications/read-all ───
router.put('/notifications/read-all', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare(
      'UPDATE security_notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0'
    ).run(req.user!.userId);

    res.json({ message: 'All marked as read' });
  } catch (error: any) {
    console.error('Mark all read error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/security/unblock-ip ──────────────
// Admin-only endpoint to unblock a specific IP or all IPs
router.post('/unblock-ip', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { ip } = req.body || {};
    const count = unblockIp(ip || undefined);
    const msg = ip ? `Unblocked IP ${ip}` : `Unblocked all ${count} IPs`;
    console.log(`[Security] ${msg} — by ${req.user!.username}`);
    res.json({ success: true, message: msg, unblocked: count });
  } catch (error: any) {
    console.error('Unblock IP error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/auth/security/recent-threats ──────────────
// Admin-only endpoint showing recent login failures grouped by IP
router.get('/recent-threats', authenticateToken, requireRole('admin'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    // Compute 24-hours-ago in local time with timezone offset (matching localNow() format)
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const offsetMin = cutoff.getTimezoneOffset();
    const sign = offsetMin <= 0 ? '+' : '-';
    const absOffset = Math.abs(offsetMin);
    const cutoffStr = `${cutoff.getFullYear()}-${pad(cutoff.getMonth() + 1)}-${pad(cutoff.getDate())}T${pad(cutoff.getHours())}:${pad(cutoff.getMinutes())}:${pad(cutoff.getSeconds())}${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`;

    const threats = db.prepare(`
      SELECT ip_address, COUNT(*) as attempts,
        GROUP_CONCAT(DISTINCT username) as targeted_accounts,
        MAX(created_at) as last_attempt
      FROM login_attempts
      WHERE success = 0 AND created_at > ?
      GROUP BY ip_address
      HAVING attempts >= 3
      ORDER BY attempts DESC
      LIMIT 50
    `).all(cutoffStr);
    res.json(threats);
  } catch (error: any) {
    console.error('Recent threats error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
