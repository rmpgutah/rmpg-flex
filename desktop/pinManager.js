// ============================================================
// RMPG Flex — PIN Manager
// Deterministic HMAC-based PIN generation and validation for
// the 24-hour offline override system. Both admin (generating)
// and employee (entering) can work fully offline.
// ============================================================

const crypto = require('crypto');
const { getLocalDb, getConfig, setConfig } = require('./localDb');

let mainWindow = null;
let expiryTimer = null;

// ─── Constants ───────────────────────────────────────────────
const PIN_LENGTH = 6;
const PIN_WINDOW_HOURS = 24;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// ─── Initialization ─────────────────────────────────────────

function init(window) {
  mainWindow = window;

  // Start expiry check timer (every 60 seconds)
  expiryTimer = setInterval(checkExpiredSessions, 60_000);
}

function destroy() {
  if (expiryTimer) {
    clearInterval(expiryTimer);
    expiryTimer = null;
  }
}

// ─── PIN Generation (Admin) ──────────────────────────────────

/**
 * Generate a 6-digit PIN for a specific employee.
 * Called by the admin via IPC.
 * @param {number} userId - The employee's user ID
 * @returns {{ pin: string, expiresAt: string } | { error: string }}
 */
function generatePinForUser(userId) {
  const adminSecret = getConfig('admin_offline_secret');
  if (!adminSecret) {
    return { error: 'Admin offline secret not configured. Sync with server first.' };
  }

  // Get the target user's secret
  let userSecret;
  const allSecrets = getConfig('all_user_secrets');
  if (allSecrets) {
    const parsed = JSON.parse(allSecrets);
    const match = parsed.find(s => String(s.user_id) === String(userId));
    if (match) userSecret = match.secret;
  }

  if (!userSecret) {
    return { error: 'No offline secret found for this user. Generate one in the admin panel first.' };
  }

  const windowStart = get24hWindowStart();
  const pin = computePin(userSecret, adminSecret, windowStart);
  const expiresAt = new Date(new Date(windowStart).getTime() + PIN_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  return { pin, expiresAt, userId };
}

// ─── PIN Validation (Employee) ───────────────────────────────

/**
 * Validate a 6-digit PIN entered by the employee.
 * Creates a pin_session if valid.
 * @param {string} inputPin - The PIN entered by the employee
 * @returns {{ success: boolean, expiresAt?: string, error?: string, attemptsRemaining?: number }}
 */
function validatePin(inputPin) {
  const db = getLocalDb();
  const userId = getConfig('current_user_id');
  const userRole = getConfig('current_user_role');

  if (!userId) {
    return { success: false, error: 'Not authenticated' };
  }

  // Admin always has access — no PIN needed
  if (userRole === 'admin') {
    return { success: true, expiresAt: null };
  }

  // Check brute-force lockout
  const lockoutStatus = checkLockout(userId);
  if (lockoutStatus.locked) {
    return {
      success: false,
      error: `Too many failed attempts. Try again in ${lockoutStatus.minutesRemaining} minutes.`,
      attemptsRemaining: 0,
    };
  }

  // Get secrets for validation
  const userSecret = getConfig('my_offline_secret');
  const adminSecret = getConfig('admin_offline_secret');

  if (!userSecret || !adminSecret) {
    return { success: false, error: 'Offline secrets not configured. Must be online at least once.' };
  }

  // Validate against current window
  const windowStart = get24hWindowStart();
  const expectedPin = computePin(userSecret, adminSecret, windowStart);

  // Also check previous window (handles edge case around midnight)
  const prevWindowStart = new Date(new Date(windowStart).getTime() - PIN_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const prevExpectedPin = computePin(userSecret, adminSecret, prevWindowStart);

  const now = new Date().toISOString();

  // Constant-time comparison
  const currentMatch = safeCompare(inputPin, expectedPin);
  const prevMatch = safeCompare(inputPin, prevExpectedPin);

  if (currentMatch || prevMatch) {
    // Record successful attempt
    recordAttempt(userId, true);

    // Create a 24h session
    const expiresAt = new Date(Date.now() + PIN_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO pin_sessions (user_id, authorized_at, expires_at, is_active, created_at)
      VALUES (?, ?, ?, 1, ?)
    `).run(userId, now, expiresAt, now);

    // Notify renderer
    emit('offline:authorization-changed', { isLocalAuthorized: true, expiresAt });

    return { success: true, expiresAt };
  }

  // Record failed attempt
  recordAttempt(userId, false);
  const remaining = MAX_ATTEMPTS - lockoutStatus.recentFailures - 1;

  return {
    success: false,
    error: 'Invalid PIN',
    attemptsRemaining: Math.max(0, remaining),
  };
}

// ─── PIN Computation ─────────────────────────────────────────

/**
 * Compute a deterministic 6-digit PIN using HMAC-SHA256.
 * The PIN is derived from: user_secret + window_start + admin_secret.
 * Uses the same truncation approach as HOTP (RFC 4226).
 */
function computePin(userSecret, adminSecret, windowStart) {
  const message = `${userSecret}:${windowStart}:${adminSecret}`;
  const hmac = crypto.createHmac('sha256', userSecret);
  hmac.update(message);
  const hash = hmac.digest('hex');

  // Dynamic truncation (HOTP-style)
  const offset = parseInt(hash.substring(hash.length - 1), 16);
  const truncated = parseInt(hash.substring(offset * 2, offset * 2 + 8), 16) & 0x7FFFFFFF;
  return String(truncated % Math.pow(10, PIN_LENGTH)).padStart(PIN_LENGTH, '0');
}

/**
 * Get the start of the current 24-hour PIN window.
 * Windows start at midnight Mountain Time.
 */
function get24hWindowStart() {
  const now = new Date();
  // Use Mountain Time for consistency with the server's TZ
  const mtString = now.toLocaleString('en-US', { timeZone: 'America/Denver' });
  const mt = new Date(mtString);
  mt.setHours(0, 0, 0, 0);
  return mt.toISOString();
}

// ─── Brute-Force Protection ─────────────────────────────────

function checkLockout(userId) {
  const db = getLocalDb();
  const cutoff = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000).toISOString();

  const row = db.prepare(`
    SELECT COUNT(*) as count FROM pin_attempts
    WHERE user_id = ? AND success = 0 AND attempted_at > ?
  `).get(userId, cutoff);

  const recentFailures = row ? row.count : 0;

  if (recentFailures >= MAX_ATTEMPTS) {
    // Find when the oldest counted failure was, to calculate remaining lockout
    const oldest = db.prepare(`
      SELECT attempted_at FROM pin_attempts
      WHERE user_id = ? AND success = 0 AND attempted_at > ?
      ORDER BY attempted_at ASC LIMIT 1
    `).get(userId, cutoff);

    const lockoutEnds = oldest
      ? new Date(new Date(oldest.attempted_at).getTime() + LOCKOUT_MINUTES * 60 * 1000)
      : new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
    const minutesRemaining = Math.ceil((lockoutEnds.getTime() - Date.now()) / 60000);

    return { locked: true, minutesRemaining: Math.max(1, minutesRemaining), recentFailures };
  }

  return { locked: false, minutesRemaining: 0, recentFailures };
}

function recordAttempt(userId, success) {
  const db = getLocalDb();
  db.prepare(`
    INSERT INTO pin_attempts (user_id, success, attempted_at) VALUES (?, ?, ?)
  `).run(userId, success ? 1 : 0, new Date().toISOString());
}

// ─── Session Expiry ──────────────────────────────────────────

function checkExpiredSessions() {
  const db = getLocalDb();
  const now = new Date().toISOString();

  const expired = db.prepare(`
    SELECT * FROM pin_sessions WHERE is_active = 1 AND expires_at < ?
  `).all(now);

  for (const session of expired) {
    db.prepare('UPDATE pin_sessions SET is_active = 0 WHERE id = ?').run(session.id);
    console.log(`[PIN] Session expired for user ${session.user_id}`);

    emit('offline:pin-expired', { userId: session.user_id });
    emit('offline:authorization-changed', { isLocalAuthorized: false, expiresAt: null });
  }
}

// ─── Utilities ───────────────────────────────────────────────

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function emit(channel, data) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  } catch { /* ignore */ }
}

module.exports = {
  init,
  destroy,
  generatePinForUser,
  validatePin,
};
