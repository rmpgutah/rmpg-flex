// Dial Connect SSO (OpenID Connect relying party) -- public router.
// Mounted at /api/oidc/dialer, auth: 'public' (see routesConfig.ts): every
// endpoint here runs before the caller has any RMPG Flex session.
//
// Flow: /check (identifier-first probe) -> /login (PKCE redirect to Dial
// Connect) -> /callback (verify id_token, match local user, mint tokens
// via the SAME issueLoginTokens the password login path uses) -> the
// browser is redirected to the SPA's /sso-callback with a short-lived,
// single-use KV exchange code (NOT the tokens themselves -- the SPA reads
// tokens from localStorage, not cookies, so a full-page OAuth redirect
// can't hand them off directly without exposing them in the URL/logs) ->
// POST /exchange consumes the code and returns the token bundle once.
import { Hono, type Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from '../types';
import { getDb, queryFirst } from '../utils/db';
import { issueLoginTokens } from './auth';
import { readDialerOidcEndpoints, generateCodeVerifier, codeChallengeS256 } from '../utils/sso';
import { rateLimitAllow } from '../utils/rateLimit';
import { log } from '../utils/logger';

const ssoAuth = new Hono<Env>();

const PKCE_COOKIE = 'sso_pkce';
const EXCHANGE_TTL_SECONDS = 30;

// Single-use PKCE artifact: every exit from /callback -- success or
// failure -- clears the cookie rather than letting it linger until its
// 300s maxAge expires.
function clearPkceCookie(c: Context<Env>): void {
  setCookie(c, PKCE_COOKIE, '', { maxAge: 0, path: '/api/oidc/dialer' });
}

function loginFailedRedirect(c: Context<Env>): Response {
  clearPkceCookie(c);
  return c.redirect('https://rmpgutah.us/login?error=sso_failed', 302);
}

// GET /api/oidc/dialer/check?email= -- identifier-first probe for LoginPage.
// Same response shape whether the email doesn't exist OR just isn't
// SSO-enabled, so this can't be used to enumerate valid accounts.
ssoAuth.get('/check', async (c) => {
  const email = c.req.query('email')?.trim().toLowerCase();
  if (!email) return c.json({ ssoEnabled: false });

  const ip = c.req.header('CF-Connecting-IP') || c.req.header('x-forwarded-for') || 'unknown';
  const ok = await rateLimitAllow(c.env.KV, `sso:check:${ip}`, 20, 300);
  if (!ok) return c.json({ ssoEnabled: false });

  try {
    const db = getDb(c.env);
    const user = await queryFirst<{ sso_enabled: number | null }>(
      db,
      `SELECT sso_enabled FROM users WHERE LOWER(email) = ? AND status = 'active'`,
      email,
    );
    return c.json({ ssoEnabled: !!user?.sso_enabled });
  } catch {
    // D1 failure must not block login — degrade to password-only.
    return c.json({ ssoEnabled: false });
  }
});

// GET /api/oidc/dialer/login -- start the PKCE authorization-code flow.
ssoAuth.get('/login', async (c) => {
  const clientId = c.env.DIALER_OIDC_CLIENT_ID;
  const redirectUri = c.env.DIALER_OIDC_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return c.json({ error: 'Dial Connect SSO is not configured' }, 503);
  }

  const endpoints = await readDialerOidcEndpoints(c.env);
  if (!endpoints) {
    return c.json({ error: 'Dial Connect SSO is not configured' }, 503);
  }

  const verifier = generateCodeVerifier();
  const challenge = await codeChallengeS256(verifier);
  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();

  setCookie(c, PKCE_COOKIE, JSON.stringify({ verifier, state, nonce }), {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 300,
    path: '/api/oidc/dialer',
  });

  const authorizeUrl = new URL(endpoints.authorizationEndpoint);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', 'openid profile email');
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('nonce', nonce);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  return c.redirect(authorizeUrl.toString(), 302);
});

// GET /api/oidc/dialer/callback -- the redirect_uri registered with Dial Connect.
ssoAuth.get('/callback', async (c) => {
  try {
    const code = c.req.query('code');
    const state = c.req.query('state');
    const pkceCookie = getCookie(c, PKCE_COOKIE);
    if (!code || !state || !pkceCookie) return loginFailedRedirect(c);

    let pkce: { verifier: string; state: string; nonce: string };
    try {
      pkce = JSON.parse(pkceCookie);
    } catch {
      return loginFailedRedirect(c);
    }
    if (state !== pkce.state) return loginFailedRedirect(c);

    const clientId = c.env.DIALER_OIDC_CLIENT_ID;
    const clientSecret = c.env.DIALER_OIDC_CLIENT_SECRET;
    const redirectUri = c.env.DIALER_OIDC_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) return loginFailedRedirect(c);

    const endpoints = await readDialerOidcEndpoints(c.env);
    if (!endpoints) return loginFailedRedirect(c);

    const tokenRes = await fetch(endpoints.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: pkce.verifier,
      }),
    });
    if (!tokenRes.ok) {
      log.error('[SSO] token exchange failed', { status: tokenRes.status, body: await tokenRes.text() });
      return loginFailedRedirect(c);
    }
    const tok = await tokenRes.json<{ id_token?: string }>();
    if (!tok.id_token) return loginFailedRedirect(c);

    const jwks = createRemoteJWKSet(new URL(endpoints.jwksUri));
    let claims: { sub: string; email?: string; role?: string; nonce?: string };
    try {
      const { payload } = await jwtVerify(tok.id_token, jwks, {
        issuer: endpoints.issuer,
        audience: clientId,
      });
      claims = payload as typeof claims;
    } catch (err) {
      log.error('[SSO] id_token verification failed', {}, err);
      return loginFailedRedirect(c);
    }
    if (claims.nonce !== pkce.nonce || !claims.email) return loginFailedRedirect(c);

    const db = getDb(c.env);
    const matches = await queryFirst<{ count: number }>(
      db,
      `SELECT COUNT(*) as count FROM users WHERE LOWER(email) = LOWER(?) AND sso_enabled = 1 AND status = 'active'`,
      claims.email,
    );
    if (!matches || matches.count !== 1) return loginFailedRedirect(c);

    const user = await queryFirst<any>(
      db,
      `SELECT id, username, full_name, first_name, last_name, email, role, badge_number, phone, avatar_url, status, must_change_password, totp_enabled
       FROM users WHERE LOWER(email) = LOWER(?) AND sso_enabled = 1 AND status = 'active'`,
      claims.email,
    );
    if (!user) return loginFailedRedirect(c);

    const bundle = await issueLoginTokens(c, db, user);
    const exchangeCode = crypto.randomUUID();
    await c.env.KV.put(`sso_exchange:${exchangeCode}`, JSON.stringify(bundle), {
      expirationTtl: EXCHANGE_TTL_SECONDS,
    });

    clearPkceCookie(c);
    return c.redirect(`https://rmpgutah.us/sso-callback?code=${exchangeCode}`, 302);
  } catch (err) {
    log.error('[SSO] callback failed', {}, err);
    return loginFailedRedirect(c);
  }
});

// POST /api/oidc/dialer/exchange -- single-use handoff, called by the SPA's
// /sso-callback page immediately after the redirect above.
ssoAuth.post('/exchange', async (c) => {
  const body = await c.req.json<{ code?: string }>().catch(() => ({}) as any);
  if (!body.code) return c.json({ error: 'Missing code' }, 400);

  const key = `sso_exchange:${body.code}`;
  const stored = await c.env.KV.get(key);
  if (!stored) return c.json({ error: 'Invalid or expired code' }, 400);

  await c.env.KV.delete(key);
  return c.json(JSON.parse(stored));
});

export default ssoAuth;
