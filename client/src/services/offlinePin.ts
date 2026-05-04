// ============================================================
// RMPG Flex — Browser PIN System (WebCrypto)
// Mirrors desktop/pinManager.js — deterministic HMAC-based PIN
// generation and validation using the Web Crypto API.
// ============================================================

import { getOfflineDb, getConfig } from './offlineDb';

// ─── Constants ───────────────────────────────────────────────

const PIN_LENGTH = 6;
const PIN_WINDOW_HOURS = 24;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// ─── Event Emitter ──────────────────────────────────────────

type PinEventType = 'authorization-changed' | 'pin-expired';
type PinEventCallback = (data: any) => void;

const listeners: Map<PinEventType, Set<PinEventCallback>> = new Map();

export function onPinEvent(event: PinEventType, callback: PinEventCallback): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(callback);
  return () => { listeners.get(event)?.delete(callback); };
}

function emit(event: PinEventType, data: any): void {
  listeners.get(event)?.forEach(cb => {
    try { cb(data); } catch { /* ignore */ }
  });
}

// ─── Expiry Timer ───────────────────────────────────────────

let expiryTimer: ReturnType<typeof setInterval> | null = null;

export function startExpiryTimer(): void {
  if (expiryTimer) return;
  expiryTimer = setInterval(() => { checkExpiredSessions(); }, 60_000);
}

export function stopExpiryTimer(): void {
  if (expiryTimer) {
    clearInterval(expiryTimer);
    expiryTimer = null;
  }
}

// ─── PIN Generation (Admin) ─────────────────────────────────

/**
 * Generate a 6-digit PIN for a specific employee.
 * Called by the admin in the browser.
 */
export async function generatePinForUser(
  userId: number
): Promise<{ pin: string; expiresAt: string; userId: number } | { error: string }> {
  const adminSecret = await getConfig('admin_offline_secret');
  if (!adminSecret) {
    return { error: 'Admin offline secret not configured. Sync with server first.' };
  }

  // Get the target user's secret
  let userSecret: string | undefined;
  const allSecretsRaw = await getConfig('all_user_secrets');
  if (allSecretsRaw) {
    try {
      const parsed = JSON.parse(allSecretsRaw);
      const match = parsed.find((s: any) => String(s.user_id) === String(userId));
      if (match) userSecret = match.secret;
    } catch { /* ignore parse errors */ }
  }

  if (!userSecret) {
    return { error: 'No offline secret found for this user. Generate one in the admin panel first.' };
  }

  const windowStart = get24hWindowStart();
  const pin = await computePin(userSecret, adminSecret, windowStart);
  const expiresAt = new Date(
    new Date(windowStart).getTime() + PIN_WINDOW_HOURS * 60 * 60 * 1000
  ).toISOString();

  return { pin, expiresAt, userId };
}

// ─── PIN Validation (Employee) ──────────────────────────────

/**
 * Validate a 6-digit PIN entered by the employee.
 * Creates a pin_session if valid.
 */
export async function validatePin(inputPin: string): Promise<{
  success: boolean;
  expiresAt?: string | null;
  error?: string;
  attemptsRemaining?: number;
}> {
  const db = getOfflineDb();
  const userId = await getConfig('current_user_id');
  const userRole = await getConfig('current_user_role');

  if (!userId) {
    return { success: false, error: 'Not authenticated' };
  }

  const userIdNum = parseInt(userId, 10);

  // Admin always has access — no PIN needed
  if (userRole === 'admin') {
    return { success: true, expiresAt: null };
  }

  // Check brute-force lockout
  const lockoutStatus = await checkLockout(userIdNum);
  if (lockoutStatus.locked) {
    return {
      success: false,
      error: `Too many failed attempts. Try again in ${lockoutStatus.minutesRemaining} minutes.`,
      attemptsRemaining: 0,
    };
  }

  // Get secrets for validation
  const userSecret = await getConfig('my_offline_secret');
  const adminSecret = await getConfig('admin_offline_secret');

  if (!userSecret || !adminSecret) {
    return { success: false, error: 'Offline secrets not configured. Must be online at least once.' };
  }

  // Validate against current window
  const windowStart = get24hWindowStart();
  const expectedPin = await computePin(userSecret, adminSecret, windowStart);

  // Also check previous window (handles edge case around midnight)
  const prevWindowStart = new Date(
    new Date(windowStart).getTime() - PIN_WINDOW_HOURS * 60 * 60 * 1000
  ).toISOString();
  const prevExpectedPin = await computePin(userSecret, adminSecret, prevWindowStart);

  const now = new Date().toISOString();

  // String comparison (see Insight comment above re: timing attacks)
  const currentMatch = inputPin === expectedPin;
  const prevMatch = inputPin === prevExpectedPin;

  if (currentMatch || prevMatch) {
    // Record successful attempt
    await recordAttempt(userIdNum, true);

    // Create a 24h session
    const expiresAt = new Date(Date.now() + PIN_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

    await db.add('pin_sessions', {
      user_id: userIdNum,
      authorized_at: now,
      expires_at: expiresAt,
      is_active: 1,
      created_at: now,
    } as any);

    // Notify listeners
    emit('authorization-changed', { isLocalAuthorized: true, expiresAt });

    return { success: true, expiresAt };
  }

  // Record failed attempt
  await recordAttempt(userIdNum, false);
  const remaining = MAX_ATTEMPTS - lockoutStatus.recentFailures - 1;

  return {
    success: false,
    error: 'Invalid PIN',
    attemptsRemaining: Math.max(0, remaining),
  };
}

// ─── Check Active Session ───────────────────────────────────

export async function hasActiveSession(): Promise<{
  active: boolean;
  expiresAt: string | null;
}> {
  const db = getOfflineDb();
  const userId = await getConfig('current_user_id');
  const userRole = await getConfig('current_user_role');

  if (userRole === 'admin') {
    return { active: true, expiresAt: null };
  }

  if (!userId) return { active: false, expiresAt: null };

  const now = new Date().toISOString();
  const sessions = await db.getAllFromIndex(
    'pin_sessions',
    'by-user-active',
    [parseInt(userId, 10), 1]
  );

  const validSession = sessions.find(s => s.expires_at > now);
  if (validSession) {
    return { active: true, expiresAt: validSession.expires_at };
  }

  return { active: false, expiresAt: null };
}

// ─── PIN Computation ────────────────────────────────────────

/**
 * Compute a deterministic 6-digit PIN using HMAC-SHA256.
 * Uses WebCrypto API — same algorithm as desktop/pinManager.js.
 */
async function computePin(
  userSecret: string,
  adminSecret: string,
  windowStart: string
): Promise<string> {
  const message = `${userSecret}:${windowStart}:${adminSecret}`;

  // Import key for HMAC-SHA256
  const encoder = new TextEncoder();
  const keyData = encoder.encode(userSecret);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Sign the message
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  const hashBytes = new Uint8Array(signature);

  // Convert to hex string (matching Node's .digest('hex'))
  const hash = Array.from(hashBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Dynamic truncation (HOTP-style, same as desktop)
  const offset = parseInt(hash.substring(hash.length - 1), 16);
  const truncated = parseInt(hash.substring(offset * 2, offset * 2 + 8), 16) & 0x7FFFFFFF;
  return String(truncated % Math.pow(10, PIN_LENGTH)).padStart(PIN_LENGTH, '0');
}

/**
 * Get the start of the current 24-hour PIN window.
 * Windows start at midnight Mountain Time.
 */
function get24hWindowStart(): string {
  const now = new Date();
  // Use Mountain Time for consistency with the server's TZ
  const mtString = now.toLocaleString('en-US', { timeZone: 'America/Denver' });
  const mt = new Date(mtString);
  mt.setHours(0, 0, 0, 0);
  return mt.toISOString();
}

// ─── Brute-Force Protection ─────────────────────────────────

async function checkLockout(userId: number): Promise<{
  locked: boolean;
  minutesRemaining: number;
  recentFailures: number;
}> {
  const db = getOfflineDb();
  const cutoff = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000).toISOString();

  // Get all attempts for this user via index
  const allAttempts = await db.getAllFromIndex(
    'pin_attempts',
    'by-user-time',
    IDBKeyRange.bound([userId, cutoff], [userId, '\uffff'])
  );

  const recentFailures = allAttempts.filter(a => a.success === 0).length;

  if (recentFailures >= MAX_ATTEMPTS) {
    const failedAttempts = allAttempts
      .filter(a => a.success === 0)
      .sort((a, b) => a.attempted_at.localeCompare(b.attempted_at));

    const oldest = failedAttempts[0];
    const lockoutEnds = oldest
      ? new Date(new Date(oldest.attempted_at).getTime() + LOCKOUT_MINUTES * 60 * 1000)
      : new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
    const minutesRemaining = Math.ceil((lockoutEnds.getTime() - Date.now()) / 60000);

    return { locked: true, minutesRemaining: Math.max(1, minutesRemaining), recentFailures };
  }

  return { locked: false, minutesRemaining: 0, recentFailures };
}

async function recordAttempt(userId: number, success: boolean): Promise<void> {
  const db = getOfflineDb();
  await db.add('pin_attempts', {
    user_id: userId,
    success: success ? 1 : 0,
    attempted_at: new Date().toISOString(),
  } as any);
}

// ─── Session Expiry Check ───────────────────────────────────

async function checkExpiredSessions(): Promise<void> {
  const db = getOfflineDb();
  const now = new Date().toISOString();

  // Get all active sessions
  const tx = db.transaction('pin_sessions', 'readwrite');
  const store = tx.objectStore('pin_sessions');
  let cursor = await store.openCursor();

  while (cursor) {
    const session = cursor.value;
    if (session.is_active === 1 && session.expires_at < now) {
      await cursor.update({ ...session, is_active: 0 });
      emit('pin-expired', { userId: session.user_id });
      emit('authorization-changed', { isLocalAuthorized: false, expiresAt: null });
    }
    cursor = await cursor.continue();
  }

  await tx.done;
}
