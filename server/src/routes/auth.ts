import { Router, Request, Response } from 'express';
import bcryptjs from 'bcryptjs';
import crypto from 'crypto';
import { getDb } from '../models/database';
import { broadcast } from '../utils/websocket';
import {
  authenticateToken,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  JwtPayload,
} from '../middleware/auth';
import { authRateLimit } from '../middleware/rateLimiter';
import { validatePassword, getPasswordPolicyDescription } from '../middleware/validatePassword';
import config from '../config';
import { localNow } from '../utils/timeUtils';

const router = Router();

// ─── Helper: Check if account is locked out ──────────
function isLockedOut(username: string): { locked: boolean; minutesRemaining: number } {
  const db = getDb();
  const windowStart = new Date(
    Date.now() - config.security.lockoutDurationMinutes * 60 * 1000
  ).toISOString();

  const result = db.prepare(`
    SELECT COUNT(*) as failed_count
    FROM login_attempts
    WHERE username = ? AND success = 0 AND created_at > ?
  `).get(username, windowStart) as { failed_count: number };

  if (result.failed_count >= config.security.maxLoginAttempts) {
    // Find the most recent failed attempt to calculate remaining lockout
    const lastAttempt = db.prepare(`
      SELECT created_at FROM login_attempts
      WHERE username = ? AND success = 0
      ORDER BY created_at DESC LIMIT 1
    `).get(username) as { created_at: string } | undefined;

    if (lastAttempt) {
      const lockoutEnds = new Date(lastAttempt.created_at).getTime() +
        config.security.lockoutDurationMinutes * 60 * 1000;
      const remaining = Math.ceil((lockoutEnds - Date.now()) / 60000);
      if (remaining > 0) {
        return { locked: true, minutesRemaining: remaining };
      }
    }
  }

  return { locked: false, minutesRemaining: 0 };
}

// ─── Helper: Log login attempt ────────────────────────
function logLoginAttempt(username: string, ip: string, success: boolean, reason?: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO login_attempts (username, ip_address, success, failure_reason)
    VALUES (?, ?, ?, ?)
  `).run(username, ip, success ? 1 : 0, reason || null);
}

// ─── Helper: Create session ───────────────────────────
function createSession(userId: number, refreshToken: string, ip: string, userAgent: string): string {
  const db = getDb();
  const sessionId = crypto.randomUUID();
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  // Parse refresh token expiry
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Enforce max sessions per user
  const activeSessions = db.prepare(`
    SELECT id FROM sessions WHERE user_id = ? AND is_active = 1
    ORDER BY last_used_at ASC
  `).all(userId) as { id: number }[];

  if (activeSessions.length >= config.session.maxPerUser) {
    // Deactivate oldest sessions
    const toRemove = activeSessions.length - config.session.maxPerUser + 1;
    const oldestIds = activeSessions.slice(0, toRemove).map(s => s.id);
    db.prepare(`UPDATE sessions SET is_active = 0 WHERE id IN (${oldestIds.map(() => '?').join(',')})`)
      .run(...oldestIds);
  }

  db.prepare(`
    INSERT INTO sessions (session_id, user_id, refresh_token_hash, ip_address, user_agent, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId, userId, tokenHash, ip, userAgent, expiresAt);

  return sessionId;
}

// ─── POST /api/auth/login ─────────────────────────────
router.post('/login', authRateLimit, (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    const ip = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    // Check lockout
    const lockout = isLockedOut(username);
    if (lockout.locked) {
      logLoginAttempt(username, ip, false, 'account_locked');
      res.status(423).json({
        error: `Account temporarily locked. Try again in ${lockout.minutesRemaining} minute(s).`,
        code: 'ACCOUNT_LOCKED',
        retryAfter: lockout.minutesRemaining * 60,
      });
      return;
    }

    const db = getDb();
    const user = db.prepare(`
      SELECT id, username, password_hash, first_name, last_name, full_name, email, role,
             badge_number, phone, status, avatar_url, must_change_password
      FROM users WHERE username = ?
    `).get(username) as any;

    if (!user) {
      logLoginAttempt(username, ip, false, 'user_not_found');
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    if (user.status !== 'active') {
      logLoginAttempt(username, ip, false, 'account_inactive');
      res.status(403).json({ error: 'Account is not active' });
      return;
    }

    const validPassword = bcryptjs.compareSync(password, user.password_hash);
    if (!validPassword) {
      logLoginAttempt(username, ip, false, 'invalid_password');

      // Check if this failure triggers a lockout
      const newLockout = isLockedOut(username);
      const lockoutWindow = new Date(
        Date.now() - config.security.lockoutDurationMinutes * 60 * 1000
      ).toISOString();
      const attemptsRemaining = config.security.maxLoginAttempts -
        (db.prepare(`
          SELECT COUNT(*) as count FROM login_attempts
          WHERE username = ? AND success = 0
          AND created_at > ?
        `).get(username, lockoutWindow) as { count: number }).count;

      res.status(401).json({
        error: 'Invalid username or password',
        ...(attemptsRemaining <= 2 && attemptsRemaining > 0 && {
          warning: `${attemptsRemaining} attempt(s) remaining before account lockout`,
        }),
        ...(newLockout.locked && {
          code: 'ACCOUNT_LOCKED',
          retryAfter: newLockout.minutesRemaining * 60,
        }),
      });
      return;
    }

    // Successful login - generate tokens
    logLoginAttempt(username, ip, true);

    const payload: Omit<JwtPayload, 'type'> = {
      userId: user.id,
      username: user.username,
      role: user.role,
      fullName: user.full_name,
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);
    const sessionId = createSession(user.id, refreshToken, ip, userAgent);

    // Log the login to activity log
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'user_login', 'user', ?, 'User logged in', ?)
    `).run(user.id, user.id, ip);

    res.json({
      token: accessToken,
      refreshToken,
      sessionId,
      expiresIn: config.jwt.accessExpiry,
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
        must_change_password: !!user.must_change_password,
      },
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/refresh ───────────────────────────
router.post('/refresh', (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(400).json({ error: 'Refresh token is required' });
      return;
    }

    // Verify the refresh token
    let decoded: JwtPayload;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch {
      res.status(401).json({ error: 'Invalid or expired refresh token', code: 'REFRESH_EXPIRED' });
      return;
    }

    // Verify session exists and is active
    const db = getDb();
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const session = db.prepare(`
      SELECT * FROM sessions
      WHERE refresh_token_hash = ? AND user_id = ? AND is_active = 1
    `).get(tokenHash, decoded.userId) as any;

    if (!session) {
      res.status(401).json({ error: 'Session not found or expired', code: 'SESSION_INVALID' });
      return;
    }

    // Verify user is still active
    const user = db.prepare('SELECT id, status, role, full_name, username FROM users WHERE id = ?')
      .get(decoded.userId) as any;

    if (!user || user.status !== 'active') {
      // Deactivate session
      db.prepare('UPDATE sessions SET is_active = 0 WHERE id = ?').run(session.id);
      res.status(403).json({ error: 'Account is no longer active' });
      return;
    }

    // Issue new access token (rotate refresh token for security)
    const payload: Omit<JwtPayload, 'type'> = {
      userId: user.id,
      username: user.username,
      role: user.role,
      fullName: user.full_name,
      sessionId: session.session_id,
    };

    const newAccessToken = generateAccessToken(payload);
    const newRefreshToken = generateRefreshToken(payload);
    const newTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');

    // Update session with new refresh token
    db.prepare(`
      UPDATE sessions SET refresh_token_hash = ?, last_used_at = ?
      WHERE id = ?
    `).run(newTokenHash, localNow(), session.id);

    res.json({
      token: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: config.jwt.accessExpiry,
    });
  } catch (error: any) {
    console.error('Refresh token error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/logout ────────────────────────────
router.post('/logout', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { refreshToken, sessionId } = req.body;

    // Deactivate session by refresh token or session ID
    if (refreshToken) {
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      db.prepare('UPDATE sessions SET is_active = 0 WHERE refresh_token_hash = ? AND user_id = ?')
        .run(tokenHash, req.user!.userId);
    } else if (sessionId) {
      db.prepare('UPDATE sessions SET is_active = 0 WHERE session_id = ? AND user_id = ?')
        .run(sessionId, req.user!.userId);
    } else {
      // Deactivate all sessions for this user
      db.prepare('UPDATE sessions SET is_active = 0 WHERE user_id = ?')
        .run(req.user!.userId);
    }

    // Log the logout
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'user_logout', 'user', ?, 'User logged out', ?)
    `).run(req.user!.userId, req.user!.userId, req.ip || 'unknown');

    res.json({ message: 'Logged out successfully' });
  } catch (error: any) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────
router.get('/me', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare(`
      SELECT id, username, first_name, last_name, full_name, email, role,
             badge_number, phone, status, avatar_url, created_at, must_change_password
      FROM users WHERE id = ?
    `).get(req.user!.userId) as any;

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Return snake_case keys to match the client User interface
    res.json({
      id: user.id,
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      badge_number: user.badge_number,
      phone: user.phone,
      status: user.status,
      avatar_url: user.avatar_url,
      created_at: user.created_at,
      must_change_password: !!user.must_change_password,
    });
  } catch (error: any) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/auth/sessions ───────────────────────────
router.get('/sessions', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const sessions = db.prepare(`
      SELECT session_id, ip_address, user_agent, is_active, created_at, last_used_at, expires_at
      FROM sessions
      WHERE user_id = ? AND is_active = 1
      ORDER BY last_used_at DESC
    `).all(req.user!.userId);

    res.json(sessions);
  } catch (error: any) {
    console.error('Get sessions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/auth/sessions/:sessionId ─────────────
router.delete('/sessions/:sessionId', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const result = db.prepare(
      'UPDATE sessions SET is_active = 0 WHERE session_id = ? AND user_id = ?'
    ).run(req.params.sessionId, req.user!.userId);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json({ message: 'Session revoked' });
  } catch (error: any) {
    console.error('Revoke session error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/change-password ───────────────────
router.post('/change-password', authenticateToken, (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current password and new password are required' });
      return;
    }

    // Validate new password against policy
    const validation = validatePassword(newPassword);
    if (!validation.valid) {
      res.status(400).json({
        error: 'Password does not meet requirements',
        details: validation.errors,
        policy: getPasswordPolicyDescription(),
      });
      return;
    }

    const db = getDb();
    const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?')
      .get(req.user!.userId) as any;

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const validPassword = bcryptjs.compareSync(currentPassword, user.password_hash);
    if (!validPassword) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    // Prevent reusing the same password
    if (bcryptjs.compareSync(newPassword, user.password_hash)) {
      res.status(400).json({ error: 'New password must be different from current password' });
      return;
    }

    const newHash = bcryptjs.hashSync(newPassword, 10);
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?")
      .run(newHash, localNow(), user.id);

    // Log the password change
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'password_changed', 'user', ?, 'Password changed', ?)
    `).run(user.id, user.id, req.ip || 'unknown');

    // Invalidate all other sessions (force re-login)
    db.prepare('UPDATE sessions SET is_active = 0 WHERE user_id = ?').run(user.id);

    res.json({ message: 'Password changed successfully. Please log in again.' });
  } catch (error: any) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/auth/profile ───────────────────────────
router.put('/profile', authenticateToken, (req: Request, res: Response) => {
  try {
    const { email, phone, first_name, last_name } = req.body;
    const db = getDb();

    const user = db.prepare('SELECT id FROM users WHERE id = ?')
      .get(req.user!.userId) as any;

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Build update dynamically based on provided fields
    const updates: string[] = [];
    const values: any[] = [];

    if (email !== undefined) { updates.push('email = ?'); values.push(email); }
    if (phone !== undefined) { updates.push('phone = ?'); values.push(phone); }
    if (first_name !== undefined && last_name !== undefined) {
      // Server-side enforcement: names must not be empty once provided
      const fn = String(first_name).trim();
      const ln = String(last_name).trim();
      if (!fn || !ln) {
        res.status(400).json({ error: 'First and last name are required and cannot be empty.' });
        return;
      }
      updates.push('first_name = ?', 'last_name = ?', 'full_name = ?');
      values.push(fn, ln, `${fn} ${ln}`);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push('updated_at = ?');
    values.push(localNow());
    values.push(user.id);

    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    // Return updated user
    const updated = db.prepare(`
      SELECT id, username, full_name, first_name, last_name, email, role, badge_number, phone, status, avatar_url, created_at
      FROM users WHERE id = ?
    `).get(user.id) as any;

    // Broadcast so Admin → Users tab and Personnel page pick up the change
    try {
      broadcast('personnel', 'data_changed', {
        action: 'put', module: 'auth', entity: 'profile',
        id: user.id, timestamp: new Date().toISOString(),
      });
      broadcast('admin', 'data_changed', {
        action: 'put', module: 'auth', entity: 'profile',
        id: user.id, timestamp: new Date().toISOString(),
      });
    } catch { /* never break the response */ }

    res.json(updated);
  } catch (error: any) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/auth/password-policy ────────────────────
router.get('/password-policy', (_req: Request, res: Response) => {
  res.json({
    policy: getPasswordPolicyDescription(),
    rules: {
      minLength: config.password.minLength,
      requireUppercase: config.password.requireUppercase,
      requireLowercase: config.password.requireLowercase,
      requireNumber: config.password.requireNumber,
      requireSpecial: config.password.requireSpecial,
    },
  });
});

export default router;
