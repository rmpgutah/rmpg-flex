// ============================================================
// WebAuthn / Security Key Routes (YubiKey, Touch ID, Windows Hello)
// Provides registration + authentication of hardware security keys
// as an alternative 2FA method alongside TOTP.
// ============================================================

import { Router, Request, Response } from 'express';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { getDb } from '../models/database';
import { authenticateToken, generateAccessToken, generateRefreshToken, generateTempToken, JwtPayload } from '../middleware/auth';
import { createSecurityNotification, trustDevice, hashDeviceFingerprint, parseDeviceName } from '../utils/deviceFingerprint';
import { isPasswordExpired } from '../middleware/validatePassword';
import config from '../config';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { localNow } from '../utils/timeUtils';

const router = Router();

// In-memory challenge store (short-lived, keyed by random ID)
const challengeStore = new Map<string, { challenge: string; userId: number; expiresAt: number }>();
const MAX_CHALLENGES = 500; // Prevent unbounded memory growth from DoS

// Clean stale challenges every 5 minutes
// .unref() so this timer doesn't prevent graceful Node.js shutdown
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of challengeStore) {
    if (val.expiresAt < now) challengeStore.delete(key);
  }
}, 300_000).unref();

function storeChallengeWithCap(key: string, value: { challenge: string; userId: number; expiresAt: number }) {
  // Evict oldest entries if at capacity
  if (challengeStore.size >= MAX_CHALLENGES) {
    const now = Date.now();
    // First pass: remove expired
    for (const [k, v] of challengeStore) {
      if (v.expiresAt < now) challengeStore.delete(k);
    }
    // Second pass: if still over limit, remove oldest
    if (challengeStore.size >= MAX_CHALLENGES) {
      const firstKey = challengeStore.keys().next().value;
      if (firstKey) challengeStore.delete(firstKey);
    }
  }
  challengeStore.set(key, value);
}

function getCredentialsForUser(userId: number) {
  const db = getDb();
  return db.prepare(
    'SELECT id, credential_id, public_key, counter, transports, name, device_type, backed_up, created_at, last_used_at FROM webauthn_credentials WHERE user_id = ?'
  ).all(userId) as {
    id: number;
    credential_id: string;
    public_key: string;
    counter: number;
    transports: string | null;
    name: string;
    device_type: string;
    backed_up: number;
    created_at: string;
    last_used_at: string | null;
  }[];
}

/** Parse transports JSON — returns undefined (not []) when empty/null so
 *  browsers don't receive a misleading empty-array transport hint. */
function parseTransports(json: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!json) return undefined;
  try {
    const arr = JSON.parse(json) as AuthenticatorTransportFuture[];
    return arr.length > 0 ? arr : undefined;
  } catch {
    return undefined;
  }
}


// ─── GET /api/auth/webauthn/credentials ─────────────
// List registered security keys for the authenticated user
router.get('/credentials', authenticateToken, (req: Request, res: Response) => {
  try {
    const creds = getCredentialsForUser(req.user!.userId);
    res.json(creds.map(c => ({
      id: c.id,
      name: c.name,
      deviceType: c.device_type,
      backedUp: !!c.backed_up,
      transports: parseTransports(c.transports) || [],
      createdAt: c.created_at,
      lastUsedAt: c.last_used_at,
    })));
  } catch (error: any) {
    console.error('WebAuthn list credentials error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ─── POST /api/auth/webauthn/register-options ───────
// Generate registration options — user must be authenticated
router.post('/register-options', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const db = getDb();
    const user = db.prepare('SELECT id, username, full_name FROM users WHERE id = ?')
      .get(userId) as { id: number; username: string; full_name: string } | undefined;

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Existing credentials to exclude (prevents re-registering same key)
    const existingCreds = getCredentialsForUser(userId);
    const excludeCredentials = existingCreds.map(c => ({
      id: c.credential_id,
      transports: parseTransports(c.transports),
    }));

    const options = await generateRegistrationOptions({
      rpName: config.webauthn.rpName,
      rpID: config.webauthn.rpID,
      userName: user.username,
      userDisplayName: user.full_name || user.username,
      attestationType: 'none',
      excludeCredentials,
      authenticatorSelection: {
        // Allow both platform (Touch ID) and cross-platform (YubiKey)
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    // Store challenge
    const challengeId = crypto.randomBytes(16).toString('hex');
    storeChallengeWithCap(challengeId, {
      challenge: options.challenge,
      userId,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 min
    });

    res.json({ options, challengeId });
  } catch (error: any) {
    console.error('WebAuthn register-options error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ─── POST /api/auth/webauthn/register-verify ────────
// Verify registration response and store credential
router.post('/register-verify', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { challengeId, response: regResponse, name } = req.body as {
      challengeId: string;
      response: RegistrationResponseJSON;
      name?: string;
    };

    if (!challengeId || !regResponse) {
      res.status(400).json({ error: 'Missing challengeId or response' });
      return;
    }

    const stored = challengeStore.get(challengeId);
    if (!stored || stored.expiresAt < Date.now()) {
      challengeStore.delete(challengeId);
      res.status(400).json({ error: 'Challenge expired. Please try again.' });
      return;
    }

    if (stored.userId !== req.user!.userId) {
      res.status(403).json({ error: 'Challenge mismatch' });
      return;
    }

    const verification = await verifyRegistrationResponse({
      response: regResponse,
      expectedChallenge: stored.challenge,
      expectedOrigin: config.webauthn.origin,
      expectedRPID: config.webauthn.rpID,
      requireUserVerification: false, // UV is 'preferred', not required — some keys skip it
    });

    challengeStore.delete(challengeId);

    if (!verification.verified || !verification.registrationInfo) {
      res.status(400).json({ error: 'Verification failed. Please try again.' });
      return;
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    // Store credential
    const db = getDb();
    const credName = name || 'Security Key';
    const transportsJson = credential.transports && credential.transports.length > 0
      ? JSON.stringify(credential.transports)
      : null;

    db.prepare(`
      INSERT INTO webauthn_credentials
        (user_id, credential_id, public_key, counter, device_type, backed_up, transports, name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user!.userId,
      credential.id,  // Already Base64URLString
      isoBase64URL.fromBuffer(credential.publicKey),
      credential.counter,
      credentialDeviceType,
      credentialBackedUp ? 1 : 0,
      transportsJson,
      credName,
      localNow(),
    );

    // Also enable TOTP flag (security keys count as 2FA enabled)
    db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(req.user!.userId);

    createSecurityNotification(
      req.user!.userId,
      'webauthn_registered',
      'Security key registered',
      `Security key "${credName}" was registered for your account.`,
      req.ip || 'unknown',
    );

    const lastRow = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number } | undefined;
    res.json({
      success: true,
      credential: {
        id: lastRow?.id ?? 0,
        name: credName,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
      },
    });
  } catch (error: any) {
    console.error('WebAuthn register-verify error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ─── DELETE /api/auth/webauthn/credentials/:id ──────
// Remove a registered security key
router.delete('/credentials/:id', authenticateToken, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const credId = parseInt(req.params.id as string, 10);
    if (isNaN(credId)) { res.status(400).json({ error: 'Invalid credential ID' }); return; }
    const cred = db.prepare(
      'SELECT id, name FROM webauthn_credentials WHERE id = ? AND user_id = ?'
    ).get(credId, req.user!.userId) as { id: number; name: string } | undefined;

    if (!cred) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }

    db.prepare('DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?')
      .run(credId, req.user!.userId);

    // Check if user still has any 2FA methods
    const remaining = db.prepare(
      'SELECT COUNT(*) as count FROM webauthn_credentials WHERE user_id = ?'
    ).get(req.user!.userId) as { count: number } | undefined;

    // Check new user_totp_secrets table for active TOTP, falling back to legacy column
    const hasNewTotp = db.prepare(
      'SELECT COUNT(*) as count FROM user_totp_secrets WHERE user_id = ?'
    ).get(req.user!.userId) as { count: number } | undefined;
    const hasLegacyTotp = db.prepare(
      'SELECT totp_secret_enc FROM users WHERE id = ?'
    ).get(req.user!.userId) as { totp_secret_enc: string | null } | undefined;
    const hasAnyTotp = (hasNewTotp?.count ?? 0) > 0 || !!hasLegacyTotp?.totp_secret_enc;

    // If no security keys AND no TOTP secret, disable 2FA
    if ((remaining?.count ?? 0) === 0 && !hasAnyTotp) {
      db.prepare('UPDATE users SET totp_enabled = 0 WHERE id = ?').run(req.user!.userId);
    }

    createSecurityNotification(
      req.user!.userId,
      'webauthn_removed',
      'Security key removed',
      `Security key "${cred.name}" was removed from your account.`,
      req.ip || 'unknown',
    );

    res.json({ message: 'Security key removed' });
  } catch (error: any) {
    console.error('WebAuthn delete credential error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ─── POST /api/auth/webauthn/authenticate-options ───
// Generate authentication options — called during 2FA step
// Accepts a tempToken (2FA-pending JWT) OR requires authenticated session
router.post('/authenticate-options', async (req: Request, res: Response) => {
  try {
    const { tempToken } = req.body;

    let userId: number;

    if (tempToken) {
      // Verify the temp token from login flow
      let decoded: JwtPayload;
      try {
        decoded = jwt.verify(tempToken, config.jwt.secret) as JwtPayload;
      } catch {
        res.status(401).json({ error: 'Session expired. Please log in again.' });
        return;
      }
      if (decoded.type !== 'mfa_pending') {
        res.status(403).json({ error: 'Invalid token type' });
        return;
      }
      userId = decoded.userId;
    } else if (req.user?.userId) {
      userId = req.user.userId;
    } else {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const existingCreds = getCredentialsForUser(userId);
    if (existingCreds.length === 0) {
      res.status(400).json({ error: 'No security keys registered', hasSecurityKeys: false });
      return;
    }

    const allowCredentials = existingCreds.map(c => ({
      id: c.credential_id,
      transports: parseTransports(c.transports),
    }));

    const options = await generateAuthenticationOptions({
      rpID: config.webauthn.rpID,
      allowCredentials,
      userVerification: 'preferred',
    });

    // Store challenge
    const challengeId = crypto.randomBytes(16).toString('hex');
    storeChallengeWithCap(challengeId, {
      challenge: options.challenge,
      userId,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    res.json({ options, challengeId, hasSecurityKeys: true });
  } catch (error: any) {
    console.error('WebAuthn authenticate-options error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ─── POST /api/auth/webauthn/authenticate-verify ────
// Verify authentication response — completes 2FA via security key
router.post('/authenticate-verify', async (req: Request, res: Response) => {
  try {
    const { challengeId, tempToken, response: authResponse, trustDevice: shouldTrust, deviceFingerprint } = req.body as {
      challengeId: string;
      tempToken: string;
      response: AuthenticationResponseJSON;
      trustDevice?: boolean;
      deviceFingerprint?: string;
    };

    if (!challengeId || !tempToken || !authResponse) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Verify temp token
    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(tempToken, config.jwt.secret) as JwtPayload;
    } catch {
      res.status(401).json({ error: 'Session expired. Please log in again.' });
      return;
    }

    if (decoded.type !== 'mfa_pending') {
      res.status(403).json({ error: 'Invalid token type' });
      return;
    }

    // Verify challenge
    const stored = challengeStore.get(challengeId);
    if (!stored || stored.expiresAt < Date.now()) {
      challengeStore.delete(challengeId);
      res.status(400).json({ error: 'Challenge expired. Please try again.' });
      return;
    }

    if (stored.userId !== decoded.userId) {
      res.status(403).json({ error: 'Challenge mismatch' });
      return;
    }

    // Find the credential
    const db = getDb();
    const credentialIdBase64 = authResponse.id;
    const cred = db.prepare(
      'SELECT id, credential_id, public_key, counter, transports FROM webauthn_credentials WHERE credential_id = ? AND user_id = ?'
    ).get(credentialIdBase64, decoded.userId) as {
      id: number;
      credential_id: string;
      public_key: string;
      counter: number;
      transports: string | null;
    } | undefined;

    if (!cred) {
      res.status(400).json({ error: 'Security key not recognized' });
      return;
    }

    const verification = await verifyAuthenticationResponse({
      response: authResponse,
      expectedChallenge: stored.challenge,
      expectedOrigin: config.webauthn.origin,
      expectedRPID: config.webauthn.rpID,
      requireUserVerification: false, // UV is 'preferred', not required
      credential: {
        id: cred.credential_id,
        publicKey: isoBase64URL.toBuffer(cred.public_key),
        counter: cred.counter,
        transports: parseTransports(cred.transports),
      },
    });

    challengeStore.delete(challengeId);

    if (!verification.verified) {
      res.status(401).json({ error: 'Security key verification failed' });
      return;
    }

    // Update counter
    db.prepare('UPDATE webauthn_credentials SET counter = ?, last_used_at = ? WHERE id = ?')
      .run(verification.authenticationInfo.newCounter, localNow(), cred.id);

    // 2FA verified — issue full tokens (same as TOTP verify flow)
    const user = db.prepare(
      'SELECT id, username, full_name, first_name, last_name, email, role, badge_number, phone, avatar_url, status, must_change_password, password_changed_at, force_password_change FROM users WHERE id = ?'
    ).get(decoded.userId) as any;

    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    if (user.status !== 'active') {
      res.status(403).json({ error: 'Account is disabled or suspended' });
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

    // ── Check if password change is required before issuing final tokens ──
    const needsPasswordChange = user.must_change_password === 1
      || user.force_password_change === 1
      || isPasswordExpired(user.password_changed_at);

    if (needsPasswordChange) {
      const pwTempToken = generateTempToken(payload, ['password_change']);
      res.json({
        step: 'password_change',
        requiresPasswordChange: true,
        tempToken: pwTempToken,
      });
      return;
    }

    // Trust this device if requested
    if (shouldTrust && deviceFingerprint) {
      const ip = req.ip || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';
      trustDevice(user.id, deviceFingerprint, ip, userAgent);
    }

    const refreshToken = generateRefreshToken(payload);

    // Create session — hash the refresh token and use correct column names
    const sessionId = crypto.randomUUID();
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO sessions (session_id, user_id, refresh_token_hash, ip_address, user_agent, is_active, created_at, last_used_at, expires_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(sessionId, user.id, tokenHash, ip, userAgent, localNow(), localNow(), expiresAt);

    const accessToken = generateAccessToken({ ...payload, sessionId });

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'user_login_webauthn', 'user', ?, 'Security key 2FA login completed', ?)
    `).run(user.id, user.id, ip);

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
        status: user.status,
        must_change_password: false,
        totp_enabled: true,
      },
    });
  } catch (error: any) {
    console.error('WebAuthn authenticate-verify error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
