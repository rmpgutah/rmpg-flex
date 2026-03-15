import { Router, Request, Response } from 'express';
import bcryptjs from 'bcryptjs';
import crypto from 'crypto';
import { getDb } from '../models/database';
import { broadcast } from '../utils/websocket';
import jwt from 'jsonwebtoken';
import {
  authenticateToken,
  authenticateTempToken,
  authenticateAnyToken,
  requireRole,
  generateAccessToken,
  generateRefreshToken,
  generate2faPendingToken,
  generateTempToken,
  verifyRefreshToken,
  JwtPayload,
} from '../middleware/auth';
import { authRateLimit, mfaRateLimit, refreshRateLimit, passwordRateLimit } from '../middleware/rateLimiter';
import { validatePassword, getPasswordPolicyDescription, checkPasswordHistory, isPasswordExpired } from '../middleware/validatePassword';
import config from '../config';
import { localNow } from '../utils/timeUtils';
import {
  generateTotpSecret as legacyGenerateTotpSecret,
  generateQrCodeDataUrl,
  verifyTotpCode,
  generateBackupCodes as legacyGenerateBackupCodes,
  verifyBackupCode,
  encryptSecret as legacyEncryptSecret,
  decryptSecret as legacyDecryptSecret,
} from '../utils/totp';
import { createNotification } from './notifications';
import { sendNotificationEmail } from '../utils/emailSender';
import {
  isDeviceTrusted,
  trustDevice,
  isNewDevice,
  parseDeviceName,
  hashDeviceFingerprint,
  createSecurityNotification,
} from '../utils/deviceFingerprint';
import {
  isPasswordExpiringSoon,
  setPasswordExpiry,
  isPasswordInHistory,
  addToPasswordHistory,
} from '../utils/passwordExpiry';

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
function logLoginAttempt(
  username: string,
  ip: string,
  success: boolean,
  reason?: string,
  userAgent?: string,
  deviceFingerprint?: string
): void {
  const db = getDb();
  const fpHash = deviceFingerprint ? hashDeviceFingerprint(deviceFingerprint) : null;
  db.prepare(`
    INSERT INTO login_attempts (username, ip_address, success, failure_reason, user_agent, device_fingerprint)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(username, ip, success ? 1 : 0, reason || null, userAgent || null, fpHash);
}

// ─── Helper: Create session ───────────────────────────
function createSession(
  userId: number,
  refreshToken: string,
  ip: string,
  userAgent: string,
  deviceFingerprint?: string
): string {
  const db = getDb();
  const sessionId = crypto.randomUUID();
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const fpHash = deviceFingerprint ? hashDeviceFingerprint(deviceFingerprint) : null;
  const deviceName = parseDeviceName(userAgent);

  // Enforce max sessions per user
  const activeSessions = db.prepare(`
    SELECT id FROM sessions WHERE user_id = ? AND is_active = 1
    ORDER BY last_used_at ASC
  `).all(userId) as { id: number }[];

  if (activeSessions.length >= config.session.maxPerUser) {
    const toRemove = activeSessions.length - config.session.maxPerUser + 1;
    const oldestIds = activeSessions.slice(0, toRemove).map(s => s.id);
    db.prepare(`UPDATE sessions SET is_active = 0 WHERE id IN (${oldestIds.map(() => '?').join(',')})`)
      .run(...oldestIds);
  }

  db.prepare(`
    INSERT INTO sessions (session_id, user_id, refresh_token_hash, ip_address, user_agent, expires_at, device_fingerprint, device_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, userId, tokenHash, ip, userAgent, expiresAt, fpHash, deviceName);

  return sessionId;
}

// ─── Helper: Issue final tokens after full authentication ──
function issueTokens(user: any, ip: string, userAgent: string, deviceFingerprint?: string) {
  const payload: Omit<JwtPayload, 'type'> = {
    userId: user.id,
    username: user.username,
    role: user.role,
    fullName: user.full_name,
  };

  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);
  const sessionId = createSession(user.id, refreshToken, ip, userAgent, deviceFingerprint);

  // Log the login activity
  const db = getDb();
  db.prepare(`
    INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
    VALUES (?, 'user_login', 'user', ?, 'User logged in', ?)
  `).run(user.id, user.id, ip);

  return {
    token: accessToken,
    refreshToken,
    sessionId,
    expiresIn: config.jwt.accessExpiry,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      email: user.email,
      role: user.role,
      badgeNumber: user.badge_number,
      phone: user.phone,
      avatarUrl: user.avatar_url,
    },
  };
}


// ═══════════════════════════════════════════════════════
// POST /api/auth/login — Multi-step login
// ═══════════════════════════════════════════════════════
router.post('/login', authRateLimit, (req: Request, res: Response) => {
  try {
    const { username, password, deviceFingerprint } = req.body;
    const ip = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    // Check lockout
    const lockout = isLockedOut(username);
    if (lockout.locked) {
      logLoginAttempt(username, ip, false, 'account_locked', userAgent, deviceFingerprint);
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
             badge_number, phone, status, avatar_url, profile_image, must_change_password
      FROM users WHERE username = ?
    `).get(username) as any;

    if (!user) {
      logLoginAttempt(username, ip, false, 'user_not_found', userAgent, deviceFingerprint);
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    if (user.status !== 'active') {
      logLoginAttempt(username, ip, false, 'account_inactive');
      // Return identical error to invalid credentials to prevent account enumeration
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    const validPassword = bcryptjs.compareSync(password, user.password_hash);
    if (!validPassword) {
      logLoginAttempt(username, ip, false, 'invalid_password', userAgent, deviceFingerprint);

      const lockoutWindow = new Date(
        Date.now() - config.security.lockoutDurationMinutes * 60 * 1000
      ).toISOString();
      const attemptsRemaining = config.security.maxLoginAttempts -
        (db.prepare(`
          SELECT COUNT(*) as count FROM login_attempts
          WHERE username = ? AND success = 0 AND created_at > ?
        `).get(username, lockoutWindow) as { count: number }).count;

      const newLockout = isLockedOut(username);
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

    // ── Password verified. Determine next steps. ──────

    // Build list of pending actions
    const pendingActions: string[] = [];
    const needsPasswordChange = user.force_password_change === 1 || user.must_change_password === 1 || isPasswordExpired(user);
    // 2FA is mandatory for ALL users regardless of account age or role.
    // Any user without an active, verified TOTP secret must complete setup.
    const needs2FASetup = user.totp_setup_required === 1 || user.totp_enabled !== 1;
    const has2FA = user.totp_enabled === 1 && user.totp_setup_required !== 1;

    // Also check WebAuthn
    let hasWebAuthn = false;
    try {
      const webauthnEnabled = db.prepare('SELECT webauthn_enabled FROM users WHERE id = ?')
        .get(user.id) as { webauthn_enabled: number } | undefined;
      hasWebAuthn = !!webauthnEnabled?.webauthn_enabled;
    } catch { /* column may not exist */ }

    if (needsPasswordChange) pendingActions.push('password_change');
    if (needs2FASetup) pendingActions.push('2fa_setup');

    // Check trusted device — if trusted and 2FA is already set up, skip 2FA
    if (has2FA && deviceFingerprint && isDeviceTrusted(user.id, deviceFingerprint)) {
      // Trusted device — skip 2FA, log success
      logLoginAttempt(username, ip, true, undefined, userAgent, deviceFingerprint);

      // Detect new device and send notification
      if (deviceFingerprint && isNewDevice(user.id, deviceFingerprint)) {
        createSecurityNotification(
          user.id,
          'new_device_login',
          'New device login detected',
          `Login from ${parseDeviceName(userAgent)} at IP ${ip}`,
          ip,
          parseDeviceName(userAgent)
        );
      }

      // If password change needed, still require it
      if (needsPasswordChange) {
        const tempToken = generateTempToken(
          { userId: user.id, username: user.username, role: user.role, fullName: user.full_name },
          ['password_change']
        );
        res.json({
          step: 'password_change',
          requiresPasswordChange: true,
          tempToken,
        });
        return;
      }

      const tokens = issueTokens(user, ip, userAgent, deviceFingerprint);
      res.json(tokens);
      return;
    }

    const payload: Omit<JwtPayload, 'type'> = {
      userId: user.id,
      username: user.username,
      role: user.role,
      fullName: user.full_name,
    };

    // ── Two-Factor Authentication gate ──────────────────
    if (has2FA) {
      // Check if this device is trusted — skip 2FA if so
      if (deviceFingerprint && isDeviceTrusted(user.id, deviceFingerprint)) {
        // Trusted device — bypass 2FA, proceed to token issuance below
        logLoginAttempt(username, ip, true, undefined, userAgent, deviceFingerprint);
      } else {
        // Not trusted — require 2FA
        const tempToken = generate2faPendingToken(payload);
        res.json({
          requires2FA: true,
          tempToken,
          userId: user.id,
        });
        return;
      }
    }

    // 2FA not set up — require setup
    if (needs2FASetup) {
      const tempToken = generateTempToken(
        { userId: user.id, username: user.username, role: user.role, fullName: user.full_name },
        pendingActions
      );
      res.json({
        step: 'setup_2fa',
        requires2FASetup: true,
        requiresPasswordChange: needsPasswordChange,
        tempToken,
      });
      return;
    }

    // ── No 2FA — issue full tokens ──────────────────────
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);
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
            'auth.new_ip_login',
          );
          // Email alert for new IP login
          sendNotificationEmail(
            user.id,
            'New Login From Unrecognized IP',
            `A login to your RMPG Flex account was detected from a new IP address: ${ip}\n\nDevice: ${(userAgent || '').substring(0, 80)}\nTime: ${localNow()}\n\nIf this was not you, contact your administrator immediately.`
          ).catch(() => { /* email failure should never block login */ });
        }
      }
    } catch { /* notification failure should never block login */ }

    res.json({
      token: accessTokenWithSession,
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
        profile_image: user.profile_image || null,
        status: user.status,
        must_change_password: !!user.must_change_password,
        totp_enabled: false,
        requires_2fa_setup: must_setup_2fa,
      },
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/refresh ───────────────────────────
router.post('/refresh', refreshRateLimit, (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(400).json({ error: 'Refresh token is required' });
      return;
    }

    let decoded: JwtPayload;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch {
      res.status(401).json({ error: 'Invalid or expired refresh token', code: 'REFRESH_EXPIRED' });
      return;
    }

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

    const user = db.prepare('SELECT id, status, role, full_name, username FROM users WHERE id = ?')
      .get(decoded.userId) as any;

    if (!user || user.status !== 'active') {
      db.prepare('UPDATE sessions SET is_active = 0 WHERE id = ?').run(session.id);
      res.status(403).json({ error: 'Account is no longer active' });
      return;
    }

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


// ═══════════════════════════════════════════════════════
// POST /api/auth/logout
// ═══════════════════════════════════════════════════════
router.post('/logout', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { refreshToken, sessionId } = req.body;

    if (refreshToken) {
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      db.prepare('UPDATE sessions SET is_active = 0 WHERE refresh_token_hash = ? AND user_id = ?')
        .run(tokenHash, req.user!.userId);
    } else if (sessionId) {
      db.prepare('UPDATE sessions SET is_active = 0 WHERE session_id = ? AND user_id = ?')
        .run(sessionId, req.user!.userId);
    } else {
      db.prepare('UPDATE sessions SET is_active = 0 WHERE user_id = ?')
        .run(req.user!.userId);
    }

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


// ═══════════════════════════════════════════════════════
// GET /api/auth/me
// ═══════════════════════════════════════════════════════
router.get('/me', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare(`
      SELECT id, username, first_name, last_name, full_name, email, role,
             badge_number, phone, status, avatar_url, profile_image, created_at, must_change_password, totp_enabled
      FROM users WHERE id = ?
    `).get(req.user!.userId) as any;

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Check if 2FA setup is required for this role
    const requiredRoles = config.totp?.requiredRoles || [];
    const requires2faSetup = requiredRoles.length > 0 && requiredRoles.includes(user.role) && !user.totp_enabled;

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
      profile_image: user.profile_image || null,
      created_at: user.created_at,
      createdAt: user.created_at,
      must_change_password: !!user.must_change_password,
      totp_enabled: !!user.totp_enabled,
      totpEnabled: user.totp_enabled === 1,
      requires_2fa_setup: requires2faSetup,
      passwordExpiringSoon: isPasswordExpiringSoon(user),
      passwordExpiresAt: user.password_expires_at,
    });
  } catch (error: any) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ═══════════════════════════════════════════════════════
// GET /api/auth/sessions
// ═══════════════════════════════════════════════════════
router.get('/sessions', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const sessions = db.prepare(`
      SELECT session_id, ip_address, user_agent, device_name, device_fingerprint,
             is_active, created_at, last_used_at, expires_at
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


// ═══════════════════════════════════════════════════════
// DELETE /api/auth/sessions/:sessionId
// ═══════════════════════════════════════════════════════
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

    createSecurityNotification(
      req.user!.userId,
      'session_revoked',
      'Session revoked',
      `A session was manually revoked.`,
      req.ip || 'unknown'
    );

    res.json({ message: 'Session revoked' });
  } catch (error: any) {
    console.error('Revoke session error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/logout-all ────────────────────────
// Revoke all sessions for the current user (logout from all devices)
router.post('/logout-all', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const result = db.prepare('UPDATE sessions SET is_active = 0 WHERE user_id = ?')
      .run(req.user!.userId);

    const ip = req.ip || 'unknown';
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'logout_all_sessions', 'user', ?, 'Revoked all active sessions', ?)
    `).run(req.user!.userId, req.user!.userId, ip);

    createSecurityNotification(
      req.user!.userId,
      'all_sessions_revoked',
      'All Sessions Revoked',
      `All ${result.changes} active sessions were revoked from ${ip}.`,
      ip,
      parseDeviceName(req.headers['user-agent'] || '')
    );

    res.json({ message: 'All sessions revoked', count: result.changes });
  } catch (error: any) {
    console.error('Logout all sessions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/auth/session-timeout ───────────────────
// Return the configured session idle timeout (in minutes) for client-side enforcement
router.get('/session-timeout', authenticateToken, (_req: Request, res: Response) => {
  try {
    const db = getDb();
    // Check system_config for security_config JSON or session_timeout_minutes
    let timeoutMinutes = 480; // default: 8 hours

    const row = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = 'security_config' AND category = 'settings'"
    ).get() as { config_value: string } | undefined;

    if (row?.config_value) {
      try {
        const secConfig = JSON.parse(row.config_value);
        if (secConfig.session_timeout_minutes) {
          timeoutMinutes = parseInt(secConfig.session_timeout_minutes, 10) || 480;
        }
      } catch { /* use default */ }
    }

    // Also check for standalone setting
    const standalone = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = 'session_timeout_minutes' AND category = 'settings'"
    ).get() as { config_value: string } | undefined;

    if (standalone?.config_value) {
      timeoutMinutes = parseInt(standalone.config_value, 10) || timeoutMinutes;
    }

    res.json({ timeoutMinutes });
  } catch (error: any) {
    console.error('Get session timeout error:', error);
    res.json({ timeoutMinutes: 480 }); // safe fallback
  }
});

// ─── POST /api/auth/change-password ───────────────────
router.post('/change-password', passwordRateLimit, authenticateToken, (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const ip = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current password and new password are required' });
      return;
    }

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
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const validPassword = bcryptjs.compareSync(currentPassword, user.password_hash);
    if (!validPassword) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    if (bcryptjs.compareSync(newPassword, user.password_hash)) {
      res.status(400).json({ error: 'New password must be different from current password' });
      return;
    }

    // Check password history — prevent reuse of recent passwords
    if (config.password.historyCount > 0) {
      let historyHashes: string[] = [];
      try { historyHashes = user.password_history ? JSON.parse(user.password_history) : []; } catch { /* corrupted history — allow password change */ }
      if (checkPasswordHistory(newPassword, historyHashes)) {
        res.status(400).json({
          error: `Password was used recently. Cannot reuse the last ${config.password.historyCount} passwords.`,
        });
        return;
      }
    }

    // Save to history
    addToPasswordHistory(user.id, user.password_hash);

    const newHash = bcryptjs.hashSync(newPassword, 10);
    const now = localNow();

    // Update password history: prepend old hash, keep last N
    let oldHistory: string[] = [];
    try { oldHistory = user.password_history ? JSON.parse(user.password_history) : []; } catch { /* corrupted — start fresh history */ }
    const newHistory = [user.password_hash, ...oldHistory].slice(0, config.password.historyCount);

    db.prepare(`
      UPDATE users SET password_hash = ?, must_change_password = 0, force_password_change = 0,
        password_changed_at = ?, updated_at = ? WHERE id = ?
    `).run(newHash, now, now, user.id);

    // Set new password expiry
    try { setPasswordExpiry(user.id); } catch { /* ignore if column missing */ }

    // Log the password change
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'password_changed', 'user', ?, 'Password changed', ?)
    `).run(user.id, user.id, ip);

    createSecurityNotification(
      user.id,
      'password_changed',
      'Password changed',
      'Your password was changed.',
      ip,
      parseDeviceName(userAgent)
    );

    // Email alert for password change
    sendNotificationEmail(
      req.user!.userId,
      'Password Changed',
      `Your RMPG Flex password was changed.\n\nIP: ${ip}\nDevice: ${parseDeviceName(userAgent)}\nTime: ${localNow()}\n\nAll active sessions have been terminated. If this was not you, contact your administrator immediately.`
    ).catch(() => { /* email failure should never block response */ });

    createSecurityNotification(
      user.id,
      'password_changed',
      'Password changed',
      'Your password was changed.',
      ip,
      parseDeviceName(userAgent)
    );

    // Invalidate all sessions
    db.prepare('UPDATE sessions SET is_active = 0 WHERE user_id = ?').run(user.id);

    res.json({ message: 'Password changed successfully. Please log in again.' });
  } catch (error: any) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ═══════════════════════════════════════════════════════
// PUT /api/auth/profile
// ═══════════════════════════════════════════════════════
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

    const updated = db.prepare(`
      SELECT id, username, full_name, first_name, last_name, email, role, badge_number, phone, status, avatar_url, profile_image, created_at
      FROM users WHERE id = ?
    `).get(user.id) as any;

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

// ─── PUT /api/auth/profile-image ─────────────────────────
// Save or clear the current user's profile image (base64 data URL)
router.put('/profile-image', authenticateToken, (req: Request, res: Response) => {
  try {
    const { profile_image } = req.body; // base64 data URL or null to clear
    const db = getDb();

    if (profile_image !== null && profile_image !== undefined) {
      if (typeof profile_image !== 'string' || !profile_image.startsWith('data:image/')) {
        res.status(400).json({ error: 'Profile image must be an image data URL' });
        return;
      }
      // Limit size (~2MB for a profile photo)
      if (profile_image.length > 2_000_000) {
        res.status(400).json({ error: 'Profile image too large (max 2MB)' });
        return;
      }
    }

    db.prepare('UPDATE users SET profile_image = ?, updated_at = ? WHERE id = ?')
      .run(profile_image || null, localNow(), req.user!.userId);

    // Verify roundtrip — ensure DB stored the complete value
    if (profile_image) {
      const verify = db.prepare('SELECT length(profile_image) as len FROM users WHERE id = ?')
        .get(req.user!.userId) as { len: number } | undefined;
      if (verify && verify.len !== profile_image.length) {
        console.error(`Profile image truncated! Sent ${profile_image.length}, stored ${verify.len}`);
        res.status(500).json({ error: 'Image data was truncated during storage' });
        return;
      }
    }

    // Broadcast so avatar updates everywhere
    try {
      broadcast('personnel', 'data_changed', {
        action: 'put', module: 'auth', entity: 'profile_image',
        id: req.user!.userId, timestamp: new Date().toISOString(),
      });
    } catch { /* never break the response */ }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Save profile image error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/auth/profile-image ─────────────────────────
// Retrieve the current user's profile image
router.get('/profile-image', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT profile_image FROM users WHERE id = ?')
      .get(req.user!.userId) as { profile_image: string | null } | undefined;
    res.json({ profile_image: row?.profile_image || null });
  } catch (error: any) {
    console.error('Get profile image error:', error);
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
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
        res.status(400).json({ error: 'Signature must be a PNG data URL' });
        return;
      }
      // Limit size (~500KB — a hand-drawn signature should be well under this)
      if (signature.length > 500_000) {
        res.status(400).json({ error: 'Signature data too large' });
        return;
      }
    }

    db.prepare('UPDATE users SET digital_signature = ?, updated_at = ? WHERE id = ?')
      .run(signature || null, localNow(), req.user!.userId);

    res.json({ success: true });
  } catch (error: any) {
    console.error('Save signature error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/auth/password-policy ────────────────────
// Requires auth — password requirements are internal policy info
router.get('/password-policy', authenticateAnyToken, (_req: Request, res: Response) => {
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

// ─── POST /api/auth/verify-2fa ───────────────────────
// Second step of login — verify TOTP code after password accepted
router.post('/verify-2fa', mfaRateLimit, (req: Request, res: Response) => {
  try {
    const { tempToken, code, deviceFingerprint, trustDevice: shouldTrust } = req.body;

    if (!tempToken || !code) {
      res.status(400).json({ error: 'Token and verification code are required' });
      return;
    }

    // Verify the temp token
    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(tempToken, config.jwt.secret) as JwtPayload;
    } catch {
      res.status(401).json({ error: 'Verification session expired. Please log in again.' });
      return;
    }

    if (decoded.type !== 'mfa_pending') {
      res.status(403).json({ error: 'Invalid token type' });
      return;
    }

    const db = getDb();
    const user = db.prepare(
      'SELECT id, username, full_name, first_name, last_name, email, role, badge_number, phone, avatar_url, profile_image, status, must_change_password, totp_secret_enc, totp_backup_codes FROM users WHERE id = ?'
    ).get(decoded.userId) as any;

    if (!user) {
      res.status(401).json({ error: 'Invalid verification session' });
      return;
    }

    if (user.status !== 'active') {
      res.status(403).json({ error: 'Account is disabled or suspended' });
      return;
    }

    const ip = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    let codeValid = false;

    // ── Try new system first (user_totp_secrets table) ───
    const totpRecord = db.prepare(`
      SELECT encrypted_secret, encryption_iv, encryption_tag
      FROM user_totp_secrets WHERE user_id = ? AND is_verified = 1
    `).get(decoded.userId) as any;

    if (totpRecord) {
      // New system: secret in separate table with 3-column encryption
      try {
        const secretBase32 = decryptSecretV2(
          totpRecord.encrypted_secret,
          totpRecord.encryption_iv,
          totpRecord.encryption_tag
        );
        codeValid = verifyTotpToken(secretBase32, code);
      } catch (decryptErr: any) {
        console.error('2FA decryption failed (new system):', decryptErr.message);
        res.status(401).json({ error: '2FA secret could not be decrypted. Please re-enroll 2FA.' });
        return;
      }

      // If TOTP fails, try backup codes from user_backup_codes table
      if (!codeValid) {
        const backupCodes = db.prepare(`
          SELECT id, code_hash FROM user_backup_codes
          WHERE user_id = ? AND is_used = 0
        `).all(decoded.userId) as { id: number; code_hash: string }[];

        for (const bc of backupCodes) {
          if (verifyBackupCode(code, [bc.code_hash]).valid) {
            codeValid = true;
            db.prepare('UPDATE user_backup_codes SET is_used = 1, used_at = ? WHERE id = ?')
              .run(localNow(), bc.id);
            break;
          }
        }
      }
    } else if (user.totp_secret_enc) {
      // Legacy system: secret stored as iv:tag:ciphertext in users table
      let secret: string;
      try {
        secret = decryptSecret(user.totp_secret_enc);
      } catch (decryptErr: any) {
        console.error('2FA decryption failed (legacy system):', decryptErr.message);
        res.status(401).json({ error: '2FA secret could not be decrypted. Please re-enroll 2FA.' });
        return;
      }
      codeValid = verifyTotpCode(secret, code);

      // If TOTP fails, try legacy backup codes
      if (!codeValid && user.totp_backup_codes) {
        try {
          const hashedCodes: string[] = JSON.parse(user.totp_backup_codes);
          if (Array.isArray(hashedCodes)) {
            const result = verifyBackupCode(code, hashedCodes);
            if (result.valid) {
              codeValid = true;
              db.prepare('UPDATE users SET totp_backup_codes = ? WHERE id = ?')
                .run(JSON.stringify(result.remainingCodes), user.id);
            }
          }
        } catch { /* corrupted backup codes — skip legacy fallback */ }
      }
    } else {
      // Neither system has a secret — 2FA is marked enabled but no secret exists
      res.status(401).json({ error: '2FA is not properly configured. Contact an administrator.' });
      return;
    }

    if (!codeValid) {
      res.status(401).json({ error: 'Invalid verification code' });
      return;
    }

    // Replay protection — reject if this TOTP code was already used
    if (isTotpCodeUsed(decoded.userId, code)) {
      res.status(401).json({ error: 'This code has already been used. Please wait for the next code.' });
      return;
    }
    markTotpCodeUsed(decoded.userId, code);

    // 2FA verified — log login attempt and handle device trust
    logLoginAttempt(user.username, ip, true, undefined, userAgent, deviceFingerprint);

    // Trust this device if requested
    console.log(`[Auth] verify-2fa trust check: shouldTrust=${shouldTrust}, hasFingerprint=${!!deviceFingerprint}, userId=${user.id}`);
    if (shouldTrust && deviceFingerprint) {
      trustDevice(user.id, deviceFingerprint, ip, userAgent);
      console.log(`[Auth] Device trusted for user ${user.id}`);
    }

    // Device fingerprint tracking (new device notification)
    if (deviceFingerprint && isNewDevice(user.id, deviceFingerprint)) {
      createSecurityNotification(
        user.id,
        'new_device_login',
        'New device login detected',
        `Login from ${parseDeviceName(userAgent)} at IP ${ip}`,
        ip,
        parseDeviceName(userAgent)
      );
    }

    // ── Check if password change is required before issuing final tokens ──
    const needsPasswordChange = user.must_change_password === 1 || isPasswordExpired(
      (db.prepare('SELECT password_changed_at FROM users WHERE id = ?').get(user.id) as any)?.password_changed_at
    );

    const payload: Omit<JwtPayload, 'type'> = {
      userId: user.id,
      username: user.username,
      role: user.role,
      fullName: user.full_name,
    };

    if (needsPasswordChange) {
      const pwTempToken = generateTempToken(payload, ['password_change']);
      res.json({
        step: 'password_change',
        requiresPasswordChange: true,
        tempToken: pwTempToken,
      });
      return;
    }

    // Issue full tokens
    const refreshToken = generateRefreshToken(payload);
    const sessionId = createSession(user.id, refreshToken, ip, userAgent, deviceFingerprint);
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
            'auth.new_ip_login',
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
        profile_image: user.profile_image || null,
        status: user.status,
        must_change_password: false,
        totp_enabled: true,
      },
    });
  } catch (error: any) {
    console.error('2FA verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/unlock-account ───────────────────
// Admin endpoint to clear login lockout for a user
router.post('/unlock-account', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { username } = req.body;
    if (!username) {
      res.status(400).json({ error: 'Username is required' });
      return;
    }

    const db = getDb();

    // Delete failed login attempts to clear the lockout
    const result = db.prepare(
      'DELETE FROM login_attempts WHERE username = ? AND success = 0'
    ).run(username);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'account_unlocked', 'user', 0, ?, ?)
    `).run(req.user!.userId, `Admin unlocked account: ${username}`, req.ip || 'unknown');

    res.json({
      success: true,
      message: `Account unlocked for ${username}`,
      clearedAttempts: result.changes,
    });
  } catch (error: any) {
    console.error('Unlock account error:', error);
    res.status(500).json({ error: 'Failed to unlock account' });
  }
});

// ─── GET /api/auth/totp/status ───────────────────────
router.get('/totp/status', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT totp_enabled FROM users WHERE id = ?')
      .get(req.user!.userId) as any;

    const requiredRoles = config.totp?.requiredRoles || [];
    const required = requiredRoles.includes(req.user!.role);

    res.json({
      enabled: !!user?.totp_enabled,
      required,
    });
  } catch (error: any) {
    console.error('TOTP status error:', error);
    res.status(500).json({ error: 'Internal server error' });
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
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (user.totp_enabled) {
      res.status(400).json({ error: '2FA is already enabled. Disable it first to re-setup.' });
      return;
    }

    // Generate secret (legacy — combined string format for users table)
    const { secret, otpauthUrl } = legacyGenerateTotpSecret(user.username);
    const qrCodeUrl = await generateQrCodeDataUrl(otpauthUrl);

    // Generate backup codes
    const { plain: backupCodes, hashed: hashedBackupCodes } = legacyGenerateBackupCodes(config.totp?.backupCodeCount || 10);

    // Store pending secret (not active yet — user must verify first)
    const encPendingSecret = legacyEncryptSecret(secret);
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/totp/verify-setup ────────────────
// Verify the first TOTP code to activate 2FA
router.post('/totp/verify-setup', authenticateToken, (req: Request, res: Response) => {
  try {
    const { code } = req.body;
    if (!code) {
      res.status(400).json({ error: 'Verification code is required' });
      return;
    }

    const db = getDb();
    const user = db.prepare('SELECT id, totp_pending_secret FROM users WHERE id = ?')
      .get(req.user!.userId) as any;

    if (!user?.totp_pending_secret) {
      res.status(400).json({ error: 'No pending 2FA setup found. Call /totp/setup first.' });
      return;
    }

    // Decrypt pending secret and verify code (legacy — combined string format)
    const secret = legacyDecryptSecret(user.totp_pending_secret);
    if (!verifyTotpCode(secret, code)) {
      res.status(401).json({ error: 'Invalid code. Ensure your authenticator app is synced and try again.' });
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/totp/disable ─────────────────────
// Disable 2FA (requires password re-entry)
router.post('/totp/disable', authenticateToken, (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    if (!password) {
      res.status(400).json({ error: 'Password is required to disable 2FA' });
      return;
    }

    const db = getDb();
    const user = db.prepare('SELECT id, password_hash, totp_enabled FROM users WHERE id = ?')
      .get(req.user!.userId) as any;

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (!user.totp_enabled) {
      res.status(400).json({ error: '2FA is not currently enabled' });
      return;
    }

    if (!bcryptjs.compareSync(password, user.password_hash)) {
      res.status(401).json({ error: 'Incorrect password' });
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// NEW-STYLE 2FA ENDPOINTS (separate tables architecture)
// These use user_totp_secrets / user_backup_codes tables
// ============================================================

import {
  generateTotpSecret as generateTotpSecretV2,
  encryptSecret as encryptSecretV2,
  decryptSecret as decryptSecretV2,
  generateQRCodeDataUri,
  verifyTotpToken,
  isTotpCodeUsed,
  markTotpCodeUsed,
  generateBackupCodes as generateBackupCodesV2,
  hashBackupCode,
  verifyBackupCode as verifyBackupCodeHash,
} from '../utils/totpService';

// ─── POST /api/auth/2fa/setup ───────────────────────────
// Generate TOTP secret + QR (uses user_totp_secrets table)
router.post('/2fa/setup', authenticateAnyToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const username = req.user!.username;
    const db = getDb();

    // Check if already has a verified TOTP
    const existing = db.prepare(
      'SELECT is_verified FROM user_totp_secrets WHERE user_id = ?'
    ).get(userId) as { is_verified: number } | undefined;

    if (existing?.is_verified) {
      res.status(400).json({ error: '2FA is already configured. Disable it first to reconfigure.' });
      return;
    }

    // Delete any unverified previous setup attempt
    db.prepare('DELETE FROM user_totp_secrets WHERE user_id = ? AND is_verified = 0').run(userId);

    // Generate new TOTP secret
    const { secret, uri } = generateTotpSecretV2(username);
    const secretBase32 = secret.base32;

    // Encrypt and store
    const { encrypted, iv, tag } = encryptSecretV2(secretBase32);
    db.prepare(`
      INSERT INTO user_totp_secrets (user_id, encrypted_secret, encryption_iv, encryption_tag, is_verified)
      VALUES (?, ?, ?, ?, 0)
    `).run(userId, encrypted, iv, tag);

    // Generate QR code
    const qrCodeDataUri = await generateQRCodeDataUri(uri);

    res.json({
      qrCodeDataUri,
      manualKey: secretBase32,
      issuer: (config as any).twoFactor?.issuer || 'RMPG Flex',
    });
  } catch (error: any) {
    console.error('2FA setup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/2fa/setup/verify ────────────────────
// Confirm first TOTP code to activate 2FA
router.post('/2fa/setup/verify', authenticateAnyToken, (req: Request, res: Response) => {
  try {
    const { code } = req.body;
    const userId = req.user!.userId;
    const ip = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    if (!code) {
      res.status(400).json({ error: 'Verification code is required' });
      return;
    }

    const db = getDb();

    // Get the unverified secret
    const totpRecord = db.prepare(`
      SELECT id, encrypted_secret, encryption_iv, encryption_tag
      FROM user_totp_secrets WHERE user_id = ? AND is_verified = 0
    `).get(userId) as any;

    if (!totpRecord) {
      res.status(400).json({ error: 'No pending 2FA setup found. Start setup again.' });
      return;
    }

    // Decrypt and verify
    const secretBase32 = decryptSecretV2(
      totpRecord.encrypted_secret,
      totpRecord.encryption_iv,
      totpRecord.encryption_tag
    );

    const isValid = verifyTotpToken(secretBase32, code);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid code. Please try again with the current code from your authenticator app.' });
      return;
    }

    // Replay protection — reject if this TOTP code was already used
    if (isTotpCodeUsed(userId, code)) {
      res.status(401).json({ error: 'This code has already been used. Please wait for the next code.' });
      return;
    }
    markTotpCodeUsed(userId, code);

    // Mark as verified
    db.prepare('UPDATE user_totp_secrets SET is_verified = 1, updated_at = ? WHERE id = ?')
      .run(localNow(), totpRecord.id);

    // Enable 2FA on user
    db.prepare('UPDATE users SET totp_enabled = 1, totp_setup_required = 0, updated_at = ? WHERE id = ?')
      .run(localNow(), userId);

    // Generate backup codes
    const codes = generateBackupCodesV2();
    const insertStmt = db.prepare(
      'INSERT INTO user_backup_codes (user_id, code_hash) VALUES (?, ?)'
    );
    const insertTx = db.transaction(() => {
      db.prepare('DELETE FROM user_backup_codes WHERE user_id = ?').run(userId);
      for (const c of codes) {
        insertStmt.run(userId, hashBackupCode(c));
      }
    });
    insertTx();

    // Create security notification
    createSecurityNotification(
      userId,
      '2fa_enabled',
      'Two-factor authentication enabled',
      'TOTP-based 2FA has been set up on your account.',
      ip,
      parseDeviceName(userAgent)
    );

    // Log
    logLoginAttempt(req.user!.username, ip, true, undefined, userAgent);

    // If this is during login (mfa_pending token) — issue tokens
    if (req.user!.type === 'mfa_pending') {
      const user = db.prepare(`
        SELECT id, username, full_name, email, role, badge_number, phone, avatar_url,
               force_password_change, password_expires_at, password_changed_at
        FROM users WHERE id = ?
      `).get(userId) as any;

      const needsPasswordChange = user.force_password_change === 1 || isPasswordExpired(user?.password_changed_at);
      if (needsPasswordChange) {
        const tempToken = generateTempToken(
          { userId: user.id, username: user.username, role: user.role, fullName: user.full_name },
          ['password_change']
        );
        res.json({
          step: 'show_backup_codes',
          backupCodes: codes,
          requiresPasswordChange: true,
          tempToken,
        });
        return;
      }

      const { deviceFingerprint } = req.body;
      const refreshToken = generateRefreshToken({ userId: user.id, username: user.username, role: user.role, fullName: user.full_name });
      const sessionId = createSession(user.id, refreshToken, ip, userAgent, deviceFingerprint);
      const accessToken = generateAccessToken({ userId: user.id, username: user.username, role: user.role, fullName: user.full_name, sessionId });

      res.json({
        token: accessToken,
        refreshToken,
        sessionId,
        expiresIn: config.jwt.accessExpiry,
        step: 'show_backup_codes',
        backupCodes: codes,
      });
      return;
    }

    // Already authenticated (managing 2FA from profile)
    res.json({
      message: '2FA setup complete',
      backupCodes: codes,
    });
  } catch (error: any) {
    console.error('2FA setup verify error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/auth/2fa/status ───────────────────────────
router.get('/2fa/status', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;

    const user = db.prepare('SELECT totp_enabled, totp_setup_required FROM users WHERE id = ?')
      .get(userId) as any;

    const backupCount = db.prepare(`
      SELECT COUNT(*) as count FROM user_backup_codes
      WHERE user_id = ? AND is_used = 0
    `).get(userId) as { count: number };

    res.json({
      enabled: user?.totp_enabled === 1,
      setupRequired: user?.totp_setup_required === 1,
      backupCodesRemaining: backupCount.count,
    });
  } catch (error: any) {
    console.error('2FA status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/2fa/backup-codes/regenerate ─────────
router.post('/2fa/backup-codes/regenerate', authenticateToken, (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { password } = req.body;
    const ip = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    if (!password) {
      res.status(400).json({ error: 'Password confirmation required' });
      return;
    }

    const db = getDb();

    // Verify password
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as any;
    if (!user || !bcryptjs.compareSync(password, user.password_hash)) {
      res.status(401).json({ error: 'Invalid password' });
      return;
    }

    // Generate new codes
    const codes = generateBackupCodesV2();
    const insertStmt = db.prepare(
      'INSERT INTO user_backup_codes (user_id, code_hash) VALUES (?, ?)'
    );
    const insertTx = db.transaction(() => {
      db.prepare('DELETE FROM user_backup_codes WHERE user_id = ?').run(userId);
      for (const c of codes) {
        insertStmt.run(userId, hashBackupCode(c));
      }
    });
    insertTx();

    createSecurityNotification(
      userId,
      '2fa_enabled',
      'Backup codes regenerated',
      'Your 2FA backup codes have been regenerated. Old codes are no longer valid.',
      ip,
      parseDeviceName(userAgent)
    );

    res.json({ backupCodes: codes });
  } catch (error: any) {
    console.error('Backup codes regenerate error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/2fa/disable ─────────────────────────
// Disable 2FA using new-style tables (requires password, admin-only for non-admins)
router.post('/2fa/disable', authenticateToken, (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { password } = req.body;
    const ip = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    if (!password) {
      res.status(400).json({ error: 'Password confirmation required' });
      return;
    }

    const db = getDb();
    const user = db.prepare('SELECT password_hash, role FROM users WHERE id = ?').get(userId) as any;

    if (!user || !bcryptjs.compareSync(password, user.password_hash)) {
      res.status(401).json({ error: 'Invalid password' });
      return;
    }

    // Only admins can disable their own 2FA (mandatory for everyone else)
    if (user.role !== 'admin') {
      res.status(403).json({ error: 'Two-factor authentication is mandatory and cannot be disabled.' });
      return;
    }

    db.prepare('DELETE FROM user_totp_secrets WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_backup_codes WHERE user_id = ?').run(userId);
    db.prepare('UPDATE users SET totp_enabled = 0, totp_setup_required = 1, updated_at = ? WHERE id = ?')
      .run(localNow(), userId);

    createSecurityNotification(
      userId,
      '2fa_disabled',
      'Two-factor authentication disabled',
      'TOTP 2FA has been disabled on your account.',
      ip,
      parseDeviceName(userAgent)
    );

    res.json({ message: '2FA disabled. You will need to set it up again on next login.' });
  } catch (error: any) {
    console.error('2FA disable error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/login/verify-2fa ────────────────────
// Verify TOTP code during login (uses user_totp_secrets table)
router.post('/login/verify-2fa', authenticateTempToken, (req: Request, res: Response) => {
  try {
    const { code, trustDevice: shouldTrust, deviceFingerprint } = req.body;
    const ip = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const userId = req.user!.userId;

    if (!code) {
      res.status(400).json({ error: 'Verification code is required' });
      return;
    }

    const db = getDb();

    // Get the user's TOTP secret from separate table
    const totpRecord = db.prepare(`
      SELECT encrypted_secret, encryption_iv, encryption_tag
      FROM user_totp_secrets WHERE user_id = ? AND is_verified = 1
    `).get(userId) as any;

    if (!totpRecord) {
      res.status(400).json({ error: '2FA is not configured for this account' });
      return;
    }

    // Decrypt and verify
    const secretBase32 = decryptSecretV2(
      totpRecord.encrypted_secret,
      totpRecord.encryption_iv,
      totpRecord.encryption_tag
    );

    const isValid = verifyTotpToken(secretBase32, code);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid verification code' });
      return;
    }

    // Replay protection — reject if this TOTP code was already used
    if (isTotpCodeUsed(userId, code)) {
      res.status(401).json({ error: 'This code has already been used. Please wait for the next code.' });
      return;
    }
    markTotpCodeUsed(userId, code);

    // Success — log and issue tokens
    logLoginAttempt(req.user!.username, ip, true, undefined, userAgent, deviceFingerprint);

    // Trust this device if requested
    if (shouldTrust && deviceFingerprint) {
      trustDevice(userId, deviceFingerprint, ip, userAgent);
    }

    // Check for new device notification
    if (deviceFingerprint && isNewDevice(userId, deviceFingerprint)) {
      createSecurityNotification(
        userId,
        'new_device_login',
        'New device login detected',
        `Login from ${parseDeviceName(userAgent)} at IP ${ip}`,
        ip,
        parseDeviceName(userAgent)
      );
    }

    // Check if password change is still pending
    const user = db.prepare(`
      SELECT id, username, full_name, first_name, last_name, email, role, badge_number, phone, avatar_url,
             force_password_change, password_expires_at, password_changed_at, status, must_change_password
      FROM users WHERE id = ?
    `).get(userId) as any;

    if (!user || user.status !== 'active') {
      res.status(403).json({ error: 'Account is disabled or not found' });
      return;
    }

    const needsPasswordChange = user.force_password_change === 1 || isPasswordExpired(user?.password_changed_at);
    if (needsPasswordChange) {
      const tempToken = generateTempToken(
        { userId: user.id, username: user.username, role: user.role, fullName: user.full_name },
        ['password_change']
      );
      res.json({
        step: 'password_change',
        requiresPasswordChange: true,
        tempToken,
      });
      return;
    }

    const refreshToken = generateRefreshToken({ userId: user.id, username: user.username, role: user.role, fullName: user.full_name });
    const sessionId = createSession(user.id, refreshToken, ip, userAgent, deviceFingerprint);
    const accessToken = generateAccessToken({ userId: user.id, username: user.username, role: user.role, fullName: user.full_name, sessionId });

    db.prepare(`
      UPDATE users SET login_count = COALESCE(login_count, 0) + 1, last_login_at = ? WHERE id = ?
    `).run(localNow(), user.id);

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
        profile_image: user.profile_image || null,
        status: user.status,
        must_change_password: !!user.must_change_password,
        totp_enabled: true,
      },
    });
  } catch (error: any) {
    console.error('2FA verify error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/login/verify-backup-code ────────────
router.post('/login/verify-backup-code', authenticateTempToken, (req: Request, res: Response) => {
  try {
    const { code, deviceFingerprint } = req.body;
    const ip = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const userId = req.user!.userId;

    if (!code) {
      res.status(400).json({ error: 'Backup code is required' });
      return;
    }

    const db = getDb();

    // ── Try new system first (user_backup_codes table) ───
    const backupCodes = db.prepare(`
      SELECT id, code_hash FROM user_backup_codes
      WHERE user_id = ? AND is_used = 0
    `).all(userId) as { id: number; code_hash: string }[];

    let matchedCode: { id: number; code_hash: string } | null = null;
    let usedLegacy = false;

    if (backupCodes.length > 0) {
      for (const bc of backupCodes) {
        if (verifyBackupCodeHash(code, bc.code_hash)) {
          matchedCode = bc;
          break;
        }
      }
    }

    // ── Fallback to legacy system (users.totp_backup_codes JSON column) ──
    if (!matchedCode) {
      const legacyUser = db.prepare('SELECT totp_backup_codes FROM users WHERE id = ?')
        .get(userId) as { totp_backup_codes: string | null } | undefined;

      if (legacyUser?.totp_backup_codes) {
        try {
          const hashedCodes: string[] = JSON.parse(legacyUser.totp_backup_codes);
          if (Array.isArray(hashedCodes)) {
            const result = verifyBackupCode(code, hashedCodes);
            if (result.valid) {
              // Update the legacy backup codes — remove the used one
              db.prepare('UPDATE users SET totp_backup_codes = ? WHERE id = ?')
                .run(JSON.stringify(result.remainingCodes), userId);
              usedLegacy = true;
              matchedCode = { id: -1, code_hash: '' }; // sentinel to indicate match
            }
          }
        } catch { /* corrupted legacy backup codes — skip */ }
      }
    }

    if (!matchedCode) {
      // Neither new nor legacy system had a match
      if (backupCodes.length === 0) {
        const legacyUser = db.prepare('SELECT totp_backup_codes FROM users WHERE id = ?')
          .get(userId) as { totp_backup_codes: string | null } | undefined;
        let legacyCodes: string[] = [];
        try { legacyCodes = legacyUser?.totp_backup_codes ? JSON.parse(legacyUser.totp_backup_codes) as string[] : []; } catch { /* corrupted */ }
        if (legacyCodes.length === 0) {
          res.status(400).json({ error: 'No backup codes remaining. Contact an administrator.' });
          return;
        }
      }
      res.status(401).json({ error: 'Invalid backup code' });
      return;
    }

    // Mark code as used (new system only — legacy codes already updated during verification)
    if (!usedLegacy) {
      db.prepare('UPDATE user_backup_codes SET is_used = 1, used_at = ? WHERE id = ?')
        .run(localNow(), matchedCode.id);
    }

    // Log successful login
    logLoginAttempt(req.user!.username, ip, true, undefined, userAgent, deviceFingerprint);

    // Check remaining codes (combine new + legacy systems)
    let remaining: number;
    if (usedLegacy) {
      const legacyUser = db.prepare('SELECT totp_backup_codes FROM users WHERE id = ?')
        .get(userId) as { totp_backup_codes: string | null } | undefined;
      try { remaining = legacyUser?.totp_backup_codes ? (JSON.parse(legacyUser.totp_backup_codes) as string[]).length : 0; } catch { remaining = 0; }
    } else {
      remaining = backupCodes.length - 1;
    }

    // Check password change requirement
    const user = db.prepare(`
      SELECT id, username, full_name, first_name, last_name, email, role, badge_number, phone, avatar_url,
             force_password_change, password_expires_at, password_changed_at, status, must_change_password
      FROM users WHERE id = ?
    `).get(userId) as any;

    if (!user || user.status !== 'active') {
      res.status(403).json({ error: 'Account is disabled or not found' });
      return;
    }

    const needsPasswordChange = user.force_password_change === 1 || isPasswordExpired(user?.password_changed_at);
    if (needsPasswordChange) {
      const tempToken = generateTempToken(
        { userId: user.id, username: user.username, role: user.role, fullName: user.full_name },
        ['password_change']
      );
      res.json({
        step: 'password_change',
        requiresPasswordChange: true,
        tempToken,
        backupCodesRemaining: remaining,
        ...(remaining <= 2 && { warning: `Only ${remaining} backup code(s) remaining. Please regenerate.` }),
      });
      return;
    }

    const refreshToken = generateRefreshToken({ userId: user.id, username: user.username, role: user.role, fullName: user.full_name });
    const sessionId = createSession(user.id, refreshToken, ip, userAgent, deviceFingerprint);
    const accessToken = generateAccessToken({ userId: user.id, username: user.username, role: user.role, fullName: user.full_name, sessionId });

    db.prepare(`
      UPDATE users SET login_count = COALESCE(login_count, 0) + 1, last_login_at = ? WHERE id = ?
    `).run(localNow(), user.id);

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
        profile_image: user.profile_image || null,
        status: user.status,
        must_change_password: !!user.must_change_password,
        totp_enabled: true,
      },
      backupCodesRemaining: remaining,
      ...(remaining <= 2 && { warning: `Only ${remaining} backup code(s) remaining. Please regenerate.` }),
    });
  } catch (error: any) {
    console.error('Backup code verify error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/auth/login/change-password ───────────────
// During login flow — change password then issue final tokens
router.post('/login/change-password', authenticateTempToken, (req: Request, res: Response) => {
  try {
    const { newPassword, deviceFingerprint } = req.body;
    const userId = req.user!.userId;
    const ip = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    // Verify this temp token was actually issued for password_change
    if (!req.user!.pendingActions?.includes('password_change')) {
      res.status(403).json({ error: 'This token is not authorized for password change' });
      return;
    }

    if (!newPassword) {
      res.status(400).json({ error: 'New password is required' });
      return;
    }

    // Validate password policy
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
    const user = db.prepare('SELECT id, username, full_name, email, role, badge_number, phone, avatar_url, profile_image, password_hash, first_name, last_name, status, must_change_password FROM users WHERE id = ?')
      .get(userId) as any;

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (user.status !== 'active') {
      res.status(403).json({ error: 'Account is disabled or suspended' });
      return;
    }

    // Prevent reusing current password
    if (bcryptjs.compareSync(newPassword, user.password_hash)) {
      res.status(400).json({ error: 'New password must be different from current password' });
      return;
    }

    // Check password history
    try {
      if (isPasswordInHistory(userId, newPassword)) {
        res.status(400).json({ error: `Cannot reuse any of your last ${config.password.historyCount} passwords` });
        return;
      }
    } catch { /* ignore if table missing */ }

    // Save old password to history
    try { addToPasswordHistory(userId, user.password_hash); } catch { /* ignore */ }

    // Update password
    const newHash = bcryptjs.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, force_password_change = 0, password_changed_at = ?, updated_at = ? WHERE id = ?')
      .run(newHash, localNow(), localNow(), userId);

    // Set expiry
    try { setPasswordExpiry(userId); } catch { /* ignore */ }

    // Log password change
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'password_changed', 'user', ?, 'Password changed during login', ?)
    `).run(userId, userId, ip);

    createSecurityNotification(
      userId,
      'password_changed',
      'Password changed',
      'Your password was changed during the login process.',
      ip,
      parseDeviceName(userAgent)
    );

    // Issue final tokens
    const refreshToken = generateRefreshToken({ userId: user.id, username: user.username, role: user.role, fullName: user.full_name });
    const sessionId = createSession(user.id, refreshToken, ip, userAgent, deviceFingerprint);
    const accessToken = generateAccessToken({ userId: user.id, username: user.username, role: user.role, fullName: user.full_name, sessionId });

    db.prepare(`
      UPDATE users SET login_count = COALESCE(login_count, 0) + 1, last_login_at = ? WHERE id = ?
    `).run(localNow(), user.id);

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
        profile_image: user.profile_image || null,
        status: user.status,
        must_change_password: false,
        totp_enabled: true,
      },
    });
  } catch (error: any) {
    console.error('Login password change error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
