// ============================================================
// RMPG Flex — "Sign in with Dialer" OIDC SSO
// ============================================================
// Mounted at /api/oidc (auth: 'public' — mirrors emailOauthCallback.ts:
// the browser is mid-redirect from dialer.rmpgutah.us with no Authorization
// header or app cookie, so this route can't sit behind authMiddleware).
// isPublicAuthBypass() in src/middleware/auth.ts already exempts every path
// ending in /oauth/callback; /dialer/callback below doesn't match that
// literal suffix so this router is registered with auth:'public' instead
// (see routesConfig.ts) rather than relying on the bypass string match.
//
// Flow:
//   GET  /api/oidc/dialer/check     Identifier-first probe from LoginPage.tsx
//                                   (fetch, not a redirect): does this email
//                                   belong to an active dialer-linked account?
//                                   Answers a bare {ssoEnabled:boolean}.
//   GET  /api/oidc/dialer/login     Browser hits this directly (not fetch —
//                                   it's a full-page redirect chain). Builds
//                                   the authorization_endpoint URL, stashes a
//                                   CSRF `state` in KV, redirects.
//   GET  /api/oidc/dialer/callback  Dialer redirects back with ?code&state.
//                                   Verifies state, exchanges code for tokens
//                                   at token_endpoint, verifies the id_token
//                                   against the dialer's JWKS, links/finds the
//                                   Flex user by dialer_oidc_sub, mints a full
//                                   Flex session via mintLoginTokens(), and
//                                   redirects the browser to the SPA with the
//                                   tokens in the URL FRAGMENT (never the
//                                   query string — fragments aren't sent to
//                                   the server or logged by Cloudflare/nginx).
//
// Account linking policy: this does NOT auto-create Flex users. A dialer
// identity must already be linked to an existing `users` row (via
// dialer_oidc_sub, set once by an admin — no self-service linking endpoint
// yet) or the callback fails closed with an error redirect. Auto-provisioning
// CAD/RMS accounts from an external IdP with no role assigned is a bigger
// policy decision than this PR — see CLAUDE.md Security section on roles.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getDb, queryFirst, execute, ensureDialerOidcColumns } from '../utils/db';
import { mintLoginTokens, USER_SELECT } from './auth';
import { log } from '../utils/logger';

const oidc = new Hono<Env>();

const STATE_TTL_SECONDS = 300; // 5 minutes — matches the 2fa_pending token TTL convention

interface DiscoveryDoc {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}

// Discovery doc + JWKS rarely change — cache in KV for an hour rather than
// fetching dialer.rmpgutah.us/.well-known on every login. KV fails open to a
// live fetch on miss/error, never blocks login on a cache problem.
async function getDiscoveryDoc(env: Env['Bindings']): Promise<DiscoveryDoc> {
  const cacheKey = 'oidc:dialer:discovery';
  try {
    const cached = await env.KV.get(cacheKey, 'json');
    if (cached) return cached as DiscoveryDoc;
  } catch { /* fall through to live fetch */ }

  const issuerUrl = env.DIALER_OIDC_ISSUER as string | undefined;
  if (!issuerUrl) {
    throw new Error('DIALER_OIDC_ISSUER is not configured');
  }
  const res = await fetch(issuerUrl);
  if (!res.ok) {
    throw new Error(`Discovery fetch failed: HTTP ${res.status}`);
  }
  const doc = await res.json<DiscoveryDoc>();
  try {
    await env.KV.put(cacheKey, JSON.stringify(doc), { expirationTtl: 3600 });
  } catch { /* best-effort cache write */ }
  return doc;
}

function backToLogin(appOrigin: string, status: 'error', message: string) {
  const params = new URLSearchParams({ sso: 'dialer', status, message });
  return Response.redirect(`${appOrigin}/login?${params}`, 302);
}

// ── GET /dialer/check?email=… ──────────────────────────────────────────────
// Identifier-first SSO probe. LoginPage.tsx asks this before rendering the
// password field: if the typed identifier belongs to an active, dialer-linked
// account, the SPA skips the password step and redirects into
// /dialer/login instead. This endpoint was called by the client from day one
// but never existed — every "Continue" click produced a console 404 and the
// probe silently fell through to the password field, so SSO users could never
// actually be routed into SSO.
//
// Enumeration posture: any identifier-first SSO flow necessarily reveals that
// an identifier is SSO-enabled (Google and Microsoft both do). Kept as tight
// as the feature allows — a bare boolean, nothing echoed back, only ACTIVE
// linked accounts count, non-SSO and unknown identifiers are indistinguishable
// (both `false`), and a KV counter caps probes per client IP so the endpoint
// can't be walked through an address list. Never reports whether an account
// exists when it isn't SSO-linked.
// The SPA calls this on each identifier-first keystroke (debounced); 20/min
// was easily exhausted during normal typing, producing Cloudflare-level 429s
// because the probe volume triggered the zone rate limit before the Worker
// could respond with its own graceful { ssoEnabled: false }. Raised 2026-08-15.
const CHECK_PROBES_PER_MINUTE = 60;

async function overCheckProbeLimit(env: Env['Bindings'], ip: string, nowMs: number): Promise<boolean> {
  const key = `oidc:dialer:check:${ip}:${Math.floor(nowMs / 60_000)}`;
  try {
    const raw = await env.KV.get(key);
    const count = raw ? parseInt(raw, 10) || 0 : 0;
    if (count >= CHECK_PROBES_PER_MINUTE) return true;
    await env.KV.put(key, String(count + 1), { expirationTtl: 120 });
  } catch { /* KV unavailable — fail open, the probe is a boolean either way */ }
  return false;
}

oidc.get('/dialer/check', async (c) => {
  const env = c.env as Env['Bindings'];
  // Not configured → a plain `false`, not a 503: the SPA's only question is
  // "should I skip the password field", and the answer is no.
  if (!env.DIALER_OIDC_ISSUER || !env.DIALER_OIDC_CLIENT_ID) {
    return c.json({ ssoEnabled: false });
  }

  const email = (c.req.query('email') || '').trim().toLowerCase();
  if (!email || email.length > 254) return c.json({ ssoEnabled: false });

  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  if (await overCheckProbeLimit(env, ip, Date.now())) {
    return c.json({ ssoEnabled: false });
  }

  try {
    const db = getDb(env);
    await ensureDialerOidcColumns(db);
    const row = await queryFirst<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM users
        WHERE LOWER(email) = ? AND status = 'active' AND dialer_oidc_sub IS NOT NULL`,
      email,
    );
    return c.json({ ssoEnabled: (row?.n ?? 0) > 0 });
  } catch (err) {
    // A lookup failure must not block login — the SPA falls through to the
    // password field on `false`, which is the correct degraded behaviour.
    log.error('[oidc] dialer SSO check failed', { traceId: c.get('traceId') }, err as Error);
    return c.json({ ssoEnabled: false });
  }
});

oidc.get('/dialer/login', async (c) => {
  const env = c.env as Env['Bindings'];
  const appOrigin = env.APP_ORIGIN || new URL(c.req.url).origin;
  const clientId = env.DIALER_OIDC_CLIENT_ID as string | undefined;
  const redirectUri = env.DIALER_OIDC_REDIRECT_URI as string | undefined;
  if (!clientId || !redirectUri || !env.DIALER_OIDC_ISSUER) {
    return backToLogin(appOrigin, 'error', 'Dialer SSO is not configured');
  }

  let discovery: DiscoveryDoc;
  try {
    discovery = await getDiscoveryDoc(env);
  } catch (err) {
    log.error('[oidc] discovery fetch failed', { traceId: c.get('traceId') }, err as Error);
    return backToLogin(appOrigin, 'error', 'Dialer SSO is temporarily unavailable');
  }

  // Random CSRF state, single-use, KV-backed (mirrors the 2fa_pending TTL
  // pattern in auth.ts, just KV instead of a signed JWT since there's no
  // user identity to bind yet at this point in the flow). The nonce is
  // bound to this same state entry so the id_token returned in the
  // callback can be proven to belong to this exact browser-initiated
  // request (prevents id_token replay).
  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  await env.KV.put(`oidc:dialer:state:${state}`, JSON.stringify({ nonce }), { expirationTtl: STATE_TTL_SECONDS });

  const authUrl = new URL(discovery.authorization_endpoint);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid profile email');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('nonce', nonce);
  return c.redirect(authUrl.toString(), 302);
});

oidc.get('/dialer/callback', async (c) => {
  const env = c.env as Env['Bindings'];
  const appOrigin = env.APP_ORIGIN || new URL(c.req.url).origin;
  const code = c.req.query('code');
  const state = c.req.query('state');
  const errParam = c.req.query('error');
  if (errParam) return backToLogin(appOrigin, 'error', c.req.query('error_description') || errParam);
  if (!code || !state) return backToLogin(appOrigin, 'error', 'Missing authorization code or state');

  const stateKey = `oidc:dialer:state:${state}`;
  const stateValid = await env.KV.get(stateKey);
  if (!stateValid) return backToLogin(appOrigin, 'error', 'Sign-in session expired — please try again');
  await env.KV.delete(stateKey); // single-use
  let expectedNonce: string | undefined;
  try {
    expectedNonce = (JSON.parse(stateValid) as { nonce?: string }).nonce;
  } catch { /* legacy state entries without a nonce fail closed below */ }
  if (!expectedNonce) return backToLogin(appOrigin, 'error', 'Sign-in session expired — please try again');

  const clientId = env.DIALER_OIDC_CLIENT_ID as string | undefined;
  const clientSecret = env.DIALER_OIDC_CLIENT_SECRET as string | undefined;
  const redirectUri = env.DIALER_OIDC_REDIRECT_URI as string | undefined;
  if (!clientId || !clientSecret || !redirectUri) {
    return backToLogin(appOrigin, 'error', 'Dialer SSO is not configured');
  }

  let discovery: DiscoveryDoc;
  try {
    discovery = await getDiscoveryDoc(env);
  } catch (err) {
    log.error('[oidc] discovery fetch failed', { traceId: c.get('traceId') }, err as Error);
    return backToLogin(appOrigin, 'error', 'Dialer SSO is temporarily unavailable');
  }

  let idToken: string;
  try {
    const tokenRes = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!tokenRes.ok) {
      log.error('[oidc] token exchange failed', { traceId: c.get('traceId'), status: tokenRes.status });
      return backToLogin(appOrigin, 'error', 'Token exchange failed');
    }
    const tok = await tokenRes.json<{ id_token?: string }>();
    if (!tok.id_token) return backToLogin(appOrigin, 'error', 'No id_token returned by dialer');
    idToken = tok.id_token;
  } catch (err) {
    log.error('[oidc] token exchange error', { traceId: c.get('traceId') }, err as Error);
    return backToLogin(appOrigin, 'error', 'Token exchange failed');
  }

  let sub: string;
  let email: string | undefined;
  try {
    const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: discovery.issuer,
      audience: clientId,
    });
    if (payload.nonce !== expectedNonce) return backToLogin(appOrigin, 'error', 'Could not verify dialer identity');
    if (!payload.sub) return backToLogin(appOrigin, 'error', 'id_token missing sub claim');
    sub = payload.sub;
    // Only accept the email claim for auto-linking when the IdP asserts it is
    // VERIFIED. The email fallback below silently binds this OIDC sub to an
    // existing local account by email; if the dialer IdP ever let a user set an
    // arbitrary/unverified email, that would be a takeover of the matching Flex
    // account (link attacker's sub → victim's row → full session). Requiring
    // email_verified closes that regardless of the IdP's registration policy.
    email = (payload.email_verified === true && typeof payload.email === 'string')
      ? payload.email
      : undefined;
  } catch (err) {
    log.error('[oidc] id_token verification failed', { traceId: c.get('traceId') }, err as Error);
    return backToLogin(appOrigin, 'error', 'Could not verify dialer identity');
  }

  const db = getDb(env);
  await ensureDialerOidcColumns(db);
  // Link lookup order: an existing dialer_oidc_sub link wins outright; a
  // first-time SSO login for an already-provisioned local account matches by
  // email and self-links (one-time, silent — no new account is created).
  let user = await queryFirst<any>(
    db, `SELECT ${USER_SELECT}, password_hash FROM users WHERE dialer_oidc_sub = ?`, sub,
  );
  if (!user && email) {
    user = await queryFirst<any>(
      db, `SELECT ${USER_SELECT}, password_hash FROM users WHERE email = ? AND dialer_oidc_sub IS NULL`, email,
    );
    if (user) {
      try {
        await execute(db, `UPDATE users SET dialer_oidc_sub = ? WHERE id = ?`, sub, user.id);
      } catch (err) {
        // Unique-index collision (another account already claimed this sub
        // between the SELECT and here) or the column not yet reconciled on
        // this isolate — either way, don't fail the login over it.
        log.error('[oidc] failed to persist dialer_oidc_sub link', { traceId: c.get('traceId') }, err as Error);
      }
    }
  }
  if (!user) {
    return backToLogin(appOrigin, 'error', 'No Flex account is linked to this dialer identity. Contact your administrator.');
  }
  if (user.status !== 'active') {
    return backToLogin(appOrigin, 'error', 'Account is inactive');
  }

  const tokens = await mintLoginTokens(c, db, user);
  const fragment = new URLSearchParams({
    token: tokens.token,
    refreshToken: tokens.refreshToken,
    sessionId: tokens.sessionId,
    expiresIn: String(tokens.expiresIn),
  });
  return c.redirect(`${appOrigin}/oidc-callback#${fragment.toString()}`, 302);
});

export default oidc;
