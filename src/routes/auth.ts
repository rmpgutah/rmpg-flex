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
       VALUES (?, ?, ?, ?, ?, datetime('now', '-6 hours', '+15 minutes'), datetime('now', '-6 hours', '+7 days'))`,
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
    const { refresh_token } = await c.req.json();
    if (!refresh_token) {
      return c.json({ error: 'Refresh token required' }, 400);
    }

    const db = getDb(c.env);
    const session = await queryFirst<any>(
      db,
      `SELECT id, user_id, token FROM sessions WHERE refresh_token = ? AND refresh_expires_at > datetime('now', '-6 hours')`,
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

    await execute(db, `UPDATE sessions SET token = ?, expires_at = datetime('now', '-6 hours', '+15 minutes') WHERE id = ?`, newAccessToken, session.id);

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
      `UPDATE users SET password_hash = ?, force_password_change = 0, password_changed_at = datetime('now', '-6 hours'), updated_at = datetime('now', '-6 hours') WHERE id = ?`,
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
                          password_changed_at = datetime('now', '-6 hours'),
                          updated_at = datetime('now', '-6 hours')
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
                          password_changed_at = datetime('now', '-6 hours'),
                          updated_at = datetime('now', '-6 hours')
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
       VALUES (?, ?, ?, ?, ?, datetime('now', '-6 hours', '+15 minutes'), datetime('now', '-6 hours', '+7 days'))`,
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

auth.get('/profile', authMiddleware, (c) => c.json({}));
auth.put('/profile', authMiddleware, async (c) => c.json({ success: true }));

export default auth;
