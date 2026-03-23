import { Router, Request, Response } from 'express';
import bcryptjs from 'bcryptjs';
import crypto from 'crypto';
import { getDb } from '../models/database';
import { broadcast } from '../utils/websocket';
import jwt from 'jsonwebtoken';
import {
  authenticateToken,
  generateAccessToken,
  generateRefreshToken,
  generate2faPendingToken,
  verifyRefreshToken,
  JwtPayload,
} from '../middleware/auth';
import { authRateLimit } from '../middleware/rateLimiter';
import { validatePassword, getPasswordPolicyDescription, checkPasswordHistory, isPasswordExpired } from '../middleware/validatePassword';
import config from '../config';
import { localNow } from '../utils/timeUtils';
import {
  generateTotpSecret,
  generateQrCodeDataUrl,
  verifyTotpCode,
  generateBackupCodes,
  verifyBackupCode,
  encryptSecret,
  decryptSecret,
} from '../utils/totp';
import { createNotification } from './notifications';

const router = Router();

/** Read totp_required_roles from system_config (admin-editable), fall back to static config. */
function getTotpRequiredRoles(): string[] {
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = 'totp_required_roles' AND category = 'system_settings' AND is_active = 1 LIMIT 1"
    ).get() as { config_value: string } | undefined;
    if (row !== undefined) {
      // Admin explicitly set the value — empty string means "no roles required"
      return row.config_value.split(',').map(s => s.trim()).filter(Boolean);
    }
  } catch { /* DB not ready yet — fall through */ }
  return config.totp?.requiredRoles || [];
}

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
  
    LIMIT 1000
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
      res.status(400).json({ error: 'Username and password are required', code: 'USERNAME_AND_PASSWORD_ARE' });
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
      res.status(401).json({ error: 'Invalid username or password', code: 'INVALID_USERNAME_OR_PASSWORD' });
      return;
    }

    if (user.status !== 'active') {
      logLoginAttempt(username, ip, false, 'account_inactive');
      res.status(403).json({ error: 'Account is not active', code: 'ACCOUNT_IS_NOT_ACTIVE' });
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

    // Successful password verification
    logLoginAttempt(username, ip, true);

    // Check password expiry — set must_change_password if expired
    const userFull = db.prepare('SELECT password_changed_at, totp_enabled, totp_exempt FROM users WHERE id = ?')
      .get(user.id) as any;
    if (isPasswordExpired(userFull?.password_changed_at)) {
      db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(user.id);
      user.must_change_password = 1;
    }

    const payload: Omit<JwtPayload, 'type'> = {
      userId: user.id,
      username: user.username,
      role: user.role,
      fullName: user.full_name,
    };

    // ── Two-Factor Authentication gate ──────────────────
    if (userFull?.totp_enabled) {
      // Don't issue full tokens yet — return a 2FA-pending token
      const tempToken = generate2faPendingToken(payload);
      res.json({
        requires2FA: true,
        tempToken,
        userId: user.id,
      });
      return;
    }

    // ── Check if 2FA setup is required for this role ────
    const requiredRoles = getTotpRequiredRoles();
    const must_setup_2fa = requiredRoles.length > 0 && requiredRoles.includes(user.role) && !userFull?.totp_enabled && !userFull?.totp_exempt;

    // ── No 2FA — issue full tokens ──────────────────────
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);
    // Capture previous login info before updating
    const prevLogin = db.prepare(`SELECT last_login_at FROM users WHERE id = ?`).get(user.id) as { last_login_at?: string } | undefined;
    const prevLoginIp = db.prepare(`
      SELECT ip_address FROM login_attempts WHERE username = ? AND success = 1
      ORDER BY created_at DESC LIMIT 1
    `).get(username) as { ip_address?: string } | undefined;

    const sessionId = createSession(user.id, refreshToken, ip, userAgent);

    // Include sessionId in a fresh access token so IP binding works
    const accessTokenWithSession = generateAccessToken({ ...payload, sessionId });

    // Log the login to activity log
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'user_login', 'user', ?, 'User logged in', ?)
    `).run(user.id, user.id, ip);

    // Update login statistics
    db.prepare(`
      UPDATE users SET login_count = COALESCE(login_count, 0) + 1, last_login_at = ? WHERE id = ?
    `).run(localNow(), user.id);

    // Login notification — alert user if logging in from a new IP
    try {
      const previousLogins = db.prepare(`
        SELECT DISTINCT ip_address FROM login_attempts
        WHERE username = ? AND success = 1 AND ip_address != ?
        ORDER BY created_at DESC LIMIT 20
      `).all(username, ip) as { ip_address: string }[];

      if (previousLogins.length > 0) {
        const knownIps = new Set(previousLogins.map(l => l.ip_address));
        if (!knownIps.has(ip)) {
          createNotification(
            user.id,
            'login_alert',
            'New Login Detected',
            `Login from new IP address: ${ip} — ${(userAgent || '').substring(0, 60)}`,
            'user',
            user.id,
            'high',
          );
        }
      }
    } catch { /* notification failure should never block login */ }

    res.json({
      token: accessTokenWithSession,
      refreshToken,
      sessionId,
      expiresIn: config.jwt.accessExpiry,
      lastLoginAt: prevLogin?.last_login_at || null,
      lastLoginIp: prevLoginIp?.ip_address || null,
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
        totp_enabled: false,
        requires_2fa_setup: must_setup_2fa,
      },
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login', code: 'LOGIN_ERROR' });
  }
});

// ─── POST /api/auth/refresh ───────────────────────────
router.post('/refresh', (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(400).json({ error: 'Refresh token is required', code: 'REFRESH_TOKEN_IS_REQUIRED' });
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
      res.status(403).json({ error: 'Account is no longer active', code: 'ACCOUNT_IS_NO_LONGER' });
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
    res.status(500).json({ error: 'Failed to refresh token', code: 'REFRESH_TOKEN_ERROR' });
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
    res.status(500).json({ error: 'Failed to logout', code: 'LOGOUT_ERROR' });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────
router.get('/me', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare(`
      SELECT id, username, first_name, last_name, full_name, email, role,
             badge_number, phone, status, avatar_url, created_at, must_change_password, totp_enabled, totp_exempt
      FROM users WHERE id = ?
    `).get(req.user!.userId) as any;

    if (!user) {
      res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      return;
    }

    // Check if 2FA setup is required for this role
    const requiredRoles = getTotpRequiredRoles();
    const requires2faSetup = requiredRoles.length > 0 && requiredRoles.includes(user.role) && !user.totp_enabled && !user.totp_exempt;

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
      totp_enabled: !!user.totp_enabled,
      requires_2fa_setup: requires2faSetup,
    });
  } catch (error: any) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user', code: 'GET_USER_ERROR' });
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
    
      LIMIT 1000
    `).all(req.user!.userId);

    res.json(sessions);
  } catch (error: any) {
    console.error('Get sessions error:', error);
    res.status(500).json({ error: 'Failed to get sessions', code: 'GET_SESSIONS_ERROR' });
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
      res.status(404).json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' });
      return;
    }

    res.json({ message: 'Session revoked' });
  } catch (error: any) {
    console.error('Revoke session error:', error);
    res.status(500).json({ error: 'Failed to revoke session', code: 'REVOKE_SESSION_ERROR' });
  }
});

// ─── POST /api/auth/change-password ───────────────────
router.post('/change-password', authenticateToken, (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current password and new password are required', code: 'CURRENT_PASSWORD_AND_NEW' });
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
    const user = db.prepare('SELECT id, password_hash, password_history FROM users WHERE id = ?')
      .get(req.user!.userId) as any;

    if (!user) {
      res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      return;
    }

    const validPassword = bcryptjs.compareSync(currentPassword, user.password_hash);
    if (!validPassword) {
      res.status(401).json({ error: 'Current password is incorrect', code: 'CURRENT_PASSWORD_IS_INCORRECT' });
      return;
    }

    // Prevent reusing the same password
    if (bcryptjs.compareSync(newPassword, user.password_hash)) {
      res.status(400).json({ error: 'New password must be different from current password', code: 'NEW_PASSWORD_MUST_BE' });
      return;
    }

    // Check password history — prevent reuse of recent passwords
    if (config.password.historyCount > 0) {
      const historyHashes: string[] = user.password_history ? JSON.parse(user.password_history) : [];
      if (checkPasswordHistory(newPassword, historyHashes)) {
        res.status(400).json({
          error: `Password was used recently. Cannot reuse the last ${config.password.historyCount} passwords.`,
        });
        return;
      }
    }

    const newHash = bcryptjs.hashSync(newPassword, 10);
    const now = localNow();

    // Update password history: prepend old hash, keep last N
    const oldHistory: string[] = user.password_history ? JSON.parse(user.password_history) : [];
    const newHistory = [user.password_hash, ...oldHistory].slice(0, config.password.historyCount);

    db.prepare(`
      UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = ?,
        password_history = ?, updated_at = ? WHERE id = ?
    `).run(newHash, now, JSON.stringify(newHistory), now, user.id);

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
    res.status(500).json({ error: 'Failed to change password', code: 'CHANGE_PASSWORD_ERROR' });
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
      res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
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
        res.status(400).json({ error: 'First and last name are required and cannot be empty.', code: 'FIRST_AND_LAST_NAME' });
        return;
      }
      updates.push('first_name = ?', 'last_name = ?', 'full_name = ?');
      values.push(fn, ln, `${fn} ${ln}`);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' });
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
        id: user.id, timestamp: localNow(),
      });
      broadcast('admin', 'data_changed', {
        action: 'put', module: 'auth', entity: 'profile',
        id: user.id, timestamp: localNow(),
      });
    } catch { /* never break the response */ }

    res.json(updated);
  } catch (error: any) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile', code: 'UPDATE_PROFILE_ERROR' });
  }
});

// ─── GET /api/auth/signature ───────────────────────────
// Retrieve the current user's digital signature (PNG base64)
router.get('/signature', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT digital_signature FROM users WHERE id = ?')
      .get(req.user!.userId) as { digital_signature: string | null } | undefined;
    res.json({ signature: row?.digital_signature || null });
  } catch (error: any) {
    console.error('Get signature error:', error);
    res.status(500).json({ error: 'Failed to get signature', code: 'GET_SIGNATURE_ERROR' });
  }
});

// ─── PUT /api/auth/signature ──────────────────────────
// Save or clear the current user's digital signature
router.put('/signature', authenticateToken, (req: Request, res: Response) => {
  try {
    const { signature } = req.body; // base64 data URL or null to clear
    const db = getDb();

    // Validate: must be a PNG data URL or null
    if (signature !== null && signature !== undefined) {
      if (typeof signature !== 'string' || !signature.startsWith('data:image/png;base64,')) {
        res.status(400).json({ error: 'Signature must be a PNG data URL', code: 'SIGNATURE_MUST_BE_A' });
        return;
      }
      // Limit size (~500KB — a hand-drawn signature should be well under this)
      if (signature.length > 500_000) {
        res.status(400).json({ error: 'Signature data too large', code: 'SIGNATURE_DATA_TOO_LARGE' });
        return;
      }
    }

    db.prepare('UPDATE users SET digital_signature = ?, updated_at = ? WHERE id = ?')
      .run(signature || null, localNow(), req.user!.userId);

    res.json({ success: true });
  } catch (error: any) {
    console.error('Save signature error:', error);
    res.status(500).json({ error: 'Failed to save signature', code: 'SAVE_SIGNATURE_ERROR' });
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
      historyCount: config.password.historyCount,
      expiryDays: config.password.expiryDays,
    },
  });
});

// ============================================================
// TWO-FACTOR AUTHENTICATION (TOTP)
// ============================================================

// ─── POST /api/auth/verify-2fa (also /api/auth/login/verify-2fa) ───
// Second step of login — verify TOTP code after password accepted
router.post('/login/verify-2fa', authRateLimit, verify2FAHandler);
router.post('/verify-2fa', authRateLimit, verify2FAHandler);

function verify2FAHandler(req: Request, res: Response) {
  try {
    const { tempToken, code } = req.body;

    if (!tempToken || !code) {
      res.status(400).json({ error: 'Token and verification code are required', code: 'TOKEN_AND_VERIFICATION_CODE' });
      return;
    }

    // Verify the temp token
    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(tempToken, config.jwt.secret) as JwtPayload;
    } catch {
      res.status(401).json({ error: 'Verification session expired. Please log in again.', code: 'VERIFICATION_SESSION_EXPIRED_PLEASE' });
      return;
    }

    if (decoded.type !== '2fa_pending') {
      res.status(403).json({ error: 'Invalid token type', code: 'INVALID_TOKEN_TYPE' });
      return;
    }

    const db = getDb();
    const user = db.prepare(
      'SELECT id, username, full_name, first_name, last_name, email, role, badge_number, phone, avatar_url, status, must_change_password, totp_secret_enc, totp_backup_codes FROM users WHERE id = ?'
    ).get(decoded.userId) as any;

    if (!user || !user.totp_secret_enc) {
      res.status(401).json({ error: 'Invalid verification session', code: 'INVALID_VERIFICATION_SESSION' });
      return;
    }

    const ip = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    // Try TOTP code first
    const secret = decryptSecret(user.totp_secret_enc);
    let codeValid = verifyTotpCode(secret, code);

    // If TOTP fails, try backup code
    if (!codeValid && user.totp_backup_codes) {
      const hashedCodes: string[] = JSON.parse(user.totp_backup_codes);
      const result = verifyBackupCode(code, hashedCodes);
      if (result.valid) {
        codeValid = true;
        // Consume the backup code
        db.prepare('UPDATE users SET totp_backup_codes = ? WHERE id = ?')
          .run(JSON.stringify(result.remainingCodes), user.id);
      }
    }

    if (!codeValid) {
      res.status(401).json({ error: 'Invalid verification code', code: 'INVALID_VERIFICATION_CODE' });
      return;
    }

    // 2FA verified — issue full tokens
    const payload: Omit<JwtPayload, 'type'> = {
      userId: user.id,
      username: user.username,
      role: user.role,
      fullName: user.full_name,
    };

    const refreshToken = generateRefreshToken(payload);
    const sessionId = createSession(user.id, refreshToken, ip, userAgent);
    const accessToken = generateAccessToken({ ...payload, sessionId });

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'user_login_2fa', 'user', ?, '2FA login completed', ?)
    `).run(user.id, user.id, ip);

    db.prepare(`
      UPDATE users SET login_count = COALESCE(login_count, 0) + 1, last_login_at = ? WHERE id = ?
    `).run(localNow(), user.id);

    // Login notification for new IP
    try {
      const previousLogins = db.prepare(`
        SELECT DISTINCT ip_address FROM login_attempts
        WHERE username = ? AND success = 1 AND ip_address != ?
        ORDER BY created_at DESC LIMIT 20
      `).all(user.username, ip) as { ip_address: string }[];

      if (previousLogins.length > 0) {
        const knownIps = new Set(previousLogins.map(l => l.ip_address));
        if (!knownIps.has(ip)) {
          createNotification(
            user.id, 'login_alert', 'New Login Detected',
            `Login from new IP address: ${ip} — ${(userAgent || '').substring(0, 60)}`,
            'user', user.id, 'high',
          );
        }
      }
    } catch { /* non-critical */ }

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
        totp_enabled: true,
      },
    });
  } catch (error: any) {
    console.error('2FA verification error:', error);
    res.status(500).json({ error: 'Failed to 2fa verification', code: '2FA_VERIFICATION_ERROR' });
  }
}

// ─── GET /api/auth/totp/status ───────────────────────
router.get('/totp/status', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT totp_enabled FROM users WHERE id = ?')
      .get(req.user!.userId) as any;

    const requiredRoles = getTotpRequiredRoles();
    const required = requiredRoles.includes(req.user!.role);

    res.json({
      enabled: !!user?.totp_enabled,
      required,
    });
  } catch (error: any) {
    console.error('TOTP status error:', error);
    res.status(500).json({ error: 'Failed to totp status', code: 'TOTP_STATUS_ERROR' });
  }
});

// ─── POST /api/auth/totp/setup ───────────────────────
// Begin TOTP enrollment — generates secret + QR code
router.post('/totp/setup', authenticateToken, async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT id, username, totp_enabled FROM users WHERE id = ?')
      .get(req.user!.userId) as any;

    if (!user) {
      res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      return;
    }

    if (user.totp_enabled) {
      res.status(400).json({ error: '2FA is already enabled. Disable it first to re-setup.', code: '2FA_IS_ALREADY_ENABLED' });
      return;
    }

    // Generate secret
    const { secret, otpauthUrl } = generateTotpSecret(user.username);
    const qrCodeUrl = await generateQrCodeDataUrl(otpauthUrl);

    // Generate backup codes
    const { plain: backupCodes, hashed: hashedBackupCodes } = generateBackupCodes(config.totp?.backupCodeCount || 10);

    // Store pending secret (not active yet — user must verify first)
    const encPendingSecret = encryptSecret(secret);
    db.prepare('UPDATE users SET totp_pending_secret = ? WHERE id = ?')
      .run(encPendingSecret, user.id);

    // Temporarily store hashed backup codes (will be activated on verify-setup)
    // We store them alongside the pending secret — they're not active until setup completes
    db.prepare('UPDATE users SET totp_backup_codes = ? WHERE id = ?')
      .run(JSON.stringify(hashedBackupCodes), user.id);

    res.json({
      qrCodeDataUrl: qrCodeUrl,
      secret,
      backupCodes,
    });
  } catch (error: any) {
    console.error('TOTP setup error:', error);
    res.status(500).json({ error: 'Failed to totp setup', code: 'TOTP_SETUP_ERROR' });
  }
});

// ─── POST /api/auth/totp/verify-setup ────────────────
// Verify the first TOTP code to activate 2FA
router.post('/totp/verify-setup', authenticateToken, (req: Request, res: Response) => {
  try {
    const { code } = req.body;
    if (!code) {
      res.status(400).json({ error: 'Verification code is required', code: 'VERIFICATION_CODE_IS_REQUIRED' });
      return;
    }

    const db = getDb();
    const user = db.prepare('SELECT id, totp_pending_secret FROM users WHERE id = ?')
      .get(req.user!.userId) as any;

    if (!user?.totp_pending_secret) {
      res.status(400).json({ error: 'No pending 2FA setup found. Call /totp/setup first.', code: 'NO_PENDING_2FA_SETUP' });
      return;
    }

    // Decrypt pending secret and verify code
    const secret = decryptSecret(user.totp_pending_secret);
    if (!verifyTotpCode(secret, code)) {
      res.status(401).json({ error: 'Invalid code. Ensure your authenticator app is synced and try again.', code: 'INVALID_CODE_ENSURE_YOUR' });
      return;
    }

    // Activate: move pending secret to active, enable 2FA
    db.prepare(`
      UPDATE users SET totp_secret_enc = totp_pending_secret, totp_pending_secret = NULL,
        totp_enabled = 1, updated_at = ? WHERE id = ?
    `).run(localNow(), user.id);

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'totp_enabled', 'user', ?, 'Two-factor authentication enabled', ?)
    `).run(user.id, user.id, req.ip || 'unknown');

    res.json({ enabled: true, message: 'Two-factor authentication is now active.' });
  } catch (error: any) {
    console.error('TOTP verify-setup error:', error);
    res.status(500).json({ error: 'Failed to totp verify-setup', code: 'TOTP_VERIFYSETUP_ERROR' });
  }
});

// ─── GET /api/auth/session-timeout ────────────────────
// Returns session timeout configuration for the client
router.get('/session-timeout', authenticateToken, (_req: Request, res: Response) => {
  try {
    res.json({
      timeoutMinutes: 60,      // 1 hour of inactivity
      maxSessionHours: 12,     // 12 hours of continuous use
    });
  } catch (error: any) {
    console.error('Session timeout config error:', error);
    res.status(500).json({ error: 'Failed to session timeout config', code: 'SESSION_TIMEOUT_CONFIG_ERROR' });
  }
});

// ─── POST /api/auth/admin/reset-all-2fa ──────────────
// Admin-only: Reset 2FA for ALL users (clears TOTP secrets, backup codes, pending secrets)
router.post('/admin/reset-all-2fa', authenticateToken, (req: Request, res: Response) => {
  try {
    // Only admins can reset 2FA for all users
    if (req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required', code: 'ADMIN_ACCESS_REQUIRED' });
      return;
    }

    const db = getDb();
    const now = localNow();

    // Reset 2FA for all users in a transaction
    const resetTx = db.transaction(() => {
      const result = db.prepare(`
        UPDATE users SET
          totp_enabled = 0,
          totp_secret_enc = NULL,
          totp_backup_codes = NULL,
          totp_pending_secret = NULL,
          updated_at = ?
        WHERE totp_enabled = 1 OR totp_secret_enc IS NOT NULL OR totp_pending_secret IS NOT NULL
      `).run(now);

      // Log the action
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'admin_reset_all_2fa', 'system', 0, ?, ?)
      `).run(
        req.user!.userId,
        `Admin reset 2FA for ${result.changes} users`,
        req.ip || 'unknown'
      );

      return result.changes;
    });

    const usersReset = resetTx();

    console.log(`[Auth] Admin ${req.user!.userId} reset 2FA for ${usersReset} users`);

    res.json({
      success: true,
      usersReset,
      message: `Two-factor authentication reset for ${usersReset} user(s). Users will need to re-enroll.`,
    });
  } catch (error: any) {
    console.error('Admin reset all 2FA error:', error);
    res.status(500).json({ error: 'Failed to admin reset all 2fa', code: 'ADMIN_RESET_ALL_2FA' });
  }
});

// ─── POST /api/auth/totp/disable ─────────────────────
// Disable 2FA (requires password re-entry)
router.post('/totp/disable', authenticateToken, (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    if (!password) {
      res.status(400).json({ error: 'Password is required to disable 2FA', code: 'PASSWORD_IS_REQUIRED_TO' });
      return;
    }

    const db = getDb();
    const user = db.prepare('SELECT id, password_hash, totp_enabled FROM users WHERE id = ?')
      .get(req.user!.userId) as any;

    if (!user) {
      res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      return;
    }

    if (!user.totp_enabled) {
      res.status(400).json({ error: '2FA is not currently enabled', code: '2FA_IS_NOT_CURRENTLY' });
      return;
    }

    if (!bcryptjs.compareSync(password, user.password_hash)) {
      res.status(401).json({ error: 'Incorrect password', code: 'INCORRECT_PASSWORD' });
      return;
    }

    db.prepare(`
      UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, totp_backup_codes = NULL,
        totp_pending_secret = NULL, updated_at = ? WHERE id = ?
    `).run(localNow(), user.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'totp_disabled', 'user', ?, 'Two-factor authentication disabled', ?)
    `).run(user.id, user.id, req.ip || 'unknown');

    res.json({ enabled: false, message: 'Two-factor authentication has been disabled.' });
  } catch (error: any) {
    console.error('TOTP disable error:', error);
    res.status(500).json({ error: 'Failed to totp disable', code: 'TOTP_DISABLE_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// 2FA Path Aliases (client uses /auth/2fa/*, server has /auth/totp/*)
// ═══════════════════════════════════════════════════════════════

// GET /auth/2fa/status — alias for /auth/totp/status
router.get('/2fa/status', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT totp_enabled FROM users WHERE id = ?').get(req.user!.userId) as any;
    const requiredRoles = getTotpRequiredRoles();
    const required = requiredRoles.includes(req.user!.role);
    res.json({ enabled: !!(user?.totp_enabled), required });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// POST /auth/2fa/setup — alias for /auth/totp/setup
router.post('/2fa/setup', authenticateToken, async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT id, email, username FROM users WHERE id = ?').get(req.user!.userId) as any;
    if (!user) { res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' }); return; }

    const accountName = user.email || user.username;
    const { secret, otpauthUrl } = generateTotpSecret(accountName);
    const qrCodeDataUri = await generateQrCodeDataUrl(otpauthUrl);

    // Store as pending until verified
    const encSecret = encryptSecret(secret);
    db.prepare('UPDATE users SET totp_pending_secret = ?, updated_at = ? WHERE id = ?')
      .run(encSecret, localNow(), user.id);

    res.json({ qrCodeDataUri, manualKey: secret });
  } catch (error: any) {
    console.error('2FA setup error:', error);
    res.status(500).json({ error: 'Failed to 2fa setup', code: '2FA_SETUP_ERROR' });
  }
});

// POST /auth/2fa/setup/verify — alias for /auth/totp/verify-setup
router.post('/2fa/setup/verify', authenticateToken, (req: Request, res: Response) => {
  try {
    const { code } = req.body;
    if (!code) { res.status(400).json({ error: 'Verification code required', code: 'VERIFICATION_CODE_REQUIRED' }); return; }

    const db = getDb();
    const user = db.prepare('SELECT id, totp_pending_secret FROM users WHERE id = ?').get(req.user!.userId) as any;
    if (!user?.totp_pending_secret) { res.status(400).json({ error: 'No pending 2FA setup', code: 'NO_PENDING_2FA_SETUP' }); return; }

    const secret = decryptSecret(user.totp_pending_secret);
    if (!verifyTotpCode(secret, code)) {
      res.status(400).json({ error: 'Invalid verification code', code: 'INVALID_VERIFICATION_CODE' });
      return;
    }

    // Activate 2FA and generate backup codes
    const backupResult = generateBackupCodes(config.totp.backupCodeCount);

    db.prepare(`
      UPDATE users SET totp_secret_enc = totp_pending_secret, totp_pending_secret = NULL,
        totp_enabled = 1, totp_backup_codes = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(backupResult.hashed), localNow(), user.id);

    res.json({ success: true, backupCodes: backupResult.plain });
  } catch (error: any) {
    console.error('2FA verify setup error:', error);
    res.status(500).json({ error: 'Failed to 2fa verify setup', code: '2FA_VERIFY_SETUP_ERROR' });
  }
});

// POST /auth/2fa/backup-codes/regenerate
router.post('/2fa/backup-codes/regenerate', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT id, totp_enabled FROM users WHERE id = ?').get(req.user!.userId) as any;
    if (!user || !user.totp_enabled) {
      res.status(400).json({ error: '2FA is not enabled', code: '2FA_IS_NOT_ENABLED' });
      return;
    }

    const backupResult = generateBackupCodes(config.totp.backupCodeCount);

    db.prepare('UPDATE users SET totp_backup_codes = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(backupResult.hashed), localNow(), user.id);

    res.json({ backupCodes: backupResult.plain });
  } catch (error: any) {
    console.error('Regenerate backup codes error:', error);
    res.status(500).json({ error: 'Failed to regenerate backup codes', code: 'REGENERATE_BACKUP_CODES_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Password Reset (forgot/reset flow)
// ═══════════════════════════════════════════════════════════════

router.post('/forgot-password', authRateLimit, (req: Request, res: Response) => {
  // Always return success to prevent email enumeration
  res.json({ message: 'If an account exists with that username, password reset instructions have been sent.' });
});

router.get('/reset-password/validate', (req: Request, res: Response) => {
  // Token-based reset not yet implemented — respond with a helpful message
  res.status(400).json({ error: 'Password reset links are not enabled. Contact your administrator.', code: 'PASSWORD_RESET_LINKS_ARE' });
});

router.post('/reset-password', (req: Request, res: Response) => {
  res.status(400).json({ error: 'Password reset links are not enabled. Contact your administrator.', code: 'PASSWORD_RESET_LINKS_ARE' });
});

// ═══════════════════════════════════════════════════════════════
// Profile Image
// ═══════════════════════════════════════════════════════════════

router.get('/profile-image', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT avatar_url FROM users WHERE id = ?').get(req.user!.userId) as any;
    res.json({ url: user?.avatar_url || null });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

router.put('/profile-image', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { url } = req.body;
    db.prepare('UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?')
      .run(url || null, localNow(), req.user!.userId);
    res.json({ success: true, url: url || null });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Signed URLs (for secure file access)
// ═══════════════════════════════════════════════════════════════

router.post('/sign-urls', authenticateToken, (req: Request, res: Response) => {
  try {
    const { urls } = req.body;
    if (!Array.isArray(urls)) {
      res.status(400).json({ error: 'urls array required', code: 'URLS_ARRAY_REQUIRED' });
      return;
    }
    // For local file storage, just return the same URLs (no signing needed)
    const signed = urls.map((url: string) => ({ original: url, signed: url, expiresAt: new Date(Date.now() + 3600000).toISOString() }));
    res.json({ urls: signed });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

export default router;
