import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { compareSync, hashSync } from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getDb, queryFirst, query, execute } from '../utils/db';
import { authMiddleware } from '../middleware/auth';

const auth = new Hono<{ Bindings: { DB: D1Database; KV: KVNamespace; JWT_SECRET: string }; Variables: { user: { id: number; username: string; role: string; full_name: string }; userId: number } }>();

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
    must_change_password: !!user.force_password_change,
    totp_enabled: !!user.totp_enrolled,
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
      `SELECT id, username, password_hash, full_name, email, role,
              badge_number, phone, avatar_url, status, force_password_change, totp_enrolled
       FROM users WHERE username = ?`,
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

    const jwtSecret = c.env.JWT_SECRET;
    const now = Math.floor(Date.now() / 1000);
    const payload = { sub: String(user.id), user_id: user.id, username: user.username, role: user.role };

    const sessionId = uuidv4().replace(/-/g, '');
    const accessToken = await sign({ ...payload, sessionId }, jwtSecret);
    const refreshToken = uuidv4();

    await execute(
      db,
      `INSERT INTO sessions (user_id, token, refresh_token, ip_address, user_agent, expires_at, refresh_expires_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', '+15 minutes'), datetime('now', '+7 days'))`,
      user.id, accessToken, refreshToken, c.req.header('cf-connecting-ip') || '', c.req.header('user-agent') || ''
    );

    return c.json({
      token: accessToken,
      refreshToken,
      sessionId,
      expiresIn: 900,
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

    const db = getDb(c.env);
    const session = await queryFirst<any>(
      db,
      `SELECT id, user_id, token FROM sessions WHERE refresh_token = ? AND refresh_expires_at > datetime('now')`,
      refresh_token
    );
    if (!session) {
      return c.json({ error: 'Invalid or expired refresh token' }, 401);
    }

    const user = await queryFirst<any>(
      db,
      `SELECT id, username, full_name, email, role, badge_number, phone, avatar_url, status, force_password_change, totp_enrolled
       FROM users WHERE id = ? AND status = 'active'`,
      session.user_id
    );
    if (!user) {
      return c.json({ error: 'User not found or inactive' }, 401);
    }

    const jwtSecret = c.env.JWT_SECRET;
    const now = Math.floor(Date.now() / 1000);
    const payload = { sub: String(user.id), user_id: user.id, username: user.username, role: user.role };
    const newAccessToken = await sign({ ...payload, sessionId: uuidv4().replace(/-/g, '') }, jwtSecret);

    await execute(db, `UPDATE sessions SET token = ?, expires_at = datetime('now', '+15 minutes') WHERE id = ?`, newAccessToken, session.id);

    return c.json({
      token: newAccessToken,
      user: userPayload(user),
    });
  } catch (err) {
    return c.json({ error: 'Refresh failed' }, 500);
  }
});

auth.post('/logout', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const db = getDb(c.env);
  await execute(db, 'DELETE FROM sessions WHERE user_id = ?', userId);
  return c.json({ message: 'Logged out' });
});

auth.get('/me', authMiddleware, async (c) => {
  const db = getDb(c.env);
  const user = await queryFirst<any>(
    db,
    `SELECT id, username, full_name, email, role, badge_number, phone, avatar_url, status, force_password_change, totp_enrolled
     FROM users WHERE id = ?`,
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
      `UPDATE users SET password_hash = ?, force_password_change = 0, password_changed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
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
      `UPDATE users SET password_hash = ?, force_password_change = 0,
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
// Triggered when the login response carries `force_password_change: 1`.
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
      `UPDATE users SET password_hash = ?, force_password_change = 0,
                          password_changed_at = datetime('now'),
                          updated_at = datetime('now')
       WHERE id = ?`,
      newHash, userId,
    );

    // Re-issue a fresh JWT so the old tempToken can't be reused.
    const user = await queryFirst<any>(
      db,
      `SELECT id, username, full_name, email, role, badge_number, phone,
              avatar_url, status, force_password_change, totp_enrolled
       FROM users WHERE id = ?`,
      userId,
    );
    if (!user) return c.json({ error: 'User not found' }, 404);

    const jwtSecret = c.env.JWT_SECRET;
    const payload = { sub: String(user.id), user_id: user.id, username: user.username, role: user.role };
    const sessionId = uuidv4().replace(/-/g, '');
    const accessToken = await sign({ ...payload, sessionId }, jwtSecret);
    const refreshToken = uuidv4();

    await execute(
      db,
      `INSERT INTO sessions (user_id, token, refresh_token, ip_address, user_agent, expires_at, refresh_expires_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', '+15 minutes'), datetime('now', '+7 days'))`,
      user.id, accessToken, refreshToken, c.req.header('cf-connecting-ip') || '', c.req.header('user-agent') || '',
    );

    return c.json({
      token: accessToken,
      refreshToken,
      sessionId,
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
      `SELECT id, username, full_name, email, role, badge_number, phone, avatar_url,
              status, force_password_change, totp_enrolled
       FROM users WHERE id = ?`,
      userId,
    );

    // Username changed → re-issue JWT so the username claim matches.
    // The client's apiFetch reads `token` from the response and swaps
    // it into localStorage when present, so the existing session
    // continues uninterrupted under the new username.
    let tokenBundle: Record<string, unknown> = {};
    if (username && username !== existing.username) {
      const jwtSecret = c.env.JWT_SECRET;
      const payload = { sub: String(updated.id), user_id: updated.id, username: updated.username, role: updated.role };
      const sessionId = uuidv4().replace(/-/g, '');
      const accessToken = await sign({ ...payload, sessionId }, jwtSecret);
      const refreshToken = uuidv4();
      await execute(
        db,
        `INSERT INTO sessions (user_id, token, refresh_token, ip_address, user_agent, expires_at, refresh_expires_at)
         VALUES (?, ?, ?, ?, ?, datetime('now', '+15 minutes'), datetime('now', '+7 days'))`,
        updated.id, accessToken, refreshToken,
        c.req.header('cf-connecting-ip') || '', c.req.header('user-agent') || '',
      );
      tokenBundle = { token: accessToken, refreshToken, sessionId };
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

// GET /auth/profile-image — current user's profile photo (data URL) or null.
auth.get('/profile-image', authMiddleware, async (c) => {
  const db = getDb(c.env);
  const row = await queryFirst<{ profile_image: string | null }>(
    db,
    'SELECT profile_image FROM users WHERE id = ?',
    c.get('userId'),
  );
  return c.json({ profile_image: row?.profile_image ?? null });
});

// PUT /auth/profile-image — set or clear the photo. Body: { profile_image: string | null }.
// The client sends a 256×256 JPEG data URL (~tens of KB) or null to remove.
auth.put('/profile-image', authMiddleware, async (c) => {
  try {
    const db = getDb(c.env);
    const { profile_image } = await c.req.json<{ profile_image?: string | null }>();
    const value = typeof profile_image === 'string' && profile_image.length > 0 ? profile_image : null;
    await execute(db, 'UPDATE users SET profile_image = ? WHERE id = ?', value, c.get('userId'));
    return c.json({ success: true, profile_image: value });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: 'Failed to save profile image', detail: msg }, 500);
  }
});

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

export default auth;
