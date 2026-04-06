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
<<<<<<< HEAD
    res.status(500).json({ error: 'Internal server error' });
=======
    res.status(500).json({ error: 'Failed to get security status', code: 'SECURITY_STATUS_ERROR' });
>>>>>>> origin/main
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
<<<<<<< HEAD
    res.status(500).json({ error: 'Internal server error' });
=======
    res.status(500).json({ error: 'Failed to get login history', code: 'LOGIN_HISTORY_ERROR' });
>>>>>>> origin/main
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
<<<<<<< HEAD
    res.status(500).json({ error: 'Internal server error' });
=======
    res.status(500).json({ error: 'Failed to get trusted devices', code: 'TRUSTED_DEVICES_ERROR' });
>>>>>>> origin/main
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
<<<<<<< HEAD
    res.status(500).json({ error: 'Internal server error' });
=======
    res.status(500).json({ error: 'Failed to remove device', code: 'REMOVE_DEVICE_ERROR' });
>>>>>>> origin/main
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
<<<<<<< HEAD
    res.status(500).json({ error: 'Internal server error' });
=======
    res.status(500).json({ error: 'Failed to get security notifications', code: 'SECURITY_NOTIFICATIONS_ERROR' });
>>>>>>> origin/main
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
<<<<<<< HEAD
    res.status(500).json({ error: 'Internal server error' });
=======
    res.status(500).json({ error: 'Failed to mark notification read', code: 'MARK_NOTIFICATION_READ_ERROR' });
>>>>>>> origin/main
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
<<<<<<< HEAD
    res.status(500).json({ error: 'Internal server error' });
=======
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
    res.status(500).json({ error: 'Failed to get recent threats', code: 'RECENT_THREATS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 1: Failed Login Heatmap Data
// Returns failed login attempts grouped by hour-of-day and day-of-week
// for rendering a heatmap visualization on the security dashboard.
// ════════════════════════════════════════════════════════════
router.get('/failed-login-heatmap', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.min(90, Math.max(1, parseInt(String(req.query.days || '30'), 10)));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Group failed logins by hour and day-of-week (0=Sunday)
    const heatmapData = db.prepare(`
      SELECT
        CAST(strftime('%w', created_at) AS INTEGER) as day_of_week,
        CAST(strftime('%H', created_at) AS INTEGER) as hour,
        COUNT(*) as count
      FROM login_attempts
      WHERE success = 0 AND created_at >= ?
      GROUP BY day_of_week, hour
      ORDER BY day_of_week, hour
    `).all(cutoff) as { day_of_week: number; hour: number; count: number }[];

    // Also provide daily totals for sparkline
    const dailyTotals = db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM login_attempts
      WHERE success = 0 AND created_at >= ?
      GROUP BY DATE(created_at)
      ORDER BY date
    `).all(cutoff) as { date: string; count: number }[];

    // Peak failure hour
    const peakHour = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
      FROM login_attempts
      WHERE success = 0 AND created_at >= ?
      GROUP BY hour ORDER BY count DESC LIMIT 1
    `).get(cutoff) as { hour: number; count: number } | undefined;

    res.json({
      heatmap: heatmapData,
      daily_totals: dailyTotals,
      peak_hour: peakHour || null,
      period_days: days,
    });
  } catch (error: any) {
    console.error('Failed login heatmap error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get login heatmap', code: 'LOGIN_HEATMAP_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 2: Suspicious Activity Scoring
// Calculates a risk score for each IP or user based on patterns.
// ════════════════════════════════════════════════════════════
router.get('/suspicious-activity', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Score IPs: weight by failures, targeted accounts, time clustering
    const ipScores = db.prepare(`
      SELECT
        ip_address,
        COUNT(*) as total_attempts,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
        COUNT(DISTINCT username) as unique_accounts_targeted,
        MAX(created_at) as last_attempt,
        MIN(created_at) as first_attempt
      FROM login_attempts
      WHERE created_at >= ?
      GROUP BY ip_address
      HAVING failures >= 2
      ORDER BY failures DESC
      LIMIT 50
    `).all(cutoff7d) as any[];

    const scoredIps = ipScores.map((ip: any) => {
      let score = 0;
      // High failure count
      score += Math.min(ip.failures * 10, 50);
      // Multiple accounts targeted = credential stuffing
      score += Math.min(ip.unique_accounts_targeted * 15, 45);
      // No successful logins = likely attacker
      if (ip.successes === 0) score += 20;
      // Rapid-fire attempts (many in short window)
      const spanMs = new Date(ip.last_attempt).getTime() - new Date(ip.first_attempt).getTime();
      const spanHours = spanMs / (60 * 60 * 1000);
      if (spanHours > 0 && ip.failures / spanHours > 10) score += 25;

      return {
        ip_address: ip.ip_address,
        total_attempts: ip.total_attempts,
        failures: ip.failures,
        successes: ip.successes,
        unique_accounts_targeted: ip.unique_accounts_targeted,
        last_attempt: ip.last_attempt,
        risk_score: Math.min(score, 100),
        risk_level: score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low',
      };
    });

    // Score users: multiple failures, after-hours logins
    const userScores = db.prepare(`
      SELECT
        username,
        COUNT(*) as total_attempts,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
        COUNT(DISTINCT ip_address) as unique_ips,
        MAX(created_at) as last_attempt
      FROM login_attempts
      WHERE created_at >= ?
      GROUP BY username
      HAVING failures >= 3
      ORDER BY failures DESC
      LIMIT 50
    `).all(cutoff7d) as any[];

    const scoredUsers = userScores.map((u: any) => {
      let score = 0;
      score += Math.min(u.failures * 5, 30);
      score += Math.min(u.unique_ips * 10, 40);
      // Lots of IPs trying same account = distributed attack
      if (u.unique_ips >= 5) score += 30;
      return {
        username: u.username,
        total_attempts: u.total_attempts,
        failures: u.failures,
        unique_ips: u.unique_ips,
        last_attempt: u.last_attempt,
        risk_score: Math.min(score, 100),
        risk_level: score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low',
      };
    });

    res.json({
      ip_risks: scoredIps.sort((a, b) => b.risk_score - a.risk_score),
      user_risks: scoredUsers.sort((a, b) => b.risk_score - a.risk_score),
      summary: {
        critical_ips: scoredIps.filter(i => i.risk_level === 'critical').length,
        high_risk_ips: scoredIps.filter(i => i.risk_level === 'high').length,
        critical_users: scoredUsers.filter(u => u.risk_level === 'critical').length,
      },
    });
  } catch (error: any) {
    console.error('Suspicious activity error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get suspicious activity', code: 'SUSPICIOUS_ACTIVITY_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 3: IP Geolocation for Login Attempts
// Returns login attempts with basic geo derived from IP ranges.
// Uses a simple mapping approach (no external API).
// ════════════════════════════════════════════════════════════
router.get('/login-geo', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(String(req.query.limit || '100'), 10), 500);
    const onlyFailed = req.query.only_failed === '1' || req.query.only_failed === 'true';

    let where = "WHERE created_at >= datetime('now', 'localtime', '-30 days')";
    if (onlyFailed) where += ' AND success = 0';

    const attempts = db.prepare(`
      SELECT ip_address, username, success, failure_reason, user_agent, created_at
      FROM login_attempts
      ${where}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as any[];

    // Simple IP classification (private vs public ranges)
    const geoAttempts = attempts.map((a: any) => {
      const ip = a.ip_address || '';
      let geo_type = 'public';
      let geo_label = 'External';
      if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.16.') ||
          ip.startsWith('172.17.') || ip.startsWith('172.18.') || ip.startsWith('172.19.') ||
          ip.startsWith('172.2') || ip.startsWith('172.3') ||
          ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
        geo_type = 'local';
        geo_label = 'Internal Network';
      }
      return {
        ...a,
        geo_type,
        geo_label,
        // Parse basic browser info from user_agent
        browser: parseBrowserFromUA(a.user_agent || ''),
      };
    });

    // Group by IP for summary
    const ipSummary: Record<string, { count: number; failures: number; last_seen: string }> = {};
    for (const a of geoAttempts) {
      const key = a.ip_address || 'unknown';
      if (!ipSummary[key]) ipSummary[key] = { count: 0, failures: 0, last_seen: a.created_at };
      ipSummary[key].count++;
      if (!a.success) ipSummary[key].failures++;
      if (a.created_at > ipSummary[key].last_seen) ipSummary[key].last_seen = a.created_at;
    }

    res.json({
      attempts: geoAttempts,
      ip_summary: Object.entries(ipSummary).map(([ip, data]) => ({ ip_address: ip, ...data })),
    });
  } catch (error: any) {
    console.error('Login geo error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get login geo data', code: 'LOGIN_GEO_ERROR' });
  }
});

/** Parse basic browser name from user agent string */
function parseBrowserFromUA(ua: string): string {
  if (!ua) return 'Unknown';
  if (ua.includes('Electron')) return 'RMPG Desktop';
  if (ua.includes('Edg/')) return 'Edge';
  if (ua.includes('Chrome/')) return 'Chrome';
  if (ua.includes('Firefox/')) return 'Firefox';
  if (ua.includes('Safari/') && !ua.includes('Chrome')) return 'Safari';
  if (ua.includes('okhttp') || ua.includes('Capacitor')) return 'RMPG Mobile';
  return 'Other';
}

// ════════════════════════════════════════════════════════════
// UPGRADE 4: Security Event Timeline
// Returns a chronological timeline of all security-relevant
// events (logins, lockouts, device changes, password changes).
// ════════════════════════════════════════════════════════════
router.get('/event-timeline', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(String(req.query.limit || '100'), 10), 500);
    const days = Math.min(90, Math.max(1, parseInt(String(req.query.days || '7'), 10)));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Combine multiple event sources into a unified timeline
    const events: any[] = [];

    // 1. Login attempts (both success and failure)
    const logins = db.prepare(`
      SELECT 'login_attempt' as event_type, username as actor,
        ip_address, success, failure_reason as detail, created_at as event_time
      FROM login_attempts
      WHERE created_at >= ?
      ORDER BY created_at DESC LIMIT ?
    `).all(cutoff, limit) as any[];
    for (const l of logins) {
      events.push({
        event_type: l.success ? 'login_success' : 'login_failure',
        actor: l.actor,
        ip_address: l.ip_address,
        detail: l.success ? 'Successful login' : `Failed: ${l.detail || 'invalid credentials'}`,
        severity: l.success ? 'info' : 'warning',
        event_time: l.event_time,
      });
    }

    // 2. Security notifications (device revoked, password changes, etc.)
    const notifications = db.prepare(`
      SELECT sn.event_type, sn.title, sn.details as detail, sn.ip_address,
        sn.created_at as event_time, u.username as actor
      FROM security_notifications sn
      LEFT JOIN users u ON sn.user_id = u.id
      WHERE sn.created_at >= ?
      ORDER BY sn.created_at DESC LIMIT ?
    `).all(cutoff, limit) as any[];
    for (const n of notifications) {
      events.push({
        event_type: n.event_type || 'security_notification',
        actor: n.actor || 'system',
        ip_address: n.ip_address,
        detail: n.detail || n.title,
        severity: 'medium',
        event_time: n.event_time,
      });
    }

    // 3. Admin security actions from activity_log
    const adminActions = db.prepare(`
      SELECT al.action as event_type, al.details as detail, al.ip_address,
        al.created_at as event_time, u.username as actor
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.created_at >= ?
        AND al.action IN ('user_login', 'user_logout', 'password_changed', 'totp_enabled',
          'totp_disabled', 'user_created', 'user_deactivated', 'user_role_changed',
          'user_login_trusted_device', 'force_password_change')
      ORDER BY al.created_at DESC LIMIT ?
    `).all(cutoff, limit) as any[];
    for (const a of adminActions) {
      events.push({
        event_type: a.event_type,
        actor: a.actor || 'system',
        ip_address: a.ip_address,
        detail: a.detail,
        severity: ['user_deactivated', 'totp_disabled', 'force_password_change'].includes(a.event_type) ? 'high' : 'info',
        event_time: a.event_time,
      });
    }

    // Sort by event_time descending and limit
    events.sort((a, b) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime());
    const trimmed = events.slice(0, limit);

    res.json({
      events: trimmed,
      total: trimmed.length,
      period_days: days,
    });
  } catch (error: any) {
    console.error('Security event timeline error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get event timeline', code: 'EVENT_TIMELINE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 5: Session Analytics
// Provides stats about active sessions across all users.
// ════════════════════════════════════════════════════════════
router.get('/session-analytics', authenticateToken, requireRole('admin'), (_req: Request, res: Response) => {
  try {
    const db = getDb();

    const totalActive = db.prepare(
      'SELECT COUNT(*) as count FROM sessions WHERE is_active = 1'
    ).get() as { count: number };

    const byUser = db.prepare(`
      SELECT u.username, u.full_name, u.role, COUNT(*) as session_count,
        MAX(s.last_used_at) as last_active
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.is_active = 1
      GROUP BY s.user_id
      ORDER BY session_count DESC
      LIMIT 50
    `).all() as any[];

    const stale = db.prepare(`
      SELECT COUNT(*) as count FROM sessions
      WHERE is_active = 1 AND last_used_at < datetime('now', '-24 hours')
    `).get() as { count: number };

    res.json({
      total_active_sessions: totalActive.count,
      stale_sessions: stale.count,
      sessions_by_user: byUser,
    });
  } catch (error: any) {
    console.error('Session analytics error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get session analytics', code: 'SESSION_ANALYTICS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 6: Password Compliance Report
// Shows which users have expired/expiring passwords,
// users who haven't changed passwords recently, etc.
// ════════════════════════════════════════════════════════════
router.get('/password-compliance', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (_req: Request, res: Response) => {
  try {
    const db = getDb();

    const users = db.prepare(`
      SELECT id, username, full_name, role, status, password_changed_at,
        password_expires_at, force_password_change, totp_enabled, last_login_at
      FROM users WHERE status = 'active'
      ORDER BY password_changed_at ASC
    `).all() as any[];

    const now = new Date();
    const report = users.map((u: any) => {
      const changedAt = u.password_changed_at ? new Date(u.password_changed_at) : null;
      const daysSinceChange = changedAt ? Math.floor((now.getTime() - changedAt.getTime()) / (24 * 60 * 60 * 1000)) : null;
      const expired = u.password_expires_at ? new Date(u.password_expires_at) < now : false;
      const expiringSoon = u.password_expires_at
        ? new Date(u.password_expires_at).getTime() - now.getTime() < 14 * 24 * 60 * 60 * 1000 && !expired
        : false;

      return {
        user_id: u.id,
        username: u.username,
        full_name: u.full_name,
        role: u.role,
        password_changed_at: u.password_changed_at,
        days_since_change: daysSinceChange,
        password_expired: expired,
        password_expiring_soon: expiringSoon,
        force_change_required: u.force_password_change === 1,
        totp_enabled: u.totp_enabled === 1,
        last_login: u.last_login_at,
      };
    });

    const summary = {
      total_active_users: report.length,
      passwords_expired: report.filter(r => r.password_expired).length,
      passwords_expiring_soon: report.filter(r => r.password_expiring_soon).length,
      force_change_pending: report.filter(r => r.force_change_required).length,
      totp_enabled_count: report.filter(r => r.totp_enabled).length,
      totp_disabled_count: report.filter(r => !r.totp_enabled).length,
    };

    res.json({ users: report, summary });
  } catch (error: any) {
    console.error('Password compliance error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get password compliance', code: 'PASSWORD_COMPLIANCE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 1: Failed Login Heatmap Data
// Returns failed login attempts grouped by hour-of-day and day-of-week
// for rendering a heatmap visualization on the security dashboard.
// ════════════════════════════════════════════════════════════
router.get('/failed-login-heatmap', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.min(90, Math.max(1, parseInt(String(req.query.days || '30'), 10)));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Group failed logins by hour and day-of-week (0=Sunday)
    const heatmapData = db.prepare(`
      SELECT
        CAST(strftime('%w', created_at) AS INTEGER) as day_of_week,
        CAST(strftime('%H', created_at) AS INTEGER) as hour,
        COUNT(*) as count
      FROM login_attempts
      WHERE success = 0 AND created_at >= ?
      GROUP BY day_of_week, hour
      ORDER BY day_of_week, hour
    `).all(cutoff) as { day_of_week: number; hour: number; count: number }[];

    // Also provide daily totals for sparkline
    const dailyTotals = db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM login_attempts
      WHERE success = 0 AND created_at >= ?
      GROUP BY DATE(created_at)
      ORDER BY date
    `).all(cutoff) as { date: string; count: number }[];

    // Peak failure hour
    const peakHour = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
      FROM login_attempts
      WHERE success = 0 AND created_at >= ?
      GROUP BY hour ORDER BY count DESC LIMIT 1
    `).get(cutoff) as { hour: number; count: number } | undefined;

    res.json({
      heatmap: heatmapData,
      daily_totals: dailyTotals,
      peak_hour: peakHour || null,
      period_days: days,
    });
  } catch (error: any) {
    console.error('Failed login heatmap error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get login heatmap', code: 'LOGIN_HEATMAP_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 2: Suspicious Activity Scoring
// Calculates a risk score for each IP or user based on patterns.
// ════════════════════════════════════════════════════════════
router.get('/suspicious-activity', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Score IPs: weight by failures, targeted accounts, time clustering
    const ipScores = db.prepare(`
      SELECT
        ip_address,
        COUNT(*) as total_attempts,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
        COUNT(DISTINCT username) as unique_accounts_targeted,
        MAX(created_at) as last_attempt,
        MIN(created_at) as first_attempt
      FROM login_attempts
      WHERE created_at >= ?
      GROUP BY ip_address
      HAVING failures >= 2
      ORDER BY failures DESC
      LIMIT 50
    `).all(cutoff7d) as any[];

    const scoredIps = ipScores.map((ip: any) => {
      let score = 0;
      // High failure count
      score += Math.min(ip.failures * 10, 50);
      // Multiple accounts targeted = credential stuffing
      score += Math.min(ip.unique_accounts_targeted * 15, 45);
      // No successful logins = likely attacker
      if (ip.successes === 0) score += 20;
      // Rapid-fire attempts (many in short window)
      const spanMs = new Date(ip.last_attempt).getTime() - new Date(ip.first_attempt).getTime();
      const spanHours = spanMs / (60 * 60 * 1000);
      if (spanHours > 0 && ip.failures / spanHours > 10) score += 25;

      return {
        ip_address: ip.ip_address,
        total_attempts: ip.total_attempts,
        failures: ip.failures,
        successes: ip.successes,
        unique_accounts_targeted: ip.unique_accounts_targeted,
        last_attempt: ip.last_attempt,
        risk_score: Math.min(score, 100),
        risk_level: score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low',
      };
    });

    // Score users: multiple failures, after-hours logins
    const userScores = db.prepare(`
      SELECT
        username,
        COUNT(*) as total_attempts,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
        COUNT(DISTINCT ip_address) as unique_ips,
        MAX(created_at) as last_attempt
      FROM login_attempts
      WHERE created_at >= ?
      GROUP BY username
      HAVING failures >= 3
      ORDER BY failures DESC
      LIMIT 50
    `).all(cutoff7d) as any[];

    const scoredUsers = userScores.map((u: any) => {
      let score = 0;
      score += Math.min(u.failures * 5, 30);
      score += Math.min(u.unique_ips * 10, 40);
      // Lots of IPs trying same account = distributed attack
      if (u.unique_ips >= 5) score += 30;
      return {
        username: u.username,
        total_attempts: u.total_attempts,
        failures: u.failures,
        unique_ips: u.unique_ips,
        last_attempt: u.last_attempt,
        risk_score: Math.min(score, 100),
        risk_level: score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low',
      };
    });

    res.json({
      ip_risks: scoredIps.sort((a, b) => b.risk_score - a.risk_score),
      user_risks: scoredUsers.sort((a, b) => b.risk_score - a.risk_score),
      summary: {
        critical_ips: scoredIps.filter(i => i.risk_level === 'critical').length,
        high_risk_ips: scoredIps.filter(i => i.risk_level === 'high').length,
        critical_users: scoredUsers.filter(u => u.risk_level === 'critical').length,
      },
    });
  } catch (error: any) {
    console.error('Suspicious activity error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get suspicious activity', code: 'SUSPICIOUS_ACTIVITY_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 3: IP Geolocation for Login Attempts
// Returns login attempts with basic geo derived from IP ranges.
// Uses a simple mapping approach (no external API).
// ════════════════════════════════════════════════════════════
router.get('/login-geo', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(String(req.query.limit || '100'), 10), 500);
    const onlyFailed = req.query.only_failed === '1' || req.query.only_failed === 'true';

    let where = "WHERE created_at >= datetime('now', 'localtime', '-30 days')";
    if (onlyFailed) where += ' AND success = 0';

    const attempts = db.prepare(`
      SELECT ip_address, username, success, failure_reason, user_agent, created_at
      FROM login_attempts
      ${where}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as any[];

    // Simple IP classification (private vs public ranges)
    const geoAttempts = attempts.map((a: any) => {
      const ip = a.ip_address || '';
      let geo_type = 'public';
      let geo_label = 'External';
      if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.16.') ||
          ip.startsWith('172.17.') || ip.startsWith('172.18.') || ip.startsWith('172.19.') ||
          ip.startsWith('172.2') || ip.startsWith('172.3') ||
          ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
        geo_type = 'local';
        geo_label = 'Internal Network';
      }
      return {
        ...a,
        geo_type,
        geo_label,
        // Parse basic browser info from user_agent
        browser: parseBrowserFromUA(a.user_agent || ''),
      };
    });

    // Group by IP for summary
    const ipSummary: Record<string, { count: number; failures: number; last_seen: string }> = {};
    for (const a of geoAttempts) {
      const key = a.ip_address || 'unknown';
      if (!ipSummary[key]) ipSummary[key] = { count: 0, failures: 0, last_seen: a.created_at };
      ipSummary[key].count++;
      if (!a.success) ipSummary[key].failures++;
      if (a.created_at > ipSummary[key].last_seen) ipSummary[key].last_seen = a.created_at;
    }

    res.json({
      attempts: geoAttempts,
      ip_summary: Object.entries(ipSummary).map(([ip, data]) => ({ ip_address: ip, ...data })),
    });
  } catch (error: any) {
    console.error('Login geo error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get login geo data', code: 'LOGIN_GEO_ERROR' });
  }
});


// ════════════════════════════════════════════════════════════
// UPGRADE 4: Security Event Timeline
// Returns a chronological timeline of all security-relevant
// events (logins, lockouts, device changes, password changes).
// ════════════════════════════════════════════════════════════
router.get('/event-timeline', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(String(req.query.limit || '100'), 10), 500);
    const days = Math.min(90, Math.max(1, parseInt(String(req.query.days || '7'), 10)));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Combine multiple event sources into a unified timeline
    const events: any[] = [];

    // 1. Login attempts (both success and failure)
    const logins = db.prepare(`
      SELECT 'login_attempt' as event_type, username as actor,
        ip_address, success, failure_reason as detail, created_at as event_time
      FROM login_attempts
      WHERE created_at >= ?
      ORDER BY created_at DESC LIMIT ?
    `).all(cutoff, limit) as any[];
    for (const l of logins) {
      events.push({
        event_type: l.success ? 'login_success' : 'login_failure',
        actor: l.actor,
        ip_address: l.ip_address,
        detail: l.success ? 'Successful login' : `Failed: ${l.detail || 'invalid credentials'}`,
        severity: l.success ? 'info' : 'warning',
        event_time: l.event_time,
      });
    }

    // 2. Security notifications (device revoked, password changes, etc.)
    const notifications = db.prepare(`
      SELECT sn.event_type, sn.title, sn.details as detail, sn.ip_address,
        sn.created_at as event_time, u.username as actor
      FROM security_notifications sn
      LEFT JOIN users u ON sn.user_id = u.id
      WHERE sn.created_at >= ?
      ORDER BY sn.created_at DESC LIMIT ?
    `).all(cutoff, limit) as any[];
    for (const n of notifications) {
      events.push({
        event_type: n.event_type || 'security_notification',
        actor: n.actor || 'system',
        ip_address: n.ip_address,
        detail: n.detail || n.title,
        severity: 'medium',
        event_time: n.event_time,
      });
    }

    // 3. Admin security actions from activity_log
    const adminActions = db.prepare(`
      SELECT al.action as event_type, al.details as detail, al.ip_address,
        al.created_at as event_time, u.username as actor
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.created_at >= ?
        AND al.action IN ('user_login', 'user_logout', 'password_changed', 'totp_enabled',
          'totp_disabled', 'user_created', 'user_deactivated', 'user_role_changed',
          'user_login_trusted_device', 'force_password_change')
      ORDER BY al.created_at DESC LIMIT ?
    `).all(cutoff, limit) as any[];
    for (const a of adminActions) {
      events.push({
        event_type: a.event_type,
        actor: a.actor || 'system',
        ip_address: a.ip_address,
        detail: a.detail,
        severity: ['user_deactivated', 'totp_disabled', 'force_password_change'].includes(a.event_type) ? 'high' : 'info',
        event_time: a.event_time,
      });
    }

    // Sort by event_time descending and limit
    events.sort((a, b) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime());
    const trimmed = events.slice(0, limit);

    res.json({
      events: trimmed,
      total: trimmed.length,
      period_days: days,
    });
  } catch (error: any) {
    console.error('Security event timeline error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get event timeline', code: 'EVENT_TIMELINE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 5: Session Analytics
// Provides stats about active sessions across all users.
// ════════════════════════════════════════════════════════════
router.get('/session-analytics', authenticateToken, requireRole('admin'), (_req: Request, res: Response) => {
  try {
    const db = getDb();

    const totalActive = db.prepare(
      'SELECT COUNT(*) as count FROM sessions WHERE is_active = 1'
    ).get() as { count: number };

    const byUser = db.prepare(`
      SELECT u.username, u.full_name, u.role, COUNT(*) as session_count,
        MAX(s.last_used_at) as last_active
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.is_active = 1
      GROUP BY s.user_id
      ORDER BY session_count DESC
      LIMIT 50
    `).all() as any[];

    const stale = db.prepare(`
      SELECT COUNT(*) as count FROM sessions
      WHERE is_active = 1 AND last_used_at < datetime('now', '-24 hours')
    `).get() as { count: number };

    res.json({
      total_active_sessions: totalActive.count,
      stale_sessions: stale.count,
      sessions_by_user: byUser,
    });
  } catch (error: any) {
    console.error('Session analytics error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get session analytics', code: 'SESSION_ANALYTICS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 6: Password Compliance Report
// Shows which users have expired/expiring passwords,
// users who haven't changed passwords recently, etc.
// ════════════════════════════════════════════════════════════
router.get('/password-compliance', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (_req: Request, res: Response) => {
  try {
    const db = getDb();

    const users = db.prepare(`
      SELECT id, username, full_name, role, status, password_changed_at,
        password_expires_at, force_password_change, totp_enabled, last_login_at
      FROM users WHERE status = 'active'
      ORDER BY password_changed_at ASC
    `).all() as any[];

    const now = new Date();
    const report = users.map((u: any) => {
      const changedAt = u.password_changed_at ? new Date(u.password_changed_at) : null;
      const daysSinceChange = changedAt ? Math.floor((now.getTime() - changedAt.getTime()) / (24 * 60 * 60 * 1000)) : null;
      const expired = u.password_expires_at ? new Date(u.password_expires_at) < now : false;
      const expiringSoon = u.password_expires_at
        ? new Date(u.password_expires_at).getTime() - now.getTime() < 14 * 24 * 60 * 60 * 1000 && !expired
        : false;

      return {
        user_id: u.id,
        username: u.username,
        full_name: u.full_name,
        role: u.role,
        password_changed_at: u.password_changed_at,
        days_since_change: daysSinceChange,
        password_expired: expired,
        password_expiring_soon: expiringSoon,
        force_change_required: u.force_password_change === 1,
        totp_enabled: u.totp_enabled === 1,
        last_login: u.last_login_at,
      };
    });

    const summary = {
      total_active_users: report.length,
      passwords_expired: report.filter(r => r.password_expired).length,
      passwords_expiring_soon: report.filter(r => r.password_expiring_soon).length,
      force_change_pending: report.filter(r => r.force_change_required).length,
      totp_enabled_count: report.filter(r => r.totp_enabled).length,
      totp_disabled_count: report.filter(r => !r.totp_enabled).length,
    };

    res.json({ users: report, summary });
  } catch (error: any) {
    console.error('Password compliance error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get password compliance', code: 'PASSWORD_COMPLIANCE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 1: Failed Login Heatmap Data
// Returns failed login attempts grouped by hour-of-day and day-of-week
// for rendering a heatmap visualization on the security dashboard.
// ════════════════════════════════════════════════════════════
router.get('/failed-login-heatmap', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.min(90, Math.max(1, parseInt(String(req.query.days || '30'), 10)));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Group failed logins by hour and day-of-week (0=Sunday)
    const heatmapData = db.prepare(`
      SELECT
        CAST(strftime('%w', created_at) AS INTEGER) as day_of_week,
        CAST(strftime('%H', created_at) AS INTEGER) as hour,
        COUNT(*) as count
      FROM login_attempts
      WHERE success = 0 AND created_at >= ?
      GROUP BY day_of_week, hour
      ORDER BY day_of_week, hour
    `).all(cutoff) as { day_of_week: number; hour: number; count: number }[];

    // Also provide daily totals for sparkline
    const dailyTotals = db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM login_attempts
      WHERE success = 0 AND created_at >= ?
      GROUP BY DATE(created_at)
      ORDER BY date
    `).all(cutoff) as { date: string; count: number }[];

    // Peak failure hour
    const peakHour = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
      FROM login_attempts
      WHERE success = 0 AND created_at >= ?
      GROUP BY hour ORDER BY count DESC LIMIT 1
    `).get(cutoff) as { hour: number; count: number } | undefined;

    res.json({
      heatmap: heatmapData,
      daily_totals: dailyTotals,
      peak_hour: peakHour || null,
      period_days: days,
    });
  } catch (error: any) {
    console.error('Failed login heatmap error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get login heatmap', code: 'LOGIN_HEATMAP_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 2: Suspicious Activity Scoring
// Calculates a risk score for each IP or user based on patterns.
// ════════════════════════════════════════════════════════════
router.get('/suspicious-activity', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Score IPs: weight by failures, targeted accounts, time clustering
    const ipScores = db.prepare(`
      SELECT
        ip_address,
        COUNT(*) as total_attempts,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
        COUNT(DISTINCT username) as unique_accounts_targeted,
        MAX(created_at) as last_attempt,
        MIN(created_at) as first_attempt
      FROM login_attempts
      WHERE created_at >= ?
      GROUP BY ip_address
      HAVING failures >= 2
      ORDER BY failures DESC
      LIMIT 50
    `).all(cutoff7d) as any[];

    const scoredIps = ipScores.map((ip: any) => {
      let score = 0;
      // High failure count
      score += Math.min(ip.failures * 10, 50);
      // Multiple accounts targeted = credential stuffing
      score += Math.min(ip.unique_accounts_targeted * 15, 45);
      // No successful logins = likely attacker
      if (ip.successes === 0) score += 20;
      // Rapid-fire attempts (many in short window)
      const spanMs = new Date(ip.last_attempt).getTime() - new Date(ip.first_attempt).getTime();
      const spanHours = spanMs / (60 * 60 * 1000);
      if (spanHours > 0 && ip.failures / spanHours > 10) score += 25;

      return {
        ip_address: ip.ip_address,
        total_attempts: ip.total_attempts,
        failures: ip.failures,
        successes: ip.successes,
        unique_accounts_targeted: ip.unique_accounts_targeted,
        last_attempt: ip.last_attempt,
        risk_score: Math.min(score, 100),
        risk_level: score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low',
      };
    });

    // Score users: multiple failures, after-hours logins
    const userScores = db.prepare(`
      SELECT
        username,
        COUNT(*) as total_attempts,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
        COUNT(DISTINCT ip_address) as unique_ips,
        MAX(created_at) as last_attempt
      FROM login_attempts
      WHERE created_at >= ?
      GROUP BY username
      HAVING failures >= 3
      ORDER BY failures DESC
      LIMIT 50
    `).all(cutoff7d) as any[];

    const scoredUsers = userScores.map((u: any) => {
      let score = 0;
      score += Math.min(u.failures * 5, 30);
      score += Math.min(u.unique_ips * 10, 40);
      // Lots of IPs trying same account = distributed attack
      if (u.unique_ips >= 5) score += 30;
      return {
        username: u.username,
        total_attempts: u.total_attempts,
        failures: u.failures,
        unique_ips: u.unique_ips,
        last_attempt: u.last_attempt,
        risk_score: Math.min(score, 100),
        risk_level: score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low',
      };
    });

    res.json({
      ip_risks: scoredIps.sort((a, b) => b.risk_score - a.risk_score),
      user_risks: scoredUsers.sort((a, b) => b.risk_score - a.risk_score),
      summary: {
        critical_ips: scoredIps.filter(i => i.risk_level === 'critical').length,
        high_risk_ips: scoredIps.filter(i => i.risk_level === 'high').length,
        critical_users: scoredUsers.filter(u => u.risk_level === 'critical').length,
      },
    });
  } catch (error: any) {
    console.error('Suspicious activity error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get suspicious activity', code: 'SUSPICIOUS_ACTIVITY_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 3: IP Geolocation for Login Attempts
// Returns login attempts with basic geo derived from IP ranges.
// Uses a simple mapping approach (no external API).
// ════════════════════════════════════════════════════════════
router.get('/login-geo', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(String(req.query.limit || '100'), 10), 500);
    const onlyFailed = req.query.only_failed === '1' || req.query.only_failed === 'true';

    let where = "WHERE created_at >= datetime('now', 'localtime', '-30 days')";
    if (onlyFailed) where += ' AND success = 0';

    const attempts = db.prepare(`
      SELECT ip_address, username, success, failure_reason, user_agent, created_at
      FROM login_attempts
      ${where}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as any[];

    // Simple IP classification (private vs public ranges)
    const geoAttempts = attempts.map((a: any) => {
      const ip = a.ip_address || '';
      let geo_type = 'public';
      let geo_label = 'External';
      if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.16.') ||
          ip.startsWith('172.17.') || ip.startsWith('172.18.') || ip.startsWith('172.19.') ||
          ip.startsWith('172.2') || ip.startsWith('172.3') ||
          ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
        geo_type = 'local';
        geo_label = 'Internal Network';
      }
      return {
        ...a,
        geo_type,
        geo_label,
        // Parse basic browser info from user_agent
        browser: parseBrowserFromUA(a.user_agent || ''),
      };
    });

    // Group by IP for summary
    const ipSummary: Record<string, { count: number; failures: number; last_seen: string }> = {};
    for (const a of geoAttempts) {
      const key = a.ip_address || 'unknown';
      if (!ipSummary[key]) ipSummary[key] = { count: 0, failures: 0, last_seen: a.created_at };
      ipSummary[key].count++;
      if (!a.success) ipSummary[key].failures++;
      if (a.created_at > ipSummary[key].last_seen) ipSummary[key].last_seen = a.created_at;
    }

    res.json({
      attempts: geoAttempts,
      ip_summary: Object.entries(ipSummary).map(([ip, data]) => ({ ip_address: ip, ...data })),
    });
  } catch (error: any) {
    console.error('Login geo error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get login geo data', code: 'LOGIN_GEO_ERROR' });
  }
});


// ════════════════════════════════════════════════════════════
// UPGRADE 4: Security Event Timeline
// Returns a chronological timeline of all security-relevant
// events (logins, lockouts, device changes, password changes).
// ════════════════════════════════════════════════════════════
router.get('/event-timeline', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(String(req.query.limit || '100'), 10), 500);
    const days = Math.min(90, Math.max(1, parseInt(String(req.query.days || '7'), 10)));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Combine multiple event sources into a unified timeline
    const events: any[] = [];

    // 1. Login attempts (both success and failure)
    const logins = db.prepare(`
      SELECT 'login_attempt' as event_type, username as actor,
        ip_address, success, failure_reason as detail, created_at as event_time
      FROM login_attempts
      WHERE created_at >= ?
      ORDER BY created_at DESC LIMIT ?
    `).all(cutoff, limit) as any[];
    for (const l of logins) {
      events.push({
        event_type: l.success ? 'login_success' : 'login_failure',
        actor: l.actor,
        ip_address: l.ip_address,
        detail: l.success ? 'Successful login' : `Failed: ${l.detail || 'invalid credentials'}`,
        severity: l.success ? 'info' : 'warning',
        event_time: l.event_time,
      });
    }

    // 2. Security notifications (device revoked, password changes, etc.)
    const notifications = db.prepare(`
      SELECT sn.event_type, sn.title, sn.details as detail, sn.ip_address,
        sn.created_at as event_time, u.username as actor
      FROM security_notifications sn
      LEFT JOIN users u ON sn.user_id = u.id
      WHERE sn.created_at >= ?
      ORDER BY sn.created_at DESC LIMIT ?
    `).all(cutoff, limit) as any[];
    for (const n of notifications) {
      events.push({
        event_type: n.event_type || 'security_notification',
        actor: n.actor || 'system',
        ip_address: n.ip_address,
        detail: n.detail || n.title,
        severity: 'medium',
        event_time: n.event_time,
      });
    }

    // 3. Admin security actions from activity_log
    const adminActions = db.prepare(`
      SELECT al.action as event_type, al.details as detail, al.ip_address,
        al.created_at as event_time, u.username as actor
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.created_at >= ?
        AND al.action IN ('user_login', 'user_logout', 'password_changed', 'totp_enabled',
          'totp_disabled', 'user_created', 'user_deactivated', 'user_role_changed',
          'user_login_trusted_device', 'force_password_change')
      ORDER BY al.created_at DESC LIMIT ?
    `).all(cutoff, limit) as any[];
    for (const a of adminActions) {
      events.push({
        event_type: a.event_type,
        actor: a.actor || 'system',
        ip_address: a.ip_address,
        detail: a.detail,
        severity: ['user_deactivated', 'totp_disabled', 'force_password_change'].includes(a.event_type) ? 'high' : 'info',
        event_time: a.event_time,
      });
    }

    // Sort by event_time descending and limit
    events.sort((a, b) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime());
    const trimmed = events.slice(0, limit);

    res.json({
      events: trimmed,
      total: trimmed.length,
      period_days: days,
    });
  } catch (error: any) {
    console.error('Security event timeline error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get event timeline', code: 'EVENT_TIMELINE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 5: Session Analytics
// Provides stats about active sessions across all users.
// ════════════════════════════════════════════════════════════
router.get('/session-analytics', authenticateToken, requireRole('admin'), (_req: Request, res: Response) => {
  try {
    const db = getDb();

    const totalActive = db.prepare(
      'SELECT COUNT(*) as count FROM sessions WHERE is_active = 1'
    ).get() as { count: number };

    const byUser = db.prepare(`
      SELECT u.username, u.full_name, u.role, COUNT(*) as session_count,
        MAX(s.last_used_at) as last_active
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.is_active = 1
      GROUP BY s.user_id
      ORDER BY session_count DESC
      LIMIT 50
    `).all() as any[];

    const stale = db.prepare(`
      SELECT COUNT(*) as count FROM sessions
      WHERE is_active = 1 AND last_used_at < datetime('now', '-24 hours')
    `).get() as { count: number };

    res.json({
      total_active_sessions: totalActive.count,
      stale_sessions: stale.count,
      sessions_by_user: byUser,
    });
  } catch (error: any) {
    console.error('Session analytics error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get session analytics', code: 'SESSION_ANALYTICS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 6: Password Compliance Report
// Shows which users have expired/expiring passwords,
// users who haven't changed passwords recently, etc.
// ════════════════════════════════════════════════════════════
router.get('/password-compliance', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (_req: Request, res: Response) => {
  try {
    const db = getDb();

    const users = db.prepare(`
      SELECT id, username, full_name, role, status, password_changed_at,
        password_expires_at, force_password_change, totp_enabled, last_login_at
      FROM users WHERE status = 'active'
      ORDER BY password_changed_at ASC
    `).all() as any[];

    const now = new Date();
    const report = users.map((u: any) => {
      const changedAt = u.password_changed_at ? new Date(u.password_changed_at) : null;
      const daysSinceChange = changedAt ? Math.floor((now.getTime() - changedAt.getTime()) / (24 * 60 * 60 * 1000)) : null;
      const expired = u.password_expires_at ? new Date(u.password_expires_at) < now : false;
      const expiringSoon = u.password_expires_at
        ? new Date(u.password_expires_at).getTime() - now.getTime() < 14 * 24 * 60 * 60 * 1000 && !expired
        : false;

      return {
        user_id: u.id,
        username: u.username,
        full_name: u.full_name,
        role: u.role,
        password_changed_at: u.password_changed_at,
        days_since_change: daysSinceChange,
        password_expired: expired,
        password_expiring_soon: expiringSoon,
        force_change_required: u.force_password_change === 1,
        totp_enabled: u.totp_enabled === 1,
        last_login: u.last_login_at,
      };
    });

    const summary = {
      total_active_users: report.length,
      passwords_expired: report.filter(r => r.password_expired).length,
      passwords_expiring_soon: report.filter(r => r.password_expiring_soon).length,
      force_change_pending: report.filter(r => r.force_change_required).length,
      totp_enabled_count: report.filter(r => r.totp_enabled).length,
      totp_disabled_count: report.filter(r => !r.totp_enabled).length,
    };

    res.json({ users: report, summary });
  } catch (error: any) {
    console.error('Password compliance error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get password compliance', code: 'PASSWORD_COMPLIANCE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 1: Failed Login Heatmap Data
// Returns failed login attempts grouped by hour-of-day and day-of-week
// for rendering a heatmap visualization on the security dashboard.
// ════════════════════════════════════════════════════════════
router.get('/failed-login-heatmap', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.min(90, Math.max(1, parseInt(String(req.query.days || '30'), 10)));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Group failed logins by hour and day-of-week (0=Sunday)
    const heatmapData = db.prepare(`
      SELECT
        CAST(strftime('%w', created_at) AS INTEGER) as day_of_week,
        CAST(strftime('%H', created_at) AS INTEGER) as hour,
        COUNT(*) as count
      FROM login_attempts
      WHERE success = 0 AND created_at >= ?
      GROUP BY day_of_week, hour
      ORDER BY day_of_week, hour
    `).all(cutoff) as { day_of_week: number; hour: number; count: number }[];

    // Also provide daily totals for sparkline
    const dailyTotals = db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM login_attempts
      WHERE success = 0 AND created_at >= ?
      GROUP BY DATE(created_at)
      ORDER BY date
    `).all(cutoff) as { date: string; count: number }[];

    // Peak failure hour
    const peakHour = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
      FROM login_attempts
      WHERE success = 0 AND created_at >= ?
      GROUP BY hour ORDER BY count DESC LIMIT 1
    `).get(cutoff) as { hour: number; count: number } | undefined;

    res.json({
      heatmap: heatmapData,
      daily_totals: dailyTotals,
      peak_hour: peakHour || null,
      period_days: days,
    });
  } catch (error: any) {
    console.error('Failed login heatmap error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get login heatmap', code: 'LOGIN_HEATMAP_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 2: Suspicious Activity Scoring
// Calculates a risk score for each IP or user based on patterns.
// ════════════════════════════════════════════════════════════
router.get('/suspicious-activity', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Score IPs: weight by failures, targeted accounts, time clustering
    const ipScores = db.prepare(`
      SELECT
        ip_address,
        COUNT(*) as total_attempts,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
        COUNT(DISTINCT username) as unique_accounts_targeted,
        MAX(created_at) as last_attempt,
        MIN(created_at) as first_attempt
      FROM login_attempts
      WHERE created_at >= ?
      GROUP BY ip_address
      HAVING failures >= 2
      ORDER BY failures DESC
      LIMIT 50
    `).all(cutoff7d) as any[];

    const scoredIps = ipScores.map((ip: any) => {
      let score = 0;
      // High failure count
      score += Math.min(ip.failures * 10, 50);
      // Multiple accounts targeted = credential stuffing
      score += Math.min(ip.unique_accounts_targeted * 15, 45);
      // No successful logins = likely attacker
      if (ip.successes === 0) score += 20;
      // Rapid-fire attempts (many in short window)
      const spanMs = new Date(ip.last_attempt).getTime() - new Date(ip.first_attempt).getTime();
      const spanHours = spanMs / (60 * 60 * 1000);
      if (spanHours > 0 && ip.failures / spanHours > 10) score += 25;

      return {
        ip_address: ip.ip_address,
        total_attempts: ip.total_attempts,
        failures: ip.failures,
        successes: ip.successes,
        unique_accounts_targeted: ip.unique_accounts_targeted,
        last_attempt: ip.last_attempt,
        risk_score: Math.min(score, 100),
        risk_level: score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low',
      };
    });

    // Score users: multiple failures, after-hours logins
    const userScores = db.prepare(`
      SELECT
        username,
        COUNT(*) as total_attempts,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
        COUNT(DISTINCT ip_address) as unique_ips,
        MAX(created_at) as last_attempt
      FROM login_attempts
      WHERE created_at >= ?
      GROUP BY username
      HAVING failures >= 3
      ORDER BY failures DESC
      LIMIT 50
    `).all(cutoff7d) as any[];

    const scoredUsers = userScores.map((u: any) => {
      let score = 0;
      score += Math.min(u.failures * 5, 30);
      score += Math.min(u.unique_ips * 10, 40);
      // Lots of IPs trying same account = distributed attack
      if (u.unique_ips >= 5) score += 30;
      return {
        username: u.username,
        total_attempts: u.total_attempts,
        failures: u.failures,
        unique_ips: u.unique_ips,
        last_attempt: u.last_attempt,
        risk_score: Math.min(score, 100),
        risk_level: score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low',
      };
    });

    res.json({
      ip_risks: scoredIps.sort((a, b) => b.risk_score - a.risk_score),
      user_risks: scoredUsers.sort((a, b) => b.risk_score - a.risk_score),
      summary: {
        critical_ips: scoredIps.filter(i => i.risk_level === 'critical').length,
        high_risk_ips: scoredIps.filter(i => i.risk_level === 'high').length,
        critical_users: scoredUsers.filter(u => u.risk_level === 'critical').length,
      },
    });
  } catch (error: any) {
    console.error('Suspicious activity error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get suspicious activity', code: 'SUSPICIOUS_ACTIVITY_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 3: IP Geolocation for Login Attempts
// Returns login attempts with basic geo derived from IP ranges.
// Uses a simple mapping approach (no external API).
// ════════════════════════════════════════════════════════════
router.get('/login-geo', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(String(req.query.limit || '100'), 10), 500);
    const onlyFailed = req.query.only_failed === '1' || req.query.only_failed === 'true';

    let where = "WHERE created_at >= datetime('now', 'localtime', '-30 days')";
    if (onlyFailed) where += ' AND success = 0';

    const attempts = db.prepare(`
      SELECT ip_address, username, success, failure_reason, user_agent, created_at
      FROM login_attempts
      ${where}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as any[];

    // Simple IP classification (private vs public ranges)
    const geoAttempts = attempts.map((a: any) => {
      const ip = a.ip_address || '';
      let geo_type = 'public';
      let geo_label = 'External';
      if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.16.') ||
          ip.startsWith('172.17.') || ip.startsWith('172.18.') || ip.startsWith('172.19.') ||
          ip.startsWith('172.2') || ip.startsWith('172.3') ||
          ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
        geo_type = 'local';
        geo_label = 'Internal Network';
      }
      return {
        ...a,
        geo_type,
        geo_label,
        // Parse basic browser info from user_agent
        browser: parseBrowserFromUA(a.user_agent || ''),
      };
    });

    // Group by IP for summary
    const ipSummary: Record<string, { count: number; failures: number; last_seen: string }> = {};
    for (const a of geoAttempts) {
      const key = a.ip_address || 'unknown';
      if (!ipSummary[key]) ipSummary[key] = { count: 0, failures: 0, last_seen: a.created_at };
      ipSummary[key].count++;
      if (!a.success) ipSummary[key].failures++;
      if (a.created_at > ipSummary[key].last_seen) ipSummary[key].last_seen = a.created_at;
    }

    res.json({
      attempts: geoAttempts,
      ip_summary: Object.entries(ipSummary).map(([ip, data]) => ({ ip_address: ip, ...data })),
    });
  } catch (error: any) {
    console.error('Login geo error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get login geo data', code: 'LOGIN_GEO_ERROR' });
  }
});


// ════════════════════════════════════════════════════════════
// UPGRADE 4: Security Event Timeline
// Returns a chronological timeline of all security-relevant
// events (logins, lockouts, device changes, password changes).
// ════════════════════════════════════════════════════════════
router.get('/event-timeline', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(String(req.query.limit || '100'), 10), 500);
    const days = Math.min(90, Math.max(1, parseInt(String(req.query.days || '7'), 10)));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Combine multiple event sources into a unified timeline
    const events: any[] = [];

    // 1. Login attempts (both success and failure)
    const logins = db.prepare(`
      SELECT 'login_attempt' as event_type, username as actor,
        ip_address, success, failure_reason as detail, created_at as event_time
      FROM login_attempts
      WHERE created_at >= ?
      ORDER BY created_at DESC LIMIT ?
    `).all(cutoff, limit) as any[];
    for (const l of logins) {
      events.push({
        event_type: l.success ? 'login_success' : 'login_failure',
        actor: l.actor,
        ip_address: l.ip_address,
        detail: l.success ? 'Successful login' : `Failed: ${l.detail || 'invalid credentials'}`,
        severity: l.success ? 'info' : 'warning',
        event_time: l.event_time,
      });
    }

    // 2. Security notifications (device revoked, password changes, etc.)
    const notifications = db.prepare(`
      SELECT sn.event_type, sn.title, sn.details as detail, sn.ip_address,
        sn.created_at as event_time, u.username as actor
      FROM security_notifications sn
      LEFT JOIN users u ON sn.user_id = u.id
      WHERE sn.created_at >= ?
      ORDER BY sn.created_at DESC LIMIT ?
    `).all(cutoff, limit) as any[];
    for (const n of notifications) {
      events.push({
        event_type: n.event_type || 'security_notification',
        actor: n.actor || 'system',
        ip_address: n.ip_address,
        detail: n.detail || n.title,
        severity: 'medium',
        event_time: n.event_time,
      });
    }

    // 3. Admin security actions from activity_log
    const adminActions = db.prepare(`
      SELECT al.action as event_type, al.details as detail, al.ip_address,
        al.created_at as event_time, u.username as actor
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.created_at >= ?
        AND al.action IN ('user_login', 'user_logout', 'password_changed', 'totp_enabled',
          'totp_disabled', 'user_created', 'user_deactivated', 'user_role_changed',
          'user_login_trusted_device', 'force_password_change')
      ORDER BY al.created_at DESC LIMIT ?
    `).all(cutoff, limit) as any[];
    for (const a of adminActions) {
      events.push({
        event_type: a.event_type,
        actor: a.actor || 'system',
        ip_address: a.ip_address,
        detail: a.detail,
        severity: ['user_deactivated', 'totp_disabled', 'force_password_change'].includes(a.event_type) ? 'high' : 'info',
        event_time: a.event_time,
      });
    }

    // Sort by event_time descending and limit
    events.sort((a, b) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime());
    const trimmed = events.slice(0, limit);

    res.json({
      events: trimmed,
      total: trimmed.length,
      period_days: days,
    });
  } catch (error: any) {
    console.error('Security event timeline error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get event timeline', code: 'EVENT_TIMELINE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 5: Session Analytics
// Provides stats about active sessions across all users.
// ════════════════════════════════════════════════════════════
router.get('/session-analytics', authenticateToken, requireRole('admin'), (_req: Request, res: Response) => {
  try {
    const db = getDb();

    const totalActive = db.prepare(
      'SELECT COUNT(*) as count FROM sessions WHERE is_active = 1'
    ).get() as { count: number };

    const byUser = db.prepare(`
      SELECT u.username, u.full_name, u.role, COUNT(*) as session_count,
        MAX(s.last_used_at) as last_active
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.is_active = 1
      GROUP BY s.user_id
      ORDER BY session_count DESC
      LIMIT 50
    `).all() as any[];

    const stale = db.prepare(`
      SELECT COUNT(*) as count FROM sessions
      WHERE is_active = 1 AND last_used_at < datetime('now', '-24 hours')
    `).get() as { count: number };

    res.json({
      total_active_sessions: totalActive.count,
      stale_sessions: stale.count,
      sessions_by_user: byUser,
    });
  } catch (error: any) {
    console.error('Session analytics error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get session analytics', code: 'SESSION_ANALYTICS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 6: Password Compliance Report
// Shows which users have expired/expiring passwords,
// users who haven't changed passwords recently, etc.
// ════════════════════════════════════════════════════════════
router.get('/password-compliance', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (_req: Request, res: Response) => {
  try {
    const db = getDb();

    const users = db.prepare(`
      SELECT id, username, full_name, role, status, password_changed_at,
        password_expires_at, force_password_change, totp_enabled, last_login_at
      FROM users WHERE status = 'active'
      ORDER BY password_changed_at ASC
    `).all() as any[];

    const now = new Date();
    const report = users.map((u: any) => {
      const changedAt = u.password_changed_at ? new Date(u.password_changed_at) : null;
      const daysSinceChange = changedAt ? Math.floor((now.getTime() - changedAt.getTime()) / (24 * 60 * 60 * 1000)) : null;
      const expired = u.password_expires_at ? new Date(u.password_expires_at) < now : false;
      const expiringSoon = u.password_expires_at
        ? new Date(u.password_expires_at).getTime() - now.getTime() < 14 * 24 * 60 * 60 * 1000 && !expired
        : false;

      return {
        user_id: u.id,
        username: u.username,
        full_name: u.full_name,
        role: u.role,
        password_changed_at: u.password_changed_at,
        days_since_change: daysSinceChange,
        password_expired: expired,
        password_expiring_soon: expiringSoon,
        force_change_required: u.force_password_change === 1,
        totp_enabled: u.totp_enabled === 1,
        last_login: u.last_login_at,
      };
    });

    const summary = {
      total_active_users: report.length,
      passwords_expired: report.filter(r => r.password_expired).length,
      passwords_expiring_soon: report.filter(r => r.password_expiring_soon).length,
      force_change_pending: report.filter(r => r.force_change_required).length,
      totp_enabled_count: report.filter(r => r.totp_enabled).length,
      totp_disabled_count: report.filter(r => !r.totp_enabled).length,
    };

    res.json({ users: report, summary });
  } catch (error: any) {
    console.error('Password compliance error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get password compliance', code: 'PASSWORD_COMPLIANCE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 1: Failed Login Heatmap Data
// Returns failed login attempts grouped by hour-of-day and day-of-week
// for rendering a heatmap visualization on the security dashboard.
// ════════════════════════════════════════════════════════════
router.get('/failed-login-heatmap', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.min(90, Math.max(1, parseInt(String(req.query.days || '30'), 10)));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Group failed logins by hour and day-of-week (0=Sunday)
    const heatmapData = db.prepare(`
      SELECT
        CAST(strftime('%w', created_at) AS INTEGER) as day_of_week,
        CAST(strftime('%H', created_at) AS INTEGER) as hour,
        COUNT(*) as count
      FROM login_attempts
      WHERE success = 0 AND created_at >= ?
      GROUP BY day_of_week, hour
      ORDER BY day_of_week, hour
    `).all(cutoff) as { day_of_week: number; hour: number; count: number }[];

    // Also provide daily totals for sparkline
    const dailyTotals = db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM login_attempts
      WHERE success = 0 AND created_at >= ?
      GROUP BY DATE(created_at)
      ORDER BY date
    `).all(cutoff) as { date: string; count: number }[];

    // Peak failure hour
    const peakHour = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
      FROM login_attempts
      WHERE success = 0 AND created_at >= ?
      GROUP BY hour ORDER BY count DESC LIMIT 1
    `).get(cutoff) as { hour: number; count: number } | undefined;

    res.json({
      heatmap: heatmapData,
      daily_totals: dailyTotals,
      peak_hour: peakHour || null,
      period_days: days,
    });
  } catch (error: any) {
    console.error('Failed login heatmap error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get login heatmap', code: 'LOGIN_HEATMAP_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 2: Suspicious Activity Scoring
// Calculates a risk score for each IP or user based on patterns.
// ════════════════════════════════════════════════════════════
router.get('/suspicious-activity', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Score IPs: weight by failures, targeted accounts, time clustering
    const ipScores = db.prepare(`
      SELECT
        ip_address,
        COUNT(*) as total_attempts,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
        COUNT(DISTINCT username) as unique_accounts_targeted,
        MAX(created_at) as last_attempt,
        MIN(created_at) as first_attempt
      FROM login_attempts
      WHERE created_at >= ?
      GROUP BY ip_address
      HAVING failures >= 2
      ORDER BY failures DESC
      LIMIT 50
    `).all(cutoff7d) as any[];

    const scoredIps = ipScores.map((ip: any) => {
      let score = 0;
      // High failure count
      score += Math.min(ip.failures * 10, 50);
      // Multiple accounts targeted = credential stuffing
      score += Math.min(ip.unique_accounts_targeted * 15, 45);
      // No successful logins = likely attacker
      if (ip.successes === 0) score += 20;
      // Rapid-fire attempts (many in short window)
      const spanMs = new Date(ip.last_attempt).getTime() - new Date(ip.first_attempt).getTime();
      const spanHours = spanMs / (60 * 60 * 1000);
      if (spanHours > 0 && ip.failures / spanHours > 10) score += 25;

      return {
        ip_address: ip.ip_address,
        total_attempts: ip.total_attempts,
        failures: ip.failures,
        successes: ip.successes,
        unique_accounts_targeted: ip.unique_accounts_targeted,
        last_attempt: ip.last_attempt,
        risk_score: Math.min(score, 100),
        risk_level: score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low',
      };
    });

    // Score users: multiple failures, after-hours logins
    const userScores = db.prepare(`
      SELECT
        username,
        COUNT(*) as total_attempts,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
        COUNT(DISTINCT ip_address) as unique_ips,
        MAX(created_at) as last_attempt
      FROM login_attempts
      WHERE created_at >= ?
      GROUP BY username
      HAVING failures >= 3
      ORDER BY failures DESC
      LIMIT 50
    `).all(cutoff7d) as any[];

    const scoredUsers = userScores.map((u: any) => {
      let score = 0;
      score += Math.min(u.failures * 5, 30);
      score += Math.min(u.unique_ips * 10, 40);
      // Lots of IPs trying same account = distributed attack
      if (u.unique_ips >= 5) score += 30;
      return {
        username: u.username,
        total_attempts: u.total_attempts,
        failures: u.failures,
        unique_ips: u.unique_ips,
        last_attempt: u.last_attempt,
        risk_score: Math.min(score, 100),
        risk_level: score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low',
      };
    });

    res.json({
      ip_risks: scoredIps.sort((a, b) => b.risk_score - a.risk_score),
      user_risks: scoredUsers.sort((a, b) => b.risk_score - a.risk_score),
      summary: {
        critical_ips: scoredIps.filter(i => i.risk_level === 'critical').length,
        high_risk_ips: scoredIps.filter(i => i.risk_level === 'high').length,
        critical_users: scoredUsers.filter(u => u.risk_level === 'critical').length,
      },
    });
  } catch (error: any) {
    console.error('Suspicious activity error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get suspicious activity', code: 'SUSPICIOUS_ACTIVITY_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 3: IP Geolocation for Login Attempts
// Returns login attempts with basic geo derived from IP ranges.
// Uses a simple mapping approach (no external API).
// ════════════════════════════════════════════════════════════
router.get('/login-geo', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(String(req.query.limit || '100'), 10), 500);
    const onlyFailed = req.query.only_failed === '1' || req.query.only_failed === 'true';

    let where = "WHERE created_at >= datetime('now', 'localtime', '-30 days')";
    if (onlyFailed) where += ' AND success = 0';

    const attempts = db.prepare(`
      SELECT ip_address, username, success, failure_reason, user_agent, created_at
      FROM login_attempts
      ${where}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as any[];

    // Simple IP classification (private vs public ranges)
    const geoAttempts = attempts.map((a: any) => {
      const ip = a.ip_address || '';
      let geo_type = 'public';
      let geo_label = 'External';
      if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.16.') ||
          ip.startsWith('172.17.') || ip.startsWith('172.18.') || ip.startsWith('172.19.') ||
          ip.startsWith('172.2') || ip.startsWith('172.3') ||
          ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
        geo_type = 'local';
        geo_label = 'Internal Network';
      }
      return {
        ...a,
        geo_type,
        geo_label,
        // Parse basic browser info from user_agent
        browser: parseBrowserFromUA(a.user_agent || ''),
      };
    });

    // Group by IP for summary
    const ipSummary: Record<string, { count: number; failures: number; last_seen: string }> = {};
    for (const a of geoAttempts) {
      const key = a.ip_address || 'unknown';
      if (!ipSummary[key]) ipSummary[key] = { count: 0, failures: 0, last_seen: a.created_at };
      ipSummary[key].count++;
      if (!a.success) ipSummary[key].failures++;
      if (a.created_at > ipSummary[key].last_seen) ipSummary[key].last_seen = a.created_at;
    }

    res.json({
      attempts: geoAttempts,
      ip_summary: Object.entries(ipSummary).map(([ip, data]) => ({ ip_address: ip, ...data })),
    });
  } catch (error: any) {
    console.error('Login geo error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get login geo data', code: 'LOGIN_GEO_ERROR' });
  }
});


// ════════════════════════════════════════════════════════════
// UPGRADE 4: Security Event Timeline
// Returns a chronological timeline of all security-relevant
// events (logins, lockouts, device changes, password changes).
// ════════════════════════════════════════════════════════════
router.get('/event-timeline', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(String(req.query.limit || '100'), 10), 500);
    const days = Math.min(90, Math.max(1, parseInt(String(req.query.days || '7'), 10)));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Combine multiple event sources into a unified timeline
    const events: any[] = [];

    // 1. Login attempts (both success and failure)
    const logins = db.prepare(`
      SELECT 'login_attempt' as event_type, username as actor,
        ip_address, success, failure_reason as detail, created_at as event_time
      FROM login_attempts
      WHERE created_at >= ?
      ORDER BY created_at DESC LIMIT ?
    `).all(cutoff, limit) as any[];
    for (const l of logins) {
      events.push({
        event_type: l.success ? 'login_success' : 'login_failure',
        actor: l.actor,
        ip_address: l.ip_address,
        detail: l.success ? 'Successful login' : `Failed: ${l.detail || 'invalid credentials'}`,
        severity: l.success ? 'info' : 'warning',
        event_time: l.event_time,
      });
    }

    // 2. Security notifications (device revoked, password changes, etc.)
    const notifications = db.prepare(`
      SELECT sn.event_type, sn.title, sn.details as detail, sn.ip_address,
        sn.created_at as event_time, u.username as actor
      FROM security_notifications sn
      LEFT JOIN users u ON sn.user_id = u.id
      WHERE sn.created_at >= ?
      ORDER BY sn.created_at DESC LIMIT ?
    `).all(cutoff, limit) as any[];
    for (const n of notifications) {
      events.push({
        event_type: n.event_type || 'security_notification',
        actor: n.actor || 'system',
        ip_address: n.ip_address,
        detail: n.detail || n.title,
        severity: 'medium',
        event_time: n.event_time,
      });
    }

    // 3. Admin security actions from activity_log
    const adminActions = db.prepare(`
      SELECT al.action as event_type, al.details as detail, al.ip_address,
        al.created_at as event_time, u.username as actor
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.created_at >= ?
        AND al.action IN ('user_login', 'user_logout', 'password_changed', 'totp_enabled',
          'totp_disabled', 'user_created', 'user_deactivated', 'user_role_changed',
          'user_login_trusted_device', 'force_password_change')
      ORDER BY al.created_at DESC LIMIT ?
    `).all(cutoff, limit) as any[];
    for (const a of adminActions) {
      events.push({
        event_type: a.event_type,
        actor: a.actor || 'system',
        ip_address: a.ip_address,
        detail: a.detail,
        severity: ['user_deactivated', 'totp_disabled', 'force_password_change'].includes(a.event_type) ? 'high' : 'info',
        event_time: a.event_time,
      });
    }

    // Sort by event_time descending and limit
    events.sort((a, b) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime());
    const trimmed = events.slice(0, limit);

    res.json({
      events: trimmed,
      total: trimmed.length,
      period_days: days,
    });
  } catch (error: any) {
    console.error('Security event timeline error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get event timeline', code: 'EVENT_TIMELINE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 5: Session Analytics
// Provides stats about active sessions across all users.
// ════════════════════════════════════════════════════════════
router.get('/session-analytics', authenticateToken, requireRole('admin'), (_req: Request, res: Response) => {
  try {
    const db = getDb();

    const totalActive = db.prepare(
      'SELECT COUNT(*) as count FROM sessions WHERE is_active = 1'
    ).get() as { count: number };

    const byUser = db.prepare(`
      SELECT u.username, u.full_name, u.role, COUNT(*) as session_count,
        MAX(s.last_used_at) as last_active
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.is_active = 1
      GROUP BY s.user_id
      ORDER BY session_count DESC
      LIMIT 50
    `).all() as any[];

    const stale = db.prepare(`
      SELECT COUNT(*) as count FROM sessions
      WHERE is_active = 1 AND last_used_at < datetime('now', '-24 hours')
    `).get() as { count: number };

    res.json({
      total_active_sessions: totalActive.count,
      stale_sessions: stale.count,
      sessions_by_user: byUser,
    });
  } catch (error: any) {
    console.error('Session analytics error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get session analytics', code: 'SESSION_ANALYTICS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 6: Password Compliance Report
// Shows which users have expired/expiring passwords,
// users who haven't changed passwords recently, etc.
// ════════════════════════════════════════════════════════════
router.get('/password-compliance', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (_req: Request, res: Response) => {
  try {
    const db = getDb();

    const users = db.prepare(`
      SELECT id, username, full_name, role, status, password_changed_at,
        password_expires_at, force_password_change, totp_enabled, last_login_at
      FROM users WHERE status = 'active'
      ORDER BY password_changed_at ASC
    `).all() as any[];

    const now = new Date();
    const report = users.map((u: any) => {
      const changedAt = u.password_changed_at ? new Date(u.password_changed_at) : null;
      const daysSinceChange = changedAt ? Math.floor((now.getTime() - changedAt.getTime()) / (24 * 60 * 60 * 1000)) : null;
      const expired = u.password_expires_at ? new Date(u.password_expires_at) < now : false;
      const expiringSoon = u.password_expires_at
        ? new Date(u.password_expires_at).getTime() - now.getTime() < 14 * 24 * 60 * 60 * 1000 && !expired
        : false;

      return {
        user_id: u.id,
        username: u.username,
        full_name: u.full_name,
        role: u.role,
        password_changed_at: u.password_changed_at,
        days_since_change: daysSinceChange,
        password_expired: expired,
        password_expiring_soon: expiringSoon,
        force_change_required: u.force_password_change === 1,
        totp_enabled: u.totp_enabled === 1,
        last_login: u.last_login_at,
      };
    });

    const summary = {
      total_active_users: report.length,
      passwords_expired: report.filter(r => r.password_expired).length,
      passwords_expiring_soon: report.filter(r => r.password_expiring_soon).length,
      force_change_pending: report.filter(r => r.force_change_required).length,
      totp_enabled_count: report.filter(r => r.totp_enabled).length,
      totp_disabled_count: report.filter(r => !r.totp_enabled).length,
    };

    res.json({ users: report, summary });
  } catch (error: any) {
    console.error('Password compliance error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get password compliance', code: 'PASSWORD_COMPLIANCE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 1: Failed Login Heatmap Data
// Returns failed login attempts grouped by hour-of-day and day-of-week
// for rendering a heatmap visualization on the security dashboard.
// ════════════════════════════════════════════════════════════
router.get('/failed-login-heatmap', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.min(90, Math.max(1, parseInt(String(req.query.days || '30'), 10)));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Group failed logins by hour and day-of-week (0=Sunday)
    const heatmapData = db.prepare(`
      SELECT
        CAST(strftime('%w', created_at) AS INTEGER) as day_of_week,
        CAST(strftime('%H', created_at) AS INTEGER) as hour,
        COUNT(*) as count
      FROM login_attempts
      WHERE success = 0 AND created_at >= ?
      GROUP BY day_of_week, hour
      ORDER BY day_of_week, hour
    `).all(cutoff) as { day_of_week: number; hour: number; count: number }[];

    // Also provide daily totals for sparkline
    const dailyTotals = db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM login_attempts
      WHERE success = 0 AND created_at >= ?
      GROUP BY DATE(created_at)
      ORDER BY date
    `).all(cutoff) as { date: string; count: number }[];

    // Peak failure hour
    const peakHour = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
      FROM login_attempts
      WHERE success = 0 AND created_at >= ?
      GROUP BY hour ORDER BY count DESC LIMIT 1
    `).get(cutoff) as { hour: number; count: number } | undefined;

    res.json({
      heatmap: heatmapData,
      daily_totals: dailyTotals,
      peak_hour: peakHour || null,
      period_days: days,
    });
  } catch (error: any) {
    console.error('Failed login heatmap error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get login heatmap', code: 'LOGIN_HEATMAP_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 2: Suspicious Activity Scoring
// Calculates a risk score for each IP or user based on patterns.
// ════════════════════════════════════════════════════════════
router.get('/suspicious-activity', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Score IPs: weight by failures, targeted accounts, time clustering
    const ipScores = db.prepare(`
      SELECT
        ip_address,
        COUNT(*) as total_attempts,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
        COUNT(DISTINCT username) as unique_accounts_targeted,
        MAX(created_at) as last_attempt,
        MIN(created_at) as first_attempt
      FROM login_attempts
      WHERE created_at >= ?
      GROUP BY ip_address
      HAVING failures >= 2
      ORDER BY failures DESC
      LIMIT 50
    `).all(cutoff7d) as any[];

    const scoredIps = ipScores.map((ip: any) => {
      let score = 0;
      // High failure count
      score += Math.min(ip.failures * 10, 50);
      // Multiple accounts targeted = credential stuffing
      score += Math.min(ip.unique_accounts_targeted * 15, 45);
      // No successful logins = likely attacker
      if (ip.successes === 0) score += 20;
      // Rapid-fire attempts (many in short window)
      const spanMs = new Date(ip.last_attempt).getTime() - new Date(ip.first_attempt).getTime();
      const spanHours = spanMs / (60 * 60 * 1000);
      if (spanHours > 0 && ip.failures / spanHours > 10) score += 25;

      return {
        ip_address: ip.ip_address,
        total_attempts: ip.total_attempts,
        failures: ip.failures,
        successes: ip.successes,
        unique_accounts_targeted: ip.unique_accounts_targeted,
        last_attempt: ip.last_attempt,
        risk_score: Math.min(score, 100),
        risk_level: score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low',
      };
    });

    // Score users: multiple failures, after-hours logins
    const userScores = db.prepare(`
      SELECT
        username,
        COUNT(*) as total_attempts,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
        COUNT(DISTINCT ip_address) as unique_ips,
        MAX(created_at) as last_attempt
      FROM login_attempts
      WHERE created_at >= ?
      GROUP BY username
      HAVING failures >= 3
      ORDER BY failures DESC
      LIMIT 50
    `).all(cutoff7d) as any[];

    const scoredUsers = userScores.map((u: any) => {
      let score = 0;
      score += Math.min(u.failures * 5, 30);
      score += Math.min(u.unique_ips * 10, 40);
      // Lots of IPs trying same account = distributed attack
      if (u.unique_ips >= 5) score += 30;
      return {
        username: u.username,
        total_attempts: u.total_attempts,
        failures: u.failures,
        unique_ips: u.unique_ips,
        last_attempt: u.last_attempt,
        risk_score: Math.min(score, 100),
        risk_level: score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low',
      };
    });

    res.json({
      ip_risks: scoredIps.sort((a, b) => b.risk_score - a.risk_score),
      user_risks: scoredUsers.sort((a, b) => b.risk_score - a.risk_score),
      summary: {
        critical_ips: scoredIps.filter(i => i.risk_level === 'critical').length,
        high_risk_ips: scoredIps.filter(i => i.risk_level === 'high').length,
        critical_users: scoredUsers.filter(u => u.risk_level === 'critical').length,
      },
    });
  } catch (error: any) {
    console.error('Suspicious activity error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get suspicious activity', code: 'SUSPICIOUS_ACTIVITY_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 3: IP Geolocation for Login Attempts
// Returns login attempts with basic geo derived from IP ranges.
// Uses a simple mapping approach (no external API).
// ════════════════════════════════════════════════════════════
router.get('/login-geo', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(String(req.query.limit || '100'), 10), 500);
    const onlyFailed = req.query.only_failed === '1' || req.query.only_failed === 'true';

    let where = "WHERE created_at >= datetime('now', 'localtime', '-30 days')";
    if (onlyFailed) where += ' AND success = 0';

    const attempts = db.prepare(`
      SELECT ip_address, username, success, failure_reason, user_agent, created_at
      FROM login_attempts
      ${where}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as any[];

    // Simple IP classification (private vs public ranges)
    const geoAttempts = attempts.map((a: any) => {
      const ip = a.ip_address || '';
      let geo_type = 'public';
      let geo_label = 'External';
      if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.16.') ||
          ip.startsWith('172.17.') || ip.startsWith('172.18.') || ip.startsWith('172.19.') ||
          ip.startsWith('172.2') || ip.startsWith('172.3') ||
          ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
        geo_type = 'local';
        geo_label = 'Internal Network';
      }
      return {
        ...a,
        geo_type,
        geo_label,
        // Parse basic browser info from user_agent
        browser: parseBrowserFromUA(a.user_agent || ''),
      };
    });

    // Group by IP for summary
    const ipSummary: Record<string, { count: number; failures: number; last_seen: string }> = {};
    for (const a of geoAttempts) {
      const key = a.ip_address || 'unknown';
      if (!ipSummary[key]) ipSummary[key] = { count: 0, failures: 0, last_seen: a.created_at };
      ipSummary[key].count++;
      if (!a.success) ipSummary[key].failures++;
      if (a.created_at > ipSummary[key].last_seen) ipSummary[key].last_seen = a.created_at;
    }

    res.json({
      attempts: geoAttempts,
      ip_summary: Object.entries(ipSummary).map(([ip, data]) => ({ ip_address: ip, ...data })),
    });
  } catch (error: any) {
    console.error('Login geo error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get login geo data', code: 'LOGIN_GEO_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 4: Security Event Timeline
// Returns a chronological timeline of all security-relevant
// events (logins, lockouts, device changes, password changes).
// ════════════════════════════════════════════════════════════
router.get('/event-timeline', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(String(req.query.limit || '100'), 10), 500);
    const days = Math.min(90, Math.max(1, parseInt(String(req.query.days || '7'), 10)));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Combine multiple event sources into a unified timeline
    const events: any[] = [];

    // 1. Login attempts (both success and failure)
    const logins = db.prepare(`
      SELECT 'login_attempt' as event_type, username as actor,
        ip_address, success, failure_reason as detail, created_at as event_time
      FROM login_attempts
      WHERE created_at >= ?
      ORDER BY created_at DESC LIMIT ?
    `).all(cutoff, limit) as any[];
    for (const l of logins) {
      events.push({
        event_type: l.success ? 'login_success' : 'login_failure',
        actor: l.actor,
        ip_address: l.ip_address,
        detail: l.success ? 'Successful login' : `Failed: ${l.detail || 'invalid credentials'}`,
        severity: l.success ? 'info' : 'warning',
        event_time: l.event_time,
      });
    }

    // 2. Security notifications (device revoked, password changes, etc.)
    const notifications = db.prepare(`
      SELECT sn.event_type, sn.title, sn.details as detail, sn.ip_address,
        sn.created_at as event_time, u.username as actor
      FROM security_notifications sn
      LEFT JOIN users u ON sn.user_id = u.id
      WHERE sn.created_at >= ?
      ORDER BY sn.created_at DESC LIMIT ?
    `).all(cutoff, limit) as any[];
    for (const n of notifications) {
      events.push({
        event_type: n.event_type || 'security_notification',
        actor: n.actor || 'system',
        ip_address: n.ip_address,
        detail: n.detail || n.title,
        severity: 'medium',
        event_time: n.event_time,
      });
    }

    // 3. Admin security actions from activity_log
    const adminActions = db.prepare(`
      SELECT al.action as event_type, al.details as detail, al.ip_address,
        al.created_at as event_time, u.username as actor
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.created_at >= ?
        AND al.action IN ('user_login', 'user_logout', 'password_changed', 'totp_enabled',
          'totp_disabled', 'user_created', 'user_deactivated', 'user_role_changed',
          'user_login_trusted_device', 'force_password_change')
      ORDER BY al.created_at DESC LIMIT ?
    `).all(cutoff, limit) as any[];
    for (const a of adminActions) {
      events.push({
        event_type: a.event_type,
        actor: a.actor || 'system',
        ip_address: a.ip_address,
        detail: a.detail,
        severity: ['user_deactivated', 'totp_disabled', 'force_password_change'].includes(a.event_type) ? 'high' : 'info',
        event_time: a.event_time,
      });
    }

    // Sort by event_time descending and limit
    events.sort((a, b) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime());
    const trimmed = events.slice(0, limit);

    res.json({
      events: trimmed,
      total: trimmed.length,
      period_days: days,
    });
  } catch (error: any) {
    console.error('Security event timeline error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get event timeline', code: 'EVENT_TIMELINE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 5: Session Analytics
// Provides stats about active sessions across all users.
// ════════════════════════════════════════════════════════════
router.get('/session-analytics', authenticateToken, requireRole('admin'), (_req: Request, res: Response) => {
  try {
    const db = getDb();

    const totalActive = db.prepare(
      'SELECT COUNT(*) as count FROM sessions WHERE is_active = 1'
    ).get() as { count: number };

    const byUser = db.prepare(`
      SELECT u.username, u.full_name, u.role, COUNT(*) as session_count,
        MAX(s.last_used_at) as last_active
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.is_active = 1
      GROUP BY s.user_id
      ORDER BY session_count DESC
      LIMIT 50
    `).all() as any[];

    const stale = db.prepare(`
      SELECT COUNT(*) as count FROM sessions
      WHERE is_active = 1 AND last_used_at < datetime('now', '-24 hours')
    `).get() as { count: number };

    res.json({
      total_active_sessions: totalActive.count,
      stale_sessions: stale.count,
      sessions_by_user: byUser,
    });
  } catch (error: any) {
    console.error('Session analytics error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get session analytics', code: 'SESSION_ANALYTICS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 6: Password Compliance Report
// Shows which users have expired/expiring passwords,
// users who haven't changed passwords recently, etc.
// ════════════════════════════════════════════════════════════
router.get('/password-compliance', authenticateToken, requireRole('admin', 'manager', 'supervisor'), (_req: Request, res: Response) => {
  try {
    const db = getDb();

    const users = db.prepare(`
      SELECT id, username, full_name, role, status, password_changed_at,
        password_expires_at, force_password_change, totp_enabled, last_login_at
      FROM users WHERE status = 'active'
      ORDER BY password_changed_at ASC
    `).all() as any[];

    const now = new Date();
    const report = users.map((u: any) => {
      const changedAt = u.password_changed_at ? new Date(u.password_changed_at) : null;
      const daysSinceChange = changedAt ? Math.floor((now.getTime() - changedAt.getTime()) / (24 * 60 * 60 * 1000)) : null;
      const expired = u.password_expires_at ? new Date(u.password_expires_at) < now : false;
      const expiringSoon = u.password_expires_at
        ? new Date(u.password_expires_at).getTime() - now.getTime() < 14 * 24 * 60 * 60 * 1000 && !expired
        : false;

      return {
        user_id: u.id,
        username: u.username,
        full_name: u.full_name,
        role: u.role,
        password_changed_at: u.password_changed_at,
        days_since_change: daysSinceChange,
        password_expired: expired,
        password_expiring_soon: expiringSoon,
        force_change_required: u.force_password_change === 1,
        totp_enabled: u.totp_enabled === 1,
        last_login: u.last_login_at,
      };
    });

    const summary = {
      total_active_users: report.length,
      passwords_expired: report.filter(r => r.password_expired).length,
      passwords_expiring_soon: report.filter(r => r.password_expiring_soon).length,
      force_change_pending: report.filter(r => r.force_change_required).length,
      totp_enabled_count: report.filter(r => r.totp_enabled).length,
      totp_disabled_count: report.filter(r => !r.totp_enabled).length,
    };

    res.json({ users: report, summary });
  } catch (error: any) {
    console.error('Password compliance error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get password compliance', code: 'PASSWORD_COMPLIANCE_ERROR' });
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
>>>>>>> origin/main
  }
});

export default router;
