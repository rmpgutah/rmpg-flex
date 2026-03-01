// ============================================================
// RMPG Flex — PIN Manager
// Deterministic HMAC-based PIN system for offline authorization.
// Admin generates a 6-digit PIN for an employee; employee enters
// it on their machine. Both computed offline — no server needed.
//
// PIN = HMAC-SHA256(user_secret, "${user_secret}:${window_start}:${admin_secret}")
//       → truncated to 6 digits
//
// 24-hour window: midnight-to-midnight Mountain Time.
// Brute-force: 5 failures = 15-minute lockout.
// ============================================================

const crypto = require('crypto');

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const PIN_DURATION_HOURS = 24;

let localDb = null;
let expiryCheckHandle = null;

function init(db) {
  localDb = db;

  // Check for expired sessions every 60 seconds
  expiryCheckHandle = setInterval(checkExpiredSessions, 60_000);
  // Initial check after 5 seconds
  setTimeout(checkExpiredSessions, 5000);

  console.log('[PIN] Manager initialized');
}

function stop() {
  if (expiryCheckHandle) {
    clearInterval(expiryCheckHandle);
    expiryCheckHandle = null;
  }
}

// Get the current 24h window start (midnight Mountain Time)
function getWindowStart() {
  // Mountain Time offset: UTC-7 (MST) or UTC-6 (MDT)
  // For simplicity, use the local system timezone which should be Mountain
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}T00:00:00`;
}

// Generate a deterministic 6-digit PIN
function generatePin(userSecret, adminSecret) {
  const windowStart = getWindowStart();
  const payload = `${userSecret}:${windowStart}:${adminSecret}`;
  const hmac = crypto.createHmac('sha256', userSecret).update(payload).digest('hex');
  // Take first 8 hex chars → convert to number → mod 1000000 → pad to 6 digits
  const num = parseInt(hmac.substring(0, 8), 16) % 1000000;
  return String(num).padStart(6, '0');
}

// Admin: generate PIN for an employee
function generatePinForUser(userId) {
  if (!localDb) throw new Error('PIN Manager not initialized');

  const user = localDb.prepare('SELECT id, username, offline_secret FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('User not found in local database');
  if (!user.offline_secret) throw new Error('User has no offline secret — sync from server first');

  const adminSecretRow = localDb.prepare("SELECT value FROM local_config WHERE key = 'admin_secret'").get();
  if (!adminSecretRow) throw new Error('Admin secret not configured — sync from server first');

  const pin = generatePin(user.offline_secret, adminSecretRow.value);

  // Calculate expiry (end of current 24h window)
  const now = new Date();
  const expiry = new Date(now);
  expiry.setHours(23, 59, 59, 999);
  // If past 6pm, extend to next day end (give at least 6 hours)
  if (now.getHours() >= 18) {
    expiry.setDate(expiry.getDate() + 1);
  }

  return {
    pin,
    user_id: userId,
    username: user.username,
    expires_at: expiry.toISOString(),
    valid_until: expiry.toLocaleString('en-US', { timeZone: 'America/Denver' }),
  };
}

// Employee: validate a PIN
function validatePin(userId, enteredPin) {
  if (!localDb) throw new Error('PIN Manager not initialized');

  // Check for lockout
  if (isLockedOut(userId)) {
    return { valid: false, error: 'Too many failed attempts. Locked out for 15 minutes.', locked: true };
  }

  const user = localDb.prepare('SELECT id, username, offline_secret, role FROM users WHERE id = ?').get(userId);
  if (!user) return { valid: false, error: 'User not found locally' };

  // Admin role doesn't need a PIN
  if (user.role === 'admin') {
    return { valid: true, role: 'admin', message: 'Admin has persistent offline access' };
  }

  if (!user.offline_secret) return { valid: false, error: 'No offline secret for this user' };

  const adminSecretRow = localDb.prepare("SELECT value FROM local_config WHERE key = 'admin_secret'").get();
  if (!adminSecretRow) return { valid: false, error: 'System not configured for offline access' };

  const expectedPin = generatePin(user.offline_secret, adminSecretRow.value);
  const isValid = enteredPin === expectedPin;

  // Record attempt
  localDb.prepare('INSERT INTO pin_attempts (user_id, success) VALUES (?, ?)').run(userId, isValid ? 1 : 0);

  if (!isValid) {
    const remaining = getRemainingAttempts(userId);
    return { valid: false, error: `Invalid PIN. ${remaining} attempt(s) remaining.`, remaining };
  }

  // Create session
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PIN_DURATION_HOURS * 60 * 60 * 1000);

  // Deactivate any existing sessions for this user
  localDb.prepare('UPDATE pin_sessions SET is_active = 0 WHERE user_id = ?').run(userId);

  localDb.prepare('INSERT INTO pin_sessions (user_id, expires_at) VALUES (?, ?)').run(
    userId,
    expiresAt.toISOString().replace('T', ' ').substring(0, 19)
  );

  console.log('[PIN] Session created for user', userId, '— expires', expiresAt.toISOString());

  return {
    valid: true,
    session_expires: expiresAt.toISOString(),
    message: `Offline access granted for ${PIN_DURATION_HOURS} hours`,
  };
}

// Check if a user is authorized for offline writes
function isAuthorized(userId) {
  if (!localDb) return false;

  const user = localDb.prepare('SELECT role FROM users WHERE id = ?').get(userId);
  // Admin always has access
  if (user && user.role === 'admin') return true;

  // Check for active PIN session
  const session = localDb.prepare(`
    SELECT id, expires_at FROM pin_sessions
    WHERE user_id = ? AND is_active = 1 AND expires_at > datetime('now','localtime')
    ORDER BY expires_at DESC LIMIT 1
  `).get(userId);

  return !!session;
}

function getSessionInfo(userId) {
  if (!localDb) return null;

  const user = localDb.prepare('SELECT role FROM users WHERE id = ?').get(userId);
  if (user && user.role === 'admin') {
    return { authorized: true, type: 'admin', expires_at: null, permanent: true };
  }

  const session = localDb.prepare(`
    SELECT id, granted_at, expires_at FROM pin_sessions
    WHERE user_id = ? AND is_active = 1 AND expires_at > datetime('now','localtime')
    ORDER BY expires_at DESC LIMIT 1
  `).get(userId);

  if (!session) return { authorized: false };

  return {
    authorized: true,
    type: 'pin_session',
    granted_at: session.granted_at,
    expires_at: session.expires_at,
    permanent: false,
  };
}

function isLockedOut(userId) {
  const cutoff = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000)
    .toISOString().replace('T', ' ').substring(0, 19);

  const failures = localDb.prepare(`
    SELECT COUNT(*) as count FROM pin_attempts
    WHERE user_id = ? AND success = 0 AND attempted_at > ?
  `).get(userId, cutoff);

  return failures.count >= MAX_ATTEMPTS;
}

function getRemainingAttempts(userId) {
  const cutoff = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000)
    .toISOString().replace('T', ' ').substring(0, 19);

  const failures = localDb.prepare(`
    SELECT COUNT(*) as count FROM pin_attempts
    WHERE user_id = ? AND success = 0 AND attempted_at > ?
  `).get(userId, cutoff);

  return Math.max(0, MAX_ATTEMPTS - failures.count);
}

function checkExpiredSessions() {
  if (!localDb) return;

  try {
    const expired = localDb.prepare(`
      UPDATE pin_sessions SET is_active = 0
      WHERE is_active = 1 AND expires_at <= datetime('now','localtime')
    `).run();

    if (expired.changes > 0) {
      console.log('[PIN] Deactivated', expired.changes, 'expired session(s)');
      // Notify renderer
      const { BrowserWindow } = require('electron');
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('offline:pin-expired');
        }
      }
    }
  } catch (err) {
    console.error('[PIN] Expiry check error:', err.message);
  }
}

function getActiveSessions() {
  if (!localDb) return [];
  return localDb.prepare(`
    SELECT ps.*, u.username, u.full_name
    FROM pin_sessions ps
    JOIN users u ON ps.user_id = u.id
    WHERE ps.is_active = 1
    ORDER BY ps.expires_at DESC
  `).all();
}

module.exports = {
  init, stop,
  generatePinForUser, validatePin,
  isAuthorized, getSessionInfo,
  getActiveSessions,
};
