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
  generateAccessToken,
  generateRefreshToken,
  generate2faPendingToken,
  generateTempToken,
  verifyRefreshToken,
  JwtPayload,
} from '../middleware/auth';
import { authRateLimit } from '../middleware/rateLimiter';
import { validatePassword, getPasswordPolicyDescription, checkPasswordHistory } from '../middleware/validatePassword';
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
import {
  beginRegistration,
  completeRegistration,
  beginAuthentication,
  verifyAuthentication,
  removeCredential,
  getUserWebAuthnStatus,
  hasWebAuthnCredentials,
} from '../utils/webauthn';
import {
  generateTotpSecret,
  generateQRCodeDataUri,
  verifyTotpToken,
  encryptSecret,
  decryptSecret,
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode as verifyBackupCodeHash,
} from '../utils/totpService';
import {
  isDeviceTrusted,
  trustDevice,
  isNewDevice,
  parseDeviceName,
  hashDeviceFingerprint,
  createSecurityNotification,
} from '../utils/deviceFingerprint';
import {
  isPasswordExpired,
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
             badge_number, phone, status, avatar_url, must_change_password,
             totp_enabled, totp_setup_required, password_expires_at, force_password_change
      FROM users WHERE username = ?
    `).get(username) as any;

    if (!user) {
      logLoginAttempt(username, ip, false, 'user_not_found', userAgent, deviceFingerprint);
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    if (user.status !== 'active') {
      logLoginAttempt(username, ip, false, 'account_inactive', userAgent, deviceFingerprint);
      res.status(403).json({ error: 'Account is not active' });
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

    // 2FA is enabled — require verification
    if (has2FA || hasWebAuthn) {
      const tempToken = generateTempToken(
        { userId: user.id, username: user.username, role: user.role, fullName: user.full_name },
        pendingActions
      );
      res.json({
        step: 'verify_2fa',
        requires2FA: true,
        requiresPasswordChange: needsPasswordChange,
        tempToken,
        methods: {
          totp: has2FA,
          webauthn: hasWebAuthn,
        },
      });
      return;
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

    // No 2FA at all (should not happen with mandatory 2FA, but fallback)
    logLoginAttempt(username, ip, true, undefined, userAgent, deviceFingerprint);
    const tokens = issueTokens(user, ip, userAgent, deviceFingerprint);
    res.json(tokens);
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ═══════════════════════════════════════════════════════
// POST /api/auth/login/verify-2fa — Verify TOTP code
// ═══════════════════════════════════════════════════════
router.post('/login/verify-2fa', authRateLimit, authenticateTempToken, (req: Request, res: Response) => {
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

    // Get the user's TOTP secret
    const totpRecord = db.prepare(`
      SELECT encrypted_secret, encryption_iv, encryption_tag
      FROM user_totp_secrets WHERE user_id = ? AND is_verified = 1
    `).get(userId) as any;

    if (!totpRecord) {
      res.status(400).json({ error: '2FA is not configured for this account' });
      return;
    }

    // Decrypt and verify
    const secretBase32 = decryptSecret(
      totpRecord.encrypted_secret,
      totpRecord.encryption_iv,
      totpRecord.encryption_tag
    );

    const isValid = verifyTotpToken(secretBase32, code);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid verification code' });
      return;
    }

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
      SELECT id, username, full_name, email, role, badge_number, phone, avatar_url,
             force_password_change, password_expires_at
      FROM users WHERE id = ?
    `).get(userId) as any;

    const needsPasswordChange = user.force_password_change === 1 || isPasswordExpired(user);
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
  } catch (error: any) {
    console.error('2FA verify error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ═══════════════════════════════════════════════════════
// POST /api/auth/login/verify-backup-code
// ═══════════════════════════════════════════════════════
router.post('/login/verify-backup-code', authRateLimit, authenticateTempToken, (req: Request, res: Response) => {
  try {
    const { code, deviceFingerprint, trustDevice: shouldTrust } = req.body;
    const ip = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const userId = req.user!.userId;

    if (!code) {
      res.status(400).json({ error: 'Backup code is required' });
      return;
    }

    const db = getDb();

    // Get unused backup codes
    const backupCodes = db.prepare(`
      SELECT id, code_hash FROM user_backup_codes
      WHERE user_id = ? AND is_used = 0
    `).all(userId) as { id: number; code_hash: string }[];

    if (backupCodes.length === 0) {
      res.status(400).json({ error: 'No backup codes remaining. Contact an administrator.' });
      return;
    }

    // Try to verify against each unused code
    let matchedCode: { id: number; code_hash: string } | null = null;
    for (const bc of backupCodes) {
      if (verifyBackupCodeHash(code, bc.code_hash)) {
        matchedCode = bc;
        break;
      }
    }

    if (!matchedCode) {
      res.status(401).json({ error: 'Invalid backup code' });
      return;
    }

    // Mark code as used
    db.prepare('UPDATE user_backup_codes SET is_used = 1, used_at = ? WHERE id = ?')
      .run(localNow(), matchedCode.id);

    // Log successful login
    logLoginAttempt(req.user!.username, ip, true, undefined, userAgent, deviceFingerprint);

    // Trust this device if requested
    if (shouldTrust && deviceFingerprint) {
      trustDevice(userId, deviceFingerprint, ip, userAgent);
    }

    // Check remaining codes
    const remaining = backupCodes.length - 1;

    // Check password change requirement
    const user = db.prepare(`
      SELECT id, username, full_name, email, role, badge_number, phone, avatar_url,
             force_password_change, password_expires_at
      FROM users WHERE id = ?
    `).get(userId) as any;

    const needsPasswordChange = user.force_password_change === 1 || isPasswordExpired(user);
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

    const tokens = issueTokens(user, ip, userAgent, deviceFingerprint);
    res.json({
      ...tokens,
      backupCodesRemaining: remaining,
      ...(remaining <= 2 && { warning: `Only ${remaining} backup code(s) remaining. Please regenerate.` }),
    });
  } catch (error: any) {
    console.error('Backup code verify error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ═══════════════════════════════════════════════════════
// POST /api/auth/2fa/setup — Generate TOTP secret + QR
// ═══════════════════════════════════════════════════════
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
    const { secret, uri } = generateTotpSecret(username);
    const secretBase32 = secret.base32;

    // Encrypt and store
    const { encrypted, iv, tag } = encryptSecret(secretBase32);
    db.prepare(`
      INSERT INTO user_totp_secrets (user_id, encrypted_secret, encryption_iv, encryption_tag, is_verified)
      VALUES (?, ?, ?, ?, 0)
    `).run(userId, encrypted, iv, tag);

    // Generate QR code
    const qrCodeDataUri = await generateQRCodeDataUri(uri);

    res.json({
      qrCodeDataUri,
      manualKey: secretBase32,
      issuer: config.totp.issuer,
    });
  } catch (error: any) {
    console.error('2FA setup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ═══════════════════════════════════════════════════════
// POST /api/auth/2fa/setup/verify — Confirm first TOTP code
// ═══════════════════════════════════════════════════════
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
    const secretBase32 = decryptSecret(
      totpRecord.encrypted_secret,
      totpRecord.encryption_iv,
      totpRecord.encryption_tag
    );

    const isValid = verifyTotpToken(secretBase32, code);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid code. Please try again with the current code from your authenticator app.' });
      return;
    }

    // Mark as verified
    db.prepare('UPDATE user_totp_secrets SET is_verified = 1, updated_at = ? WHERE id = ?')
      .run(localNow(), totpRecord.id);

    // Enable 2FA on user
    db.prepare('UPDATE users SET totp_enabled = 1, totp_setup_required = 0, updated_at = ? WHERE id = ?')
      .run(localNow(), userId);

    // Generate backup codes
    const { plain: codes, hashed: hashedCodes } = legacyGenerateBackupCodes();
    const insertStmt = db.prepare(
      'INSERT INTO user_backup_codes (user_id, code_hash) VALUES (?, ?)'
    );
    const insertTx = db.transaction(() => {
      // Remove any old backup codes
      db.prepare('DELETE FROM user_backup_codes WHERE user_id = ?').run(userId);
      for (const hash of hashedCodes) {
        insertStmt.run(userId, hash);
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

    // Log successful login
    logLoginAttempt(req.user!.username, ip, true, undefined, userAgent);

    // Check if this is during login (mfa_pending token) — need to check password change and issue tokens
    if (req.user!.type === 'mfa_pending') {
      const user = db.prepare(`
        SELECT id, username, full_name, email, role, badge_number, phone, avatar_url,
               force_password_change, password_expires_at
        FROM users WHERE id = ?
      `).get(userId) as any;

      const needsPasswordChange = user.force_password_change === 1 || isPasswordExpired(user);
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
      const tokens = issueTokens(user, ip, userAgent, deviceFingerprint);
      res.json({
        ...tokens,
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


// ═══════════════════════════════════════════════════════
// GET /api/auth/2fa/status — Current 2FA status
// ═══════════════════════════════════════════════════════
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


// ═══════════════════════════════════════════════════════
// POST /api/auth/2fa/backup-codes/regenerate
// ═══════════════════════════════════════════════════════
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
    const { plain: codes, hashed: hashedCodes } = legacyGenerateBackupCodes();
    const insertStmt = db.prepare(
      'INSERT INTO user_backup_codes (user_id, code_hash) VALUES (?, ?)'
    );
    const insertTx = db.transaction(() => {
      db.prepare('DELETE FROM user_backup_codes WHERE user_id = ?').run(userId);
      for (const hash of hashedCodes) {
        insertStmt.run(userId, hash);
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


// ═══════════════════════════════════════════════════════
// POST /api/auth/2fa/disable — Disable 2FA (requires password)
// ═══════════════════════════════════════════════════════
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

    const disable2fa = db.transaction(() => {
      db.prepare('DELETE FROM user_totp_secrets WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM user_backup_codes WHERE user_id = ?').run(userId);
      db.prepare('UPDATE users SET totp_enabled = 0, totp_setup_required = 1, updated_at = ? WHERE id = ?')
        .run(localNow(), userId);
    });
    disable2fa();

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


// ═══════════════════════════════════════════════════════
// POST /api/auth/login/change-password — During login flow
// ═══════════════════════════════════════════════════════
router.post('/login/change-password', authenticateTempToken, (req: Request, res: Response) => {
  try {
    const { newPassword, deviceFingerprint } = req.body;
    const userId = req.user!.userId;
    const ip = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

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
    const user = db.prepare('SELECT id, username, full_name, email, role, badge_number, phone, avatar_url, password_hash FROM users WHERE id = ?')
      .get(userId) as any;

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Prevent reusing current password
    if (bcryptjs.compareSync(newPassword, user.password_hash)) {
      res.status(400).json({ error: 'New password must be different from current password' });
      return;
    }

    // Check password history
    if (isPasswordInHistory(userId, newPassword)) {
      res.status(400).json({ error: `Cannot reuse any of your last ${config.password.historyCount} passwords` });
      return;
    }

    // Save old password to history
    addToPasswordHistory(userId, user.password_hash);

    // Update password
    const newHash = bcryptjs.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(newHash, localNow(), userId);

    // Set expiry and clear force flag
    setPasswordExpiry(userId);

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
    const tokens = issueTokens(user, ip, userAgent, deviceFingerprint);
    res.json(tokens);
  } catch (error: any) {
    console.error('Login password change error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ═══════════════════════════════════════════════════════
// POST /api/auth/refresh
// ═══════════════════════════════════════════════════════
router.post('/refresh', (req: Request, res: Response) => {
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
             badge_number, phone, status, avatar_url, created_at, must_change_password,
             totp_enabled, password_expires_at
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
      avatarUrl: user.avatar_url,
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


// ═══════════════════════════════════════════════════════
// POST /api/auth/change-password — Authenticated users
// ═══════════════════════════════════════════════════════
router.post('/change-password', authenticateToken, (req: Request, res: Response) => {
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
    if (isPasswordInHistory(user.id, newPassword)) {
      res.status(400).json({ error: `Cannot reuse any of your last ${config.password.historyCount} passwords` });
      return;
    }

    // Save to history
    addToPasswordHistory(user.id, user.password_hash);

    const newHash = bcryptjs.hashSync(newPassword, 10);
    const now = localNow();

    db.prepare(`
      UPDATE users SET password_hash = ?, must_change_password = 0, force_password_change = 0,
        password_changed_at = ?, updated_at = ? WHERE id = ?
    `).run(newHash, now, now, user.id);

    // Set new expiry
    setPasswordExpiry(user.id);

    // Log
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
      SELECT id, username, full_name, first_name, last_name, email, role, badge_number, phone, status, avatar_url, created_at
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

// ═══════════════════════════════════════════════════════
// GET /api/auth/password-policy
// ═══════════════════════════════════════════════════════
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

// ─── POST /api/auth/verify-2fa ───────────────────────
// Second step of login — verify TOTP code after password accepted
router.post('/verify-2fa', authRateLimit, (req: Request, res: Response) => {
  try {
    const { tempToken, code } = req.body;

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

    if (decoded.type !== '2fa_pending') {
      res.status(403).json({ error: 'Invalid token type' });
      return;
    }

    const db = getDb();
    const user = db.prepare(
      'SELECT id, username, full_name, first_name, last_name, email, role, badge_number, phone, avatar_url, status, must_change_password, totp_secret_enc, totp_backup_codes FROM users WHERE id = ?'
    ).get(decoded.userId) as any;

    if (!user || !user.totp_secret_enc) {
      res.status(401).json({ error: 'Invalid verification session' });
      return;
    }

    const ip = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    // Try TOTP code first (legacy — combined iv:tag:ciphertext format)
    const secret = legacyDecryptSecret(user.totp_secret_enc);
    let codeValid = verifyTotpCode(secret, code);

    // If TOTP fails, try backup code
    if (!codeValid && user.totp_backup_codes) {
      let hashedCodes: string[] = [];
      try { hashedCodes = JSON.parse(user.totp_backup_codes); } catch { /* corrupted backup codes */ }
      const result = verifyBackupCode(code, hashedCodes);
      if (result.valid) {
        codeValid = true;
        // Consume the backup code
        db.prepare('UPDATE users SET totp_backup_codes = ? WHERE id = ?')
          .run(JSON.stringify(result.remainingCodes), user.id);
      }
    }

    if (!codeValid) {
      res.status(401).json({ error: 'Invalid verification code' });
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
    res.status(500).json({ error: 'Internal server error' });
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

// ─── WebAuthn / YubiKey Registration ──────────────────
// GET /api/auth/webauthn/status — check WebAuthn status for current user
router.get('/webauthn/status', authenticateToken, (req: Request, res: Response) => {
  try {
    const status = getUserWebAuthnStatus(req.user!.userId);
    res.json(status);
  } catch (error: any) {
    console.error('WebAuthn status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/webauthn/register/begin — start key registration
router.post('/webauthn/register/begin', authenticateToken, async (req: Request, res: Response) => {
  try {
    const options = await beginRegistration(req.user!.userId, req.user!.username);
    res.json(options);
  } catch (error: any) {
    console.error('WebAuthn register begin error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/webauthn/register/complete — verify and store key
router.post('/webauthn/register/complete', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { response: webauthnResponse, challenge, deviceName } = req.body;

    if (!webauthnResponse || !challenge) {
      res.status(400).json({ error: 'Response and challenge are required' });
      return;
    }

    const result = await completeRegistration(
      req.user!.userId,
      webauthnResponse,
      challenge,
      deviceName || 'Security Key',
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    const db = getDb();
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'webauthn_key_registered', 'user', ?, ?, ?)
    `).run(req.user!.userId, req.user!.userId, `Registered security key: ${deviceName || 'Security Key'}`, req.ip || 'unknown');

    const status = getUserWebAuthnStatus(req.user!.userId);
    res.json({ success: true, ...status });
  } catch (error: any) {
    console.error('WebAuthn register complete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/auth/webauthn/credentials/:id — remove a registered key
router.delete('/webauthn/credentials/:id', authenticateToken, (req: Request, res: Response) => {
  try {
    const credId = parseInt(req.params.id as string, 10);
    if (isNaN(credId)) {
      res.status(400).json({ error: 'Invalid credential ID' });
      return;
    }

    const removed = removeCredential(req.user!.userId, credId);
    if (!removed) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }

    const db = getDb();
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'webauthn_key_removed', 'user', ?, 'Removed security key', ?)
    `).run(req.user!.userId, req.user!.userId, req.ip || 'unknown');

    const status = getUserWebAuthnStatus(req.user!.userId);
    res.json({ success: true, ...status });
  } catch (error: any) {
    console.error('WebAuthn remove credential error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── WebAuthn Authentication (2FA verification) ──────
// POST /api/auth/webauthn/authenticate/begin — start assertion for login
router.post('/webauthn/authenticate/begin', authRateLimit, (req: Request, res: Response) => {
  (async () => {
    try {
      const { tempToken } = req.body;

      if (!tempToken) {
        res.status(400).json({ error: 'Temp token is required' });
        return;
      }

      let decoded: JwtPayload;
      try {
        decoded = jwt.verify(tempToken, config.jwt.secret) as JwtPayload;
      } catch {
        res.status(401).json({ error: 'Session expired. Please log in again.' });
        return;
      }

      if (decoded.type !== '2fa_pending') {
        res.status(403).json({ error: 'Invalid token type' });
        return;
      }

      if (!hasWebAuthnCredentials(decoded.userId)) {
        res.status(400).json({ error: 'No security keys registered' });
        return;
      }

      const options = await beginAuthentication(decoded.userId);
      res.json(options);
    } catch (error: any) {
      console.error('WebAuthn authenticate begin error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  })();
});

// POST /api/auth/webauthn/authenticate/verify — verify assertion for login
router.post('/webauthn/authenticate/verify', authRateLimit, (req: Request, res: Response) => {
  (async () => {
    try {
      const { tempToken, response: webauthnResponse, challenge, trustDevice: shouldTrust, deviceFingerprint } = req.body;

      if (!tempToken || !webauthnResponse || !challenge) {
        res.status(400).json({ error: 'Token, response, and challenge are required' });
        return;
      }

      let decoded: JwtPayload;
      try {
        decoded = jwt.verify(tempToken, config.jwt.secret) as JwtPayload;
      } catch {
        res.status(401).json({ error: 'Session expired. Please log in again.' });
        return;
      }

      if (decoded.type !== '2fa_pending') {
        res.status(403).json({ error: 'Invalid token type' });
        return;
      }

      const result = await verifyAuthentication(decoded.userId, webauthnResponse, challenge);

      if (!result.success) {
        res.status(401).json({ error: result.error || 'Security key verification failed' });
        return;
      }

      // WebAuthn verified — issue full tokens (same as TOTP verify-2fa)
      const db = getDb();
      const user = db.prepare(
        'SELECT id, username, full_name, first_name, last_name, email, role, badge_number, phone, avatar_url, status, must_change_password FROM users WHERE id = ?'
      ).get(decoded.userId) as any;

      if (!user) {
        res.status(401).json({ error: 'User not found' });
        return;
      }

      const ip = req.ip || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';

      const payload: Omit<JwtPayload, 'type'> = {
        userId: user.id,
        username: user.username,
        role: user.role,
        fullName: user.full_name,
      };

      const refreshToken = generateRefreshToken(payload);
      const sessionId = createSession(user.id, refreshToken, ip, userAgent);
      const accessToken = generateAccessToken({ ...payload, sessionId });

      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'user_login_webauthn', 'user', ?, 'WebAuthn/YubiKey login completed', ?)
      `).run(user.id, user.id, ip);

      db.prepare(`
        UPDATE users SET login_count = COALESCE(login_count, 0) + 1, last_login_at = ? WHERE id = ?
      `).run(localNow(), user.id);

      // Trust this device if requested
      if (shouldTrust && deviceFingerprint) {
        trustDevice(decoded.userId, deviceFingerprint, ip, userAgent);
      }

      res.json({
        token: accessToken,
        refreshToken,
        sessionId,
        expiresIn: config.jwt.accessExpiry,
        user: {
          id: user.id,
          username: user.username,
          full_name: user.full_name,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          role: user.role,
          badge_number: user.badge_number,
          phone: user.phone,
          avatar_url: user.avatar_url,
          must_change_password: !!user.must_change_password,
          totp_enabled: true,
          requires_2fa_setup: false,
        },
      });
    } catch (error: any) {
      console.error('WebAuthn authenticate verify error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  })();
});

export default router;
