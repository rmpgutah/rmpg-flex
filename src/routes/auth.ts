import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { compareSync, hashSync } from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getDb, queryFirst, query, execute } from '../utils/db';
import { authMiddleware } from '../middleware/auth';

const auth = new Hono<{ Bindings: { DB: D1Database; KV: KVNamespace; JWT_SECRET: string }; Variables: { user: { id: number; username: string; role: string; full_name: string }; userId: number } }>();

// ── Session + token contract (MUST match the legacy `rmpg-flex` Worker) ──────
// login/refresh fall through the proxy to legacy in normal operation; this
// rewrite is the hot spare and also serves these directly if the proxy routes
// them here. A token/session issued here is therefore interchangeable with one
// issued by legacy. Original: legacy/server-vps/src/routes/auth.ts +
// middleware/auth.ts.
//
// Live `sessions` schema (legacy-owned): session_id (UUID, UNIQUE NOT NULL),
// user_id, refresh_token_hash (sha256 hex of the refresh JWT, NOT the raw
// token), is_active (default 1), expires_at, created_at/last_used_at (defaults).
// There is NO `token` / `refresh_token` / `refresh_expires_at` column — the
// earlier handlers referenced those and 500'd on every login + refresh.
const ACCESS_TTL_SECONDS = 15 * 60;            // 15m — legacy config.jwt.accessExpiry
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;  // 7d  — legacy config.jwt.refreshExpiry

// Live `users` uses must_change_password / totp_enabled — NOT the
// force_password_change / totp_enrolled names the earlier handlers queried
// (those columns do not exist on live D1).
const USER_SELECT =
  'id, username, full_name, first_name, last_name, email, role, badge_number, phone, avatar_url, status, must_change_password, totp_enabled';

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Claims carry BOTH userId (camelCase — legacy middleware REQUIRES it, see
// legacy middleware/auth.ts:51 `if (!decoded.userId ...)`) and user_id (snake —
// this Worker's middleware reads `user_id ?? userId`), so a token verifies on
// either Worker. type:'access' keeps it usable as a Bearer (legacy rejects
// type:'refresh' Bearers). exp is set explicitly: hono/jwt does not add it.
function tokenClaims(user: any) {
  return {
    sub: String(user.id),
    userId: user.id,
    user_id: user.id,
    username: user.username,
    role: user.role,
    fullName: user.full_name,
    full_name: user.full_name,
  };
}

function signAccessToken(secret: string, claims: Record<string, unknown>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ ...claims, type: 'access', iat: now, exp: now + ACCESS_TTL_SECONDS }, secret);
}

// The refresh token is itself a signed JWT (type:'refresh') so a subsequent
// /refresh routed to legacy can verifyRefreshToken() it. Only its sha256 is
// stored in sessions.refresh_token_hash.
function signRefreshToken(secret: string, claims: Record<string, unknown>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ ...claims, type: 'refresh', iat: now, exp: now + REFRESH_TTL_SECONDS }, secret);
}

// Insert a session row using the live (legacy-owned) schema and return the new
// session_id. is_active / created_at / last_used_at come from column defaults.
async function createSession(c: any, db: any, userId: number, refreshToken: string): Promise<string> {
  const sessionId = uuidv4(); // full dashed UUID → matches live session_id (36 chars)
  const refreshHash = await sha256Hex(refreshToken);
  await execute(
    db,
    `INSERT INTO sessions (session_id, user_id, refresh_token_hash, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', '+7 days'))`,
    sessionId, userId, refreshHash,
    c.req.header('cf-connecting-ip') || '', c.req.header('user-agent') || '',
  );
  return sessionId;
}

function userPayload(user: any) {
  const nameParts = (user.full_name || '').split(' ');
  return {
    id: user.id,
    username: user.username,
    first_name: user.first_name || nameParts[0] || null,
    last_name: user.last_name || nameParts.slice(1).join(' ') || null,
    full_name: user.full_name,
    email: user.email || null,
    role: user.role,
    badge_number: user.badge_number || null,
    phone: user.phone || null,
    avatar_url: user.avatar_url || null,
    status: user.status,
    must_change_password: !!user.must_change_password,
    totp_enabled: !!user.totp_enabled,
  };
}

auth.post('/login', async (c) => {
  try {
    const { username, password, deviceFingerprint } = await c.req.json();
    if (!username || !password) {
      return c.json({ error: 'Username and password are required', code: 'USERNAME_AND_PASSWORD_ARE' }, 400);
    }

    const db = getDb(c.env);
    const user = await queryFirst<any>(
      db,
      `SELECT ${USER_SELECT}, password_hash FROM users WHERE username = ?`,
      username
    );

    if (!user) {
      return c.json({ error: 'Invalid username or password', code: 'INVALID_USERNAME_OR_PASSWORD' }, 401);
    }
    if (user.status !== 'active') {
      return c.json({ error: 'Account is inactive', code: 'ACCOUNT_INACTIVE' }, 403);
    }

    if (!compareSync(password, user.password_hash)) {
      return c.json({ error: 'Invalid username or password', code: 'INVALID_USERNAME_OR_PASSWORD' }, 401);
    }

    const secret = c.env.JWT_SECRET;
    const claims = tokenClaims(user);
    const refreshToken = await signRefreshToken(secret, claims);
    const sessionId = await createSession(c, db, user.id, refreshToken);
    const accessToken = await signAccessToken(secret, { ...claims, sessionId });

    // Best-effort login counters — never let a counter error fail the login.
    try {
      await execute(
        db,
        `UPDATE users SET login_count = COALESCE(login_count, 0) + 1, last_login_at = datetime('now') WHERE id = ?`,
        user.id,
      );
    } catch { /* non-critical */ }

    return c.json({
      token: accessToken,
      refreshToken,
      sessionId,
      expiresIn: ACCESS_TTL_SECONDS,
      lastLoginAt: null,
      lastLoginIp: null,
      user: userPayload(user),
    });
  } catch (err: any) {
    console.error('Login error:', err);
    return c.json({ error: 'Failed to login', code: 'LOGIN_ERROR' }, 500);
  }
});

auth.post('/refresh', async (c) => {
  try {
    // Accept both spellings. The client (AuthContext + apiFetch) sends
    // camelCase `refreshToken`; older/legacy callers send snake_case
    // `refresh_token`. Tolerating both mirrors the auth middleware's
    // user_id/userId handling and prevents a silent 401 → forced-logout
    // loop when the body key doesn't match.
    const body = await c.req.json<{ refresh_token?: string; refreshToken?: string }>();
    const refresh_token = body.refresh_token ?? body.refreshToken;
    if (!refresh_token) {
      return c.json({ error: 'Refresh token required' }, 400);
    }

    // The session stores ONLY sha256(refreshToken). Hash the presented token
    // and look it up — this matches sessions written by legacy (same sha256),
    // so a session created on either Worker can be refreshed here. The active +
    // not-expired session row is the authority; we read user_id from it.
    const db = getDb(c.env);
    const refreshHash = await sha256Hex(refresh_token);
    const session = await queryFirst<any>(
      db,
      `SELECT id, session_id, user_id FROM sessions
       WHERE refresh_token_hash = ? AND is_active = 1 AND expires_at > datetime('now')`,
      refreshHash
    );
    if (!session) {
      return c.json({ error: 'Invalid or expired refresh token' }, 401);
    }

    const user = await queryFirst<any>(
      db,
      `SELECT ${USER_SELECT} FROM users WHERE id = ? AND status = 'active'`,
      session.user_id
    );
    if (!user) {
      // Stale session for a deactivated/removed user — retire it.
      await execute(db, `UPDATE sessions SET is_active = 0 WHERE id = ?`, session.id);
      return c.json({ error: 'User not found or inactive' }, 401);
    }

    const secret = c.env.JWT_SECRET;
    const claims = tokenClaims(user);
    // Rotate the refresh token (matches legacy) and re-key the session by its
    // new hash, so a leaked old refresh token can't be replayed.
    const newRefreshToken = await signRefreshToken(secret, claims);
    const newRefreshHash = await sha256Hex(newRefreshToken);
    const newAccessToken = await signAccessToken(secret, { ...claims, sessionId: session.session_id });

    await execute(
      db,
      `UPDATE sessions SET refresh_token_hash = ?, last_used_at = datetime('now', 'localtime') WHERE id = ?`,
      newRefreshHash, session.id,
    );

    return c.json({
      token: newAccessToken,
      refreshToken: newRefreshToken,
      sessionId: session.session_id,
      expiresIn: ACCESS_TTL_SECONDS,
      user: userPayload(user),
    });
  } catch (err) {
    console.error('Refresh error:', err);
    return c.json({ error: 'Refresh failed' }, 500);
  }
});

auth.post('/logout', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const db = getDb(c.env);
  // Soft-deactivate (is_active = 0) like legacy, scoped to the device that's
  // logging out when it sends a refreshToken / sessionId; otherwise retire all
  // of this user's sessions. Body is optional — tolerate a missing/empty body.
  const body = await c.req.json<{ refreshToken?: string; refresh_token?: string; sessionId?: string }>().catch(() => ({} as any));
  const refreshToken = body.refreshToken ?? body.refresh_token;
  try {
    if (refreshToken) {
      const refreshHash = await sha256Hex(refreshToken);
      await execute(db, 'UPDATE sessions SET is_active = 0 WHERE refresh_token_hash = ? AND user_id = ?', refreshHash, userId);
    } else if (body.sessionId) {
      await execute(db, 'UPDATE sessions SET is_active = 0 WHERE session_id = ? AND user_id = ?', body.sessionId, userId);
    } else {
      await execute(db, 'UPDATE sessions SET is_active = 0 WHERE user_id = ?', userId);
    }
  } catch { /* logout is best-effort — never block the client from clearing local state */ }
  return c.json({ message: 'Logged out' });
});

auth.get('/me', authMiddleware, async (c) => {
  const db = getDb(c.env);
  const user = await queryFirst<any>(
    db,
    `SELECT ${USER_SELECT} FROM users WHERE id = ?`,
    c.get('userId')
  );
  if (!user) return c.json({ error: 'User not found' }, 404);
  return c.json({ user: userPayload(user) });
});

auth.put('/password', authMiddleware, async (c) => {
  try {
    const { current_password, new_password } = await c.req.json();
    if (!current_password || !new_password) {
      return c.json({ error: 'Current and new password required' }, 400);
    }
    if (new_password.length < 8) {
      return c.json({ error: 'Password must be at least 8 characters' }, 400);
    }

    const userId = c.get('userId');
    const db = getDb(c.env);
    const user = await queryFirst<any>(db, 'SELECT password_hash FROM users WHERE id = ?', userId);
    if (!user || !compareSync(current_password, user.password_hash)) {
      return c.json({ error: 'Current password is incorrect' }, 401);
    }

    const newHash = hashSync(new_password, 12);
    await execute(
      db,
      `UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      newHash, userId
    );
    return c.json({ message: 'Password updated' });
  } catch (err) {
    return c.json({ error: 'Password change failed' }, 500);
  }
});

// POST /auth/change-password — alias the client uses from the in-profile
// password rotation modal (UserProfileModal). Same logic as the existing
// PUT /password, but accepts camelCase body keys to match the client.
auth.post('/change-password', authMiddleware, async (c) => {
  try {
    const body = await c.req.json<{
      currentPassword?: string; newPassword?: string;
      current_password?: string; new_password?: string;
    }>();
    const current = body.currentPassword ?? body.current_password ?? '';
    const next = body.newPassword ?? body.new_password ?? '';
    if (!current || !next) {
      return c.json({ error: 'Current and new password required' }, 400);
    }
    if (next.length < 8) {
      return c.json({ error: 'Password must be at least 8 characters' }, 400);
    }

    const userId = c.get('userId');
    const db = getDb(c.env);
    const user = await queryFirst<any>(db, 'SELECT password_hash FROM users WHERE id = ?', userId);
    if (!user || !compareSync(current, user.password_hash)) {
      return c.json({ error: 'Current password is incorrect' }, 401);
    }

    const newHash = hashSync(next, 12);
    await execute(
      db,
      `UPDATE users SET password_hash = ?, must_change_password = 0,
                          password_changed_at = datetime('now'),
                          updated_at = datetime('now')
       WHERE id = ?`,
      newHash, userId,
    );
    return c.json({ message: 'Password updated' });
  } catch (err) {
    return c.json({ error: 'Password change failed' }, 500);
  }
});

// POST /auth/login/change-password — forced password change at login.
// Triggered when the login response carries `must_change_password: true`.
// The client holds a `tempToken` (the just-issued JWT) and sends only
// the new password — current password is implicit (just authenticated).
// Returns a fresh access token + user so the SPA can complete login.
auth.post('/login/change-password', authMiddleware, async (c) => {
  try {
    const body = await c.req.json<{ newPassword?: string; new_password?: string }>();
    const next = body.newPassword ?? body.new_password ?? '';
    if (!next || next.length < 8) {
      return c.json({ error: 'New password must be at least 8 characters' }, 400);
    }

    const userId = c.get('userId');
    const db = getDb(c.env);
    const newHash = hashSync(next, 12);
    await execute(
      db,
      `UPDATE users SET password_hash = ?, must_change_password = 0,
                          password_changed_at = datetime('now'),
                          updated_at = datetime('now')
       WHERE id = ?`,
      newHash, userId,
    );

    // Re-issue a fresh JWT so the old tempToken can't be reused.
    const user = await queryFirst<any>(
      db,
      `SELECT ${USER_SELECT} FROM users WHERE id = ?`,
      userId,
    );
    if (!user) return c.json({ error: 'User not found' }, 404);

    const secret = c.env.JWT_SECRET;
    const claims = tokenClaims(user);
    const refreshToken = await signRefreshToken(secret, claims);
    const sessionId = await createSession(c, db, user.id, refreshToken);
    const accessToken = await signAccessToken(secret, { ...claims, sessionId });

    return c.json({
      token: accessToken,
      refreshToken,
      sessionId,
      expiresIn: ACCESS_TTL_SECONDS,
      user: userPayload(user),
    });
  } catch (err) {
    return c.json({ error: 'Password change failed' }, 500);
  }
});

auth.get('/password-policy', (c) => {
  return c.json({
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecial: true,
    expiryDays: 90,
    preventReuse: 5,
  });
});

auth.get('/session-timeout', (c) => {
  return c.json({ idleTimeoutMinutes: 30, maxSessionHours: 12 });
});

// GET /auth/profile — return the current user's editable profile fields.
// Used by UserProfileModal on mount to populate the form.
auth.get('/profile', authMiddleware, async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId');
  const row = await queryFirst<any>(
    db,
    `SELECT id, username, full_name, email, phone, badge_number, role, status, avatar_url
     FROM users WHERE id = ?`,
    userId,
  );
  if (!row) return c.json({ error: 'User not found' }, 404);
  const [first_name, ...rest] = (row.full_name || '').trim().split(/\s+/);
  const last_name = rest.join(' ');
  return c.json({ ...row, first_name: first_name || '', last_name });
});

// PUT /auth/profile — update the current user's profile.
// Accepts: username, first_name, last_name, email, phone (any subset).
// Username changes hit the UNIQUE constraint on users.username, so the
// route checks for collisions and returns 409 with a clear message
// instead of bubbling the raw SQL error. When username changes, the
// JWT becomes stale (its `username` claim no longer matches), so the
// route issues a fresh access token + refresh + session row in the
// same response — the client can swap it in transparently without
// forcing a logout.
auth.put('/profile', authMiddleware, async (c) => {
  try {
    const body = await c.req.json<{
      username?: string;
      first_name?: string; last_name?: string;
      firstName?: string; lastName?: string;
      email?: string; phone?: string;
    }>();
    const db = getDb(c.env);
    const userId = c.get('userId') as number;

    const existing = await queryFirst<any>(
      db, 'SELECT username, full_name FROM users WHERE id = ?', userId,
    );
    if (!existing) return c.json({ error: 'User not found' }, 404);

    const first = (body.first_name ?? body.firstName ?? '').trim();
    const last = (body.last_name ?? body.lastName ?? '').trim();
    const fullName = [first, last].filter(Boolean).join(' ');
    const username = body.username?.trim();

    if (username && username !== existing.username) {
      if (username.length < 3) {
        return c.json({ error: 'Username must be at least 3 characters' }, 400);
      }
      if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
        return c.json({ error: 'Username can only contain letters, numbers, underscore, dot, hyphen' }, 400);
      }
      const collision = await queryFirst<any>(
        db, 'SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?',
        username, userId,
      );
      if (collision) {
        return c.json({ error: 'Username already taken', code: 'USERNAME_TAKEN' }, 409);
      }
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (username && username !== existing.username) { sets.push('username = ?'); params.push(username); }
    if (fullName && fullName !== existing.full_name) { sets.push('full_name = ?'); params.push(fullName); }
    if (body.email !== undefined) { sets.push('email = ?'); params.push(body.email || null); }
    if (body.phone !== undefined) { sets.push('phone = ?'); params.push(body.phone || null); }

    if (sets.length === 0) {
      return c.json({ success: true, message: 'No changes' });
    }
    sets.push("updated_at = datetime('now')");
    params.push(userId);
    await execute(db, `UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...params);

    const updated = await queryFirst<any>(
      db,
      `SELECT ${USER_SELECT} FROM users WHERE id = ?`,
      userId,
    );

    // Username changed → re-issue JWT so the username claim matches.
    // The client's apiFetch reads `token` from the response and swaps
    // it into localStorage when present, so the existing session
    // continues uninterrupted under the new username.
    let tokenBundle: Record<string, unknown> = {};
    if (username && username !== existing.username) {
      const secret = c.env.JWT_SECRET;
      const claims = tokenClaims(updated);
      const refreshToken = await signRefreshToken(secret, claims);
      const sessionId = await createSession(c, db, updated.id, refreshToken);
      const accessToken = await signAccessToken(secret, { ...claims, sessionId });
      tokenBundle = { token: accessToken, refreshToken, sessionId, expiresIn: ACCESS_TTL_SECONDS };
    }

    return c.json({ success: true, user: userPayload(updated), ...tokenBundle });
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE')) {
      return c.json({ error: 'Username already taken', code: 'USERNAME_TAKEN' }, 409);
    }
    return c.json({ error: 'Failed to update profile', detail: msg }, 500);
  }
});

// ════════════════════════════════════════════════════════════════
// Profile photo / sessions / MFA status (UserProfileModal.tsx)
// ════════════════════════════════════════════════════════════════
// These four surfaces were added to the client after the legacy `rmpg-flex`
// bundle froze, so legacy 404s them (live sweep 2026-06-02: profile-image,
// sessions, totp/status, 2fa/status). They read ONLY columns that exist on
// live D1 (users.profile_image / .totp_enabled / .totp_backup_codes,
// sessions.is_active/expires_at), so unlike the login/refresh handlers above
// they run correctly on the rewrite. Routed to env.API in proxy/index.ts.

// NOTE: GET/PUT /auth/profile-image are defined ONCE, further below (search
// "own the base64-data-URL contract"). An earlier un-validated duplicate lived
// here and — because Hono runs the FIRST-registered handler for a duplicate
// path — shadowed the validating pair, so the data-URL format check + ~1.5MB
// size cap never ran (any authenticated user could write an unbounded blob to
// users.profile_image). Removed; the canonical validated handlers below are the
// only ones now.

// GET /auth/sessions — active login sessions for the current user. The Sessions
// tab reads session_id / ip_address / user_agent / last_used_at|created_at and
// does `setSessions(Array.isArray(data) ? data : [])`, so return a bare array.
auth.get('/sessions', authMiddleware, async (c) => {
  const db = getDb(c.env);
  const rows = await query<any>(
    db,
    `SELECT session_id, ip_address, user_agent, created_at, last_used_at, expires_at
       FROM sessions
      WHERE user_id = ? AND COALESCE(is_active, 1) = 1 AND expires_at > datetime('now')
      ORDER BY COALESCE(last_used_at, created_at) DESC`,
    c.get('userId'),
  );
  return c.json(rows || []);
});

// DELETE /auth/sessions/:sessionId — revoke one session (soft: is_active = 0,
// which the GET filter then hides). Scoped to user_id so a user can only revoke
// their own sessions. Legacy 404'd this too, so the "Revoke" button was dead.
auth.delete('/sessions/:sessionId', authMiddleware, async (c) => {
  const db = getDb(c.env);
  const sessionId = c.req.param('sessionId');
  await execute(
    db,
    'UPDATE sessions SET is_active = 0 WHERE session_id = ? AND user_id = ?',
    sessionId,
    c.get('userId'),
  );
  return c.json({ success: true });
});

// GET /auth/totp/status — TOTP enrollment state. No enroll/verify flow is wired
// up on the Worker yet (legacy-era MFA was never ported), so this is a read-only
// honest status sourced from users.totp_enabled. Shape: { enabled, required }.
auth.get('/totp/status', authMiddleware, async (c) => {
  const db = getDb(c.env);
  const row = await queryFirst<{ totp_enabled: number | null }>(
    db,
    'SELECT totp_enabled FROM users WHERE id = ?',
    c.get('userId'),
  );
  return c.json({ enabled: !!row?.totp_enabled, required: false });
});

// GET /auth/2fa/status — two-factor status for the Security tab. The client reads
// { enabled, backupCodesRemaining }. backupCodesRemaining is the real count from
// users.totp_backup_codes (JSON array or comma-separated), 0 when un-enrolled.
auth.get('/2fa/status', authMiddleware, async (c) => {
  const db = getDb(c.env);
  const row = await queryFirst<{ totp_enabled: number | null; totp_backup_codes: string | null }>(
    db,
    'SELECT totp_enabled, totp_backup_codes FROM users WHERE id = ?',
    c.get('userId'),
  );
  let backupCodesRemaining = 0;
  if (row?.totp_backup_codes) {
    try {
      const parsed = JSON.parse(row.totp_backup_codes);
      backupCodesRemaining = Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      backupCodesRemaining = row.totp_backup_codes.split(',').map((s) => s.trim()).filter(Boolean).length;
    }
  }
  return c.json({ enabled: !!row?.totp_enabled, backupCodesRemaining });
});

// ════════════════════════════════════════════════════════════════
// Security Dashboard (SecurityDashboardPage.tsx, route /security-dashboard)
// ════════════════════════════════════════════════════════════════
// The /api/auth router is mounted public (login/refresh are open), so we
// gate just the /security/* subtree with authMiddleware. Backed by the live
// login_attempts + sessions tables. Every handler is defensive and returns
// the page's safe empty shape on any error. Legacy had only login-history
// (a proxy stub) — the rest 404'd (live sweep 2026-06-02).
auth.use('/security/*', authMiddleware);

// GET /api/auth/security/status
auth.get('/security/status', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId');
    const sess = await queryFirst<{ active: number }>(db, "SELECT COUNT(*) AS active FROM sessions WHERE user_id = ? AND COALESCE(is_active,1) = 1 AND expires_at > datetime('now')", userId);
    const last = await queryFirst<{ created_at: string; ip_address: string | null }>(db, 'SELECT created_at, ip_address FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', userId);
    return c.json({
      twoFactorEnabled: false,
      passwordAge: 0,
      trustedDevices: 0,
      activeSessions: sess?.active ?? 0,
      lastLogin: last?.created_at ?? '',
      lastLoginIp: last?.ip_address ?? '',
      accountStatus: 'Active',
    });
  } catch {
    return c.json({ twoFactorEnabled: false, passwordAge: 0, trustedDevices: 0, activeSessions: 0, lastLogin: '', lastLoginIp: '', accountStatus: 'Active' });
  }
});

// GET /api/auth/security/recent-threats — recent failed logins.
auth.get('/security/recent-threats', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      "SELECT id, 'failed_login' AS type, username, ip_address AS ip, failure_reason AS reason, created_at AS timestamp FROM login_attempts WHERE COALESCE(success,0) = 0 ORDER BY created_at DESC LIMIT 50");
    return c.json({ data: rows || [] });
  } catch {
    return c.json({ data: [] });
  }
});

// GET /api/auth/security/blocked-ips — IPs with repeated failures (>=5/24h).
auth.get('/security/blocked-ips', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      "SELECT ip_address, COUNT(*) AS failed_attempts, MAX(created_at) AS last_attempt FROM login_attempts WHERE COALESCE(success,0) = 0 AND ip_address IS NOT NULL AND created_at >= datetime('now','-1 day') GROUP BY ip_address HAVING COUNT(*) >= 5 ORDER BY failed_attempts DESC LIMIT 100");
    return c.json({ data: rows || [] });
  } catch {
    return c.json({ data: [] });
  }
});

// GET /api/auth/security/password-compliance — no password-age tracking on
// live D1 yet; return empty (page tolerates {data:[]}).
auth.get('/security/password-compliance', async (c) => c.json({ data: [] }));

// GET /api/auth/security/session-analytics — sessions per day (last 14d).
auth.get('/security/session-analytics', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<{ day: string; count: number }>(db,
      "SELECT substr(created_at,1,10) AS day, COUNT(*) AS count FROM sessions WHERE created_at >= datetime('now','-14 days') GROUP BY substr(created_at,1,10) ORDER BY day");
    const data: Record<string, number> = {};
    for (const r of rows || []) data[r.day] = r.count;
    return c.json({ data });
  } catch {
    return c.json({ data: {} });
  }
});

// GET /api/auth/security/event-timeline?limit= — login successes + failures.
auth.get('/security/event-timeline', async (c) => {
  try {
    const db = getDb(c.env);
    const limit = Math.min(500, Math.max(1, parseInt(c.req.query('limit') || '100', 10) || 100));
    const rows = await query<Record<string, unknown>>(db,
      "SELECT id, CASE WHEN COALESCE(success,0)=1 THEN 'login' ELSE 'failed_login' END AS event, username, ip_address AS ip, failure_reason AS reason, created_at AS timestamp FROM login_attempts ORDER BY created_at DESC LIMIT ?", limit);
    return c.json({ data: rows || [] });
  } catch {
    return c.json({ data: [] });
  }
});

// ─── Profile image ────────────────────────────────────────
// The client stores the avatar as a base64 data URL (resized 256×256 JPEG)
// in users.profile_image. NOTE: the legacy handler used a different contract
// — it expected { url } (an http(s) URL) and REJECTED data: URLs with a 400,
// and only ever exposed avatar_url via /me — which is why uploads silently
// failed and the topbar avatar never updated. These handlers own the
// base64-data-URL contract; the proxy routes /api/auth/profile-image here.

// GET /auth/profile-image — return the current user's stored avatar.
auth.get('/profile-image', authMiddleware, async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId');
    const row = await queryFirst<{ profile_image: string | null }>(
      db, 'SELECT profile_image FROM users WHERE id = ?', userId,
    );
    return c.json({ profile_image: row?.profile_image || null });
  } catch (err) {
    console.error('Get profile-image error:', err);
    return c.json({ error: 'Failed to load profile image', code: 'GET_PROFILE_IMAGE_ERROR' }, 500);
  }
});

// PUT /auth/profile-image — save (base64 data URL) or clear (null).
auth.put('/profile-image', authMiddleware, async (c) => {
  try {
    const { profile_image } = await c.req.json<{ profile_image?: string | null }>();
    if (profile_image !== null && profile_image !== undefined) {
      if (typeof profile_image !== 'string' || !/^data:image\/(png|jpeg|jpg|webp);base64,/.test(profile_image)) {
        return c.json({ error: 'profile_image must be a base64 image data URL or null', code: 'INVALID_PROFILE_IMAGE' }, 400);
      }
      // Client resizes to 256×256 JPEG (~10–40KB). Cap generously at ~1.5MB
      // of base64 to reject anything pathological before it hits D1.
      if (profile_image.length > 1_500_000) {
        return c.json({ error: 'Image too large — must be under ~1MB', code: 'PROFILE_IMAGE_TOO_LARGE' }, 413);
      }
    }
    const db = getDb(c.env);
    const userId = c.get('userId');
    await execute(
      db,
      `UPDATE users SET profile_image = ?, updated_at = datetime('now') WHERE id = ?`,
      profile_image || null, userId,
    );
    return c.json({ success: true, profile_image: profile_image || null });
  } catch (err) {
    console.error('Save profile-image error:', err);
    return c.json({ error: 'Failed to save profile image', code: 'SAVE_PROFILE_IMAGE_ERROR' }, 500);
  }
});

export default auth;
