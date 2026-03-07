import crypto from 'crypto';
import { getDb } from '../models/database';
import { localNow } from './timeUtils';
import config from '../config';

// ─── Parse a human-readable device name from user-agent ──

export function parseDeviceName(userAgent: string): string {
  if (!userAgent) return 'Unknown Device';

  // Browser detection
  let browser = 'Unknown Browser';
  if (userAgent.includes('Edg/')) browser = 'Edge';
  else if (userAgent.includes('Chrome/')) browser = 'Chrome';
  else if (userAgent.includes('Firefox/')) browser = 'Firefox';
  else if (userAgent.includes('Safari/') && !userAgent.includes('Chrome')) browser = 'Safari';
  else if (userAgent.includes('Electron')) browser = 'Desktop App';

  // OS detection
  let os = 'Unknown OS';
  if (userAgent.includes('Windows')) os = 'Windows';
  else if (userAgent.includes('Mac OS')) os = 'macOS';
  else if (userAgent.includes('Linux')) os = 'Linux';
  else if (userAgent.includes('Android')) os = 'Android';
  else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) os = 'iOS';

  return `${browser} on ${os}`;
}

// ─── Generate server-side device fingerprint hash ────────

export function hashDeviceFingerprint(fingerprint: string): string {
  return crypto.createHash('sha256').update(fingerprint).digest('hex');
}

// ─── Check if a device is trusted for a user ────────────

export function isDeviceTrusted(userId: number, deviceFingerprint: string): boolean {
  const db = getDb();
  const now = localNow();
  const fpHash = hashDeviceFingerprint(deviceFingerprint);

  const device = db.prepare(`
    SELECT id FROM trusted_devices
    WHERE user_id = ? AND device_fingerprint = ? AND trusted_until > ?
  `).get(userId, fpHash, now) as { id: number } | undefined;

  if (device) {
    // Update last_used_at
    db.prepare('UPDATE trusted_devices SET last_used_at = ? WHERE id = ?')
      .run(now, device.id);
    return true;
  }

  return false;
}

// ─── Trust a device for the configured duration ─────────

export function trustDevice(
  userId: number,
  deviceFingerprint: string,
  ip: string,
  userAgent: string
): void {
  const db = getDb();
  const fpHash = hashDeviceFingerprint(deviceFingerprint);
  const deviceName = parseDeviceName(userAgent);
  const trustedUntil = new Date(
    Date.now() + config.twoFactor.trustedDeviceDays * 24 * 60 * 60 * 1000
  ).toISOString();

  // Upsert: replace existing trust for same device
  db.prepare(`
    DELETE FROM trusted_devices WHERE user_id = ? AND device_fingerprint = ?
  `).run(userId, fpHash);

  db.prepare(`
    INSERT INTO trusted_devices (user_id, device_fingerprint, device_name, ip_address, trusted_until)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, fpHash, deviceName, ip, trustedUntil);
}

// ─── Check if this is a new device for the user ─────────

export function isNewDevice(userId: number, deviceFingerprint: string): boolean {
  const db = getDb();
  const fpHash = hashDeviceFingerprint(deviceFingerprint);

  // Check if we've seen this device fingerprint in successful login attempts
  const previous = db.prepare(`
    SELECT id FROM login_attempts
    WHERE username = (SELECT username FROM users WHERE id = ?)
    AND device_fingerprint = ? AND success = 1
    LIMIT 1
  `).get(userId, fpHash) as { id: number } | undefined;

  return !previous;
}

// ─── Create a security notification ─────────────────────

export function createSecurityNotification(
  userId: number,
  eventType: string,
  title: string,
  details?: string,
  ip?: string,
  deviceInfo?: string
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO security_notifications (user_id, event_type, title, details, ip_address, device_info)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, eventType, title, details || null, ip || null, deviceInfo || null);
}

// ─── Clean up expired trusted devices ───────────────────

export function cleanExpiredDevices(): void {
  const db = getDb();
  db.prepare('DELETE FROM trusted_devices WHERE trusted_until < ?').run(localNow());
}
