import { getDb } from '../models/database';
import { broadcast } from './websocket';

export function createSecurityAlert(
  alertType: string,
  severity: 'low' | 'medium' | 'high' | 'critical',
  title: string,
  details?: string,
  sourceIp?: string,
  userId?: number
): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO security_alerts (alert_type, severity, title, details, source_ip, user_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(alertType, severity, title, details || null, sourceIp || null, userId || null);

  const id = result.lastInsertRowid as number;

  // Broadcast to admin users for real-time security dashboard
  try {
    broadcast('admin', 'security_alert', { id, alertType, severity, title, details, sourceIp, userId });
  } catch { /* WebSocket may not be initialized */ }

  return id;
}

export function checkLoginAnomalies(ip: string, username: string): void {
  try {
    const db = getDb();

    // Check for 5+ failures from same IP in last 5 minutes
    const recentFailures = db.prepare(`
      SELECT COUNT(*) as count FROM login_attempts
      WHERE ip_address = ? AND success = 0
        AND created_at > datetime('now', 'localtime', '-5 minutes')
    `).get(ip) as { count: number };

    if (recentFailures.count < 5) return;

    // Deduplicate: only 1 alert per IP per 15 minutes
    const existing = db.prepare(`
      SELECT id FROM security_alerts
      WHERE alert_type = 'brute_force' AND source_ip = ?
        AND created_at > datetime('now', 'localtime', '-15 minutes')
    `).get(ip);

    if (existing) return;

    createSecurityAlert(
      'brute_force',
      'high',
      `Brute-force login attempt from ${ip}`,
      `${recentFailures.count} failed login attempts in 5 minutes. Last username tried: ${username}`,
      ip
    );
  } catch { /* Don't break login flow on alert failure */ }
}

export function alertPrivilegeEscalation(
  targetUserId: number,
  targetUsername: string,
  oldRole: string,
  newRole: string,
  changedBy: string,
  ip: string
): void {
  try {
    const severity = newRole === 'admin' ? 'critical' as const : 'high' as const;
    createSecurityAlert(
      'privilege_escalation',
      severity,
      `Role changed: ${targetUsername} ${oldRole} → ${newRole}`,
      `User ${targetUsername} (ID: ${targetUserId}) role changed from ${oldRole} to ${newRole} by ${changedBy}`,
      ip,
      targetUserId
    );
  } catch { /* Don't break role change flow on alert failure */ }
}
