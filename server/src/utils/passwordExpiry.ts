import bcryptjs from 'bcryptjs';
import { getDb } from '../models/database';
import { localNow } from './timeUtils';
import config from '../config';

// ─── Check if a user's password has expired ─────────────
// Respects the password_expiry_exempt flag — exempt users never expire.

export function isPasswordExpired(user: { password_expires_at?: string | null; password_expiry_exempt?: number | null }): boolean {
  if (user.password_expiry_exempt) return false;
  if (!user.password_expires_at) return false;
  return new Date(user.password_expires_at) < new Date();
}

// ─── Check if password is expiring soon (within warning period) ──

export function isPasswordExpiringSoon(user: { password_expires_at?: string | null; password_expiry_exempt?: number | null }): boolean {
  if (user.password_expiry_exempt) return false;
  if (!user.password_expires_at) return false;
  const warningMs = config.password.expiryWarningDays * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(user.password_expires_at).getTime();
  const now = Date.now();
  return expiresAt > now && (expiresAt - now) < warningMs;
}

// ─── Set password expiry from now ───────────────────────
// Skips exempt users — they keep password_expires_at as NULL.

export function setPasswordExpiry(userId: number): void {
  const db = getDb();

  // Check exemption before setting expiry
  const user = db.prepare('SELECT password_expiry_exempt FROM users WHERE id = ?').get(userId) as { password_expiry_exempt: number } | undefined;
  if (user?.password_expiry_exempt) {
    // Still clear force flag and update timestamps, but don't set expiry
    db.prepare(`
      UPDATE users SET password_expires_at = NULL, password_changed_at = ?, force_password_change = 0, updated_at = ?
      WHERE id = ?
    `).run(localNow(), localNow(), userId);
    return;
  }

  const expiresAt = new Date(
    Date.now() + config.password.expiryDays * 24 * 60 * 60 * 1000
  ).toISOString();

  db.prepare(`
    UPDATE users SET password_expires_at = ?, password_changed_at = ?, force_password_change = 0, updated_at = ?
    WHERE id = ?
  `).run(expiresAt, localNow(), localNow(), userId);
}

// ─── Check new password against history ─────────────────

export function isPasswordInHistory(userId: number, newPassword: string): boolean {
  const db = getDb();
  const history = db.prepare(`
    SELECT password_hash FROM password_history
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, config.password.historyCount) as { password_hash: string }[];

  for (const entry of history) {
    if (bcryptjs.compareSync(newPassword, entry.password_hash)) {
      return true;
    }
  }

  return false;
}

// ─── Add current password hash to history ───────────────

export function addToPasswordHistory(userId: number, passwordHash: string): void {
  const db = getDb();

  // Insert the hash into history
  db.prepare('INSERT INTO password_history (user_id, password_hash) VALUES (?, ?)')
    .run(userId, passwordHash);

  // Prune old entries beyond the history count
  db.prepare(`
    DELETE FROM password_history
    WHERE user_id = ? AND id NOT IN (
      SELECT id FROM password_history
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    )
  `).run(userId, userId, config.password.historyCount);
}
