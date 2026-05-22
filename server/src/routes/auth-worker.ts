// ============================================================
// RMPG Flex — Auth Routes (Cloudflare Workers / Hono)
// ============================================================
// Ported from server/src/routes/auth.ts for Workers runtime.
// Core login/register/2FA endpoints.
// ============================================================

import { Hono } from 'hono';
import { SignJWT, jwtVerify } from 'jose';
import * as bcrypt from 'bcryptjs';
import crypto from 'crypto';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, localNow, paramNum } from '../worker-middleware/d1Helpers';
import { auditLog } from '../worker-middleware/auditLogger';

// ── JWT Helpers ──────────────────────────────────────────
async function generateAccessToken(user: any, secret: string): Promise<string> {
  const payload = { userId: user.id, username: user.username, role: user.role, fullName: user.full_name || '', type: 'access' };
  return await new SignJWT(payload as any)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(new TextEncoder().encode(secret));
}

async function generateRefreshToken(user: any, secret: string): Promise<string> {
  const payload = { userId: user.id, username: user.username, role: user.role, type: 'refresh' };
  return await new SignJWT(payload as any)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(secret));
}

// ── Session Helper ───────────────────────────────────────
async function createSession(db: D1Db, userId: number, refreshToken: string, ip: string, userAgent: string): Promise<string> {
  const sessionId = crypto.randomUUID();
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const userRow = await db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any;
  const isAdmin = userRow?.role === 'admin';
  const maxSessions = isAdmin ? 50 : 5;

  const activeSessions = await db.prepare('SELECT id FROM sessions WHERE user_id = ? AND is_active = 1 ORDER BY last_used_at ASC LIMIT 1000').all(userId) as any[];

  if (activeSessions.length >= maxSessions) {
    const toRemove = activeSessions.length - maxSessions + 1;
    const oldestIds = activeSessions.slice(0, toRemove).map(s => s.id);
    const placeholders = oldestIds.map(() => '?').join(',');
    await db.prepare(`UPDATE sessions SET is_active = 0 WHERE id IN (${placeholders})`).run(...oldestIds);
  }

  await db.prepare(`
    INSERT INTO sessions (session_id, user_id, refresh_token_hash, ip_address, user_agent, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId, userId, tokenHash, ip, userAgent, expiresAt);

  return sessionId;
}

export function mountAuthRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();

  // ═══════════════════════════════════════════════════════════
  // LOGIN
  // ═══════════════════════════════════════════════════════════

  api.post('/login', async (c) => {
    try {
    const db = new D1Db(c.env.DB);
    const body = await c.req.json();
    const { username, password } = body;
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
    const userAgent = c.req.header('user-agent') || 'unknown';

    if (!username || !password) return c.json({ error: 'Username and password are required', code: 'USERNAME_AND_PASSWORD_ARE' }, 400);

    // Check lockout
    const lockoutWindow = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const failedAttempts = await db.prepare(`SELECT COUNT(*) as count FROM login_attempts WHERE username = ? AND success = 0 AND created_at > ?`).get(username, lockoutWindow) as any;
    if ((failedAttempts?.count || 0) >= 5) {
      const lastAttempt = await db.prepare(`SELECT created_at FROM login_attempts WHERE username = ? AND success = 0 ORDER BY created_at DESC LIMIT 1`).get(username) as any;
      if (lastAttempt) {
        const lockoutEnds = new Date(lastAttempt.created_at).getTime() + 15 * 60 * 1000;
        const remaining = Math.ceil((lockoutEnds - Date.now()) / 60000);
        if (remaining > 0) {
          await db.prepare(`INSERT INTO login_attempts (username, ip_address, success, failure_reason) VALUES (?, ?, 0, 'account_locked')`).run(username, ip);
          return c.json({ error: `Account temporarily locked. Try again in ${remaining} minute(s).`, code: 'ACCOUNT_LOCKED', retryAfter: remaining * 60 }, 423);
        }
      }
    }

    const user = await db.prepare(`
      SELECT id, username, password_hash, first_name, last_name, full_name, email, role,
        badge_number, phone, status, avatar_url, must_change_password, totp_enabled, totp_exempt
      FROM users WHERE username = ?
    `).get(username) as any;

    if (!user) {
      await db.prepare(`INSERT INTO login_attempts (username, ip_address, success, failure_reason) VALUES (?, ?, 0, 'user_not_found')`).run(username, ip);
      return c.json({ error: 'Invalid username or password', code: 'INVALID_USERNAME_OR_PASSWORD' }, 401);
    }

    if (user.status !== 'active') {
      await db.prepare(`INSERT INTO login_attempts (username, ip_address, success, failure_reason) VALUES (?, ?, 0, 'account_inactive')`).run(username, ip);
      return c.json({ error: 'Account is not active', code: 'ACCOUNT_IS_NOT_ACTIVE' }, 403);
    }

    const validPassword = bcrypt.compareSync(password, user.password_hash);
    if (!validPassword) {
      await db.prepare(`INSERT INTO login_attempts (username, ip_address, success, failure_reason) VALUES (?, ?, 0, 'invalid_password')`).run(username, ip);
      const newAttempts = await db.prepare(`SELECT COUNT(*) as count FROM login_attempts WHERE username = ? AND success = 0 AND created_at > ?`).get(username, lockoutWindow) as any;
      const remaining = 5 - (newAttempts?.count || 0);
      return c.json({ error: 'Invalid username or password', ...(remaining <= 2 && remaining > 0 && { warning: `${remaining} attempt(s) remaining before account lockout` }) }, 401);
    }

    // Check TOTP
    const totpRequiredRoles = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'];
    const totpRequired = totpRequiredRoles.includes(user.role) && !user.totp_exempt;

    if (user.totp_enabled && totpRequired) {
      // Generate 2FA pending token
      const pendingPayload = { userId: user.id, username: user.username, role: user.role, step: 'verify_2fa' };
      const pendingToken = await new SignJWT(pendingPayload as any)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(new TextEncoder().encode(c.env.JWT_SECRET));

      return c.json({ requires2FA: true, tempToken: pendingToken, userId: user.id });
    }

    // Generate tokens
    const accessToken = await generateAccessToken(user, c.env.JWT_SECRET);
    const refreshToken = await generateRefreshToken(user, c.env.JWT_SECRET);
    const sessionId = await createSession(db, user.id, refreshToken, ip, userAgent);

    // Update user login info
    await db.prepare(`UPDATE users SET last_login_at = ?, login_count = COALESCE(login_count, 0) + 1 WHERE id = ?`).run(localNow(), user.id);
    await db.prepare(`INSERT INTO login_attempts (username, ip_address, success) VALUES (?, ?, 1)`).run(username, ip);
    await auditLog(db, c, 'user_login', 'user', user.id, `User ${username} logged in`);

    // Get previous login info for security notification
    let lastLoginAt: string | null = null;
    let lastLoginIp: string | null = null;
    try {
      const prevLogin = await db.prepare(`SELECT ip_address, created_at FROM login_attempts WHERE username = ? AND success = 1 AND created_at < datetime('now','localtime') ORDER BY created_at DESC LIMIT 1`).get(username) as any;
      lastLoginAt = prevLogin?.created_at || null;
      lastLoginIp = prevLogin?.ip_address || null;
    } catch { /* non-critical */ }

    return c.json({
      token: accessToken,
      refreshToken,
      sessionId,
      expiresIn: '15m',
      lastLoginAt,
      lastLoginIp,
      user: {
        id: user.id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        badge_number: user.badge_number,
        phone: user.phone,
        avatar_url: user.avatar_url,
        status: user.status,
        must_change_password: false,
        totp_enabled: false,
      },
    });
    } catch (err: any) {
      console.error('Login error:', err?.message || err);
      return c.json({ error: 'Failed to login', code: 'LOGIN_ERROR' }, 500);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // 2FA VERIFY
  // ═══════════════════════════════════════════════════════════

  api.post('/verify-2fa', async (c) => {
    const db = new D1Db(c.env.DB);
    const body = await c.req.json();
    const { token: pendingToken, code } = body;

    try {
      const { payload } = await jwtVerify(pendingToken, new TextEncoder().encode(c.env.JWT_SECRET));
      if ((payload as any).step !== 'verify_2fa') return c.json({ error: 'Invalid token', code: 'INVALID_TOKEN' }, 401);

      const userId = Number((payload as any).userId);
      const user = await db.prepare('SELECT id, username, first_name, last_name, full_name, role, totp_secret_enc, totp_enabled, badge_number, email, phone, status, avatar_url, must_change_password FROM users WHERE id = ?').get(userId) as any;
      if (!user) return c.json({ error: 'User not found', code: 'USER_NOT_FOUND' }, 404);

      // Decrypt TOTP secret and verify
      const { decryptSecret, verifyTotpCode } = await import('../utils/totp');
      const secret = decryptSecret(user.totp_secret_enc);
      const valid = verifyTotpCode(secret, code);

      if (!valid) return c.json({ error: 'Invalid 2FA code', code: 'INVALID_2FA_CODE' }, 401);

      const accessToken = await generateAccessToken(user, c.env.JWT_SECRET);
      const refreshToken = await generateRefreshToken(user, c.env.JWT_SECRET);
      const ip = c.req.header('CF-Connecting-IP') || 'unknown';
      const userAgent = c.req.header('user-agent') || 'unknown';
      const sessionId = await createSession(db, user.id, refreshToken, ip, userAgent);

      await db.prepare(`UPDATE users SET last_login_at = ?, login_count = COALESCE(login_count, 0) + 1 WHERE id = ?`).run(localNow(), user.id);
      await auditLog(db, c, 'user_login', 'user', user.id, `User ${user.username} logged in (2FA verified)`);

      return c.json({
        token: accessToken,
        refreshToken,
        sessionId,
        expiresIn: '15m',
        user: {
          id: user.id,
          username: user.username,
          first_name: user.first_name,
          last_name: user.last_name,
          full_name: user.full_name,
          email: user.email,
          role: user.role,
          badge_number: user.badge_number,
          phone: user.phone,
          avatar_url: user.avatar_url,
          status: user.status,
          must_change_password: false,
          totp_enabled: false,
        },
      });
    } catch {
      return c.json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' }, 401);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // REFRESH TOKEN
  // ═══════════════════════════════════════════════════════════

  api.post('/refresh', async (c) => {
    const db = new D1Db(c.env.DB);
    const body = await c.req.json();
    const { refreshToken, sessionId } = body;

    try {
      const { payload } = await jwtVerify(refreshToken, new TextEncoder().encode(c.env.JWT_SECRET));
      if ((payload as any).type !== 'refresh') return c.json({ error: 'Invalid token type', code: 'INVALID_TOKEN_TYPE' }, 401);

      const userId = Number((payload as any).userId);
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

      const session = await db.prepare('SELECT id, is_active, expires_at FROM sessions WHERE session_id = ? AND refresh_token_hash = ?').get(sessionId, tokenHash) as any;
      if (!session || !session.is_active) return c.json({ error: 'Session invalid or revoked', code: 'SESSION_INVALID' }, 401);
      if (new Date(session.expires_at) < new Date()) return c.json({ error: 'Session expired', code: 'SESSION_EXPIRED' }, 401);

      const user = await db.prepare('SELECT id, username, full_name, role, badge_number, email, avatar_url, must_change_password FROM users WHERE id = ?').get(userId) as any;
      if (!user) return c.json({ error: 'User not found', code: 'USER_NOT_FOUND' }, 404);

      const newAccessToken = await generateAccessToken(user, c.env.JWT_SECRET);
      const newRefreshToken = await generateRefreshToken(user, c.env.JWT_SECRET);

      await db.prepare('UPDATE sessions SET last_used_at = ?, refresh_token_hash = ? WHERE id = ?').run(localNow(), crypto.createHash('sha256').update(newRefreshToken).digest('hex'), session.id);

      return c.json({ token: newAccessToken, refreshToken: newRefreshToken, expiresIn: '15m' });
    } catch {
      return c.json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' }, 401);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // LOGOUT
  // ═══════════════════════════════════════════════════════════

  api.post('/logout', authenticateToken, async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    await db.prepare('UPDATE sessions SET is_active = 0 WHERE user_id = ?').run(user.userId);
    return c.json({ message: 'Logged out successfully' });
  });

  // ═══════════════════════════════════════════════════════════
  // ME
  // ═══════════════════════════════════════════════════════════

  api.get('/me', authenticateToken, async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const fullUser = await db.prepare(`
      SELECT id, username, first_name, last_name, full_name, email, role, badge_number,
        phone, status, avatar_url, must_change_password, totp_enabled, totp_exempt,
        last_login_at, login_count, created_at
      FROM users WHERE id = ?
    `).get(user.userId);

    if (!fullUser) return c.json({ error: 'User not found', code: 'USER_NOT_FOUND' }, 404);
    return c.json(fullUser);
  });

  // ═══════════════════════════════════════════════════════════
  // PASSWORD CHANGE
  // ═══════════════════════════════════════════════════════════

  api.post('/change-password', authenticateToken, async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const body = await c.req.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) return c.json({ error: 'currentPassword and newPassword are required', code: 'MISSING_FIELDS' }, 400);

    const dbUser = await db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(user.userId) as any;
    if (!dbUser) return c.json({ error: 'User not found', code: 'USER_NOT_FOUND' }, 404);

    const valid = bcrypt.compareSync(currentPassword, dbUser.password_hash);
    if (!valid) return c.json({ error: 'Current password is incorrect', code: 'INVALID_CURRENT_PASSWORD' }, 401);

    const hashed = await bcrypt.hash(newPassword, 12);
    await db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?').run(hashed, localNow(), user.userId);
    await auditLog(db, c, 'password_changed', 'user', user.userId, 'User changed password');

    return c.json({ message: 'Password changed successfully' });
  });

  // ═══════════════════════════════════════════════════════════
  // PROFILE UPDATE
  // ═══════════════════════════════════════════════════════════

  api.put('/profile', authenticateToken, async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const body = await c.req.json();
    const { first_name, last_name, email, phone, avatar_url } = body;

    const fields: string[] = [];
    const values: any[] = [];
    if (first_name !== undefined) { fields.push('first_name = ?'); values.push(first_name); }
    if (last_name !== undefined) { fields.push('last_name = ?'); values.push(last_name); }
    if (email !== undefined) { fields.push('email = ?'); values.push(email); }
    if (phone !== undefined) { fields.push('phone = ?'); values.push(phone); }
    if (avatar_url !== undefined) { fields.push('avatar_url = ?'); values.push(avatar_url); }

    if (fields.length === 0) return c.json({ error: 'No fields to update', code: 'NO_FIELDS' }, 400);

    // Rebuild full_name
    let fullName = null;
    const dbUser = await db.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(user.userId) as any;
    if (dbUser) {
      const fn = first_name !== undefined ? first_name : dbUser.first_name;
      const ln = last_name !== undefined ? last_name : dbUser.last_name;
      fullName = [fn, ln].filter(Boolean).join(' ');
      if (fullName) { fields.push('full_name = ?'); values.push(fullName); }
    }

    fields.push('updated_at = ?');
    values.push(localNow());
    values.push(user.userId);

    await db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    const updated = await db.prepare('SELECT id, username, first_name, last_name, full_name, email, role, badge_number, phone, avatar_url, status FROM users WHERE id = ?').get(user.userId);
    return c.json(updated);
  });

  // ═══════════════════════════════════════════════════════════
  // PASSWORD POLICY
  // ═══════════════════════════════════════════════════════════

  api.get('/password-policy', async (c) => {
    return c.json({
      min_length: 12,
      require_uppercase: true,
      require_lowercase: true,
      require_number: true,
      require_special: true,
      history_count: 5,
      expiry_days: 90,
    });
  });

  // ═══════════════════════════════════════════════════════════
  // SESSION TIMEOUT CHECK
  // ═══════════════════════════════════════════════════════════

  api.get('/session-timeout', authenticateToken, async (c) => {
    return c.json({ timeout_minutes: 15 });
  });

  // ═══════════════════════════════════════════════════════════
  // FORGOT PASSWORD via Security Questions
  // ═══════════════════════════════════════════════════════════

  // POST /api/auth/forgot-password — Step 1: Get masked questions
  api.post('/forgot-password', async (c) => {
    const db = new D1Db(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const { username } = body;
    if (!username || typeof username !== 'string' || !username.trim()) {
      return c.json({ message: 'If an account exists with that username, security questions will be presented.' });
    }

    const user = await db.prepare('SELECT id, username, status FROM users WHERE username = ?').get(username.trim()) as any;
    if (!user || user.status !== 'active') {
      return c.json({ message: 'If an account exists with that username, security questions will be presented.' });
    }

    const sq = await db.prepare(
      'SELECT question_1, question_2, question_3 FROM user_security_questions WHERE user_id = ?'
    ).get(user.id) as any;

    if (!sq) {
      return c.json({ message: 'If an account exists with that username, security questions will be presented.' });
    }

    return c.json({
      hasQuestions: true,
      username: user.username,
      questions: [sq.question_1, sq.question_2, sq.question_3],
    });
  });

  // POST /api/auth/forgot-password/verify — Step 2: Verify answers
  api.post('/forgot-password/verify', async (c) => {
    const db = new D1Db(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const { username, answers } = body;

    if (!username || typeof username !== 'string' || !Array.isArray(answers) || answers.length !== 3) {
      return c.json({ error: 'Invalid request. Provide username and exactly 3 answers.', code: 'INVALID_REQUEST' }, 400);
    }

    const user = await db.prepare('SELECT id, username, status FROM users WHERE username = ?').get(username.trim()) as any;
    if (!user || user.status !== 'active') {
      return c.json({ error: 'Invalid username or answers.', code: 'VERIFICATION_FAILED' }, 400);
    }

    const sq = await db.prepare(
      'SELECT answer_1_hash, answer_2_hash, answer_3_hash FROM user_security_questions WHERE user_id = ?'
    ).get(user.id) as any;

    if (!sq) {
      return c.json({ error: 'No security questions configured.', code: 'NO_SECURITY_QUESTIONS' }, 400);
    }

    const hashAnswers = [sq.answer_1_hash, sq.answer_2_hash, sq.answer_3_hash];
    for (let i = 0; i < 3; i++) {
      if (!bcrypt.compareSync(String(answers[i]), hashAnswers[i])) {
        return c.json({ error: 'One or more answers are incorrect.', code: 'VERIFICATION_FAILED' }, 400);
      }
    }

    // All answers correct — issue short-lived reset token (5 min)
    const tempToken = await new SignJWT({
      userId: user.id,
      username: user.username,
      type: 'forgot_pw',
    } as any)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(c.env.JWT_SECRET));

    return c.json({ success: true, tempToken });
  });

  // POST /api/auth/forgot-password/reset — Step 3: Reset password
  api.post('/forgot-password/reset', async (c) => {
    const db = new D1Db(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const { tempToken, newPassword } = body;

    if (!tempToken || typeof tempToken !== 'string') {
      return c.json({ error: 'Reset token is required.', code: 'TOKEN_REQUIRED' }, 400);
    }

    let payload: any;
    try {
      const result = await jwtVerify(tempToken, new TextEncoder().encode(c.env.JWT_SECRET));
      payload = result.payload as any;
      if (payload.type !== 'forgot_pw' || !payload.userId || !payload.username) {
        return c.json({ error: 'Invalid reset token.', code: 'INVALID_TOKEN' }, 400);
      }
    } catch {
      return c.json({ error: 'Invalid or expired reset token. Please start over.', code: 'INVALID_TOKEN' }, 400);
    }

    const user = await db.prepare('SELECT id, username, status, password_hash FROM users WHERE id = ? AND username = ?').get(payload.userId, payload.username) as any;
    if (!user || user.status !== 'active') {
      return c.json({ error: 'Account not found or inactive.', code: 'ACCOUNT_INACTIVE' }, 400);
    }

    // Validate password
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 12) {
      return c.json({ error: 'Password must be at least 12 characters.', code: 'PASSWORD_VALIDATION' }, 400);
    }

    // Check against current password
    if (bcrypt.compareSync(newPassword, user.password_hash)) {
      return c.json({ error: 'New password must be different from your current password.', code: 'PASSWORD_SAME' }, 400);
    }

    const hashed = bcrypt.hashSync(newPassword, 12);
    const now = localNow();

    // Store old password hash in history
    await db.prepare(
      'INSERT INTO password_history (user_id, password_hash, created_at) VALUES (?, ?, ?)'
    ).run(user.id, user.password_hash, now);

    // Update user
    await db.prepare(
      'UPDATE users SET password_hash = ?, password_changed_at = ?, must_change_password = 0, updated_at = ? WHERE id = ?'
    ).run(hashed, now, now, user.id);

    await auditLog(db, c, 'password_reset', 'user', user.id, 'Password reset via security questions');

    return c.json({ success: true, message: 'Password has been reset successfully.' });
  });

  // POST /api/auth/security-questions — Set/update security questions (authenticated)
  api.post('/security-questions', authenticateToken, async (c) => {
    const db = new D1Db(c.env.DB);
    const authUser = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const { question_1, answer_1, question_2, answer_2, question_3, answer_3 } = body;

    if (!question_1 || !answer_1 || !question_2 || !answer_2 || !question_3 || !answer_3) {
      return c.json({ error: 'All three questions and answers are required.', code: 'VALIDATION_ERROR' }, 400);
    }

    if ([question_1, question_2, question_3].some((q: string) => q.trim().length < 3 || q.trim().length > 200)) {
      return c.json({ error: 'Each question must be between 3 and 200 characters.', code: 'VALIDATION_ERROR' }, 400);
    }
    if ([answer_1, answer_2, answer_3].some((a: string) => a.trim().length < 1 || a.trim().length > 100)) {
      return c.json({ error: 'Each answer must be between 1 and 100 characters.', code: 'VALIDATION_ERROR' }, 400);
    }

    const salt = bcrypt.genSaltSync(12);
    const hash1 = bcrypt.hashSync(String(answer_1).trim().toLowerCase(), salt);
    const hash2 = bcrypt.hashSync(String(answer_2).trim().toLowerCase(), salt);
    const hash3 = bcrypt.hashSync(String(answer_3).trim().toLowerCase(), salt);
    const now = localNow();

    const existing = await db.prepare('SELECT id FROM user_security_questions WHERE user_id = ?').get(authUser.userId) as any;

    if (existing) {
      await db.prepare(
        'UPDATE user_security_questions SET question_1 = ?, answer_1_hash = ?, question_2 = ?, answer_2_hash = ?, question_3 = ?, answer_3_hash = ?, updated_at = ? WHERE user_id = ?'
      ).run(question_1.trim(), hash1, question_2.trim(), hash2, question_3.trim(), hash3, now, authUser.userId);
    } else {
      await db.prepare(
        'INSERT INTO user_security_questions (user_id, question_1, answer_1_hash, question_2, answer_2_hash, question_3, answer_3_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(authUser.userId, question_1.trim(), hash1, question_2.trim(), hash2, question_3.trim(), hash3, now, now);
    }

    return c.json({ success: true, message: 'Security questions saved successfully.' });
  });

  // GET /api/auth/security-questions — Check if user has security questions set
  api.get('/security-questions', authenticateToken, async (c) => {
    const db = new D1Db(c.env.DB);
    const authUser = c.get('user');
    const sq = await db.prepare(
      'SELECT question_1, question_2, question_3 FROM user_security_questions WHERE user_id = ?'
    ).get(authUser.userId) as any;

    if (!sq) return c.json({ hasQuestions: false });
    return c.json({
      hasQuestions: true,
      questions: [sq.question_1, sq.question_2, sq.question_3],
    });
  });

  // ═══════════════════════════════════════════════════════════
  // USER PREFERENCES (mounted at /api/user/*)
  // ═══════════════════════════════════════════════════════════

  const userApi = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  userApi.use('/*', authenticateToken);

  const DEFAULTS = {
    notify_dispatch_email: 1, notify_dispatch_inapp: 1,
    notify_bolo_email: 1, notify_bolo_inapp: 1,
    notify_warrant_email: 0, notify_warrant_inapp: 1,
    notify_system_email: 0, notify_system_inapp: 1,
    notify_credential_email: 1, notify_credential_inapp: 1,
    notify_pso_email: 1, notify_pso_inapp: 1,
    quiet_hours_start: null, quiet_hours_end: null,
    font_scale: 1.0, compact_mode: 0,
    show_map_labels: 1, default_map_style: 'dark',
    dashboard_widgets: null, dispatch_sort: 'priority',
    dispatch_show_cleared: 0, theme_preference: 'dark',
    font_size_preference: 'medium',
  };
  const ALLOWED_FIELDS = new Set(Object.keys(DEFAULTS));

  // GET /api/user/preferences
  userApi.get('/preferences', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    let prefs = await db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(user.userId) as any;
    if (!prefs) return c.json({ ...DEFAULTS, user_id: user.userId });
    return c.json(prefs);
  });

  // PUT /api/user/preferences
  userApi.put('/preferences', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const body = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Request body must be an object', code: 'REQUEST_BODY_MUST_BE' }, 400);
    if (Object.keys(body).length > 50) return c.json({ error: 'Too many fields in request', code: 'TOO_MANY_FIELDS_IN' }, 400);

    const validUpdates: Record<string, any> = {};
    for (const [key, value] of Object.entries(body)) {
      if (ALLOWED_FIELDS.has(key)) {
        if (value !== null && typeof value === 'object') {
          if (key === 'dashboard_widgets') { validUpdates[key] = JSON.stringify(value); continue; }
          return c.json({ error: `Invalid value type for ${key}` }, 400);
        }
        if (key === 'font_scale' && (typeof value !== 'number' || value < 0.5 || value > 3.0)) return c.json({ error: 'font_scale must be between 0.5 and 3.0', code: 'FONTSCALE_MUST_BE_BETWEEN' }, 400);
        validUpdates[key] = value;
      }
    }

    if (Object.keys(validUpdates).length === 0) return c.json({ error: 'No valid preference fields provided', code: 'NO_VALID_PREFERENCE_FIELDS' }, 400);

    const existing = await db.prepare('SELECT user_id FROM user_preferences WHERE user_id = ?').get(user.userId);
    if (!existing) await db.prepare('INSERT INTO user_preferences (user_id) VALUES (?)').run(user.userId);

    const setClauses: string[] = [];
    const values: any[] = [];
    for (const [key, value] of Object.entries(validUpdates)) {
      setClauses.push(`${key} = ?`);
      values.push(value);
    }
    setClauses.push('updated_at = ?');
    values.push(localNow());
    values.push(user.userId);

    await db.prepare(`UPDATE user_preferences SET ${setClauses.join(', ')} WHERE user_id = ?`).run(...values);
    const updated = await db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(user.userId);
    await auditLog(db, c, 'preferences_updated', 'user_preferences', user.userId, `Updated preferences: ${Object.keys(validUpdates).join(', ')}`);
    return c.json(updated);
  });

  // POST /api/user/preferences/reset
  userApi.post('/preferences/reset', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    await db.prepare('DELETE FROM user_preferences WHERE user_id = ?').run(user.userId);
    await auditLog(db, c, 'preferences_reset', 'user_preferences', user.userId, 'Reset all preferences to defaults');
    return c.json({ ...DEFAULTS, user_id: user.userId });
  });

  // GET /api/user/recently-viewed
  userApi.get('/recently-viewed', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const dbUser = await db.prepare('SELECT recently_viewed FROM users WHERE id = ?').get(user.userId) as any;
    let items: any[] = [];
    try { items = JSON.parse(dbUser?.recently_viewed || '[]'); } catch { items = []; }
    return c.json({ data: items });
  });

  // POST /api/user/recently-viewed
  userApi.post('/recently-viewed', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const body = await c.req.json();
    const { entity_type, entity_id, title } = body;
    if (!entity_type || !entity_id) return c.json({ error: 'entity_type and entity_id required', code: 'ENTITYTYPE_AND_ENTITYID_REQUIRED' }, 400);

    const dbUser = await db.prepare('SELECT recently_viewed FROM users WHERE id = ?').get(user.userId) as any;
    let items: any[];
    try { items = JSON.parse(dbUser?.recently_viewed || '[]'); } catch { items = []; }
    items = items.filter((i: any) => !(i.entity_type === entity_type && i.entity_id === entity_id));
    items.unshift({ entity_type, entity_id, title: title || '', viewed_at: localNow() });
    items = items.slice(0, 20);

    await db.prepare('UPDATE users SET recently_viewed = ? WHERE id = ?').run(JSON.stringify(items), user.userId);
    return c.json({ data: items });
  });

  // GET /api/user/favorites
  userApi.get('/favorites', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const dbUser = await db.prepare('SELECT favorites FROM users WHERE id = ?').get(user.userId) as any;
    let items: any[] = [];
    try { items = JSON.parse(dbUser?.favorites || '[]'); } catch { items = []; }
    return c.json({ data: items });
  });

  // POST /api/user/favorites
  userApi.post('/favorites', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const body = await c.req.json();
    const { entity_type, entity_id, title } = body;
    if (!entity_type || !entity_id) return c.json({ error: 'entity_type and entity_id required', code: 'ENTITYTYPE_AND_ENTITYID_REQUIRED' }, 400);

    const dbUser = await db.prepare('SELECT favorites FROM users WHERE id = ?').get(user.userId) as any;
    let items: any[];
    try { items = JSON.parse(dbUser?.favorites || '[]'); } catch { items = []; }
    if (!items.find((i: any) => i.entity_type === entity_type && i.entity_id === entity_id)) {
      items.push({ entity_type, entity_id, title: title || '', added_at: localNow() });
    }

    await db.prepare('UPDATE users SET favorites = ? WHERE id = ?').run(JSON.stringify(items), user.userId);
    return c.json({ data: items });
  });

  // DELETE /api/user/favorites/:entity_type/:entity_id
  userApi.delete('/favorites/:entity_type/:entity_id', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const entityType = c.req.param('entity_type');
    const entityId = c.req.param('entity_id');
    const dbUser = await db.prepare('SELECT favorites FROM users WHERE id = ?').get(user.userId) as any;
    let items: any[] = [];
    try { items = JSON.parse(dbUser?.favorites || '[]'); } catch { items = []; }
    items = items.filter((i: any) => !(i.entity_type === entityType && String(i.entity_id) === entityId));
    await db.prepare('UPDATE users SET favorites = ? WHERE id = ?').run(JSON.stringify(items), user.userId);
    return c.json({ data: items });
  });

  // ═══════════════════════════════════════════════════════════
  // SIGNATURE
  // ═══════════════════════════════════════════════════════════

  // GET /api/auth/signature - Get user's digital signature
  api.get('/signature', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const row = await db.prepare('SELECT digital_signature FROM users WHERE id = ?').get(user.userId) as { digital_signature: string | null } | null;
      return c.json({ signature: row?.digital_signature || null });
    } catch (err: any) {
      return c.json({ error: 'Failed to get signature', code: 'GET_SIGNATURE_ERROR' }, 500);
    }
  });

  // PUT /api/auth/signature - Save user's digital signature
  api.put('/signature', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const { signature } = await c.req.json();
      if (signature !== null && signature !== undefined) {
        if (typeof signature !== 'string' || !signature.startsWith('data:image/png;base64,')) {
          return c.json({ error: 'Signature must be a PNG data URL', code: 'SIGNATURE_MUST_BE_A' }, 400);
        }
        if (signature.length > 500_000) {
          return c.json({ error: 'Signature data too large', code: 'SIGNATURE_DATA_TOO_LARGE' }, 400);
        }
      }
      const now = localNow();
      await db.prepare('UPDATE users SET digital_signature = ?, updated_at = ? WHERE id = ?').run(signature || null, now, user.userId);
      return c.json({ success: true });
    } catch (err: any) {
      return c.json({ error: 'Failed to save signature', code: 'SAVE_SIGNATURE_ERROR' }, 500);
    }
  });

  // Mount user routes at /api/user
  app.route('/api/user', userApi);

  // Mount all auth routes under /api/auth
  app.route('/api/auth', api);
}
