// ============================================================
// WebAuthn / Security Key Routes (Workers / Hono)
// Ported from server/src/routes/webauthn.ts for Cloudflare Workers.
// ============================================================

import { Hono } from 'hono';
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
import { SignJWT, jwtVerify } from 'jose';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum, localNow } from '../worker-middleware/d1Helpers';
import { auditLog } from '../worker-middleware/auditLogger';

// ── Challenge Store (in-memory, capped) ──────────────────────
interface ChallengeEntry {
  challenge: string;
  userId: number;
  expiresAt: number;
}

const challengeStore = new Map<string, ChallengeEntry>();
const MAX_CHALLENGES = 500;

function cleanStaleChallenges() {
  const now = Date.now();
  for (const [key, val] of challengeStore) {
    if (val.expiresAt < now) challengeStore.delete(key);
  }
}

function storeChallengeWithCap(key: string, value: ChallengeEntry) {
  if (challengeStore.size >= MAX_CHALLENGES) {
    const now = Date.now();
    for (const [k, v] of challengeStore) {
      if (v.expiresAt < now) challengeStore.delete(k);
    }
    if (challengeStore.size >= MAX_CHALLENGES) {
      const firstKey = challengeStore.keys().next().value;
      if (firstKey) challengeStore.delete(firstKey);
    }
  }
  challengeStore.set(key, value);
}

// ── Crypto Helpers (Web Crypto API) ──────────────────────────
function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

// ── JWT Helpers ──────────────────────────────────────────────
async function generateAccessToken(user: any, secret: string, sessionId?: string): Promise<string> {
  const payload: any = {
    userId: user.id,
    username: user.username,
    role: user.role,
    fullName: user.full_name || '',
    type: 'access',
  };
  if (sessionId) payload.sessionId = sessionId;
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(new TextEncoder().encode(secret));
}

async function generateRefreshToken(user: any, secret: string): Promise<string> {
  return await new SignJWT({
    userId: user.id,
    username: user.username,
    role: user.role,
    type: 'refresh',
  } as any)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(secret));
}

async function generateTempToken(user: any, secret: string): Promise<string> {
  return await new SignJWT({
    userId: user.id,
    username: user.username,
    role: user.role,
    fullName: user.full_name || '',
    type: '2fa_pending',
  } as any)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
}

// ── Password Expiry Check (inline) ───────────────────────────
function isPasswordExpired(passwordChangedAt: string | null): boolean {
  if (!passwordChangedAt) return false;
  const changed = new Date(passwordChangedAt).getTime();
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;
  return Date.now() - changed > ninetyDays;
}

// ── Transports Parser ────────────────────────────────────────
function parseTransports(json: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!json) return undefined;
  try {
    const arr = JSON.parse(json) as AuthenticatorTransportFuture[];
    return arr.length > 0 ? arr : undefined;
  } catch {
    return undefined;
  }
}

// ── Credential Fetcher ───────────────────────────────────────
async function getCredentialsForUser(db: D1Db, userId: number) {
  return await db.prepare(
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

// ── Origin Helper ────────────────────────────────────────────
function getOrigin(c: any): string {
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`;
}

export function mountWebAuthnRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();

  // ─── GET /api/auth/webauthn/status ─────────────────
  api.get('/status', authenticateToken, async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    try {
      const creds = await getCredentialsForUser(db, user.userId);
      return c.json({
        enabled: creds.length > 0,
        credentialCount: creds.length,
      });
    } catch (error: any) {
      return c.json({ error: 'Failed to webauthn status', code: 'WEBAUTHN_STATUS_ERROR' }, 500);
    }
  });

  // ─── GET /api/auth/webauthn/credentials ─────────────
  api.get('/credentials', authenticateToken, async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    try {
      const creds = await getCredentialsForUser(db, user.userId);
      return c.json(creds.map(cr => ({
        id: cr.id,
        name: cr.name,
        deviceType: cr.device_type,
        backedUp: !!cr.backed_up,
        transports: parseTransports(cr.transports) || [],
        createdAt: cr.created_at,
        lastUsedAt: cr.last_used_at,
      })));
    } catch (error: any) {
      return c.json({ error: 'Failed to webauthn list credentials', code: 'WEBAUTHN_LIST_CREDENTIALS_ERROR' }, 500);
    }
  });

  // ─── POST /api/auth/webauthn/register-options ───────
  api.post('/register-options', authenticateToken, async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    try {
      const dbUser = await db.prepare('SELECT id, username, full_name FROM users WHERE id = ?')
        .get(user.userId) as { id: number; username: string; full_name: string } | undefined;

      if (!dbUser) {
        return c.json({ error: 'User not found', code: 'USER_NOT_FOUND' }, 404);
      }

      const existingCreds = await getCredentialsForUser(db, user.userId);
      const excludeCredentials = existingCreds.map(cr => ({
        id: cr.credential_id,
        transports: parseTransports(cr.transports),
      }));

      const options = await generateRegistrationOptions({
        rpName: c.env.WEBAUTHN_RP_NAME || 'RMPG Flex',
        rpID: c.env.WEBAUTHN_RP_ID || 'rmpgutah.us',
        userName: dbUser.username,
        userDisplayName: dbUser.full_name || dbUser.username,
        attestationType: 'none',
        excludeCredentials,
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'preferred',
        },
      });

      const challengeId = randomHex(16);
      storeChallengeWithCap(challengeId, {
        challenge: options.challenge,
        userId: user.userId,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });

      return c.json({ options, challengeId });
    } catch (error: any) {
      return c.json({ error: 'Failed to webauthn register-options', code: 'WEBAUTHN_REGISTEROPTIONS_ERROR' }, 500);
    }
  });

  // ─── POST /api/auth/webauthn/register-verify ────────
  api.post('/register-verify', authenticateToken, async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    try {
      const body = await c.req.json() as {
        challengeId: string;
        response: RegistrationResponseJSON;
        name?: string;
      };
      const { challengeId, response: regResponse, name } = body;

      if (!challengeId || !regResponse) {
        return c.json({ error: 'Missing challengeId or response', code: 'MISSING_CHALLENGEID_OR_RESPONSE' }, 400);
      }
      if (typeof challengeId !== 'string' || challengeId.length > 64 || !/^[a-f0-9]+$/.test(challengeId)) {
        return c.json({ error: 'Invalid challengeId format', code: 'INVALID_CHALLENGEID_FORMAT' }, 400);
      }
      if (name !== undefined && name !== null && (typeof name !== 'string' || name.length > 100)) {
        return c.json({ error: 'Security key name must be 100 characters or less', code: 'SECURITY_KEY_NAME_MUST' }, 400);
      }

      const stored = challengeStore.get(challengeId);
      if (!stored || stored.expiresAt < Date.now()) {
        challengeStore.delete(challengeId);
        return c.json({ error: 'Challenge expired. Please try again.', code: 'CHALLENGE_EXPIRED_PLEASE_TRY' }, 400);
      }
      if (stored.userId !== user.userId) {
        return c.json({ error: 'Challenge mismatch', code: 'CHALLENGE_MISMATCH' }, 403);
      }

      const verification = await verifyRegistrationResponse({
        response: regResponse,
        expectedChallenge: stored.challenge,
        expectedOrigin: getOrigin(c),
        expectedRPID: c.env.WEBAUTHN_RP_ID || 'rmpgutah.us',
        requireUserVerification: false,
      });

      challengeStore.delete(challengeId);

      if (!verification.verified || !verification.registrationInfo) {
        return c.json({ error: 'Verification failed. Please try again.', code: 'VERIFICATION_FAILED_PLEASE_TRY' }, 400);
      }

      const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
      const credName = name || 'Security Key';
      const transportsJson = credential.transports && credential.transports.length > 0
        ? JSON.stringify(credential.transports)
        : null;

      await db.prepare(`
        INSERT INTO webauthn_credentials
          (user_id, credential_id, public_key, counter, device_type, backed_up, transports, name, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        user.userId,
        credential.id,
        isoBase64URL.fromBuffer(credential.publicKey),
        credential.counter,
        credentialDeviceType,
        credentialBackedUp ? 1 : 0,
        transportsJson,
        credName,
        localNow(),
      );

      await db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(user.userId);

      const lastRow = await db.prepare('SELECT last_insert_rowid() as id').get() as { id: number } | undefined;

      await auditLog(db, c, 'WEBAUTHN_REGISTER', 'user', user.userId, `Registered security key "${credName}" (credentialId: ${credential.id})`);

      return c.json({
        success: true,
        credential: {
          id: lastRow?.id ?? 0,
          name: credName,
          deviceType: credentialDeviceType,
          backedUp: credentialBackedUp,
        },
      });
    } catch (error: any) {
      return c.json({ error: 'Failed to webauthn register-verify', code: 'WEBAUTHN_REGISTERVERIFY_ERROR' }, 500);
    }
  });

  // ─── DELETE /api/auth/webauthn/credentials/:id ──────
  api.delete('/credentials/:id', authenticateToken, async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const credId = paramNum(c.req.param('id'));
    if (isNaN(credId)) { return c.json({ error: 'Invalid credential ID', code: 'INVALID_CREDENTIAL_ID' }, 400); }

    try {
      const cred = await db.prepare(
        'SELECT id, name FROM webauthn_credentials WHERE id = ? AND user_id = ?'
      ).get(credId, user.userId) as { id: number; name: string } | undefined;

      if (!cred) {
        return c.json({ error: 'Credential not found', code: 'CREDENTIAL_NOT_FOUND' }, 404);
      }

      await db.prepare('DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?')
        .run(credId, user.userId);

      const remaining = await db.prepare(
        'SELECT COUNT(*) as count FROM webauthn_credentials WHERE user_id = ?'
      ).get(user.userId) as { count: number } | undefined;

      const hasNewTotp = await db.prepare(
        'SELECT COUNT(*) as count FROM user_totp_secrets WHERE user_id = ?'
      ).get(user.userId) as { count: number } | undefined;
      const hasLegacyTotp = await db.prepare(
        'SELECT totp_secret_enc FROM users WHERE id = ?'
      ).get(user.userId) as { totp_secret_enc: string | null } | undefined;
      const hasAnyTotp = (hasNewTotp?.count ?? 0) > 0 || !!hasLegacyTotp?.totp_secret_enc;

      if ((remaining?.count ?? 0) === 0 && !hasAnyTotp) {
        await db.prepare('UPDATE users SET totp_enabled = 0 WHERE id = ?').run(user.userId);
      }

      await auditLog(db, c, 'WEBAUTHN_DELETE', 'user', credId, `Removed security key "${cred.name}" (credentialId: ${credId})`);

      return c.json({ message: 'Security key removed' });
    } catch (error: any) {
      return c.json({ error: 'Failed to webauthn delete credential', code: 'WEBAUTHN_DELETE_CREDENTIAL_ERROR' }, 500);
    }
  });

  // ─── POST /api/auth/webauthn/authenticate-options ───
  api.post('/authenticate-options', async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const body = await c.req.json() as { tempToken?: string };
      const { tempToken } = body;

      let userId: number;

      if (tempToken) {
        let decoded: any;
        try {
          const { payload } = await jwtVerify(tempToken, new TextEncoder().encode(c.env.JWT_SECRET));
          decoded = payload;
        } catch {
          return c.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED_PLEASE_LOG' }, 401);
        }
        if ((decoded as any).type !== '2fa_pending') {
          return c.json({ error: 'Invalid token type', code: 'INVALID_TOKEN_TYPE' }, 403);
        }
        userId = Number((decoded as any).userId);
      } else {
        const authUser = c.get('user');
        if (!authUser?.userId) {
          return c.json({ error: 'Authentication required', code: 'AUTHENTICATION_REQUIRED' }, 401);
        }
        userId = authUser.userId;
      }

      const existingCreds = await getCredentialsForUser(db, userId);
      if (existingCreds.length === 0) {
        return c.json({ error: 'No security keys registered', hasSecurityKeys: false });
      }

      const allowCredentials = existingCreds.map(cr => ({
        id: cr.credential_id,
        transports: parseTransports(cr.transports),
      }));

      const options = await generateAuthenticationOptions({
        rpID: c.env.WEBAUTHN_RP_ID || 'rmpgutah.us',
        allowCredentials,
        userVerification: 'preferred',
      });

      const challengeId = randomHex(16);
      storeChallengeWithCap(challengeId, {
        challenge: options.challenge,
        userId,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });

      return c.json({ options, challengeId, hasSecurityKeys: true });
    } catch (error: any) {
      return c.json({ error: 'Failed to webauthn authenticate-options', code: 'WEBAUTHN_AUTHENTICATEOPTIONS_ERROR' }, 500);
    }
  });

  // ─── POST /api/auth/webauthn/authenticate-verify ────
  api.post('/authenticate-verify', async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const body = await c.req.json() as {
        challengeId: string;
        tempToken: string;
        response: AuthenticationResponseJSON;
        trustDevice?: boolean;
        deviceFingerprint?: string;
      };
      const { challengeId, tempToken, response: authResponse, trustDevice: shouldTrust, deviceFingerprint } = body;

      if (!challengeId || !tempToken || !authResponse) {
        return c.json({ error: 'Missing required fields', code: 'MISSING_REQUIRED_FIELDS' }, 400);
      }
      if (typeof challengeId !== 'string' || challengeId.length > 64 || !/^[a-f0-9]+$/.test(challengeId)) {
        return c.json({ error: 'Invalid challengeId format', code: 'INVALID_CHALLENGEID_FORMAT' }, 400);
      }
      if (typeof tempToken !== 'string' || tempToken.length > 2048) {
        return c.json({ error: 'Invalid tempToken', code: 'INVALID_TEMPTOKEN' }, 400);
      }
      if (deviceFingerprint !== undefined && deviceFingerprint !== null &&
          (typeof deviceFingerprint !== 'string' || deviceFingerprint.length > 500)) {
        return c.json({ error: 'Invalid deviceFingerprint', code: 'INVALID_DEVICEFINGERPRINT' }, 400);
      }

      let decoded: any;
      try {
        const { payload } = await jwtVerify(tempToken, new TextEncoder().encode(c.env.JWT_SECRET));
        decoded = payload;
      } catch {
        return c.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED_PLEASE_LOG' }, 401);
      }

      if ((decoded as any).type !== '2fa_pending') {
        return c.json({ error: 'Invalid token type', code: 'INVALID_TOKEN_TYPE' }, 403);
      }

      const stored = challengeStore.get(challengeId);
      if (!stored || stored.expiresAt < Date.now()) {
        challengeStore.delete(challengeId);
        return c.json({ error: 'Challenge expired. Please try again.', code: 'CHALLENGE_EXPIRED_PLEASE_TRY' }, 400);
      }
      if (stored.userId !== Number((decoded as any).userId)) {
        return c.json({ error: 'Challenge mismatch', code: 'CHALLENGE_MISMATCH' }, 403);
      }

      const credentialIdBase64 = authResponse.id;
      const cred = await db.prepare(
        'SELECT id, credential_id, public_key, counter, transports FROM webauthn_credentials WHERE credential_id = ? AND user_id = ?'
      ).get(credentialIdBase64, Number((decoded as any).userId)) as {
        id: number;
        credential_id: string;
        public_key: string;
        counter: number;
        transports: string | null;
      } | undefined;

      if (!cred) {
        await auditLog(db, c, 'WEBAUTHN_AUTH_FAILED', 'user', Number((decoded as any).userId), `Security key not recognized (credentialId: ${credentialIdBase64})`);
        return c.json({ error: 'Security key not recognized', code: 'SECURITY_KEY_NOT_RECOGNIZED' }, 400);
      }

      const verification = await verifyAuthenticationResponse({
        response: authResponse,
        expectedChallenge: stored.challenge,
        expectedOrigin: getOrigin(c),
        expectedRPID: c.env.WEBAUTHN_RP_ID || 'rmpgutah.us',
        requireUserVerification: false,
        credential: {
          id: cred.credential_id,
          publicKey: isoBase64URL.toBuffer(cred.public_key),
          counter: cred.counter,
          transports: parseTransports(cred.transports),
        },
      });

      challengeStore.delete(challengeId);

      if (!verification.verified) {
        await auditLog(db, c, 'WEBAUTHN_AUTH_FAILED', 'user', Number((decoded as any).userId), `Security key verification failed (credentialId: ${cred.credential_id})`);
        return c.json({ error: 'Security key verification failed', code: 'SECURITY_KEY_VERIFICATION_FAILED' }, 401);
      }

      await db.prepare('UPDATE webauthn_credentials SET counter = ?, last_used_at = ? WHERE id = ?')
        .run(verification.authenticationInfo.newCounter, localNow(), cred.id);

      const dbUser = await db.prepare(
        'SELECT id, username, full_name, first_name, last_name, email, role, badge_number, phone, avatar_url, status, must_change_password, password_changed_at, force_password_change FROM users WHERE id = ?'
      ).get(Number((decoded as any).userId)) as any;

      if (!dbUser) {
        return c.json({ error: 'User not found', code: 'USER_NOT_FOUND' }, 401);
      }
      if (dbUser.status !== 'active') {
        return c.json({ error: 'Account is disabled or suspended', code: 'ACCOUNT_IS_DISABLED_OR' }, 403);
      }

      const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
      const userAgent = c.req.header('user-agent') || 'unknown';

      let _pwExpired = false;
      try { _pwExpired = isPasswordExpired(dbUser.password_changed_at); } catch { /* fail open */ }
      const needsPasswordChange = dbUser.must_change_password === 1
        || dbUser.force_password_change === 1
        || _pwExpired;

      if (needsPasswordChange) {
        const pwTempToken = await generateTempToken(dbUser, c.env.JWT_SECRET);
        return c.json({
          step: 'password_change',
          requiresPasswordChange: true,
          tempToken: pwTempToken,
        });
      }

      // Device trust — simplified (no KV store in this port)
      // trustDevice() skipped — would need KV binding for trusted_devices table

      const refreshToken = await generateRefreshToken(dbUser, c.env.JWT_SECRET);
      const sessionId = crypto.randomUUID();
      const tokenHash = await sha256Hex(refreshToken);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      await db.prepare(`
        INSERT INTO sessions (session_id, user_id, refresh_token_hash, ip_address, user_agent, is_active, created_at, last_used_at, expires_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
      `).run(sessionId, dbUser.id, tokenHash, ip, userAgent, localNow(), localNow(), expiresAt);

      const accessToken = await generateAccessToken(dbUser, c.env.JWT_SECRET, sessionId);

      await db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'user_login_webauthn', 'user', ?, 'Security key 2FA login completed', ?)
      `).run(dbUser.id, dbUser.id, ip);

      await db.prepare(`
        UPDATE users SET login_count = COALESCE(login_count, 0) + 1, last_login_at = ? WHERE id = ?
      `).run(localNow(), dbUser.id);

      await auditLog(db, c, 'WEBAUTHN_AUTH', 'user', dbUser.id, `2FA login completed for ${dbUser.username} (credentialId: ${cred.credential_id})`);

      return c.json({
        token: accessToken,
        refreshToken,
        sessionId,
        expiresIn: c.env.JWT_ACCESS_EXPIRY || '15m',
        user: {
          id: dbUser.id,
          username: dbUser.username,
          first_name: dbUser.first_name,
          last_name: dbUser.last_name,
          full_name: dbUser.full_name,
          email: dbUser.email,
          role: dbUser.role,
          badge_number: dbUser.badge_number,
          phone: dbUser.phone,
          avatar_url: dbUser.avatar_url,
          status: dbUser.status,
          must_change_password: false,
          totp_enabled: true,
        },
      });
    } catch (error: any) {
      return c.json({ error: 'Failed to webauthn authenticate-verify', code: 'WEBAUTHN_AUTHENTICATEVERIFY_ERROR' }, 500);
    }
  });

  app.route('/api/auth/webauthn', api);
}
