import { Hono } from 'hono';
import type { Env } from '../types';
import { sign, verify as verifyJwt } from 'hono/jwt';
import { compareSync, hashSync } from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getDb, queryFirst, query, execute, ensureAccountLockoutColumns } from '../utils/db';
import { authMiddleware } from '../middleware/auth';
import { rateLimitAllow } from '../utils/rateLimit';
import { signResource, type SignedResourceParams } from '../utils/signedAccess';
import { recordAudit } from '../utils/auditLog';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticatorTransportFuture, RegistrationResponseJSON, AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { dbErrorResponse } from '../utils/dbErrors';
import { log } from '../utils/logger';
import { getSecurityPolicy, validatePassword, DEFAULT_SECURITY_POLICY, type SecurityPolicy } from '../utils/securityPolicy';
import { parseUserAgentDetails } from '../utils/userAgent';
import { getRequestGeo } from '../utils/requestGeo';
import { clientIp } from '../utils/requestIp';
import {
  generateTotpSecret, verifyTotpCode, buildOtpauthUrl,
  encryptTotpSecret, decryptTotpSecret,
  generateBackupCodes, hashBackupCode,
} from '../utils/totp';

const auth = new Hono<Env>();

// ── Session + token contract (MUST match the legacy `rmpg-flex` Worker) ──────
// Login, refresh, 2FA, and logout are routed here by the proxy (see
// proxy/index.ts). A token/session issued here is interchangeable with one
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
export const USER_SELECT =
  'id, username, full_name, first_name, last_name, email, role, badge_number, phone, avatar_url, status, must_change_password, totp_enabled, totp_exempt';

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Trusted devices ("remember this device for 30 days") ─────
// The client (AuthContext.verify2FA/verifyWebAuthn + LoginPage's "Trust this
// device" checkbox) has always sent deviceFingerprint/trustDevice on 2FA
// verification and deviceFingerprint on every /login — but nothing ever read
// them, so checking the box was a complete no-op: `trusted_devices` (schema
// present, zero writers) never got a row, and /login never checked it, so
// 2FA fired every single time regardless. Wired up here in three places:
// trustDeviceIfRequested() (called after a 2FA/WebAuthn verify when the user
// opted in) and the lookup in /login below (skips the 2FA branch entirely
// when the presented fingerprint matches an unexpired trusted row).
const TRUST_DEVICE_DURATION = '+30 days';

function deviceNameFromUserAgent(ua: string): string {
  if (/ipad/i.test(ua)) return 'iPad';
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/android/i.test(ua)) return 'Android device';
  if (/macintosh|mac os x/i.test(ua)) return 'Mac';
  if (/windows/i.test(ua)) return 'Windows PC';
  if (/linux/i.test(ua)) return 'Linux device';
  return 'Unknown device';
}

async function trustDeviceIfRequested(
  c: any, db: any, userId: number, deviceFingerprint: unknown, trustDevice: unknown,
): Promise<void> {
  if (!trustDevice || typeof deviceFingerprint !== 'string' || !deviceFingerprint) return;
  try {
    const ip = clientIp(c);
    const ua = c.req.header('user-agent') || '';
    const existing = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM trusted_devices WHERE user_id = ? AND device_fingerprint = ?', userId, deviceFingerprint);
    if (existing) {
      await execute(db,
        `UPDATE trusted_devices SET trusted_until = datetime('now', ?), last_used_at = datetime(\'now\'), ip_address = ? WHERE id = ?`,
        TRUST_DEVICE_DURATION, ip, existing.id);
    } else {
      await execute(db,
        `INSERT INTO trusted_devices (user_id, device_fingerprint, device_name, ip_address, trusted_until, last_used_at)
         VALUES (?, ?, ?, ?, datetime('now', ?), datetime('now'))`,
        userId, deviceFingerprint, deviceNameFromUserAgent(ua), ip, TRUST_DEVICE_DURATION);
    }
  } catch (err) {
    console.error('trustDeviceIfRequested failed:', err); // non-fatal — login already succeeded
  }
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
// Device (parsed from User-Agent) and network geo (from Cloudflare's free
// per-request `cf` object — see requestGeo.ts) are captured at session
// creation because that's the only point either is available; ip_address and
// user_agent alone left the admin Active Sessions view unable to show
// anything beyond a bare IP string.
// Sec-CH-UA-Platform arrives quoted, e.g. `"Windows"` — strip the quotes.
// This is a LOW-entropy Client Hint most Chromium browsers send unprompted;
// it confirms the OS family but (per Chromium's own spec) never carries a
// hardware vendor/model — see the 0232 migration comment for why "Panasonic
// Toughbook FZ-55" isn't obtainable this way.
function unquoteChHeader(v: string | undefined | null): string | null {
  if (!v) return null;
  return v.replace(/^"|"$/g, '') || null;
}

async function createSession(c: any, db: any, userId: number, refreshToken: string, securityPolicy?: SecurityPolicy): Promise<string> {
  const sessionId = uuidv4(); // full dashed UUID → matches live session_id (36 chars)
  const refreshHash = await sha256Hex(refreshToken);
  const ua = c.req.header('user-agent') || '';
  const { browser, os, deviceType } = parseUserAgentDetails(ua);
  const geo = getRequestGeo(c);
  const platform = unquoteChHeader(c.req.header('sec-ch-ua-platform'));
  const platformVersion = unquoteChHeader(c.req.header('sec-ch-ua-platform-version'));
  try {
    await execute(
      db,
      `INSERT INTO sessions (session_id, user_id, refresh_token_hash, ip_address, user_agent, expires_at,
                             device_type, browser, os, country, region, city, postal_code, timezone, latitude, longitude, asn, isp,
                             http_protocol, tls_version, tls_cipher, likely_vpn_or_hosting, device_platform, device_platform_version)
       VALUES (?, ?, ?, ?, ?, datetime('now', '+7 days'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sessionId, userId, refreshHash,
      clientIp(c), ua,
      deviceType, browser, os,
      geo.country, geo.region, geo.city, geo.postalCode, geo.timezone, geo.latitude, geo.longitude, geo.asn, geo.isp,
      geo.httpProtocol, geo.tlsVersion, geo.tlsCipher, geo.likelyVpnOrHosting ? 1 : 0, platform, platformVersion,
    );
  } catch (insertErr) {
    // Live D1 may predate the 0231/0232 device-geo columns. Core identity
    // columns are enough to mint a session — never 500 a successful password.
    log.warn('[login] full session INSERT failed, retrying core columns', {
      message: insertErr instanceof Error ? insertErr.message : String(insertErr),
    });
    await execute(
      db,
      `INSERT INTO sessions (session_id, user_id, refresh_token_hash, ip_address, user_agent, expires_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', '+7 days'))`,
      sessionId, userId, refreshHash, clientIp(c), ua,
    );
  }

  // Enforce Security Policy → "Max Active Sessions". 0 means unenforced
  // (today's behavior — no cap has ever existed). Best-effort: never fail
  // the login itself if this cleanup step errors.
  try {
    const policy = securityPolicy ?? await getSecurityPolicy(db);
    if (policy.maxActiveSessions > 0) {
      await execute(
        db,
        `UPDATE sessions SET is_active = 0
         WHERE user_id = ? AND is_active = 1
           AND session_id NOT IN (
             SELECT session_id FROM sessions
             WHERE user_id = ? AND is_active = 1
             ORDER BY created_at DESC, rowid DESC
             LIMIT ?
           )`,
        userId, userId, policy.maxActiveSessions,
      );
    }
  } catch { /* session-cap cleanup is best-effort — never block login */ }

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

// Best-effort audit of every login outcome into `login_attempts` (the table the
// Security Dashboard reads — /security/recent-threats, /blocked-ips,
// /login-history, /event-timeline). MUST never throw: a logging failure cannot
// be allowed to block or break a login, mirroring the login_count counter
// pattern. `created_at` is omitted so the column default (Denver-local time,
// consistent with historical rows) fires. `username` is the value as submitted
// so it joins to users.username exactly the way the dashboard queries expect;
// failed attempts for unknown usernames are kept on purpose as probe intel.
async function recordLoginAttempt(
  c: any,
  db: any,
  username: unknown,
  ip: string,
  success: boolean,
  failureReason: string | null,
): Promise<void> {
  try {
    const ua = c.req.header('user-agent') || '';
    const { browser, os, deviceType } = parseUserAgentDetails(ua);
    const geo = getRequestGeo(c);
    const platform = unquoteChHeader(c.req.header('sec-ch-ua-platform'));
    const platformVersion = unquoteChHeader(c.req.header('sec-ch-ua-platform-version'));
    await execute(
      db,
      `INSERT INTO login_attempts (username, ip_address, success, failure_reason,
                                    user_agent, device_type, browser, os,
                                    country, region, city, postal_code, timezone, latitude, longitude, asn, isp,
                                    http_protocol, tls_version, tls_cipher, likely_vpn_or_hosting, device_platform, device_platform_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      String(username ?? '').slice(0, 255),
      ip || null,
      success ? 1 : 0,
      success ? null : failureReason,
      ua, deviceType, browser, os,
      geo.country, geo.region, geo.city, geo.postalCode, geo.timezone, geo.latitude, geo.longitude, geo.asn, geo.isp,
      geo.httpProtocol, geo.tlsVersion, geo.tlsCipher, geo.likelyVpnOrHosting ? 1 : 0, platform, platformVersion,
    );
  } catch { /* non-critical — never fail a login on an audit-write error */ }
}

auth.post('/login', async (c) => {
  // Parse body early so we can reference username in error handlers
  let username: string | undefined;
  try {
    const body = await c.req.json();
    username = body.username;
    const { password, deviceFingerprint } = body;
    if (!username || !password) {
      return c.json({ error: 'Username and password are required', code: 'USERNAME_AND_PASSWORD_ARE' }, 400);
    }

    // Guard: JWT_SECRET must be configured. Without it every token-signing
    // call throws "key must be a string" → 500 on every login attempt.
    if (!c.env.JWT_SECRET) {
      log.error('[login] JWT_SECRET is not configured — all logins will fail');
      return c.json({ error: 'Server configuration error', code: 'SERVER_MISCONFIGURED' }, 500);
    }

    // Brute-force throttle: per-username only. A per-IP bucket was tried but
    // removed — all HQ officers share one corporate NAT IP, so the IP bucket
    // is a shared resource that drains on shift-change concurrent logins and
    // blocks everyone behind that IP simultaneously. The per-username window
    // (30 attempts / 5 min) is the correct anti-credential-stuffing lever:
    // it lets a user retry freely while still walling off a distributed run
    // targeting a specific account. KV fails open so a KV outage never
    // locks officers out.
    //
    // Limit history:
    //   ip:30/300s + user:10/300s (original) → 429s on shift-change NAT exhaustion
    //   ip:100/300s + user:30/300s (2026-08-15) → still blocks shared NAT
    //   ip bucket removed + user:30/300s (2026-08-15) → correct scope
    const ip = clientIp(c);
    const uname = String(username).toLowerCase().slice(0, 64);
    const userOk = await rateLimitAllow(c.env.KV, `login:user:${uname}`, 30, 300);
    if (!userOk) {
      await recordLoginAttempt(c, getDb(c.env), username, ip, false, 'rate_limited');
      return c.json({ error: 'Too many login attempts. Try again in a few minutes.', code: 'RATE_LIMITED' }, 429);
    }

    const db = getDb(c.env);
    await ensureAccountLockoutColumns(db);
    const securityPolicy = await getSecurityPolicy(db).catch(() => DEFAULT_SECURITY_POLICY);

    type UserRow = {
      id: number; username: string; full_name: string | null; first_name: string | null;
      last_name: string | null; email: string | null; role: string; badge_number: string | null;
      phone: string | null; avatar_url: string | null; status: string;
      must_change_password: number | null; totp_enabled: number | null; totp_exempt: number | null;
      password_hash: string | null; failed_login_count: number | null; locked_until: string | null;
      is_locked: number | null; lock_retry_seconds: number | null;
    };
    let user: UserRow | null = null;
    try {
      const userSql = `SELECT ${USER_SELECT}, password_hash, failed_login_count, locked_until,
                (locked_until IS NOT NULL AND locked_until > datetime('now')) AS is_locked,
                CAST(max(0, (julianday(locked_until) - julianday('now')) * 86400) AS INTEGER) AS lock_retry_seconds
         FROM users`;
      // Exact match first (uses the username unique index). Fall back to
      // case-insensitive so "CZamora" still finds "czamora" — a common field
      // typo that previously returned a generic 401.
      user = await queryFirst<UserRow>(db, `${userSql} WHERE username = ?`, username);
      if (!user) {
        user = await queryFirst<UserRow>(db, `${userSql} WHERE LOWER(username) = LOWER(?)`, username);
      }
    } catch (dbErr) {
      log.error('[login] D1 user lookup failed', { uname }, dbErr instanceof Error ? dbErr : new Error(String(dbErr)));
      return c.json({ error: 'Server temporarily unavailable. Please try again.', code: 'DB_ERROR' }, 503);
    }

    if (!user) {
      await recordLoginAttempt(c, db, username, ip, false, 'user_not_found');
      return c.json({ error: 'Invalid username or password', code: 'INVALID_USERNAME_OR_PASSWORD' }, 401);
    }

    if (user.is_locked) {
      await recordLoginAttempt(c, db, username, ip, false, 'account_locked');
      const minutes = Math.max(1, Math.ceil((user.lock_retry_seconds ?? 0) / 60));
      return c.json({
        error: `Account locked due to repeated failed attempts. Try again in ${minutes} minutes.`,
        code: 'ACCOUNT_LOCKED',
        retry_after_seconds: user.lock_retry_seconds ?? 0,
      }, 403);
    }

    if (user.status !== 'active') {
      await recordLoginAttempt(c, db, username, ip, false, 'account_inactive');
      return c.json({ error: 'Account is inactive', code: 'ACCOUNT_INACTIVE' }, 403);
    }

    if (!user.password_hash || !user.password_hash.startsWith('$2')) {
      log.error('[login] User has invalid password_hash (not bcrypt)', { uname: username });
      await recordLoginAttempt(c, db, username, ip, false, 'invalid_hash');
      return c.json({ error: 'Invalid username or password', code: 'INVALID_USERNAME_OR_PASSWORD' }, 401);
    }

    let passwordMatch = false;
    try {
      passwordMatch = compareSync(password, user.password_hash);
    } catch (bcryptErr) {
      log.error('[login] bcrypt compareSync threw — hash may be corrupted', { uname: username }, bcryptErr instanceof Error ? bcryptErr : new Error(String(bcryptErr)));
      await recordLoginAttempt(c, db, username, ip, false, 'corrupted_hash');
      return c.json({ error: 'Invalid username or password', code: 'INVALID_USERNAME_OR_PASSWORD' }, 401);
    }

    if (!passwordMatch) {
      // Atomic increment (avoids a lost-update race under concurrent
      // wrong-password requests for the same account). Reached here only
      // when is_locked was already false, so any locked_until still on the
      // row is a stale/expired lock — reset the counter to a fresh window
      // rather than immediately re-locking on the very next typo.
      const updated = await queryFirst<{ failed_login_count: number; locked_until: string | null }>(
        db,
        `UPDATE users SET
           failed_login_count = (CASE WHEN locked_until IS NOT NULL AND locked_until <= datetime('now') THEN 0 ELSE failed_login_count END) + 1,
           locked_until = CASE
             WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until <= datetime('now') THEN 0 ELSE failed_login_count END) + 1 >= ${securityPolicy.maxLoginAttempts}
               THEN datetime('now', '+${securityPolicy.lockoutDurationMinutes} minutes')
             ELSE NULL
           END
         WHERE id = ?
         RETURNING failed_login_count, locked_until`,
        user.id,
      ).catch(() => null);

      if (updated?.locked_until) {
        await recordLoginAttempt(c, db, username, ip, false, 'account_locked');
        return c.json({
          error: `Account locked due to repeated failed attempts. Try again in ${securityPolicy.lockoutDurationMinutes} minutes.`,
          code: 'ACCOUNT_LOCKED',
          retry_after_seconds: securityPolicy.lockoutDurationMinutes * 60,
        }, 403);
      }
      await recordLoginAttempt(c, db, username, ip, false, 'invalid_password');
      return c.json({ error: 'Invalid username or password', code: 'INVALID_USERNAME_OR_PASSWORD' }, 401);
    }

    // Correct password — reset the failure counter regardless of what happens
    // next (2FA gate, trusted-device check, etc). Password-guessing is what
    // lockout defends against; a wrong 2FA code afterward is unrelated.
    if ((user.failed_login_count ?? 0) > 0 || user.locked_until != null) {
      await execute(db, `UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?`, user.id)
        .catch((err: unknown) => log.warn('[login] failed to reset lockout counter', { userId: user?.id, err: err instanceof Error ? err.message : String(err) }));
    }

    const secret = c.env.JWT_SECRET;

    // ── Two-factor gate ───────────────────────────────────────
    // When the account has TOTP enabled (and isn't exempt), do NOT issue
    // tokens or create a session yet — return the client's pending-2FA
    // contract ({ requires2FA, tempToken }; AuthContext.login switches the
    // form to the code step). The tempToken is a 5-minute purpose-bound JWT
    // that /login/verify-2fa and /login/verify-backup-code exchange for real
    // tokens after the second factor checks out.
    // A previously-trusted device (see trustDeviceIfRequested) skips the 2FA
    // gate entirely for its 30-day window — refresh last_used_at so an
    // actively-used device doesn't expire out from under someone.
    let deviceTrusted = false;
    if (typeof deviceFingerprint === 'string' && deviceFingerprint) {
      try {
        const trusted = await queryFirst<{ id: number }>(
          db,
          `SELECT id FROM trusted_devices WHERE user_id = ? AND device_fingerprint = ? AND trusted_until > datetime(\'now\')`,
          user.id, deviceFingerprint,
        );
        if (trusted) {
          deviceTrusted = true;
          await execute(db, `UPDATE trusted_devices SET last_used_at = datetime(\'now\') WHERE id = ?`, trusted.id).catch(() => undefined);
        }
      } catch { /* table absent on an unmigrated local DB — treat as not trusted */ }
    }

    if (user.totp_enabled && !user.totp_exempt && !deviceTrusted) {
      const now = Math.floor(Date.now() / 1000);
      const tempToken = await sign(
        { sub: String(user.id), userId: user.id, username: user.username, type: '2fa_pending', iat: now, exp: now + 300 },
        secret,
      );
      // Offer the security-key path when the account has registered keys
      // (table may be absent on local DBs pre-0090 — treat as none).
      let webauthnCount = 0;
      try {
        const r = await queryFirst<{ n: number }>(
          db, 'SELECT COUNT(*) AS n FROM webauthn_credentials WHERE user_id = ?', user.id);
        webauthnCount = r?.n ?? 0;
      } catch { /* table absent */ }
      return c.json({
        requires2FA: true,
        tempToken,
        methods: { totp: true, webauthn: webauthnCount > 0 },
        requiresPasswordChange: !!user.must_change_password,
      });
    }

    const claims = tokenClaims(user);
    const refreshToken = await signRefreshToken(secret, claims);
    const sessionId = await createSession(c, db, user.id, refreshToken, securityPolicy);
    const accessToken = await signAccessToken(secret, { ...claims, sessionId });

    // Best-effort login counters — never let a counter error fail the login.
    try {
      await execute(
        db,
        `UPDATE users SET login_count = COALESCE(login_count, 0) + 1, last_login_at = datetime(\'now\') WHERE id = ?`,
        user.id,
      );
    } catch { /* non-critical */ }

    await recordLoginAttempt(c, db, user.username, ip, true, null);

    return c.json({
      token: accessToken,
      refreshToken,
      sessionId,
      expiresIn: ACCESS_TTL_SECONDS,
      lastLoginAt: null,
      lastLoginIp: null,
      user: userPayload(user),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    log.error('[login] Unhandled login error', { message: msg, uname: String(username ?? '').slice(0, 64) }, err instanceof Error ? err : new Error(msg));
    return c.json({ error: 'Failed to login', code: 'LOGIN_ERROR' }, 500);
  }
});

// ── Login second factor ─────────────────────────────────────
// Exchange a pending-2FA tempToken (issued by /login when totp_enabled) +
// a valid second factor for real tokens. Response shape mirrors /login's
// success branch exactly (AuthContext.verify2FALogin stores it identically).

type TwoFaPendingBody = {
  tempToken?: string;
  code?: string;
  deviceFingerprint?: string;
  trustDevice?: boolean;
  challengeId?: string;
  response?: AuthenticationResponseJSON;
};

async function resolve2faPending(
  c: any, db: any,
): Promise<{ user: any; body: TwoFaPendingBody } | { error: Response }> {
  // Parse once and return the body. Callers used to call c.req.json() again
  // after this helper, which either threw (empty catch → missing TOTP code)
  // or depended on Hono body caching. One parse is the only safe contract.
  const body = (await c.req.json().catch(() => ({}))) as TwoFaPendingBody;
  const tempToken = body.tempToken
    || (c.req.header('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!tempToken) {
    return { error: c.json({ error: 'Verification session expired. Please sign in again.', code: 'MFA_EXPIRED' }, 401) };
  }
  let payload: any;
  try {
    payload = await verifyJwt(tempToken, c.env.JWT_SECRET, 'HS256');
  } catch {
    return { error: c.json({ error: 'Verification session expired. Please sign in again.', code: 'MFA_EXPIRED' }, 401) };
  }
  if (payload?.type !== '2fa_pending' || payload?.userId == null) {
    return { error: c.json({ error: 'Verification session expired. Please sign in again.', code: 'MFA_EXPIRED' }, 401) };
  }
  const user = await queryFirst<any>(
    db,
    `SELECT ${USER_SELECT}, totp_secret_enc, totp_backup_codes FROM users WHERE id = ? AND status = 'active'`,
    payload.userId,
  );
  if (!user) {
    return { error: c.json({ error: 'User not found or inactive', code: 'USER_INACTIVE' }, 401) };
  }
  return { user, body };
}

export async function mintLoginTokens(c: any, db: any, user: any) {
  const secret = c.env.JWT_SECRET;
  const claims = tokenClaims(user);
  const refreshToken = await signRefreshToken(secret, claims);
  const sessionId = await createSession(c, db, user.id, refreshToken);
  const accessToken = await signAccessToken(secret, { ...claims, sessionId });
  try {
    await execute(
      db,
      `UPDATE users SET login_count = COALESCE(login_count, 0) + 1, last_login_at = datetime(\'now\') WHERE id = ?`,
      user.id,
    );
  } catch { /* non-fatal */ }
  const ip = clientIp(c);
  await recordLoginAttempt(c, db, user.username, ip, true, null);
  return {
    token: accessToken,
    refreshToken,
    sessionId,
    expiresIn: ACCESS_TTL_SECONDS,
    lastLoginAt: null,
    lastLoginIp: null,
    user: userPayload(user),
  };
}

export async function issueLoginTokens(c: any, db: any, user: any) {
  return c.json(await mintLoginTokens(c, db, user));
}

// POST /auth/login/verify-2fa — { tempToken, code } → full login tokens.
auth.post('/login/verify-2fa', async (c) => {
  try {
    const db = getDb(c.env);
    const resolved = await resolve2faPending(c, db);
    if ('error' in resolved) return resolved.error;
    const { user, body } = resolved;
    const { code, deviceFingerprint, trustDevice } = body;

    if (!user.totp_secret_enc) {
      return c.json({ error: 'Two-factor configuration missing. Contact your administrator.', code: 'TOTP_DECRYPT_ERROR' }, 500);
    }
    const secretB32 = await decryptTotpSecret(user.totp_secret_enc, c.env.JWT_SECRET);
    if (!secretB32) {
      // VPS-era blob encrypted with the lost key — surfaced distinctly so an
      // admin knows to re-enroll rather than retry codes.
      return c.json({ error: 'Authentication configuration error. Contact your administrator.', code: 'TOTP_DECRYPT_ERROR' }, 500);
    }
    if (!(await verifyTotpCode(secretB32, code || ''))) {
      return c.json({ error: 'Invalid verification code. Wait for a new code and try again.', code: 'INVALID_CODE' }, 401);
    }
    await trustDeviceIfRequested(c, db, user.id, deviceFingerprint, trustDevice);
    return issueLoginTokens(c, db, user);
  } catch (err) {
    console.error('verify-2fa failed:', err);
    return c.json({ error: 'Verification failed', code: 'VERIFY_2FA_ERROR' }, 500);
  }
});

// POST /auth/login/verify-backup-code — { tempToken, code } → full login
// tokens; the matched backup code is consumed (single use).
auth.post('/login/verify-backup-code', async (c) => {
  try {
    const db = getDb(c.env);
    const resolved = await resolve2faPending(c, db);
    if ('error' in resolved) return resolved.error;
    const { user, body } = resolved;
    const { code } = body;

    let hashes: string[] = [];
    try {
      const parsed = JSON.parse(user.totp_backup_codes || '[]');
      if (Array.isArray(parsed)) hashes = parsed.map(String);
    } catch { /* treat as none */ }
    const candidate = await hashBackupCode(code || '');
    const idx = hashes.indexOf(candidate);
    if (idx === -1) {
      return c.json({ error: 'Invalid backup code.', code: 'INVALID_BACKUP_CODE' }, 401);
    }
    hashes.splice(idx, 1); // single use
    await execute(db, 'UPDATE users SET totp_backup_codes = ? WHERE id = ?', JSON.stringify(hashes), user.id);
    return issueLoginTokens(c, db, user);
  } catch (err) {
    console.error('verify-backup-code failed:', err);
    return c.json({ error: 'Verification failed', code: 'VERIFY_BACKUP_ERROR' }, 500);
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
      `SELECT session_id, user_id FROM sessions
       WHERE refresh_token_hash = ? AND is_active = 1 AND expires_at > datetime(\'now\')`,
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
      await execute(db, `UPDATE sessions SET is_active = 0 WHERE session_id = ?`, session.session_id);
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
      `UPDATE sessions SET refresh_token_hash = ?, last_used_at = datetime(\'now\') WHERE session_id = ?`,
      newRefreshHash, session.session_id,
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
    // D1 outage or transient failure — return 401 so the client can re-login
    // instead of 500 which triggers infinite retry loops.
    return c.json({ error: 'Refresh failed', code: 'REFRESH_FAILED' }, 401);
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

// POST /auth/session/device-location — best-effort device GPS attach.
// Distinct from the IP-derived latitude/longitude captured at login
// (Cloudflare's edge estimate of where the connecting IP is): this is the
// browser's own navigator.geolocation reading, which the client only ever
// sends after the browser's OWN permission prompt — this endpoint cannot
// be used to silently geolocate anyone, since the browser gates it. Client
// call is fire-and-forget post-login (see AuthContext) and never blocks or
// retries login itself. Scoped to the CALLING session only, resolved from
// the access token's own sessionId claim — a user can't stamp coordinates
// onto a different session by guessing its id.
auth.post('/session/device-location', authMiddleware, async (c) => {
  const sessionId = c.get('sessionId');
  if (!sessionId) return c.json({ error: 'No session bound to this token' }, 400);
  try {
    const body = await c.req.json<{ latitude?: number; longitude?: number; accuracyMeters?: number }>();
    const lat = typeof body.latitude === 'number' ? body.latitude : null;
    const lng = typeof body.longitude === 'number' ? body.longitude : null;
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return c.json({ error: 'latitude and longitude are required' }, 400);
    }
    const db = getDb(c.env);
    await execute(db,
      `UPDATE sessions SET device_latitude = ?, device_longitude = ?, device_geo_accuracy_m = ?,
              device_geo_captured_at = datetime('now')
       WHERE session_id = ? AND user_id = ?`,
      String(lat), String(lng),
      typeof body.accuracyMeters === 'number' ? String(body.accuracyMeters) : null,
      sessionId, c.get('userId'));
    return c.json({ success: true });
  } catch (err) {
    console.error('[auth] POST session/device-location failed:', err);
    return c.json({ error: 'Failed to record device location' }, 500);
  }
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
    const securityPolicy = await getSecurityPolicy(getDb(c.env)).catch(() => DEFAULT_SECURITY_POLICY);
    const policyErr = validatePassword(new_password, securityPolicy);
    if (policyErr) return c.json({ error: policyErr }, 400);

    const userId = c.get('userId');
    const db = getDb(c.env);
    const user = await queryFirst<any>(db, 'SELECT password_hash FROM users WHERE id = ?', userId);
    if (!user || !compareSync(current_password, user.password_hash)) {
      return c.json({ error: 'Current password is incorrect' }, 401);
    }

    const newHash = hashSync(new_password, 12);
    await execute(
      db,
      `UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?`,
      newHash, userId
    );
    return c.json({ message: 'Password updated' });
  } catch (err) {
    log.error('PUT /password failed', { src: 'src/routes/auth.ts' }, err);
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
    const securityPolicy = await getSecurityPolicy(getDb(c.env)).catch(() => DEFAULT_SECURITY_POLICY);
    const policyErr = validatePassword(next, securityPolicy);
    if (policyErr) return c.json({ error: policyErr }, 400);

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
    log.error('POST /change-password failed', { src: 'src/routes/auth.ts' }, err);
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
    const securityPolicy = await getSecurityPolicy(getDb(c.env)).catch(() => DEFAULT_SECURITY_POLICY);
    const policyErr = validatePassword(next, securityPolicy);
    if (policyErr) return c.json({ error: policyErr }, 400);

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
    log.error('POST /login/change-password failed', { src: 'src/routes/auth.ts' }, err);
    return c.json({ error: 'Password change failed' }, 500);
  }
});

// ── Forgot password (security-question recovery) ─────────────
// Three-step anonymous flow the LoginPage "Forgot password?" panel already
// speaks: username → 3 security-question answers → new password. Backed by
// `user_security_questions` (one row per user, answers bcrypt-hashed same as
// user passwords). None of these three endpoints existed before — every
// account's "Forgot password?" click dead-ended on a fetch to a route that
// 404'd, silently swallowed by the client's catch block as "Unable to
// connect." Users must first set up their questions from the Security tab
// (PUT /auth/security-questions below) — there is no other seed path.
const FORGOT_PW_TOKEN_TTL_SECONDS = 10 * 60; // 10m — long enough to answer 3 questions, short enough to limit exposure

// POST /auth/forgot-password — { username } → { hasQuestions, questions? }
// Never reveals whether the username exists: unknown user and
// user-without-questions both fall through to the same
// `hasQuestions: false` response the client already renders as a generic
// "contact your administrator" message.
auth.post('/forgot-password', async (c) => {
  try {
    const { username } = await c.req.json<{ username?: string }>().catch(() => ({} as any));
    if (!username) return c.json({ hasQuestions: false });

    const ip = clientIp(c);
    const uname = String(username).toLowerCase().slice(0, 64);
    const [ipOk, userOk] = await Promise.all([
      rateLimitAllow(c.env.KV, `forgot-pw:ip:${ip}`, 20, 300),
      rateLimitAllow(c.env.KV, `forgot-pw:user:${uname}`, 10, 300),
    ]);
    if (!ipOk || !userOk) {
      return c.json({ error: 'Too many attempts. Try again in a few minutes.', code: 'RATE_LIMITED' }, 429);
    }

    const db = getDb(c.env);
    const user = await queryFirst<{ id: number; status: string }>(
      db, `SELECT id, status FROM users WHERE username = ?`, username);
    if (!user || user.status !== 'active') return c.json({ hasQuestions: false });

    const sq = await queryFirst<{ question_1: string; question_2: string; question_3: string }>(
      db, `SELECT question_1, question_2, question_3 FROM user_security_questions WHERE user_id = ?`, user.id);
    if (!sq) return c.json({ hasQuestions: false });

    return c.json({ hasQuestions: true, questions: [sq.question_1, sq.question_2, sq.question_3] });
  } catch (err) {
    console.error('forgot-password failed:', err);
    return c.json({ hasQuestions: false });
  }
});

// POST /auth/forgot-password/verify — { username, answers: string[3] } →
// { success, tempToken } on a match of all three (case-insensitive, the
// client already lowercases before sending — trimmed here to match how
// answers are hashed at setup time).
auth.post('/forgot-password/verify', async (c) => {
  try {
    const { username, answers } = await c.req.json<{ username?: string; answers?: string[] }>().catch(() => ({} as any));
    if (!username || !Array.isArray(answers) || answers.length !== 3) {
      return c.json({ error: 'Username and all three answers are required' }, 400);
    }

    const ip = clientIp(c);
    const uname = String(username).toLowerCase().slice(0, 64);
    const [ipOk, userOk] = await Promise.all([
      rateLimitAllow(c.env.KV, `forgot-pw-verify:ip:${ip}`, 15, 300),
      rateLimitAllow(c.env.KV, `forgot-pw-verify:user:${uname}`, 8, 300),
    ]);
    if (!ipOk || !userOk) {
      return c.json({ error: 'Too many attempts. Try again in a few minutes.', code: 'RATE_LIMITED' }, 429);
    }

    const db = getDb(c.env);
    const user = await queryFirst<{ id: number; status: string; password_hash: string }>(
      db, `SELECT id, status, password_hash FROM users WHERE username = ?`, username);
    if (!user || user.status !== 'active') {
      return c.json({ error: 'One or more answers are incorrect.' }, 401);
    }

    const sq = await queryFirst<{ answer_1_hash: string; answer_2_hash: string; answer_3_hash: string }>(
      db, `SELECT answer_1_hash, answer_2_hash, answer_3_hash FROM user_security_questions WHERE user_id = ?`, user.id);
    if (!sq) return c.json({ error: 'One or more answers are incorrect.' }, 401);

    const hashes = [sq.answer_1_hash, sq.answer_2_hash, sq.answer_3_hash];
    const allMatch = hashes.every((h, i) => compareSync(String(answers[i] ?? '').trim().toLowerCase(), h));
    if (!allMatch) return c.json({ error: 'One or more answers are incorrect.' }, 401);

    // Bind the token to the password_hash it was issued against — a JWT
    // can't be revoked server-side, so /reset re-checks this hash matches
    // what's currently on the row. A successful reset changes password_hash,
    // which makes every other outstanding token for this user (including a
    // captured/replayed copy of this one) fail that check. Without this, the
    // 10-minute token was reusable to reset the password over and over.
    const pwh = await sha256Hex(user.password_hash);
    const now = Math.floor(Date.now() / 1000);
    const tempToken = await sign(
      { sub: String(user.id), userId: user.id, type: 'pwd_reset', pwh, iat: now, exp: now + FORGOT_PW_TOKEN_TTL_SECONDS },
      c.env.JWT_SECRET,
    );
    return c.json({ success: true, tempToken });
  } catch (err) {
    console.error('forgot-password/verify failed:', err);
    return c.json({ error: 'Verification failed' }, 500);
  }
});

// POST /auth/forgot-password/reset — { tempToken, newPassword } → { success }.
// Also retires every active session for the account, matching the intent of
// a "someone other than the logged-in user may have just proven identity a
// different way" reset, and forces `must_change_password = 0` since the
// value just set IS the freshly-chosen password.
auth.post('/forgot-password/reset', async (c) => {
  try {
    const { tempToken, newPassword } = await c.req.json<{ tempToken?: string; newPassword?: string }>().catch(() => ({} as any));
    if (!tempToken || !newPassword) {
      return c.json({ error: 'Reset token and new password are required' }, 400);
    }
    const securityPolicy = await getSecurityPolicy(getDb(c.env)).catch(() => DEFAULT_SECURITY_POLICY);
    const policyErr = validatePassword(newPassword, securityPolicy);
    if (policyErr) return c.json({ error: policyErr }, 400);

    let payload: any;
    try {
      payload = await verifyJwt(tempToken, c.env.JWT_SECRET, 'HS256');
    } catch {
      return c.json({ error: 'Reset session expired. Please start over.', code: 'RESET_EXPIRED' }, 401);
    }
    if (payload?.type !== 'pwd_reset' || payload?.userId == null) {
      return c.json({ error: 'Reset session expired. Please start over.', code: 'RESET_EXPIRED' }, 401);
    }

    const db = getDb(c.env);
    const user = await queryFirst<{ id: number; status: string; password_hash: string }>(
      db, `SELECT id, status, password_hash FROM users WHERE id = ?`, payload.userId);
    if (!user || user.status !== 'active') {
      return c.json({ error: 'User not found or inactive' }, 401);
    }
    // Single-use enforcement: the token was minted against the password_hash
    // at /verify time. If it's changed since (this token already used, or
    // the password was changed some other way), reject the replay.
    if (payload.pwh !== (await sha256Hex(user.password_hash))) {
      return c.json({ error: 'Reset session expired. Please start over.', code: 'RESET_EXPIRED' }, 401);
    }

    const newHash = hashSync(newPassword, 12);
    await execute(
      db,
      `UPDATE users SET password_hash = ?, must_change_password = 0,
                          password_changed_at = datetime('now'),
                          updated_at = datetime('now')
       WHERE id = ?`,
      newHash, user.id,
    );
    await execute(db, `UPDATE sessions SET is_active = 0 WHERE user_id = ?`, user.id);

    return c.json({ success: true });
  } catch (err) {
    console.error('forgot-password/reset failed:', err);
    return c.json({ error: 'Failed to reset password' }, 500);
  }
});

// ── Security questions setup (authenticated) ──────────────────
// The forgot-password flow above has no seed path of its own — a user must
// configure their three questions/answers here (from a logged-in session)
// before "Forgot password?" can ever succeed for that account.

auth.get('/security-questions', authMiddleware, async (c) => {
  try {
    const db = getDb(c.env);
    const sq = await queryFirst<{ question_1: string; question_2: string; question_3: string }>(
      db, `SELECT question_1, question_2, question_3 FROM user_security_questions WHERE user_id = ?`, c.get('userId'));
    return c.json({ configured: !!sq, questions: sq ? [sq.question_1, sq.question_2, sq.question_3] : [] });
  } catch (err) {
    console.error('GET security-questions failed:', err);
    return c.json({ error: 'Failed to load security questions' }, 500);
  }
});

auth.put('/security-questions', authMiddleware, async (c) => {
  try {
    const body = await c.req.json<{
      currentPassword?: string;
      questions?: string[]; answers?: string[];
    }>().catch(() => ({} as any));
    const { currentPassword, questions, answers } = body;

    if (!currentPassword) return c.json({ error: 'Current password is required' }, 400);
    if (!Array.isArray(questions) || questions.length !== 3 || questions.some((q) => !q?.trim())) {
      return c.json({ error: 'All three questions are required' }, 400);
    }
    if (!Array.isArray(answers) || answers.length !== 3 || answers.some((a) => !a?.trim())) {
      return c.json({ error: 'All three answers are required' }, 400);
    }

    const userId = c.get('userId');
    const db = getDb(c.env);
    // Re-authenticate — this endpoint quietly enables a full account
    // takeover path (forgot-password/reset), so it gets the same
    // password-reconfirmation gate as changing the password itself.
    const user = await queryFirst<any>(db, 'SELECT password_hash FROM users WHERE id = ?', userId);
    if (!user || !compareSync(currentPassword, user.password_hash)) {
      return c.json({ error: 'Current password is incorrect' }, 401);
    }

    const answerHashes = answers.map((a) => hashSync(a.trim().toLowerCase(), 12));
    await execute(
      db,
      `INSERT INTO user_security_questions
         (user_id, question_1, answer_1_hash, question_2, answer_2_hash, question_3, answer_3_hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         question_1 = excluded.question_1, answer_1_hash = excluded.answer_1_hash,
         question_2 = excluded.question_2, answer_2_hash = excluded.answer_2_hash,
         question_3 = excluded.question_3, answer_3_hash = excluded.answer_3_hash,
         updated_at = datetime('now')`,
      userId,
      questions[0].trim(), answerHashes[0],
      questions[1].trim(), answerHashes[1],
      questions[2].trim(), answerHashes[2],
    );

    return c.json({ success: true });
  } catch (err) {
    console.error('PUT security-questions failed:', err);
    return c.json({ error: 'Failed to save security questions' }, 500);
  }
});

auth.get('/password-policy', async (c) => {
  const policy = await getSecurityPolicy(getDb(c.env)).catch(() => DEFAULT_SECURITY_POLICY);
  return c.json({
    minLength: policy.minPasswordLength,
    requireUppercase: policy.requireUppercase,
    requireLowercase: policy.requireLowercase,
    requireNumber: policy.requireNumbers,
    requireSpecial: policy.requireSpecialChars,
    expiryDays: policy.passwordExpiryDays,
    preventReuse: 5, // not yet configurable — no UI field exists for this
  });
});

auth.get('/session-timeout', (c) => {
  return c.json({ idleTimeoutMinutes: 30, maxSessionHours: 12 });
});

// ── Signed media URLs ────────────────────────────────────────
// POST /auth/sign-urls — client/src/utils/signedUrls.ts has called this
// since it shipped; the endpoint never existed, so <video>/<audio> tags
// fell back to ?token=<full session JWT>. Issues per-resource HMAC params
// ({ signed: { "type:id": { sig, exp, nonce } } }) the stream handlers
// verify. Read scope is enforced HERE, at sign time — a signature carries
// no session, so it must never be issuable for a resource the caller
// can't already read.
const SIGNABLE_TYPES = new Set(['bodycam', 'bodycam-thumb', 'radio', 'panic']);
const MEDIA_READ_ALL_ROLES = new Set(['admin', 'manager', 'supervisor']); // mirrors bodyCameras.ts READ_ALL_ROLES

auth.post('/sign-urls', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Authentication required' }, 401);
    const body = await c.req.json<{ resources?: Array<{ type?: string; id?: string | number }> }>().catch(() => ({} as any));
    const resources = Array.isArray(body?.resources) ? body.resources.slice(0, 100) : [];
    const db = getDb(c.env);
    const signed: Record<string, SignedResourceParams> = {};
    for (const r of resources) {
      const type = String(r?.type ?? '');
      const id = String(r?.id ?? '');
      if (!SIGNABLE_TYPES.has(type) || !/^\d{1,12}$/.test(id)) continue;
      if ((type === 'bodycam' || type === 'bodycam-thumb') && !MEDIA_READ_ALL_ROLES.has(user.role)) {
        // Officers may only sign their own footage (and its thumbnail) —
        // same scope rule as the stream handler itself. Thumbnails are
        // rows in bodycam_videos too, not a separate table.
        const row = await queryFirst<{ officer_id: number }>(db, 'SELECT officer_id FROM bodycam_videos WHERE id = ?', id);
        if (!row || row.officer_id !== user.id) continue;
      }
      signed[`${type}:${id}`] = await signResource(c.env.JWT_SECRET, type, id);
    }
    return c.json({ signed });
  } catch (err) {
    console.error('POST /auth/sign-urls failed:', err);
    return c.json({ error: 'Failed to sign resources' }, 500);
  }
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
    const userId = (c.get('userId') as number | undefined) ?? null;
    if (!userId) return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);

    const existing = await queryFirst<{ username: string; full_name: string | null }>(
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
  } catch (err) {
    log.error('PUT /profile failed', { src: 'src/routes/auth.ts' }, err);
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
      WHERE user_id = ? AND COALESCE(is_active, 1) = 1 AND expires_at > datetime(\'now\')
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

// GET /auth/security/trusted-devices — devices that skip 2FA for 30 days
// (see trustDeviceIfRequested near the top of this file). Backs
// TrustedDevicesList.tsx, which has called this since it shipped — the
// route never existed, so the panel always rendered "No trusted devices"
// regardless of how many times someone checked "Trust this device."
auth.get('/security/trusted-devices', authMiddleware, async (c) => {
  const db = getDb(c.env);
  const rows = await query<any>(
    db,
    `SELECT id, device_name, ip_address, trusted_until, last_used_at, created_at
       FROM trusted_devices
      WHERE user_id = ? AND trusted_until > datetime(\'now\')
      ORDER BY COALESCE(last_used_at, created_at) DESC`,
    c.get('userId'),
  );
  return c.json(rows || []);
});

// DELETE /auth/security/trusted-devices/:id — revoke trust; scoped to
// user_id so a user can only revoke their own devices.
auth.delete('/security/trusted-devices/:id', authMiddleware, async (c) => {
  const db = getDb(c.env);
  await execute(
    db,
    'DELETE FROM trusted_devices WHERE id = ? AND user_id = ?',
    c.req.param('id'),
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
    // Sessions that can still authenticate: active flag + unexpired AND used
    // within the last 7 days (a session's refresh chain dies silently when a
    // device stops using it; counting week-old idle rows inflated the number
    // to 40-70 "active sessions" and read as a compromise indicator).
    const sess = await queryFirst<{ active: number }>(db,
      `SELECT COUNT(*) AS active FROM sessions
        WHERE user_id = ? AND COALESCE(is_active,1) = 1 AND expires_at > datetime(\'now\')
          AND COALESCE(last_used_at, created_at) > datetime('now','-7 days')`,
      userId);
    const last = await queryFirst<{ created_at: string; ip_address: string | null }>(db, 'SELECT created_at, ip_address FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', userId);
    // 2FA + backup-code state — SecurityStatusCard reads totpEnabled /
    // totpSetupRequired / backupCodesRemaining (it rendered
    // "undefined remaining" while these fields were missing).
    const me = await queryFirst<{ totp_enabled: number | null; totp_backup_codes: string | null; must_change_password: number | null }>(
      db, 'SELECT totp_enabled, totp_backup_codes, must_change_password FROM users WHERE id = ?', userId);
    let backupCodesRemaining = 0;
    if (me?.totp_backup_codes) {
      try {
        const parsed = JSON.parse(me.totp_backup_codes);
        backupCodesRemaining = Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        backupCodesRemaining = me.totp_backup_codes.split(',').map((x) => x.trim()).filter(Boolean).length;
      }
    }
    const totpEnabled = !!me?.totp_enabled;
    return c.json({
      // SecurityStatus shape (client/src/types SecurityStatus)
      totpEnabled,
      totpSetupRequired: false,
      backupCodesRemaining,
      activeSessions: sess?.active ?? 0,
      trustedDevices: 0,
      passwordExpiresAt: null,
      passwordExpiringSoon: false,
      passwordExpired: false,
      passwordChangedAt: null,
      forcePasswordChange: !!me?.must_change_password,
      unreadSecurityNotifications: 0,
      // legacy keys kept for any older consumers
      twoFactorEnabled: totpEnabled,
      passwordAge: 0,
      lastLogin: last?.created_at ?? '',
      lastLoginIp: last?.ip_address ?? '',
      accountStatus: 'Active',
    });
  } catch {
    return c.json({ totpEnabled: false, totpSetupRequired: false, backupCodesRemaining: 0, activeSessions: 0, trustedDevices: 0, passwordExpiresAt: null, passwordExpiringSoon: false, passwordExpired: false, passwordChangedAt: null, forcePasswordChange: false, unreadSecurityNotifications: 0, twoFactorEnabled: false, passwordAge: 0, lastLogin: '', lastLoginIp: '', accountStatus: 'Active' });
  }
});

// GET /api/auth/security/recent-threats — failed logins PLUS two
// geo-derived threat types that only became possible once migration 0231
// gave login_attempts real country/city/isp columns:
//   • impossible_travel: the same username logged in successfully from two
//     different countries within a window too short to physically travel
//     between them (a strong compromised-credential signal — the classic
//     "your account was accessed from a new location" alert every major SSO
//     provider ships).
//   • new_country_login: a successful login from a country that user's
//     prior 90 days of successful logins never came from. Noisier than
//     impossible travel (a real trip triggers it) but still worth surfacing
//     — it's an admin dashboard, not an auto-block.
auth.get('/security/recent-threats', async (c) => {
  try {
    const db = getDb(c.env);
    const failedLogins = await query<Record<string, unknown>>(db,
      `SELECT id, 'failed_login' AS type, username, ip_address AS ip, failure_reason AS reason,
              created_at AS timestamp, device_type, browser, os, country, region, city, isp, likely_vpn_or_hosting
         FROM login_attempts WHERE COALESCE(success,0) = 0 ORDER BY created_at DESC LIMIT 50`);

    // Self-join successes to their immediately-prior success for the same
    // username, only where both sides have a country and the countries
    // differ, within a 4-hour window (generous — a same-day domestic flight
    // between distant cities is plausible; a country change inside 4 hours
    // is not for anyone actually present at both logins).
    const impossibleTravel = await query<Record<string, unknown>>(db,
      `SELECT cur.id, 'impossible_travel' AS type, cur.username,
              cur.ip_address AS ip, cur.created_at AS timestamp,
              cur.device_type, cur.browser, cur.os,
              cur.country, cur.city, cur.isp, cur.likely_vpn_or_hosting,
              prev.country AS prev_country, prev.city AS prev_city, prev.created_at AS prev_timestamp,
              CAST((julianday(cur.created_at) - julianday(prev.created_at)) * 1440 AS INTEGER) AS minutes_between
         FROM login_attempts cur
         JOIN login_attempts prev ON prev.username = cur.username
           AND prev.id = (
             SELECT id FROM login_attempts p2
              WHERE p2.username = cur.username AND COALESCE(p2.success,0) = 1 AND p2.id < cur.id
              ORDER BY p2.id DESC LIMIT 1
           )
        WHERE COALESCE(cur.success,0) = 1
          AND cur.country IS NOT NULL AND prev.country IS NOT NULL
          AND cur.country != prev.country
          AND cur.created_at >= datetime('now', '-7 days')
          AND (julianday(cur.created_at) - julianday(prev.created_at)) * 1440 < 240
        ORDER BY cur.created_at DESC LIMIT 25`);

    // New-country logins: successful login from a country not seen in that
    // user's successful logins over the preceding 90 days (excluding itself).
    const newCountryLogins = await query<Record<string, unknown>>(db,
      `SELECT cur.id, 'new_country_login' AS type, cur.username,
              cur.ip_address AS ip, cur.created_at AS timestamp,
              cur.device_type, cur.browser, cur.os, cur.country, cur.city, cur.isp, cur.likely_vpn_or_hosting
         FROM login_attempts cur
        WHERE COALESCE(cur.success,0) = 1
          AND cur.country IS NOT NULL
          AND cur.created_at >= datetime('now', '-7 days')
          AND NOT EXISTS (
            SELECT 1 FROM login_attempts prior
             WHERE prior.username = cur.username AND COALESCE(prior.success,0) = 1
               AND prior.country = cur.country AND prior.id < cur.id
               AND prior.created_at >= datetime(cur.created_at, '-90 days')
          )
          -- Exclude a user's very first-ever successful login — everyone's
          -- first login is definitionally a "new" country and would
          -- otherwise flag 100% of new accounts.
          AND EXISTS (
            SELECT 1 FROM login_attempts prior2
             WHERE prior2.username = cur.username AND COALESCE(prior2.success,0) = 1 AND prior2.id < cur.id
          )
        ORDER BY cur.created_at DESC LIMIT 25`);

    const data = [...(failedLogins || []), ...(impossibleTravel || []), ...(newCountryLogins || [])]
      .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    return c.json({ data });
  } catch (err) {
    console.error('[auth] GET security/recent-threats failed:', err);
    return c.json({ data: [] });
  }
});

// GET /api/auth/security/blocked-ips — IPs with repeated failures (>=5/24h),
// now with the geo/device fingerprint of the most recent failed attempt from
// that IP so an admin can tell "5 failed logins from a residential ISP in
// the same city as the user" (probably a lockout, not an attack) apart from
// "5 failed logins from a datacenter ASN on another continent."
auth.get('/security/blocked-ips', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT la.ip_address, COUNT(*) AS failed_attempts, MAX(la.created_at) AS last_attempt,
              (SELECT country FROM login_attempts WHERE ip_address = la.ip_address AND COALESCE(success,0)=0 ORDER BY id DESC LIMIT 1) AS country,
              (SELECT city FROM login_attempts WHERE ip_address = la.ip_address AND COALESCE(success,0)=0 ORDER BY id DESC LIMIT 1) AS city,
              (SELECT isp FROM login_attempts WHERE ip_address = la.ip_address AND COALESCE(success,0)=0 ORDER BY id DESC LIMIT 1) AS isp,
              (SELECT GROUP_CONCAT(DISTINCT username) FROM login_attempts WHERE ip_address = la.ip_address AND COALESCE(success,0)=0 AND created_at >= datetime('now','-1 day')) AS usernames_tried
         FROM login_attempts la
        WHERE COALESCE(la.success,0) = 0 AND la.ip_address IS NOT NULL AND la.created_at >= datetime('now','-1 day')
        GROUP BY la.ip_address HAVING COUNT(*) >= 5 ORDER BY failed_attempts DESC LIMIT 100`);
    return c.json({ data: rows || [] });
  } catch (err) {
    console.error('[auth] GET security/blocked-ips failed:', err);
    return c.json({ data: [] });
  }
});

// GET /api/auth/security/login-history?limit=&offset= — real history from the
// live login_attempts table (this path was proxy-stubbed empty for months).
// UNION SHAPE for two consumers:
//   • LoginHistoryTable (ProfilePage) reads entries + total — the CALLER's own
//     attempts, paginated.
//   • SecurityDashboardPage reads data — org-wide recent attempts for
//     admin/manager/supervisor, else the caller's own.
// device_type/browser/os/country/region/city/isp are real columns as of
// migration 0231 (recordLoginAttempt populates them via requestGeo.ts +
// userAgent.ts) — this used to hardcode `'' AS user_agent` because neither
// the column nor the capture existed yet.
auth.get('/security/login-history', async (c) => {
  const empty = { entries: [], total: 0, data: [], pagination: { total: 0, totalPages: 0, page: 1, limit: 15 } };
  try {
    const db = getDb(c.env);
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '15', 10) || 15));
    const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0);
    const userId = (c.get('userId') as number | undefined) ?? null;
    if (!userId) return c.json(empty);
    const me = await queryFirst<{ username: string; role: string }>(db, 'SELECT username, role FROM users WHERE id = ?', userId);
    if (!me) return c.json(empty);

    const DETAIL_COLUMNS = [
      'user_agent', 'device_type', 'browser', 'os',
      'country', 'region', 'city', 'postal_code', 'timezone', 'asn', 'isp',
      'http_protocol', 'tls_version', 'likely_vpn_or_hosting', 'device_platform', 'device_platform_version',
    ];

    const mine = await query<Record<string, unknown>>(db,
      `SELECT id, ip_address, ${DETAIL_COLUMNS.join(', ')}, '' AS device_fingerprint,
              COALESCE(success,0) AS success, failure_reason, created_at
       FROM login_attempts WHERE username = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      me.username, limit, offset);
    const total = (await queryFirst<{ c: number }>(db,
      'SELECT COUNT(*) AS c FROM login_attempts WHERE username = ?', me.username))?.c ?? 0;

    const orgWide = ['admin', 'manager', 'supervisor'].includes(me.role);
    const data = await query<Record<string, unknown>>(db,
      `SELECT la.id, u.id AS user_id, la.ip_address, ${DETAIL_COLUMNS.map(col => `la.${col}`).join(', ')},
              COALESCE(la.success,0) AS success, la.failure_reason AS reason,
              la.created_at, COALESCE(u.full_name, la.username) AS full_name
       FROM login_attempts la LEFT JOIN users u ON u.username = la.username
       ${orgWide ? '' : 'WHERE la.username = ?'}
       ORDER BY la.created_at DESC LIMIT 50`,
      ...(orgWide ? [] : [me.username]));

    return c.json({
      entries: mine, total, data,
      pagination: { total, totalPages: Math.max(1, Math.ceil(total / limit)), page: Math.floor(offset / limit) + 1, limit },
    });
  } catch { return c.json(empty); }
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
      `SELECT id, CASE WHEN COALESCE(success,0)=1 THEN 'login' ELSE 'failed_login' END AS event,
              username, ip_address AS ip, failure_reason AS reason, created_at AS timestamp,
              device_type, browser, os, country, region, city, isp, likely_vpn_or_hosting
         FROM login_attempts ORDER BY created_at DESC LIMIT ?`, limit);
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
      `UPDATE users SET profile_image = ?, updated_at = datetime(\'now\') WHERE id = ?`,
      profile_image || null, userId,
    );
    return c.json({ success: true, profile_image: profile_image || null });
  } catch (err) {
    console.error('Save profile-image error:', err);
    return c.json({ error: 'Failed to save profile image', code: 'SAVE_PROFILE_IMAGE_ERROR' }, 500);
  }
});

// ── Signature (UserProfileModal) ──────────────────────────
auth.get('/signature', authMiddleware, async (c) => {
  try {
    const db = getDb(c.env);
    const row = await queryFirst<{ digital_signature: string | null }>(db,
      'SELECT digital_signature FROM users WHERE id = ?', c.get('userId'));
    return c.json({ signature: row?.digital_signature || null });
  } catch { return c.json({ signature: null }); }
});

auth.put('/signature', authMiddleware, async (c) => {
  try {
    const { signature } = await c.req.json<{ signature?: string | null }>();
    if (signature && typeof signature === 'string' && signature.length > 500_000) {
      return c.json({ error: 'Signature too large' }, 413);
    }
    const db = getDb(c.env);
    await execute(db,
      `UPDATE users SET digital_signature = ?, updated_at = datetime(\'now\') WHERE id = ?`,
      signature || null, c.get('userId'));
    return c.json({ success: true });
  } catch (err) {
    log.error('PUT /signature failed', { src: 'src/routes/auth.ts' }, err); return c.json({ error: 'Failed to save signature' }, 500); }
});

// ── 2FA / TOTP stubs (not yet ported from legacy) ─────────
// ── TOTP enrollment (real — replaces the MFA_NOT_PORTED 501 stubs) ──
// Two client surfaces share these flows with slightly different field names:
//   UserProfileModal:        POST /totp/setup → { qrCodeDataUrl?, otpauthUrl,
//                            manualKey }; /totp/verify-setup { code } →
//                            { backupCodes }; /totp/disable { password }.
//   TwoFactorSetupWizard:    POST /2fa/setup → { qrCodeDataUri?, otpauthUrl,
//                            manualKey }; /2fa/setup/verify { token } →
//                            { backupCodes }.
// The QR image is rendered CLIENT-side from otpauthUrl (qrcode npm pkg is
// already in the client bundle) — generating a PNG in the Worker would mean
// vendoring a QR encoder for no gain.

async function startTotpSetup(c: any) {
  const db = getDb(c.env);
  const userId = c.get('userId');
  const me = await queryFirst<{ username: string; totp_enabled: number | null }>(
    db, 'SELECT username, totp_enabled FROM users WHERE id = ?', userId);
  if (!me) return c.json({ error: 'User not found' }, 404);
  if (me.totp_enabled) {
    return c.json({ error: 'Two-factor authentication is already enabled. Disable it before re-enrolling.', code: 'ALREADY_ENABLED' }, 400);
  }
  const secret = generateTotpSecret();
  await execute(db, 'UPDATE users SET totp_pending_secret = ? WHERE id = ?', secret, userId);
  const otpauthUrl = buildOtpauthUrl(secret, me.username);
  // manualKey grouped in 4s for typing into an authenticator by hand.
  const manualKey = secret.replace(/(.{4})/g, '$1 ').trim();
  return c.json({ otpauthUrl, manualKey, secret, qrCodeDataUrl: null, qrCodeDataUri: null });
}

async function verifyTotpSetup(c: any) {
  const db = getDb(c.env);
  const userId = c.get('userId');
  const body = (await c.req.json().catch(() => ({}))) as { code?: string; token?: string };
  const code = body.code ?? body.token ?? '';
  const me = await queryFirst<{ totp_pending_secret: string | null }>(
    db, 'SELECT totp_pending_secret FROM users WHERE id = ?', userId);
  if (!me?.totp_pending_secret) {
    return c.json({ error: 'No pending 2FA setup — start setup first.', code: 'NO_PENDING_SETUP' }, 400);
  }
  if (!(await verifyTotpCode(me.totp_pending_secret, code))) {
    return c.json({ error: 'Invalid verification code. Wait for a new code and try again.', code: 'INVALID_CODE' }, 400);
  }
  const enc = await encryptTotpSecret(me.totp_pending_secret, c.env.JWT_SECRET);
  const codes = generateBackupCodes(10);
  const hashes = await Promise.all(codes.map(hashBackupCode));
  await execute(db,
    `UPDATE users SET totp_enabled = 1, totp_secret_enc = ?, totp_pending_secret = NULL,
            totp_backup_codes = ? WHERE id = ?`,
    enc, JSON.stringify(hashes), userId);
  try {
    await recordAudit(c, { action: 'totp_enabled', entityType: 'user', entityId: userId, details: 'Two-factor authentication enabled', actorId: userId });
  } catch { /* non-fatal */ }
  return c.json({ success: true, backupCodes: codes });
}

auth.post('/totp/setup', authMiddleware, startTotpSetup);
auth.post('/2fa/setup', authMiddleware, startTotpSetup);
auth.post('/totp/verify-setup', authMiddleware, verifyTotpSetup);
auth.post('/2fa/setup/verify', authMiddleware, verifyTotpSetup);

// POST /totp/disable { password } — password-confirmed disable.
auth.post('/totp/disable', authMiddleware, async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId');
    const { password } = await c.req.json<{ password?: string }>().catch(() => ({} as any));
    const me = await queryFirst<{ password_hash: string }>(
      db, 'SELECT password_hash FROM users WHERE id = ?', userId);
    if (!me || !password || !compareSync(password, me.password_hash)) {
      return c.json({ error: 'Incorrect password', code: 'INVALID_PASSWORD' }, 401);
    }
    await execute(db,
      `UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL,
              totp_pending_secret = NULL, totp_backup_codes = NULL WHERE id = ?`,
      userId);
    try {
      await recordAudit(c, { action: 'totp_disabled', entityType: 'user', entityId: userId, details: 'Two-factor authentication disabled', actorId: userId });
    } catch { /* non-fatal */ }
    return c.json({ success: true });
  } catch (err) {
    console.error('totp/disable failed:', err);
    return c.json({ error: 'Failed to disable 2FA' }, 500);
  }
});

// POST /2fa/backup-codes/regenerate { password } → fresh set of 10 codes.
auth.post('/2fa/backup-codes/regenerate', authMiddleware, async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId');
    const { password } = await c.req.json<{ password?: string }>().catch(() => ({} as any));
    const me = await queryFirst<{ password_hash: string; totp_enabled: number | null }>(
      db, 'SELECT password_hash, totp_enabled FROM users WHERE id = ?', userId);
    if (!me || !password || !compareSync(password, me.password_hash)) {
      return c.json({ error: 'Incorrect password', code: 'INVALID_PASSWORD' }, 401);
    }
    if (!me.totp_enabled) {
      return c.json({ error: 'Two-factor authentication is not enabled.', code: 'NOT_ENABLED' }, 400);
    }
    const codes = generateBackupCodes(10);
    const hashes = await Promise.all(codes.map(hashBackupCode));
    await execute(db, 'UPDATE users SET totp_backup_codes = ? WHERE id = ?', JSON.stringify(hashes), userId);
    return c.json({ success: true, backupCodes: codes });
  } catch (err) {
    console.error('backup-codes/regenerate failed:', err);
    return c.json({ error: 'Failed to regenerate backup codes' }, 500);
  }
});

// ════════════════════════════════════════════════════════════
// WebAuthn / Security keys (YubiKey, Touch ID, Windows Hello)
// ════════════════════════════════════════════════════════════
// Port of legacy/server-vps/src/routes/webauthn.ts onto Workers:
// @simplewebauthn/server v13 (pure WebCrypto — Workers-compatible),
// challenges in KV (5-min TTL) instead of the legacy in-memory Map,
// credentials in `webauthn_credentials` (migration 0090; also created
// directly on live D1). Client: SecurityKeyManager.tsx (registration)
// + AuthContext.verifyWebAuthn (2FA login) — contracts unchanged.

const WEBAUTHN_CHALLENGE_PREFIX = 'webauthn-challenge:';
const WEBAUTHN_CHALLENGE_TTL = 300; // 5 min, matches legacy
const WEBAUTHN_RP_NAME = 'RMPG Flex';

// rpID/origin: prod is rmpgutah.us (rpID covers www.); local dev is the
// Vite server on localhost. Derived from the request Origin header so a
// registration made from www. and a login from the apex both verify.
function webauthnRp(c: any): { rpID: string; origins: string[] } {
  const origin = c.req.header('Origin') || '';
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) {
    return { rpID: 'localhost', origins: [origin] };
  }
  return { rpID: 'rmpgutah.us', origins: ['https://rmpgutah.us', 'https://www.rmpgutah.us'] };
}

function parseWebauthnTransports(json: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!json) return undefined;
  try {
    const arr = JSON.parse(json) as AuthenticatorTransportFuture[];
    return arr.length > 0 ? arr : undefined;
  } catch { return undefined; }
}

async function getWebauthnCredentials(db: any, userId: number): Promise<Array<{
  id: number; credential_id: string; public_key: string; counter: number;
  transports: string | null; name: string; device_type: string;
  backed_up: number; created_at: string; last_used_at: string | null;
}>> {
  try {
    return await query(db,
      `SELECT id, credential_id, public_key, counter, transports, name,
              device_type, backed_up, created_at, last_used_at
         FROM webauthn_credentials WHERE user_id = ?`, userId);
  } catch { return []; } // table may be absent on local DBs pre-0090
}

// Resolve the acting user for the registration-side endpoints.
const webauthnUserId = (c: any): number => Number(c.get('userId'));

// ── GET /webauthn/status ─────────────────────────────────────
auth.get('/webauthn/status', authMiddleware, async (c) => {
  try {
    const creds = await getWebauthnCredentials(getDb(c.env), webauthnUserId(c));
    return c.json({ enabled: creds.length > 0, credentialCount: creds.length, supported: true });
  } catch (err) {
    console.error('webauthn/status failed:', err);
    return c.json({ enabled: false, credentialCount: 0, supported: true });
  }
});

// ── GET /webauthn/credentials ────────────────────────────────
auth.get('/webauthn/credentials', authMiddleware, async (c) => {
  try {
    const creds = await getWebauthnCredentials(getDb(c.env), webauthnUserId(c));
    return c.json(creds.map((cr) => ({
      id: cr.id,
      name: cr.name,
      deviceType: cr.device_type,
      backedUp: !!cr.backed_up,
      transports: parseWebauthnTransports(cr.transports) || [],
      createdAt: cr.created_at,
      lastUsedAt: cr.last_used_at,
    })));
  } catch (err) {
    console.error('webauthn/credentials failed:', err);
    return c.json({ error: 'Failed to list security keys', code: 'WEBAUTHN_LIST_ERROR' }, 500);
  }
});

// ── POST /webauthn/register-options ──────────────────────────
auth.post('/webauthn/register-options', authMiddleware, async (c) => {
  try {
    const db = getDb(c.env);
    const userId = webauthnUserId(c);
    const user = await queryFirst<{ id: number; username: string; full_name: string | null }>(
      db, 'SELECT id, username, full_name FROM users WHERE id = ?', userId);
    if (!user) return c.json({ error: 'User not found', code: 'USER_NOT_FOUND' }, 404);

    const existing = await getWebauthnCredentials(db, userId);
    const { rpID } = webauthnRp(c);
    const options = await generateRegistrationOptions({
      rpName: WEBAUTHN_RP_NAME,
      rpID,
      userName: user.username,
      userDisplayName: user.full_name || user.username,
      attestationType: 'none',
      excludeCredentials: existing.map((cr) => ({
        id: cr.credential_id,
        transports: parseWebauthnTransports(cr.transports),
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    const idBytes = crypto.getRandomValues(new Uint8Array(16));
    const challengeId = Array.from(idBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    await c.env.KV.put(
      `${WEBAUTHN_CHALLENGE_PREFIX}${challengeId}`,
      JSON.stringify({ challenge: options.challenge, userId }),
      { expirationTtl: WEBAUTHN_CHALLENGE_TTL },
    );
    return c.json({ options, challengeId });
  } catch (err) {
    console.error('webauthn/register-options failed:', err);
    return c.json({ error: 'Failed to start security key registration', code: 'WEBAUTHN_REGISTEROPTIONS_ERROR' }, 500);
  }
});

// ── POST /webauthn/register-verify ───────────────────────────
auth.post('/webauthn/register-verify', authMiddleware, async (c) => {
  try {
    const body = await c.req.json<{
      challengeId?: string; response?: RegistrationResponseJSON; name?: string;
    }>().catch(() => null);
    if (!body?.challengeId || !body.response) {
      return c.json({ error: 'Missing challengeId or response', code: 'MISSING_CHALLENGEID_OR_RESPONSE' }, 400);
    }
    if (typeof body.challengeId !== 'string' || body.challengeId.length > 64 || !/^[a-f0-9]+$/.test(body.challengeId)) {
      return c.json({ error: 'Invalid challengeId format', code: 'INVALID_CHALLENGEID_FORMAT' }, 400);
    }
    if (body.name != null && (typeof body.name !== 'string' || body.name.length > 100)) {
      return c.json({ error: 'Security key name must be 100 characters or less', code: 'SECURITY_KEY_NAME_TOO_LONG' }, 400);
    }

    const key = `${WEBAUTHN_CHALLENGE_PREFIX}${body.challengeId}`;
    const storedRaw = await c.env.KV.get(key);
    if (!storedRaw) return c.json({ error: 'Challenge expired. Please try again.', code: 'CHALLENGE_EXPIRED' }, 400);
    const stored = JSON.parse(storedRaw) as { challenge: string; userId: number };
    const userId = webauthnUserId(c);
    if (stored.userId !== userId) return c.json({ error: 'Challenge mismatch', code: 'CHALLENGE_MISMATCH' }, 403);

    const { rpID, origins } = webauthnRp(c);
    const verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: stored.challenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      requireUserVerification: false, // UV is 'preferred' — some keys skip it
    });
    await c.env.KV.delete(key).catch(() => undefined);

    if (!verification.verified || !verification.registrationInfo) {
      return c.json({ error: 'Verification failed. Please try again.', code: 'VERIFICATION_FAILED' }, 400);
    }
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    const db = getDb(c.env);
    const credName = body.name?.trim() || 'Security Key';
    const result = await execute(db, `
      INSERT INTO webauthn_credentials
        (user_id, credential_id, public_key, counter, device_type, backed_up, transports, name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `,
      userId,
      credential.id, // Base64URLString already
      isoBase64URL.fromBuffer(credential.publicKey),
      credential.counter,
      credentialDeviceType,
      credentialBackedUp ? 1 : 0,
      credential.transports && credential.transports.length > 0 ? JSON.stringify(credential.transports) : null,
      credName,
    );

    // A security key counts as 2FA enabled (matches legacy behavior).
    await execute(db, 'UPDATE users SET totp_enabled = 1 WHERE id = ?', userId).catch(() => undefined);

    return c.json({
      success: true,
      credential: {
        id: result.meta?.last_row_id ?? 0,
        name: credName,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
      },
    });
  } catch (err) {
    console.error('webauthn/register-verify failed:', err);
    return c.json({ error: 'Failed to register security key', code: 'WEBAUTHN_REGISTERVERIFY_ERROR' }, 500);
  }
});

// ── DELETE /webauthn/credentials/:id ─────────────────────────
auth.delete('/webauthn/credentials/:id{[0-9]+}', authMiddleware, async (c) => {
  try {
    const db = getDb(c.env);
    const userId = webauthnUserId(c);
    const credId = Number(c.req.param('id'));
    const cred = await queryFirst<{ id: number; name: string }>(
      db, 'SELECT id, name FROM webauthn_credentials WHERE id = ? AND user_id = ?', credId, userId);
    if (!cred) return c.json({ error: 'Credential not found', code: 'CREDENTIAL_NOT_FOUND' }, 404);
    await execute(db, 'DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?', credId, userId);

    // If no keys remain AND no TOTP secret, drop the 2FA flag (legacy parity).
    const remaining = await queryFirst<{ n: number }>(
      db, 'SELECT COUNT(*) AS n FROM webauthn_credentials WHERE user_id = ?', userId);
    const totp = await queryFirst<{ totp_secret_enc: string | null }>(
      db, 'SELECT totp_secret_enc FROM users WHERE id = ?', userId).catch(() => null);
    if ((remaining?.n ?? 0) === 0 && !totp?.totp_secret_enc) {
      await execute(db, 'UPDATE users SET totp_enabled = 0 WHERE id = ?', userId).catch(() => undefined);
    }
    return c.json({ message: 'Security key removed' });
  } catch (err) {
    console.error('webauthn delete credential failed:', err);
    return c.json({ error: 'Failed to remove security key', code: 'WEBAUTHN_DELETE_ERROR' }, 500);
  }
});

// ── POST /webauthn/authenticate-options ──────────────────────
// 2FA step during login — accepts the pending-2FA tempToken in the body
// (NOT authMiddleware-gated: the user has no session yet).
auth.post('/webauthn/authenticate-options', async (c) => {
  try {
    const db = getDb(c.env);
    const resolved = await resolve2faPending(c, db);
    if ('error' in resolved) return resolved.error;
    const userId = resolved.user.id as number;

    const creds = await getWebauthnCredentials(db, userId);
    if (creds.length === 0) {
      return c.json({ error: 'No security keys registered', hasSecurityKeys: false }, 400);
    }
    const { rpID } = webauthnRp(c);
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: creds.map((cr) => ({
        id: cr.credential_id,
        transports: parseWebauthnTransports(cr.transports),
      })),
      userVerification: 'preferred',
    });

    const idBytes = crypto.getRandomValues(new Uint8Array(16));
    const challengeId = Array.from(idBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    await c.env.KV.put(
      `${WEBAUTHN_CHALLENGE_PREFIX}${challengeId}`,
      JSON.stringify({ challenge: options.challenge, userId }),
      { expirationTtl: WEBAUTHN_CHALLENGE_TTL },
    );
    return c.json({ options, challengeId, hasSecurityKeys: true });
  } catch (err) {
    console.error('webauthn/authenticate-options failed:', err);
    return c.json({ error: 'Failed to start security key verification', code: 'WEBAUTHN_AUTHENTICATEOPTIONS_ERROR' }, 500);
  }
});

// ── POST /webauthn/authenticate-verify ───────────────────────
// Completes 2FA via security key → full login tokens (same contract as
// /login/verify-2fa; AuthContext.verifyWebAuthn consumes it).
auth.post('/webauthn/authenticate-verify', async (c) => {
  try {
    const db = getDb(c.env);
    const resolved = await resolve2faPending(c, db);
    if ('error' in resolved) return resolved.error;
    const { user, body } = resolved;
    if (!body?.challengeId || !body.response) {
      return c.json({ error: 'Missing required fields', code: 'MISSING_REQUIRED_FIELDS' }, 400);
    }
    if (typeof body.challengeId !== 'string' || body.challengeId.length > 64 || !/^[a-f0-9]+$/.test(body.challengeId)) {
      return c.json({ error: 'Invalid challengeId format', code: 'INVALID_CHALLENGEID_FORMAT' }, 400);
    }

    const key = `${WEBAUTHN_CHALLENGE_PREFIX}${body.challengeId}`;
    const storedRaw = await c.env.KV.get(key);
    if (!storedRaw) return c.json({ error: 'Challenge expired. Please try again.', code: 'CHALLENGE_EXPIRED' }, 400);
    const stored = JSON.parse(storedRaw) as { challenge: string; userId: number };
    if (stored.userId !== user.id) return c.json({ error: 'Challenge mismatch', code: 'CHALLENGE_MISMATCH' }, 403);

    const cred = await queryFirst<{
      id: number; credential_id: string; public_key: string; counter: number; transports: string | null;
    }>(db,
      'SELECT id, credential_id, public_key, counter, transports FROM webauthn_credentials WHERE credential_id = ? AND user_id = ?',
      body.response.id, user.id);
    if (!cred) return c.json({ error: 'Security key not recognized', code: 'SECURITY_KEY_NOT_RECOGNIZED' }, 400);

    const { rpID, origins } = webauthnRp(c);
    const verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: stored.challenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: cred.credential_id,
        publicKey: isoBase64URL.toBuffer(cred.public_key),
        counter: cred.counter,
        transports: parseWebauthnTransports(cred.transports),
      },
    });
    await c.env.KV.delete(key).catch(() => undefined);

    if (!verification.verified) {
      return c.json({ error: 'Security key verification failed', code: 'SECURITY_KEY_VERIFICATION_FAILED' }, 401);
    }
    await execute(db,
      `UPDATE webauthn_credentials SET counter = ?, last_used_at = datetime(\'now\') WHERE id = ?`,
      verification.authenticationInfo.newCounter, cred.id).catch(() => undefined);
    await trustDeviceIfRequested(c, db, user.id, body.deviceFingerprint, body.trustDevice);

    return issueLoginTokens(c, db, user);
  } catch (err) {
    console.error('webauthn/authenticate-verify failed:', err);
    return c.json({ error: 'Failed to verify security key', code: 'WEBAUTHN_AUTHENTICATEVERIFY_ERROR' }, 500);
  }
});

// ── Security: unblock IP ───────────────────────────────────
auth.post('/security/unblock-ip', authMiddleware, async (c) => {
  const user = c.get('user') as { role: string } | undefined;
  if (!user || !['admin', 'manager'].includes(user.role)) return c.json({ error: 'Insufficient role' }, 403);
  try {
    const { ip } = await c.req.json<{ ip: string }>();
    if (!ip) return c.json({ error: 'ip required' }, 400);
    const db = getDb(c.env);
    const r = await execute(db,
      `DELETE FROM login_attempts WHERE ip_address = ? AND COALESCE(success, 0) = 0`, ip);
    return c.json({ success: true, cleared: r.meta.changes ?? 0 });
  } catch (err) {
    log.error('POST /security/unblock-ip failed', { src: 'src/routes/auth.ts' }, err); return c.json({ error: 'Failed to unblock IP' }, 500); }
});

// GET /api/auth/security/locked-accounts — accounts currently locked out.
auth.get('/security/locked-accounts', async (c) => {
  const user = c.get('user') as { role: string } | undefined;
  if (!user || !['admin', 'manager'].includes(user.role)) return c.json({ error: 'Insufficient role' }, 403);
  try {
    const db = getDb(c.env);
    await ensureAccountLockoutColumns(db);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT id, username, full_name, failed_login_count, locked_until
       FROM users WHERE locked_until IS NOT NULL AND locked_until > datetime(\'now\')
       ORDER BY locked_until DESC LIMIT 100`);
    return c.json({ data: rows || [] });
  } catch {
    return c.json({ data: [] });
  }
});

// ── Security: unlock account ────────────────────────────────
// Break-glass note: if every admin/manager account is locked simultaneously
// (e.g. an attacker deliberately trips 5 wrong passwords against each one),
// this endpoint itself becomes unreachable until the 15-minute auto-expiry
// lifts (self-healing). The out-of-band fallback is POST /auth/recover-all
// (RECOVERY_KEY-gated, see that handler's comment) or a direct D1 write.
auth.post('/security/unlock-account', authMiddleware, async (c) => {
  const user = c.get('user') as { role: string } | undefined;
  if (!user || !['admin', 'manager'].includes(user.role)) return c.json({ error: 'Insufficient role' }, 403);
  try {
    const { username } = await c.req.json<{ username: string }>();
    if (!username) return c.json({ error: 'username required' }, 400);
    const db = getDb(c.env);
    await ensureAccountLockoutColumns(db);
    const r = await execute(db,
      `UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE username = ?`, username);
    return c.json({ success: true, cleared: r.meta.changes ?? 0 });
  } catch (err) {
    log.error('POST /security/unlock-account failed', { src: 'src/routes/auth.ts' }, err); return c.json({ error: 'Failed to unlock account' }, 500); }
});

// ── Account recovery (no JWT required — secured by RECOVERY_KEY env secret) ──
// POST /auth/recover-all — reset every active user's password to a known
// temporary password. Use when login is broken for everyone. Authenticated via
// X-Recovery-Key header matching the RECOVERY_KEY secret (set via
// `wrangler secret put RECOVERY_KEY`). Every user gets must_change_password=1
// so they are forced to rotate on next login.
auth.post('/recover-all', async (c) => {
  try {
    const recoveryKey = c.req.header('X-Recovery-Key');
    const storedKey = c.env.RECOVERY_KEY;
    if (!storedKey) {
      return c.json({ error: 'RECOVERY_KEY secret not set. Run: wrangler secret put RECOVERY_KEY' }, 503);
    }
    if (!recoveryKey || recoveryKey !== storedKey) {
      return c.json({ error: 'Invalid or missing X-Recovery-Key header' }, 401);
    }

    const TEMP_PASSWORD = 'TempPass123!';
    const hash = hashSync(TEMP_PASSWORD, 12);

    const db = getDb(c.env);
    const users = await query<{ id: number; username: string }>(
      db,
      "SELECT id, username FROM users WHERE status = 'active'"
    );

    if (!users.length) {
      return c.json({ error: 'No active users found' }, 404);
    }

    await execute(
      db,
      `UPDATE users SET password_hash = ?, must_change_password = 1,
       password_changed_at = datetime('now'), updated_at = datetime('now')
       WHERE status = 'active'`,
      hash
    );

    return c.json({
      success: true,
      message: `Recovered ${users.length} active account(s)`,
      tempPassword: TEMP_PASSWORD,
      mustChangePassword: true,
      users: users.map((u) => ({ id: u.id, username: u.username })),
    });
  } catch (err) {
    console.error('POST /auth/recover-all failed:', err);
    return dbErrorResponse(c, err, 'Failed to recover accounts');
  }
});

// ── GET /auth/users/list — public user picker for the FlexOS login screen ──
// Returns display-safe fields only (no password hashes, no secrets).
// Auth is intentionally NOT required — the login screen calls this before
// a session exists. Only active accounts are returned; suspended/inactive
// accounts are excluded so they don't appear on the picker.
auth.get('/users/list', async (c) => {
  try {
    const db = c.env.DB;
    const rows = await db
      .prepare(
        `SELECT id, username, first_name, last_name, badge_number, role
         FROM users
         WHERE status = 'active'
         ORDER BY last_name ASC, first_name ASC
         LIMIT 50`
      )
      .all<{ id: number; username: string; first_name: string; last_name: string; badge_number: string | null; role: string }>();
    return c.json({ users: rows.results ?? [] });
  } catch (err) {
    console.error('GET /auth/users/list failed:', err);
    return c.json({ users: [] }, 500);
  }
});

export default auth;
